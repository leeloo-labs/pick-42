'use strict';

// Identity metadata for every draftable set Pick 42 knows about. Anything
// per-set that is data — codes, names, external slugs, cache file names,
// bundled sample fixtures — reads from here, so supporting the next set
// starts with one new entry. Set-specific draft mechanics (theme tags,
// synergy heuristics) stay in the engine and must be ported per set.
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
  })
});

const DEFAULT_SET_CODE = 'hob';

function setDefinition(setCode = DEFAULT_SET_CODE) {
  const key = String(setCode || DEFAULT_SET_CODE).trim().toLowerCase();
  if (SET_DEFINITIONS[key]) return SET_DEFINITIONS[key];
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

module.exports = {
  DEFAULT_SET_CODE,
  SET_DEFINITIONS,
  scryfallCacheFileName,
  setDefinition,
  untappedCardDataUrl
};
