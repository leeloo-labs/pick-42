'use strict';

const { EventEmitter } = require('node:events');
const { JsonEntryStream } = require('../core/json-entry-stream.cjs');

function eventLabel(value) {
  return String(value?.type || value?.eventName || value?.EventName || value?.messageType || value?.method || '');
}

function cardIds(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => Number(typeof entry === 'object' ? entry.grpId ?? entry.GrpId ?? entry.cardId : entry)).filter(Number.isFinite);
}

class DraftLogParser extends EventEmitter {
  constructor({ catalog = {} } = {}) {
    super();
    this.catalog = catalog;
    this.stream = new JsonEntryStream((document) => this.#consume(document));
    this.reset();
  }

  reset() {
    this.stream?.reset();
    this.#resetDraftState();
  }

  #resetDraftState() {
    this.state = {
      draftId: null,
      format: null,
      setCode: null,
      packNumber: 1,
      pickNumber: 1,
      packCardIds: [],
      pickedCardIds: [],
      events: []
    };
  }

  setCatalog(catalog) {
    this.catalog = catalog || {};
  }

  feed(chunk) {
    this.stream.push(chunk);
  }

  snapshot() {
    return {
      ...this.state,
      pack: this.state.packCardIds.map((id) => this.#card(id)),
      pool: this.state.pickedCardIds.map((id) => this.#card(id))
    };
  }

  #card(id) {
    return { grpId: id, ...(this.catalog[String(id)] || { name: `Arena card ${id}`, manaCost: '', typeLine: '' }) };
  }

  #consume(document) {
    this.#walk(document, new Set());
  }

  #walk(value, seen) {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    this.#apply(value);

    for (const child of Object.values(value)) {
      if (typeof child === 'string' && child.trim().startsWith('{')) {
        try { this.#walk(JSON.parse(child), seen); } catch { /* Arena mixes ordinary strings with JSON payloads. */ }
      } else if (Array.isArray(child)) {
        for (const entry of child) this.#walk(entry, seen);
      } else {
        this.#walk(child, seen);
      }
    }
  }

  #apply(message) {
    const label = eventLabel(message);
    const eventName = String(message.EventName ?? message.eventName ?? '');
    const inferredDraftId = /^(QuickDraft|PickTwoDraft|PremierDraft|TraditionalDraft)_/i.test(eventName) ? eventName : null;
    const draftId = message.draftId ?? message.DraftId ?? inferredDraftId;
    if (draftId && this.state.draftId && String(draftId) !== this.state.draftId) this.#resetDraftState();
    if (draftId) this.state.draftId = String(draftId);

    const quickDraft = /^QuickDraft_/i.test(eventName) || message.DraftPack !== undefined || message.draftPack !== undefined;
    const setFromEvent = eventName.match(/^(?:QuickDraft|PickTwoDraft|PremierDraft|TraditionalDraft)_([A-Z0-9]+)_/i)?.[1];

    const pack = cardIds(message.PackCards ?? message.packCards ?? message.DraftPack ?? message.draftPack);
    const picked = cardIds(message.PickedCards ?? message.pickedCards);
    if (pack.length) {
      this.state.packCardIds = pack;
      if (picked.length) this.state.pickedCardIds = picked;
      this.state.format = quickDraft ? 'Quick Draft' : 'Player Draft';
      this.state.packNumber = this.#displayNumber(message.SelfPack ?? message.PackNumber ?? message.packNumber, this.state.packNumber, quickDraft);
      this.state.pickNumber = this.#displayNumber(message.SelfPick ?? message.PickNumber ?? message.pickNumber, this.state.pickNumber, quickDraft);
      this.state.setCode = message.setCode ?? message.SetCode ?? setFromEvent ?? this.state.setCode;
      this.#record(`Pack ${this.state.packNumber}, pick ${this.state.pickNumber}`, `${pack.length} cards received from Arena`);
      this.emit('state', this.snapshot());
      return;
    }

    if (picked.length) {
      this.state.pickedCardIds = picked;
      this.emit('state', this.snapshot());
      return;
    }

    const selection = cardIds(message.CardIds ?? message.cardIds);
    const singleSelection = Number(message.GrpId ?? message.grpId ?? message.CardId ?? message.cardId);
    if (/makepick|draftpick/i.test(label) || (/draft/i.test(label) && (selection.length || Number.isFinite(singleSelection)))) {
      const selected = selection.length ? selection : [singleSelection].filter(Number.isFinite);
      let changed = false;
      for (const pickedId of selected) {
        if (this.state.pickedCardIds.includes(pickedId)) continue;
        this.state.pickedCardIds.push(pickedId);
        this.state.packCardIds = this.state.packCardIds.filter((id) => id !== pickedId);
        this.#record(`Picked ${this.#card(pickedId).name}`, `Pack ${this.state.packNumber}, pick ${this.state.pickNumber}`);
        changed = true;
      }
      if (changed) this.emit('state', this.snapshot());
    }
  }

  #displayNumber(value, fallback, zeroBased = false) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return zeroBased ? number + 1 : (number === 0 ? 1 : number);
  }

  #record(title, detail) {
    const last = this.state.events[0];
    if (last?.title === title && last?.detail === detail) return;
    this.state.events.unshift({ title, detail, at: Date.now() });
    this.state.events = this.state.events.slice(0, 20);
  }
}

module.exports = { DraftLogParser };
