'use strict';

// Bundled identity metadata, source slugs, and sample fixtures. PREP can also
// discover sets through Scryfall or accept a set code without an app update.
// Set-specific draft mechanics (theme tags, synergy heuristics) stay in the
// engine and must be ported per set.
const SET_DEFINITIONS = Object.freeze({
  hob: Object.freeze({
    code: 'hob',
    displayCode: 'HOB',
    name: 'The Hobbit',
    scryfallSetCode: 'hob',
    untappedSlug: 'the-hobbit',
    sampleFixtures: Object.freeze({
      seventeenLands: 'sample-17lands-hob.csv',
      untapped: 'sample-untapped-hob.csv'
    })
  }),
  sos: Object.freeze({
    code: 'sos',
    displayCode: 'SOS',
    name: 'Secrets of Strixhaven',
    scryfallSetCode: 'sos',
    untappedSlug: 'secrets-of-strixhaven',
    sampleFixtures: null
  }),
  fra: Object.freeze({
    code: 'fra',
    displayCode: 'FRA',
    name: 'Reality Fracture',
    scryfallSetCode: 'fra',
    untappedSlug: 'reality-fracture',
    sampleFixtures: null
  })
});

const DEFAULT_SET_CODE = 'hob';

function validSetCode(value) {
  return typeof value === 'string' && /^[a-z0-9]{2,12}$/i.test(value.trim()) && value.trim().toLowerCase() !== 'legacy';
}

// Public catalog entries contain identity only. Card data and ratings are
// still loaded and verified separately for the chosen set.
function normalizeSetCatalog(entries) {
  const sets = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!validSetCode(entry?.code) || typeof entry.name !== 'string' || !entry.name.trim()) continue;
    const code = entry.code.trim().toLowerCase();
    sets.set(code, {
      code, name: entry.name.trim().slice(0, 120),
      releasedAt: /^\d{4}-\d{2}-\d{2}$/.test(entry.releasedAt || '') ? entry.releasedAt : ''
    });
  }
  return [...sets.values()];
}

function setDefinition(setCode = DEFAULT_SET_CODE) {
  const key = String(setCode || DEFAULT_SET_CODE).trim().toLowerCase();
  if (Object.hasOwn(SET_DEFINITIONS, key)) return SET_DEFINITIONS[key];
  // Unknown sets still get usable identity metadata; callers needing more
  // (sample fixtures, an Untapped slug) check for null and degrade visibly.
  return {
    code: key,
    displayCode: key.toUpperCase(),
    name: key.toUpperCase(),
    scryfallSetCode: key,
    untappedSlug: null,
    sampleFixtures: null
  };
}

function scryfallCacheFileName(setCode = DEFAULT_SET_CODE) {
  return `scryfall-${setDefinition(setCode).code}.json`;
}

function untappedCardDataUrl(setCode = DEFAULT_SET_CODE) {
  const definition = setDefinition(setCode);
  return definition.untappedSlug
    ? `https://mtga.untapped.gg/limited/draft/${definition.untappedSlug}/card-data`
    : null;
}

function knownSetDefinitions() {
  return Object.values(SET_DEFINITIONS);
}

module.exports = {
  DEFAULT_SET_CODE,
  SET_DEFINITIONS,
  knownSetDefinitions,
  normalizeSetCatalog,
  scryfallCacheFileName,
  setDefinition,
  untappedCardDataUrl,
  validSetCode
};
