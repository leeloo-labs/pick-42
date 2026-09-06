'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeSetReadiness, rowMatchRate } = require('../src/draft/set-readiness.cjs');
const { setDefinition } = require('../src/draft/set-definitions.cjs');

const sos = setDefinition('sos');
const sosNames = new Set(['aether tutor', 'campus warden', 'mystic archive', 'quandrix pledge']);
const rows = (names) => names.map((name) => ({ name, key: name, gihWinRate: 56, inHandWinRate: 55 }));
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
  assert.match(partial.items.find((item) => item.id === 'untapped').detail, /no quick or all-types import/);
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
    corpusDecks: Array.from({ length: 4 }, () => ({ setCode: 'SOS', format: 'premier', trophy: true, archetype: 'Prismari' })),
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
  assert.equal(corpus.ready, false);
  assert.equal(corpus.count, 2);
  assert.match(corpus.detail, /2 SOS decks stored/);
  assert.match(corpus.detail, /more matching trophies needed/);
});

test('readiness measures the exact import even when a matching all-types import exists', () => {
  const prep = computeSetReadiness({
    set: sos, format: 'quick', cardNames: sosNames,
    sources: { seventeenLands: [
      { format: 'any', label: 'sos.csv', data: sosRows },
      { format: 'quick', label: 'old-hob.csv', data: otherRows }
    ] }
  });
  const item = prep.items.find((entry) => entry.id === 'seventeenLands');
  assert.equal(item.ready, false);
  assert.match(item.detail, /quick.*old-hob.csv.*another set/);
});

test('ANY prep requires the all-types slot, just like an unidentified live format', () => {
  const prep = computeSetReadiness({
    set: sos, format: 'any', cardNames: sosNames,
    sources: { seventeenLands: [{ format: 'quick', label: 'sos-quick.csv', data: sosRows }] }
  });
  const item = prep.items.find((entry) => entry.id === 'seventeenLands');
  assert.equal(item.ready, false);
  assert.match(item.detail, /quick slot only/);
});

test('matching card names with blank win rates are not a ready ratings source', () => {
  const prep = computeSetReadiness({
    set: sos, format: 'quick', cardNames: sosNames,
    sources: {
      seventeenLands: [{ format: 'quick', label: 'blank.csv', data: sosRows.map((row) => ({ ...row, gihWinRate: null })) }],
      untapped: [{ format: 'quick', label: 'rated.csv', data: sosRows }]
    }
  });
  assert.equal(prep.items[0].ready, false);
  assert.match(prep.items[0].detail, /no usable win rates/);
  assert.equal(prep.items[1].ready, true);
  assert.equal(prep.ratingsStatus, 'partial');
});

test('ratings in another set cannot make blank matching rows usable', () => {
  const prep = computeSetReadiness({
    set: sos, format: 'quick', cardNames: sosNames,
    sources: { seventeenLands: [{ format: 'quick', label: 'mixed.csv', data: [
      ...sosRows.map((row) => ({ ...row, gihWinRate: null })), ...otherRows.slice(0, 1)
    ] }] }
  });
  assert.equal(prep.items[0].ready, false);
  assert.equal(prep.items[0].usableCount, 0);
});

test('a missing card catalog is unverified rather than a false set mismatch', () => {
  const prep = computeSetReadiness({
    set: sos, format: 'quick',
    sources: { seventeenLands: [{ format: 'quick', label: 'sos.csv', data: sosRows }] }
  });
  assert.equal(prep.items[0].ready, false);
  assert.match(prep.items[0].detail, /set verification pending/);
  assert.doesNotMatch(prep.items[0].detail, /another set/);
});


test('corpus preparation distinguishes stored lists from enough matching archetype evidence', () => {
  const decks = Array.from({ length: 4 }, () => ({ setCode: 'SOS', format: 'premier', trophy: true, archetype: 'Prismari' }));
  const prep = (corpusDecks) => computeSetReadiness({ set: sos, format: 'quick', corpusDecks }).items.find((item) => item.id === 'corpus');
  assert.equal(prep(decks.slice(0, 1)).ready, false);
  const full = prep(decks);
  assert.equal(full.ready, true); assert.equal(full.crossFormat, true);
  assert.match(full.detail, /available cross-format for quick/);
  assert.match(full.detail, /two distinguishing pool cards/);
  assert.equal(prep(decks.map((deck, i) => ({ ...deck, archetype: `Build ${i}` }))).ready, false);
});
