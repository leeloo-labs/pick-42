'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeSetReadiness, rowMatchRate } = require('../src/draft/set-readiness.cjs');
const { setDefinition } = require('../src/draft/set-definitions.cjs');

const sos = setDefinition('sos');
const sosNames = new Set(['aether tutor', 'campus warden', 'mystic archive', 'quandrix pledge']);
const rows = (names) => names.map((name) => ({ name, key: name }));
const sosRows = rows([...sosNames]);
const otherRows = rows(['gundabad opportunist', 'ragged short spear', 'dwarven provisioner', 'moment of glory']);

test('a ratings slot counts only when its rows name the set', () => {
  assert.equal(rowMatchRate(sosRows, sosNames), 1);
  assert.equal(rowMatchRate(otherRows, sosNames), 0);
  assert.equal(rowMatchRate([], sosNames), 0);
});

test('readiness checks off each source as matching data lands', () => {
  const empty = computeSetReadiness({ set: sos, format: 'quick', cardNames: sosNames });
  assert.equal(empty.readyCount, 0);
  assert.equal(empty.percent, 0);
  assert.equal(empty.rankingsReady, false);

  const partial = computeSetReadiness({
    set: sos,
    format: 'quick',
    cardNames: sosNames,
    sources: {
      seventeenLands: [{ format: 'quick', label: 'sos-quick.csv', data: sosRows }],
      untapped: [{ format: 'premier', label: 'old-hob.csv', data: otherRows }]
    },
    images: { ready: true }
  });
  assert.equal(partial.items.find((item) => item.id === 'seventeenLands').ready, true);
  assert.equal(partial.items.find((item) => item.id === 'untapped').ready, false);
  assert.match(partial.items.find((item) => item.id === 'untapped').detail, /another set/);
  assert.equal(partial.readyCount, 2);
  assert.equal(partial.rankingsReady, false);

  const full = computeSetReadiness({
    set: sos,
    format: 'quick',
    cardNames: sosNames,
    sources: {
      seventeenLands: [{ format: 'any', label: 'sos.csv', data: sosRows }],
      untapped: [{ format: 'quick', label: 'sos-ut.csv', data: sosRows }]
    },
    corpusDecks: [{ setCode: 'SOS', format: 'premier', trophy: true }],
    images: { ready: true }
  });
  assert.equal(full.complete, true);
  assert.equal(full.percent, 100);
  assert.equal(full.rankingsReady, true);
});

test('an off-format slot with matching data points at the right slot instead of lying', () => {
  const prep = computeSetReadiness({
    set: sos,
    format: 'quick',
    cardNames: sosNames,
    sources: { seventeenLands: [{ format: 'premier', label: 'sos-premier.csv', data: sosRows }], untapped: [] }
  });
  const item = prep.items.find((entry) => entry.id === 'seventeenLands');
  assert.equal(item.ready, false);
  assert.match(item.detail, /premier slot only · import into quick or any/);
});

test('the corpus item counts same-set decks and flags cross-format use', () => {
  const prep = computeSetReadiness({
    set: sos,
    format: 'quick',
    cardNames: sosNames,
    corpusDecks: [
      { setCode: 'SOS', format: 'premier', trophy: true },
      { setCode: 'SOS', format: 'premier', trophy: true },
      { setCode: 'HOB', format: 'quick', trophy: true }
    ]
  });
  const corpus = prep.items.find((entry) => entry.id === 'corpus');
  assert.equal(corpus.ready, true);
  assert.equal(corpus.count, 2);
  assert.match(corpus.detail, /2 SOS decks · premier · used cross-format for quick/);
});
