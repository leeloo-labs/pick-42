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

function deckEntries(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => ({
    cardId: Number(typeof entry === 'object' ? entry.cardId ?? entry.grpId ?? entry.GrpId : entry),
    quantity: Math.max(1, Number(typeof entry === 'object' ? entry.quantity ?? entry.Quantity : 1) || 1)
  })).filter((entry) => Number.isFinite(entry.cardId));
}

function draftEventInfo(value) {
  const text = String(value || '');
  const normalized = text.toLowerCase().replace(/[^a-z0-9]/g, '');
  let kind = null;
  if (normalized.includes('quickdraft')) kind = 'quick';
  else if (normalized.includes('traditionaldraft')) kind = 'traditional';
  else if (normalized.includes('picktwodraft') || normalized.includes('premierdraft')) kind = 'player';
  if (!kind) return null;

  const eventSet = text.match(/^(?:QuickDraft|PickTwoDraft|PremierDraft|TraditionalDraft)_([A-Z0-9]+)(?:_|$)/i)?.[1];
  const contextSet = text.match(/^([A-Z0-9]+)_(?:Quick_Draft|Premier_Draft|Traditional_Draft|Pick_Two_Draft)(?:_|$)/i)?.[1];
  return { kind, setCode: String(eventSet || contextSet || '').toUpperCase() || null };
}

function sameDraftContext(context, eventName) {
  const contextInfo = draftEventInfo(context);
  const eventInfo = draftEventInfo(eventName);
  if (!contextInfo || !eventInfo || contextInfo.kind !== eventInfo.kind) return false;
  return !contextInfo.setCode || !eventInfo.setCode || contextInfo.setCode === eventInfo.setCode;
}

function courseModulePriority(course) {
  const module = String(course?.CurrentModule ?? course?.currentModule ?? '').toLowerCase();
  if (module === 'botdraft') return 5;
  if (module === 'deckselect') return 4;
  if (module === 'creatematch') return 3;
  if (module === 'complete') return 0;
  return 1;
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
    this.activeEventContext = null;
    this.#resetDraftState();
  }

  #resetDraftState() {
    this.state = {
      draftId: null,
      courseId: null,
      eventName: null,
      format: null,
      setCode: null,
      packNumber: 1,
      pickNumber: 1,
      packCardIds: [],
      pickedCardIds: [],
      arenaMainDeck: [],
      arenaSideboard: [],
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
      pool: this.state.pickedCardIds.map((id) => this.#card(id)),
      arenaDeck: {
        mainDeck: this.state.arenaMainDeck.map((entry) => ({ ...this.#card(entry.cardId), quantity: entry.quantity })),
        sideboard: this.state.arenaSideboard.map((entry) => ({ ...this.#card(entry.cardId), quantity: entry.quantity }))
      }
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

    const courses = value.Courses ?? value.courses;
    if (Array.isArray(courses)) {
      const course = this.#selectDraftCourse(courses);
      if (course) this.#apply(course);
      return;
    }

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
    const sceneContext = String(message.context ?? message.Context ?? '');
    if (draftEventInfo(sceneContext)) this.activeEventContext = sceneContext;

    const label = eventLabel(message);
    const eventName = String(message.EventName ?? message.eventName ?? message.InternalEventName ?? message.internalEventName ?? '');
    const eventInfo = draftEventInfo(eventName);
    const restoredPool = cardIds(message.CardPool ?? message.cardPool);
    const courseSnapshot = message.CourseId !== undefined || message.courseId !== undefined || message.InternalEventName !== undefined || message.internalEventName !== undefined;
    const courseId = String(message.CourseId ?? message.courseId ?? '').trim() || null;
    if (courseSnapshot && eventInfo && courseId) {
      if (this.state.courseId && courseId !== this.state.courseId) this.#resetDraftState();
      this.state.courseId = courseId;
      this.state.eventName = eventName;
      this.state.draftId = courseId;
      this.state.format = eventInfo.kind === 'quick' ? 'Quick Draft' : (eventInfo.kind === 'traditional' ? 'Traditional Draft' : 'Player Draft');
      this.state.setCode = eventInfo.setCode ?? this.state.setCode;
    }
    if (courseSnapshot && eventInfo && restoredPool.length) {
      this.state.draftId = courseId || String(message.draftId ?? message.DraftId ?? eventName);
      this.state.eventName = eventName;
      this.state.packNumber = 3;
      this.state.pickNumber = 14;
      this.state.packCardIds = [];
      this.state.pickedCardIds = restoredPool;
      const courseDeck = message.CourseDeck ?? message.courseDeck;
      const mainDeck = deckEntries(courseDeck?.MainDeck ?? courseDeck?.mainDeck);
      const sideboard = deckEntries(courseDeck?.Sideboard ?? courseDeck?.sideboard);
      this.state.arenaMainDeck = mainDeck;
      this.state.arenaSideboard = sideboard;
      this.#record('Draft pool restored', `${restoredPool.length} cards received from Arena`);
      this.emit('state', this.snapshot());
      return;
    }
    if (courseSnapshot && eventInfo && courseId) {
      this.state.packCardIds = [];
      this.state.pickedCardIds = [];
      this.state.arenaMainDeck = [];
      this.state.arenaSideboard = [];
      this.#record('Draft course opened', eventName);
      this.emit('state', this.snapshot());
      return;
    }

    const inferredDraftId = /^(QuickDraft|PickTwoDraft|PremierDraft|TraditionalDraft)_/i.test(eventName) ? eventName : null;
    const associatedCourseId = inferredDraftId && this.state.eventName === eventName ? this.state.courseId : null;
    const draftId = message.draftId ?? message.DraftId ?? associatedCourseId ?? inferredDraftId;
    if (draftId && this.state.draftId && String(draftId) !== this.state.draftId) this.#resetDraftState();
    if (draftId) this.state.draftId = String(draftId);
    if (eventInfo) this.state.eventName = eventName;

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

  #selectDraftCourse(courses) {
    const candidates = courses.filter((course) => {
      const eventName = course?.InternalEventName ?? course?.internalEventName;
      return draftEventInfo(eventName) && cardIds(course?.CardPool ?? course?.cardPool).length;
    });
    if (!candidates.length) return null;

    const activeCourse = candidates.find((course) => String(course.CourseId ?? course.courseId ?? '') === this.state.courseId);
    if (activeCourse) return activeCourse;

    const contextual = candidates.filter((course) => sameDraftContext(
      this.activeEventContext,
      course.InternalEventName ?? course.internalEventName
    ));
    if (contextual.length) return this.#mostCurrentCourse(contextual);

    const currentEvent = candidates.filter((course) => String(course.InternalEventName ?? course.internalEventName) === this.state.eventName);
    if (currentEvent.length) return this.#mostCurrentCourse(currentEvent);
    return this.#mostCurrentCourse(candidates);
  }

  #mostCurrentCourse(courses) {
    return courses
      .map((course, index) => ({ course, index }))
      .sort((left, right) => courseModulePriority(right.course) - courseModulePriority(left.course)
        || cardIds(right.course.CardPool ?? right.course.cardPool).length - cardIds(left.course.CardPool ?? left.course.cardPool).length
        || right.index - left.index)[0]?.course || null;
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
