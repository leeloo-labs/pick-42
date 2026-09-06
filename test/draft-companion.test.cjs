'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDraftCompanion } = require('../src/draft-app/companion.cjs');
const { createSourceImportStore } = require('../src/draft-app/source-imports.cjs');
const { createCorpusStore } = require('../src/draft-app/corpus-store.cjs');
const { setDefinition } = require('../src/draft/set-definitions.cjs');

function session() {
  const catalog = structuredClone(require('../fixtures/demo-draft-cards.json'));
  const sourceStore = createSourceImportStore();
  sourceStore.loadSamples({
    seventeenLands: path.join(__dirname, '../fixtures/sample-17lands-hob.csv'),
    untapped: path.join(__dirname, '../fixtures/sample-untapped-hob.csv')
  });
  const corpusStore = createCorpusStore({
    catalog, setCodeExample: 'HOB', manualStoragePath: () => 'memory',
    io: { readText: () => 'null', writeJson: () => {} }
  });
  let saved = {};
  const companion = createDraftCompanion({
    catalog, demoCatalog: catalog, activeSet: setDefinition('hob'), sourceStore, corpusStore,
    settings: { read: () => saved, write: (patch) => { saved = { ...saved, ...patch }; } },
    reviews: { read: () => [], write: () => {} }
  });
  return { companion, sourceStore };
}

const quickPack = (set = 'HOB') => JSON.stringify({
  EventName: `QuickDraft_${set}_20260820`, DraftPack: [103385, 103382, 103444],
  PickedCards: [], PackNumber: 0, PickNumber: 0
}) + '\n';

test('sample ratings and pair advice survive import notifications and setup errors', () => {
  const { companion, sourceStore } = session();
  companion.startDemo('pick-two');
  const before = companion.viewModel();
  // A real import is deliberately very different from the sample ratings.
  sourceStore.remember('seventeenLands', 'new.csv', 'any', 'new.csv', [
    { name: before.recommendations[0].name, gihWinRate: 1, gamesInHand: 10000 }
  ]);
  for (const kind of ['live', 'error', 'loading']) {
    companion.setStatus({ kind, message: 'An operation updated the status' });
    const after = companion.viewModel();
    assert.equal(after.sessionMode, 'demo');
    assert.equal(after.recommendationGate.kind, 'demo');
    assert.equal(after.sources.seventeenLands.kind, 'sample');
    assert.deepEqual(after.recommendations, before.recommendations);
    assert.deepEqual(after.pickPair, before.pickPair);
  }
  companion.advanceDemo();
  assert.equal(companion.draftState().pool.length, 2);
});

test('connecting a real log ends sample mode before its first pack is parsed', () => {
  const { companion } = session();
  companion.startDemo();
  companion.beginLogSession();
  companion.feedLog(quickPack('SOS'));
  const model = companion.viewModel();
  assert.equal(model.sessionMode, 'live');
  assert.equal(model.demo, null);
  assert.equal(model.sources.seventeenLands.kind, 'none');
  assert.doesNotMatch(model.sources.seventeenLands.label, /sample/i);
  assert.equal(model.recommendationGate.ready, false);
  assert.equal(companion.activeSetInfo().code, 'sos');
  // A delayed sample notification or hidden Next button cannot revive sample data.
  companion.setStatus({ kind: 'demo', message: 'Stale sample notification' });
  companion.advanceDemo();
  assert.deepEqual(companion.draftState(), model.draft);
  assert.equal(companion.viewModel().sources.seventeenLands.kind, 'none');
});

test('starting a sample keeps the chosen prep set while using the boot-set fixtures', () => {
  const { companion } = session();
  companion.beginLogSession();
  companion.feedLog(quickPack('SOS'));
  companion.startDemo();
  const model = companion.viewModel();
  assert.equal(companion.activeSetInfo().code, 'sos');
  assert.equal(model.draft.setCode, 'HOB');
  assert.equal(model.recommendationGate.kind, 'demo');
});

test('paused packs expose source measurements in pack order without recommendation scores', () => {
  const { companion, sourceStore } = session();
  const csv = fs.readFileSync(path.join(__dirname, '../fixtures/sample-17lands-hob.csv'), 'utf8');
  sourceStore.remember('seventeenLands', 'one-card.csv', 'quick', 'one-card.csv',
    sourceStore.parse('seventeenLands', csv).filter((row) => row.name === 'Fíli the Pathfinder'));
  companion.beginLogSession();
  companion.feedLog(quickPack());
  const model = companion.viewModel();
  assert.equal(model.recommendationGate.ready, false);
  assert.deepEqual(model.recommendations.map((card) => card.packIndex), [0, 1, 2]);
  for (const card of model.recommendations) {
    assert.equal(card.eligible, false);
    assert.equal(card.score, null);
    assert.equal(card.dataScore, null);
    assert.equal(card.rawRank, null);
    assert.equal(card.contextualRank, null);
  }
  assert.equal(model.recommendations[1].metrics.seventeenLands.gihWinRate, 66);
});

test('live single-source packs retain partial rankings after setup errors', () => {
  const { companion, sourceStore } = session();
  sourceStore.loadCsv('seventeenLands', path.join(__dirname, '../fixtures/sample-17lands-hob.csv'), 'quick');
  companion.beginLogSession();
  companion.feedLog(quickPack());
  companion.setStatus({ kind: 'error', message: 'Unrelated import failed' });
  const model = companion.viewModel();
  assert.equal(model.sessionMode, 'live');
  assert.equal(model.recommendationGate.kind, 'partial');
  assert.equal(model.recommendations[0].name, 'Fíli the Pathfinder');
  assert.ok(Number.isFinite(model.recommendations[0].score));
});


test('preparing another set does not replace the live draft ratings profile', () => {
  const { companion, sourceStore } = session();
  const csv = fs.readFileSync(path.join(__dirname, '../fixtures/sample-17lands-hob.csv'), 'utf8');
  const rows = sourceStore.parse('seventeenLands', csv);
  sourceStore.remember('seventeenLands', 'hob.csv', 'quick', 'hob.csv', rows, 'hob');
  sourceStore.remember('seventeenLands', 'sos.csv', 'quick', 'sos.csv', rows.map((row) => ({ ...row, gihWinRate: 1 })), 'sos');
  companion.beginLogSession(); companion.feedLog(quickPack());
  const before = companion.viewModel();
  companion.setActiveSet('sos');
  const after = companion.viewModel();
  assert.deepEqual(after.recommendations, before.recommendations);
  assert.equal(after.sources.seventeenLands.setCode, 'hob');
  assert.equal(after.setPrep.imports.seventeenLands.quick.label, 'sos.csv');
  companion.setActiveSet('hob');
  assert.equal(companion.viewModel().setPrep.imports.seventeenLands.quick.label, 'hob.csv');
});
