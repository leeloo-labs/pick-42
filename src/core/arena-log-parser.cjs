'use strict';

const { EventEmitter } = require('node:events');
const { JsonEntryStream } = require('./json-entry-stream.cjs');

const ZONE_LABELS = {
  ZoneType_Battlefield: 'Battlefield',
  ZoneType_Command: 'Command',
  ZoneType_Exile: 'Exile',
  ZoneType_Graveyard: 'Graveyard',
  ZoneType_Hand: 'Hand',
  ZoneType_Library: 'Library',
  ZoneType_Limbo: 'Limbo',
  ZoneType_Pending: 'Pending',
  ZoneType_Revealed: 'Revealed',
  ZoneType_Sideboard: 'Sideboard',
  ZoneType_Stack: 'Stack'
};

const PHASE_LABELS = {
  Phase_Beginning: 'Beginning',
  Phase_Combat: 'Combat',
  Phase_Ending: 'Ending',
  Phase_Main1: 'First main',
  Phase_Main2: 'Second main'
};

const STEP_LABELS = {
  Step_BeginCombat: 'Begin combat',
  Step_DeclareAttack: 'Declare attackers',
  Step_DeclareBlock: 'Declare blockers',
  Step_CombatDamage: 'Combat damage',
  Step_Damage: 'Damage',
  Step_Draw: 'Draw',
  Step_End: 'End step',
  Step_EndCombat: 'End combat',
  Step_FirstStrikeDamage: 'First-strike damage',
  Step_Upkeep: 'Upkeep'
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function parseMaybeJson(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function enumLabel(value, prefix, fallback = 'Unknown') {
  if (!value) return fallback;
  return String(value).replace(prefix, '').replaceAll('_', ' ');
}

function characteristicValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  if (value && typeof value === 'object') {
    for (const key of ['value', 'current', 'baseValue', 'int32Value']) {
      const candidate = Array.isArray(value[key]) ? value[key][0] : value[key];
      const normalized = characteristicValue(candidate);
      if (normalized !== null) return normalized;
    }
  }
  return null;
}

function objectTypeLine(object) {
  const types = (object?.cardTypes || []).map((type) => enumLabel(type, 'CardType_', '')).filter(Boolean);
  const subtypes = (object?.subtypes || []).map((type) => enumLabel(type, 'SubType_', '')).filter(Boolean);
  return types.join(' ') + (subtypes.length ? ` — ${subtypes.join(' ')}` : '');
}

class ArenaLogParser extends EventEmitter {
  constructor({ catalog = {}, maxEvents = 60 } = {}) {
    super();
    this.catalog = catalog;
    this.maxEvents = maxEvents;
    this.entryStream = new JsonEntryStream((document) => this.#processDocument(document));
    this.reset();
  }

  reset() {
    this.entryStream?.reset();
    this.#clearGameState({ connected: false, localSeatId: null });
    this.#emitState();
  }

  #clearGameState({ connected, localSeatId }) {
    this.objects = new Map();
    this.zones = new Map();
    this.players = new Map();
    this.seenCardIds = new Set();
    this.state = {
      connected,
      complete: false,
      matchId: null,
      gameNumber: null,
      stage: null,
      localSeatId,
      turn: {
        number: 0,
        phase: 'Waiting',
        step: '',
        activeSeatId: null,
        prioritySeatId: null,
        decisionSeatId: null
      },
      players: [],
      zones: [],
      battlefield: [],
      hand: [],
      stack: [],
      knownOpponentCards: [],
      availableActions: [],
      events: [],
      lastUpdatedAt: null
    };
    this.hasInitialGameState = false;
  }

  feed(chunk) {
    this.entryStream.push(chunk);
  }

  setCatalog(catalog) {
    this.catalog = catalog || {};
    this.#emitState();
  }

  snapshot() {
    return clone(this.state);
  }

  #processDocument(root) {
    const queue = [root];
    const visited = new Set();

    while (queue.length > 0) {
      const value = queue.shift();
      if (!value || typeof value !== 'object' || visited.has(value)) continue;
      visited.add(value);

      if (Array.isArray(value)) {
        queue.push(...value);
        continue;
      }

      if (typeof value.type === 'string' && value.type.startsWith('GREMessageType_')) {
        this.#handleGreMessage(value);
      }

      for (const [key, child] of Object.entries(value)) {
        if (child && typeof child === 'object') {
          queue.push(child);
        } else if (['Payload', 'payload', 'request', 'response'].includes(key)) {
          const parsed = parseMaybeJson(child);
          if (parsed) queue.push(parsed);
        }
      }
    }
  }

  #handleGreMessage(message) {
    if (Array.isArray(message.systemSeatIds)) {
      const seat = message.systemSeatIds.find((seatId) => Number(seatId) > 0);
      if (seat) this.state.localSeatId = Number(seat);
    }

    if (message.type === 'GREMessageType_ConnectResp') {
      const response = message.connectResp || message;
      const nextMatchId = response.matchId || response.matchID;
      if (nextMatchId && this.state.matchId && nextMatchId !== this.state.matchId) {
        this.#clearGameState({ connected: true, localSeatId: this.state.localSeatId });
      }
      this.state.connected = true;
      if (nextMatchId) this.state.matchId = nextMatchId;
      this.#emitState();
      return;
    }

    if (message.type === 'GREMessageType_GameStateMessage' || message.gameStateMessage) {
      this.#applyGameState(message.gameStateMessage || message);
    }
  }

  #applyGameState(update) {
    const nextMatchId = update.gameInfo?.matchID || update.gameInfo?.matchId || null;
    const nextGameNumber = update.gameInfo?.gameNumber ?? null;
    const matchChanged = Boolean(this.state.matchId && nextMatchId && this.state.matchId !== nextMatchId);
    const gameChanged = Boolean(
      this.state.gameNumber !== null &&
      nextGameNumber !== null &&
      this.state.gameNumber !== nextGameNumber
    );

    if (matchChanged || gameChanged) {
      this.#clearGameState({ connected: true, localSeatId: this.state.localSeatId });
    }

    const wasInitialized = this.hasInitialGameState;
    const previousTurn = { ...this.state.turn };

    this.state.connected = true;
    this.#applyGameInfo(update.gameInfo);
    this.#applyPlayers(update.players, wasInitialized);
    this.#applyObjects(update.gameObjects);
    this.#applyDeletedObjects(update.diffDeletedInstanceIds);
    this.#applyZones(update.zones, wasInitialized);
    this.#applyTurn(update.turnInfo, previousTurn, wasInitialized);
    this.#applyActions(update.actions);
    this.#applyAnnotations(update.annotations);

    this.hasInitialGameState = true;
    this.#emitState();
  }

  #applyGameInfo(gameInfo) {
    if (!gameInfo) return;
    const nextMatchId = gameInfo.matchID || gameInfo.matchId || this.state.matchId;
    if (nextMatchId && nextMatchId !== this.state.matchId) this.state.complete = false;
    this.state.matchId = nextMatchId;
    this.state.gameNumber = gameInfo.gameNumber ?? this.state.gameNumber;
    this.state.stage = gameInfo.stage || this.state.stage;

    if (Array.isArray(gameInfo.results) && gameInfo.results.length > 0) {
      const result = gameInfo.results.at(-1);
      const winner = result.winningTeamId || result.winningSeatId;
      if (winner) {
        this.state.complete = true;
        this.state.availableActions = [];
        this.#addEvent({
          kind: 'result',
          title: Number(winner) === this.state.localSeatId ? 'Game won' : 'Game finished',
          detail: enumLabel(result.reason, 'ResultReason_', 'Result recorded')
        });
      }
    }
  }

  #applyPlayers(players, announceChanges) {
    if (!Array.isArray(players)) return;

    for (const patch of players) {
      const seatId = Number(patch.systemSeatNumber || patch.seatId);
      if (!seatId) continue;
      const previous = this.players.get(seatId) || {};
      const next = { ...previous, ...patch, seatId };
      this.players.set(seatId, next);

      if (
        announceChanges &&
        Number.isFinite(previous.lifeTotal) &&
        Number.isFinite(next.lifeTotal) &&
        previous.lifeTotal !== next.lifeTotal
      ) {
        const delta = next.lifeTotal - previous.lifeTotal;
        this.#addEvent({
          kind: delta > 0 ? 'gain' : 'damage',
          title: `${this.#seatLabel(seatId)} ${delta > 0 ? 'gained' : 'lost'} ${Math.abs(delta)} life`,
          detail: `${previous.lifeTotal} → ${next.lifeTotal}`
        });
      }
    }
  }

  #applyObjects(gameObjects) {
    if (!Array.isArray(gameObjects)) return;

    for (const patch of gameObjects) {
      const instanceId = Number(patch.instanceId);
      if (!instanceId) continue;
      const previous = this.objects.get(instanceId) || {};
      const next = { ...previous, ...patch, instanceId };
      if (next.grpId) this.seenCardIds.add(Number(next.grpId));
      this.objects.set(instanceId, next);
    }
  }

  #applyDeletedObjects(instanceIds) {
    if (!Array.isArray(instanceIds)) return;
    for (const instanceId of instanceIds) this.objects.delete(Number(instanceId));
  }

  #applyZones(zones, announceChanges) {
    if (!Array.isArray(zones)) return;

    for (const patch of zones) {
      const zoneId = Number(patch.zoneId);
      if (!zoneId) continue;
      const previous = this.zones.get(zoneId) || {};
      const previousIds = new Set(previous.objectInstanceIds || []);
      const next = { ...previous, ...patch, zoneId };
      if (Array.isArray(patch.objectInstanceIds)) {
        next.objectInstanceIds = patch.objectInstanceIds.map(Number);
      }
      this.zones.set(zoneId, next);

      for (const instanceId of next.objectInstanceIds || []) {
        const object = this.objects.get(instanceId) || { instanceId };
        const oldZoneId = object.zoneId;
        object.zoneId = zoneId;
        this.objects.set(instanceId, object);

        if (announceChanges && oldZoneId && oldZoneId !== zoneId && !previousIds.has(instanceId)) {
          this.#addZoneMove(object, oldZoneId, zoneId);
        }
      }
    }
  }

  #applyTurn(turnInfo, previous, announceChanges) {
    if (!turnInfo) return;
    const next = {
      number: Number(turnInfo.turnNumber ?? previous.number ?? 0),
      phase: PHASE_LABELS[turnInfo.phase] || enumLabel(turnInfo.phase, 'Phase_', previous.phase),
      step: STEP_LABELS[turnInfo.step] || enumLabel(turnInfo.step, 'Step_', ''),
      activeSeatId: Number(turnInfo.activePlayer || turnInfo.activeSeatId || 0) || null,
      prioritySeatId: Number(turnInfo.priorityPlayer || turnInfo.prioritySeatId || 0) || null,
      decisionSeatId: Number(turnInfo.decisionPlayer || turnInfo.decisionSeatId || 0) || null
    };
    this.state.turn = next;

    const phaseChanged = next.phase !== previous.phase || next.step !== previous.step;
    const turnChanged = next.number !== previous.number;
    if (announceChanges && (turnChanged || phaseChanged)) {
      this.#addEvent({
        kind: 'phase',
        title: turnChanged ? `Turn ${next.number}` : (next.step || next.phase),
        detail: `${this.#seatLabel(next.activeSeatId)} · ${next.phase}${next.step ? ` · ${next.step}` : ''}`
      });
    }
  }

  #applyActions(actions) {
    if (!Array.isArray(actions)) return;
    const localActions = actions
      .filter((entry) => !this.state.localSeatId || Number(entry.seatId) === this.state.localSeatId)
      .map((entry) => entry.action || entry)
      .map((action) => ({
        type: enumLabel(action.actionType, 'ActionType_', 'Action'),
        instanceId: action.instanceId ? Number(action.instanceId) : null,
        card: action.instanceId ? this.#cardForObject(this.objects.get(Number(action.instanceId))) : null
      }));
    this.state.availableActions = localActions;
  }

  #applyAnnotations(annotations) {
    if (!Array.isArray(annotations)) return;
    for (const annotation of annotations) {
      const types = Array.isArray(annotation.type) ? annotation.type : [annotation.type];
      if (!types.includes('AnnotationType_DamageDealt')) continue;
      const amount = this.#annotationNumber(annotation, ['damage', 'amount']);
      const sourceId = Number(annotation.affectorId || annotation.sourceId || 0);
      const source = this.#cardForObject(this.objects.get(sourceId));
      this.#addEvent({
        kind: 'damage',
        title: amount ? `${amount} damage dealt` : 'Damage dealt',
        detail: source?.name || 'Combat or spell damage'
      });
    }
  }

  #annotationNumber(annotation, keys) {
    for (const detail of annotation.details || []) {
      const key = String(detail.key || '').toLowerCase();
      if (keys.some((candidate) => key.includes(candidate))) {
        const value = Number(detail.valueInt32?.[0] ?? detail.valueUint32?.[0] ?? detail.valueString?.[0]);
        if (Number.isFinite(value)) return value;
      }
    }
    return null;
  }

  #addZoneMove(object, fromZoneId, toZoneId) {
    const from = this.zones.get(fromZoneId);
    const to = this.zones.get(toZoneId);
    if (!to) return;
    const card = this.#cardForObject(object);
    const fromLabel = ZONE_LABELS[from?.type] || 'another zone';
    const toLabel = ZONE_LABELS[to.type] || 'another zone';
    this.#addEvent({
      kind: to.type === 'ZoneType_Graveyard' ? 'graveyard' : 'move',
      title: card?.name || 'A card moved',
      detail: `${fromLabel} → ${toLabel}`
    });
  }

  #addEvent(event) {
    const fingerprint = `${event.kind}|${event.title}|${event.detail}|${this.state.turn.number}|${this.state.turn.phase}`;
    if (this.state.events[0]?.fingerprint === fingerprint) return;
    this.state.events.unshift({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      timestamp: new Date().toISOString(),
      turn: this.state.turn.number,
      fingerprint,
      ...event
    });
    this.state.events = this.state.events.slice(0, this.maxEvents);
  }

  #seatLabel(seatId) {
    if (!seatId) return 'Unknown player';
    return Number(seatId) === this.state.localSeatId ? 'You' : 'Opponent';
  }

  #cardForObject(object) {
    if (!object) return null;
    const grpId = Number(object.grpId || 0);
    const catalogCard = this.catalog[String(grpId)] || {};
    return {
      instanceId: object.instanceId,
      grpId: grpId || null,
      name: catalogCard.name || (grpId ? `Arena card ${grpId}` : 'Unknown card'),
      manaCost: catalogCard.manaCost || '',
      typeLine: catalogCard.typeLine || objectTypeLine(object),
      objectType: object.type || null,
      image: catalogCard.image || null,
      ownerSeatId: Number(object.ownerSeatId || 0) || null,
      controllerSeatId: Number(object.controllerSeatId || 0) || null,
      power: characteristicValue(object.power ?? object.attackPower),
      toughness: characteristicValue(object.toughness ?? object.defense),
      tapped: Boolean(object.isTapped || object.tapped),
      zoneId: object.zoneId || null
    };
  }

  #cardsInZone(zoneType, seatId = null) {
    const cards = [];
    for (const zone of this.zones.values()) {
      const ownerSeatId = Number(zone.ownerSeatId || zone.seatId || 0) || null;
      if (zone.type !== zoneType || (seatId && ownerSeatId !== seatId)) continue;
      for (const instanceId of zone.objectInstanceIds || []) {
        cards.push(this.#cardForObject(this.objects.get(Number(instanceId)) || { instanceId }));
      }
    }
    return cards;
  }

  #countZone(zoneType, seatId) {
    return this.#cardsInZone(zoneType, seatId).length;
  }

  #emitState() {
    const localSeat = this.state.localSeatId;
    const opponentSeats = [...this.players.keys()].filter((seatId) => seatId !== localSeat);
    const opponentSeat = opponentSeats[0] || (localSeat === 1 ? 2 : 1);

    this.state.players = [...this.players.values()]
      .map((player) => ({
        seatId: player.seatId,
        label: this.#seatLabel(player.seatId),
        life: player.lifeTotal ?? null,
        maxHandSize: player.maxHandSize ?? null
      }))
      .sort((a, b) => a.seatId - b.seatId);

    this.state.zones = [localSeat, opponentSeat].filter(Boolean).map((seatId) => ({
      seatId,
      label: this.#seatLabel(seatId),
      hand: this.#countZone('ZoneType_Hand', seatId),
      library: this.#countZone('ZoneType_Library', seatId),
      graveyard: this.#countZone('ZoneType_Graveyard', seatId),
      exile: this.#countZone('ZoneType_Exile', seatId)
    }));
    this.state.hand = localSeat ? this.#cardsInZone('ZoneType_Hand', localSeat) : [];
    this.state.battlefield = this.#cardsInZone('ZoneType_Battlefield');
    this.state.stack = this.#cardsInZone('ZoneType_Stack');

    const known = new Map();
    for (const object of this.objects.values()) {
      const card = this.#cardForObject(object);
      const isCard = !card.objectType || ['GameObjectType_Card', 'GameObjectType_Token'].includes(card.objectType);
      if (card.ownerSeatId === opponentSeat && card.grpId && isCard) known.set(card.grpId, card);
    }
    this.state.knownOpponentCards = [...known.values()];
    this.state.lastUpdatedAt = new Date().toISOString();
    this.emit('state', this.snapshot());
  }
}

module.exports = { ArenaLogParser, PHASE_LABELS, STEP_LABELS, ZONE_LABELS };
