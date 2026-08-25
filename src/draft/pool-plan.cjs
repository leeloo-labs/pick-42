'use strict';

const { normalizeCardName } = require('./csv.cjs');

function exclusionKeysForDraft(preference, draftId) {
  if (!preference || String(preference.draftId || '') !== String(draftId || '')) return new Set();
  return new Set((preference.names || []).map(normalizeCardName).filter(Boolean));
}

function filterActivePool(pool = [], preference = null, draftId = null) {
  const exclusions = exclusionKeysForDraft(preference, draftId);
  return pool.filter((card) => !exclusions.has(normalizeCardName(card.name)));
}

function updatePoolExclusion(preference, draftId, cardName, excluded) {
  const key = normalizeCardName(cardName);
  const names = exclusionKeysForDraft(preference, draftId);
  if (key && excluded) names.add(key);
  else if (key) names.delete(key);
  return { draftId: String(draftId || ''), names: [...names].sort() };
}

module.exports = { exclusionKeysForDraft, filterActivePool, updatePoolExclusion };
