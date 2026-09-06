'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSourceImportStore } = require('../src/draft-app/source-imports.cjs');
const { createLocalStore } = require('../src/draft-app/local-store.cjs');
const { computeSetReadiness } = require('../src/draft/set-readiness.cjs');
const { setDefinition } = require('../src/draft/set-definitions.cjs');
const row = (name, value = 55) => [{ name, key: name.toLowerCase(), gihWinRate: value, gamesInHand: 1000 }];

test('HOB Quick → SOS Quick → HOB Quick restores separate ratings and file paths', () => {
  const store = createSourceImportStore();
  store.remember('seventeenLands', '/imports/hob.csv', 'quick', 'hob.csv', row('Hob card'), 'HOB');
  store.remember('seventeenLands', '/imports/sos.csv', 'quick', 'sos.csv', row('Sos card'), 'sos');
  for (const setCode of ['hob', 'sos', 'hob']) {
    const active = store.activeData({ demo: false, format: 'Quick Draft', setCode });
    assert.equal(active.seventeenLands[0].key, `${setCode} card`);
    assert.equal(store.resolve('seventeenLands', 'quick', setCode).path, `/imports/${setCode}.csv`);
  }
  assert.equal(store.settingsPayload().hob.seventeenLands.quick.path, '/imports/hob.csv');
  const files = createLocalStore('/local/pick42');
  assert.notEqual(files.importedCsvStoragePath('seventeenLands', 'quick', 'hob'), files.importedCsvStoragePath('seventeenLands', 'quick', 'sos'));
});

test('legacy imports remain unassigned and cannot override an explicit set profile', () => {
  const store = createSourceImportStore();
  store.remember('seventeenLands', '/legacy.csv', 'quick', 'legacy.csv', row('Hob card'));
  assert.equal(store.resolve('seventeenLands', 'quick', 'hob').legacy, true);
  store.remember('seventeenLands', '/sos.csv', 'any', 'sos.csv', row('Sos card'), 'sos');
  assert.equal(store.resolve('seventeenLands', 'quick', 'sos').label, 'sos.csv');
  assert.equal(store.resolve('seventeenLands', 'quick', 'hob').label, 'legacy.csv');
  assert.equal(store.settingsPayload().legacy.seventeenLands.quick.path, '/legacy.csv');
  // A named profile never borrows another format from legacy imports.
  store.remember('untapped', '/old-ut.csv', 'quick', 'old-ut.csv', [], 'legacy');
  store.remember('untapped', '/sos-ut.csv', 'premier', 'sos-ut.csv', [], 'sos');
  assert.equal(store.resolve('untapped', 'quick', 'sos'), null);
});

test('readiness and live ratings use the same exact slot within a set profile', () => {
  const store = createSourceImportStore();
  store.remember('seventeenLands', 'any.csv', 'any', 'any.csv', row('Sos card'), 'sos');
  store.remember('seventeenLands', 'quick.csv', 'quick', 'quick.csv', row('Sos card', null), 'sos');
  const prep = computeSetReadiness({ set: setDefinition('sos'), format: 'quick', cardNames: new Set(['sos card']), sources: { seventeenLands: store.slotEntries('seventeenLands', 'sos') } });
  assert.equal(prep.items[0].ready, false);
  assert.equal(store.activeData({ format: 'quick', setCode: 'sos' }).seventeenLands[0].gihWinRate, null);
  assert.equal(store.activeData({ format: 'quick', setCode: 'unknown' }).seventeenLands.length, 0);
});

test('saving a new profile preserves temporarily unavailable prior exports', () => {
  const store = createSourceImportStore();
  store.remember('seventeenLands', 'new.csv', 'quick', 'new.csv', row('New card'), 'sos');
  const previous = { hob: { seventeenLands: { premier: { path: '/unavailable/hob.csv', label: 'old.csv' } } } };
  const saved = store.settingsPayload(previous);
  assert.deepEqual(saved.hob, previous.hob);
  assert.equal(saved.sos.seventeenLands.quick.path, 'new.csv');
  assert.equal(previous.sos, undefined);
});
