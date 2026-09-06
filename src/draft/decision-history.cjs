'use strict';

const clone = (value) => JSON.parse(JSON.stringify(value));
const cardId = (card) => String(card.grpId ?? card.name);
const counts = (cards) => {
  const result = new Map();
  for (const card of cards) result.set(cardId(card), (result.get(cardId(card)) || 0) + Number(card.quantity || 1));
  return result;
};
function contentId(value) {
  let hash = 2166136261;
  const text = JSON.stringify(value);
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}
function createDecisionHistory({ write = () => {}, now = () => new Date().toISOString(), maxDrafts = 10 } = {}) {
  let records = [];
  const persist = () => write({ version: 1, records: clone(records.filter((record) => !record.demo)) });
  const trim = () => {
    const drafts = [...new Set(records.filter((record) => !record.demo).map((record) => record.draftId))];
    const retained = new Set(drafts.slice(-maxDrafts));
    records = records.filter((record) => record.demo || retained.has(record.draftId));
  };
  const keyFor = (state, demo = false) => JSON.stringify([demo ? 'sample' : 'live', state.draftId, state.setCode, state.format, state.packNumber, state.pickNumber]);
  return {
    hydrate(value) {
      if (value?.version !== 1 || !Array.isArray(value.records)) return;
      const restored = clone(value.records.filter((record) => record && !record.demo && typeof record.id === 'string'
        && typeof record.draftId === 'string' && Array.isArray(record.pack) && Array.isArray(record.pool)
        && Array.isArray(record.recommendations) && record.gate && Array.isArray(record.actual)));
      records = [...new Map([...restored, ...records].map((record) => [record.id, record])).values()];
      trim();
    },
    resetSample() { records = records.filter((record) => !record.demo); },
    capture(snapshot) {
      if (!snapshot.draftId || !snapshot.pack?.length || !snapshot.packNumber || !snapshot.pickNumber) return false;
      const id = keyFor(snapshot, snapshot.demo);
      const existing = records.find((record) => record.id === id);
      if (existing?.actual?.length) return false;
      const signature = contentId(snapshot);
      if (existing?.signature === signature) return false;
      const entry = { ...clone(snapshot), id, signature, observedAt: existing?.observedAt || now(), updatedAt: now(), bookmarked: existing?.bookmarked || false, actual: [] };
      if (existing) records[records.indexOf(existing)] = entry;
      else records.push(entry);
      trim();
      if (!entry.demo) persist();
      return true;
    },
    observePool(state, demo = false, previous = state) {
      // Match the recorded decision against visible pool growth, preserving copy
      // counts. Course jumps and unseen packs cannot manufacture a selection.
      const candidates = records.filter((record) => record.demo === demo && record.draftId === state.draftId && record.id === keyFor(previous, demo) && !record.actual.length);
      let changed = false;
      for (const record of candidates) {
        const before = counts(record.pool), after = counts(state.pool || []), pack = counts(record.pack);
        if ([...before].some(([id, n]) => (after.get(id) || 0) < n)) continue;
        const added = [];
        for (const [id, n] of after) {
          const delta = n - (before.get(id) || 0);
          for (let i = 0; i < delta; i++) added.push(id);
        }
        if (added.length !== record.pickCount || added.some((id) => !pack.has(id))) continue;
        if ([...counts(added.map((grpId) => ({ grpId })))].some(([id, n]) => n > pack.get(id))) continue;
        record.actual = added.map((id) => clone(record.pack.find((card) => cardId(card) === id)));
        record.pickedAt = now(); changed = true;
      }
      if (changed && !demo) persist();
      return changed;
    },
    bookmark(id, marked) {
      const record = records.find((entry) => entry.id === id);
      if (!record) return false;
      record.bookmarked = Boolean(marked);
      if (!record.demo) persist();
      return true;
    },
    details: (id) => { const record = records.find((entry) => entry.id === id); return record ? clone(record) : null; },
    list: () => records.map(({ id, draftId, setCode, format, packNumber, pickNumber, demo, gate, actual, recommended, bookmarked, observedAt }) => ({
      id, draftId, setCode, format, packNumber, pickNumber, demo, gate: gate.kind,
      actual: actual.map((card) => card.name), recommended: recommended || [], bookmarked, observedAt
    })),
    export: () => ({ version: 1, records: clone(records.filter((record) => !record.demo)) }),
    maxDrafts
  };
}
module.exports = { createDecisionHistory, contentId };
