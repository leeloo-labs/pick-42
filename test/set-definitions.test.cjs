'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_SET_CODE,
  scryfallCacheFileName,
  setDefinition,
  untappedCardDataUrl
} = require('../src/draft/set-definitions.cjs');

test('the default set resolves to complete Hobbit metadata', () => {
  const hob = setDefinition(DEFAULT_SET_CODE);

  assert.equal(hob.code, 'hob');
  assert.equal(hob.displayCode, 'HOB');
  assert.equal(hob.name, 'The Hobbit');
  assert.equal(hob.untappedSlug, 'the-hobbit');
  assert.equal(hob.sampleFixtures.seventeenLands, 'sample-17lands-hob.csv');
  assert.equal(hob.sampleFixtures.untapped, 'sample-untapped-hob.csv');
  assert.equal(scryfallCacheFileName('hob'), 'scryfall-hob.json');
  assert.equal(untappedCardDataUrl('hob'), 'https://mtga.untapped.gg/limited/draft/the-hobbit/card-data');
  assert.equal(setDefinition('HOB').name, 'The Hobbit', 'set codes are case-insensitive');
});

test('two different set codes yield different metadata', () => {
  const hob = setDefinition('hob');
  const next = setDefinition('xyz');

  assert.notEqual(next.code, hob.code);
  assert.equal(next.code, 'xyz');
  assert.equal(next.displayCode, 'XYZ');
  assert.equal(next.scryfallSetCode, 'xyz');
  assert.equal(scryfallCacheFileName('xyz'), 'scryfall-xyz.json');
  assert.notEqual(scryfallCacheFileName('xyz'), scryfallCacheFileName('hob'));
});

test('an unknown set degrades visibly instead of borrowing Hobbit assets', () => {
  const unknown = setDefinition('xyz');

  assert.equal(unknown.untappedSlug, null);
  assert.equal(unknown.sampleFixtures, null);
  assert.equal(untappedCardDataUrl('xyz'), null);
});

test('Secrets of Strixhaven resolves with full metadata and no sample fixtures', () => {
  const { setDefinition, knownSetDefinitions, untappedCardDataUrl } = require('../src/draft/set-definitions.cjs');
  const sos = setDefinition('SOS');

  assert.equal(sos.displayCode, 'SOS');
  assert.equal(sos.name, 'Secrets of Strixhaven');
  assert.equal(sos.scryfallSetCode, 'sos');
  assert.equal(sos.sampleFixtures, null);
  assert.equal(untappedCardDataUrl('sos'), 'https://mtga.untapped.gg/limited/draft/secrets-of-strixhaven/card-data');
  assert.deepEqual(knownSetDefinitions().map((entry) => entry.code), ['hob', 'sos']);
});
