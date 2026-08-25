'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ArenaLogParser } = require('../src/core/arena-log-parser.cjs');

const projectRoot = path.resolve(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(projectRoot, 'fixtures', 'demo-cards.json'), 'utf8'));

test('reconstructs a match from full and diff game-state messages', () => {
  const parser = new ArenaLogParser({ catalog });
  parser.feed(fs.readFileSync(path.join(projectRoot, 'fixtures', 'demo-match.log'), 'utf8'));
  const state = parser.snapshot();

  assert.equal(state.matchId, 'demo-match');
  assert.equal(state.localSeatId, 1);
  assert.deepEqual(state.turn, {
    number: 6,
    phase: 'Combat',
    step: 'Declare attackers',
    activeSeatId: 1,
    prioritySeatId: 1,
    decisionSeatId: 1
  });
  assert.equal(state.players.find((player) => player.seatId === 2).life, 6);
  assert.deepEqual(state.hand.map((card) => card.name), ['Monstrous Rage']);
  assert.equal(state.zones.find((zone) => zone.seatId === 1).graveyard, 1);
  assert.equal(state.zones.find((zone) => zone.seatId === 2).hand, 4);
  assert.equal(state.availableActions[0].card.name, 'Charming Scoundrel');
  assert.equal(state.availableActions[0].card.power, 2);
  assert.ok(state.events.some((event) => event.title === 'Opponent lost 3 life'));
  assert.ok(state.events.some((event) => event.title === '3 damage dealt'));
});

test('parses game-state JSON nested in Arena Payload strings', () => {
  const parser = new ArenaLogParser();
  const nestedMessage = {
    greToClientMessages: [{
      type: 'GREMessageType_GameStateMessage',
      systemSeatIds: [2],
      gameStateMessage: {
        gameInfo: { matchID: 'nested-match', gameNumber: 1 },
        players: [
          { systemSeatNumber: 1, lifeTotal: 20 },
          { systemSeatNumber: 2, lifeTotal: 19 }
        ]
      }
    }]
  };
  parser.feed(JSON.stringify({ Payload: JSON.stringify(nestedMessage) }));
  const state = parser.snapshot();

  assert.equal(state.matchId, 'nested-match');
  assert.equal(state.localSeatId, 2);
  assert.equal(state.players.find((player) => player.seatId === 2).label, 'You');
});

test('does not invent identities for hidden opponent hand objects', () => {
  const parser = new ArenaLogParser({ catalog });
  parser.feed(fs.readFileSync(path.join(projectRoot, 'fixtures', 'demo-match.log'), 'utf8'));
  const state = parser.snapshot();

  assert.equal(state.zones.find((zone) => zone.seatId === 2).hand, 4);
  assert.deepEqual(state.knownOpponentCards.map((card) => card.name).sort(), ['Hamlet Glutton', 'Rootrider Faun']);
});

test('clears known cards and match-scoped state when a new game begins', () => {
  const parser = new ArenaLogParser({
    catalog: {
      3001: { name: 'Game One Card', typeLine: 'Creature' },
      3002: { name: 'Game Two Card', typeLine: 'Creature' }
    }
  });

  const gameState = (gameNumber, instanceId, grpId) => JSON.stringify({
    greToClientMessages: [{
      type: 'GREMessageType_GameStateMessage',
      systemSeatIds: [1],
      gameStateMessage: {
        type: 'GameStateType_Full',
        gameInfo: { matchID: 'best-of-three-match', gameNumber },
        players: [
          { systemSeatNumber: 1, lifeTotal: 20 },
          { systemSeatNumber: 2, lifeTotal: 20 }
        ],
        gameObjects: [{
          instanceId,
          grpId,
          type: 'GameObjectType_Card',
          ownerSeatId: 2,
          controllerSeatId: 2
        }],
        zones: [{
          zoneId: gameNumber * 100,
          type: 'ZoneType_Battlefield',
          ownerSeatId: 2,
          objectInstanceIds: [instanceId]
        }]
      }
    }]
  });

  parser.feed(gameState(1, 401, 3001));
  assert.deepEqual(parser.snapshot().knownOpponentCards.map((card) => card.name), ['Game One Card']);

  parser.feed(gameState(2, 501, 3002));
  const secondGame = parser.snapshot();
  assert.equal(secondGame.gameNumber, 2);
  assert.deepEqual(secondGame.knownOpponentCards.map((card) => card.name), ['Game Two Card']);
  assert.equal(secondGame.battlefield.length, 1);
});

test('exposes a local win result and named local graveyard cards for review', () => {
  const parser = new ArenaLogParser({
    catalog: { 3001: { name: 'Reviewed Spell', manaCost: '{1}{B}', typeLine: 'Instant' } }
  });
  parser.feed(JSON.stringify({
    greToClientMessages: [{
      type: 'GREMessageType_GameStateMessage',
      systemSeatIds: [1],
      gameStateMessage: {
        gameInfo: {
          matchID: 'completed-review-match',
          gameNumber: 1,
          results: [{ winningTeamId: 1, reason: 'ResultReason_Concede' }]
        },
        gameObjects: [{ instanceId: 41, grpId: 3001, ownerSeatId: 1, controllerSeatId: 1 }],
        zones: [{ zoneId: 12, type: 'ZoneType_Graveyard', ownerSeatId: 1, objectInstanceIds: [41] }]
      }
    }]
  }));

  const state = parser.snapshot();
  assert.equal(state.complete, true);
  assert.deepEqual(state.result, { winnerSeatId: 1, won: true, reason: 'Concede' });
  assert.deepEqual(state.graveyard.map((card) => card.name), ['Reviewed Spell']);
});

test('preserves a stable card identity when Arena changes object ids between zones', () => {
  const parser = new ArenaLogParser({
    catalog: { 3001: { name: 'Traveling Spell', manaCost: '{1}{R}', typeLine: 'Sorcery' } }
  });
  parser.feed(JSON.stringify({
    greToClientMessages: [{
      type: 'GREMessageType_GameStateMessage',
      systemSeatIds: [1],
      gameStateMessage: {
        gameInfo: { matchID: 'stable-card-match', gameNumber: 1 },
        players: [{ systemSeatNumber: 1 }, { systemSeatNumber: 2 }],
        gameObjects: [{ instanceId: 41, grpId: 3001, type: 'GameObjectType_Card', ownerSeatId: 1, controllerSeatId: 1 }],
        zones: [{ zoneId: 10, type: 'ZoneType_Hand', ownerSeatId: 1, objectInstanceIds: [41] }]
      }
    }]
  }));
  parser.feed(JSON.stringify({
    greToClientMessages: [{
      type: 'GREMessageType_GameStateMessage',
      systemSeatIds: [1],
      gameStateMessage: {
        gameObjects: [{ instanceId: 72, grpId: 3001, type: 'GameObjectType_Card', ownerSeatId: 1, controllerSeatId: 1 }],
        zones: [
          { zoneId: 10, type: 'ZoneType_Hand', ownerSeatId: 1, objectInstanceIds: [] },
          { zoneId: 12, type: 'ZoneType_Graveyard', ownerSeatId: 1, objectInstanceIds: [72] }
        ],
        annotations: [{
          type: ['AnnotationType_ObjectIdChanged'],
          affectedIds: [72],
          details: [
            { key: 'orig_id', valueInt32: [41] },
            { key: 'new_id', valueInt32: [72] }
          ]
        }]
      }
    }]
  }));

  const state = parser.snapshot();
  assert.equal(state.graveyard[0].instanceId, 72);
  assert.equal(state.graveyard[0].stableId, 41);
});

test('captures cumulative attacker choices with granted flying from client combat responses', () => {
  const parser = new ArenaLogParser({
    catalog: {
      5001: { name: 'Human Soldier', typeLine: 'Creature — Human Soldier', rulesText: '' },
      5002: { name: "Eagle's Rescue", typeLine: 'Enchantment — Aura', rulesText: 'Enchanted creature gets +2/+2 and has flying.' },
      5003: { name: 'Dragon', typeLine: 'Creature — Dragon', rulesText: 'Flying' },
      5004: { name: 'Goblin Plate Mail', typeLine: 'Artifact — Equipment', rulesText: 'Equipped creature gets +1/+0 and has menace.' },
      5005: { name: 'Dreaded Bat-Cloud', typeLine: 'Creature — Bat', rulesText: 'Flying\nDeathtouch' },
      5006: { name: 'Patient Instructor', typeLine: 'Creature — Human Citizen', rulesText: 'Vigilance' },
      5007: { name: 'Thorin Oakenshield', typeLine: 'Creature — Dwarf Noble', rulesText: '' },
      5008: { name: 'Misty Mountains Raider', typeLine: 'Creature — Goblin Soldier', rulesText: '' },
      5009: { name: 'Army', typeLine: 'Creature — Goblin Army', rulesText: '' },
      5010: { name: 'Great Goblin', typeLine: 'Creature — Goblin Soldier', rulesText: '' }
    }
  });
  parser.feed(fs.readFileSync(path.join(projectRoot, 'fixtures', 'tactical-turning-point.log'), 'utf8'));

  const state = parser.snapshot();
  assert.equal(state.combatChoices.length, 1);
  assert.deepEqual(state.combatChoices[0].attackers.map((card) => card.name), ['Human Soldier', 'Patient Instructor']);
  assert.match(state.combatChoices[0].attackers[0].effectiveRulesText, /flying/i);
  assert.equal(state.combatChoices[0].board.you.life, 4);
  assert.equal(state.combatChoices[0].board.you.creatures.length, 6);
});
