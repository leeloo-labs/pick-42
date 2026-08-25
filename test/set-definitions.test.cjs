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
