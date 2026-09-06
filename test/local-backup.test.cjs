'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { ratingsCsv, validateBackup, planRestore } = require('../src/draft/local-backup.cjs');
const { parseSeventeenLandsCsv } = require('../src/draft/sources/seventeenlands.cjs');
const { parseUntappedCsv } = require('../src/draft/sources/untapped.cjs');
const { createDraftCompanion } = require('../src/draft-app/companion.cjs');
const { createSourceImportStore } = require('../src/draft-app/source-imports.cjs');
const { createCorpusStore } = require('../src/draft-app/corpus-store.cjs');
const { createLocalStore } = require('../src/draft-app/local-store.cjs');
const { setDefinition } = require('../src/draft/set-definitions.cjs');
const empty = () => ({ product: 'Pick 42', version: 1, createdAt: '2026-09-06T00:00:00Z', settings: {}, ratings: [], corpus: { imported: [], manual: [] }, reviews: { reviews: [], manualRecords: {} }, decisions: { version: 1, records: [] }, recipes: {} });
const recipeKey = 'pick42.recipe.v2.abc123.rakdos';
const recipe = { done: ['add:test'], skipped: [], history: [{ id: 'add:test', status: 'done' }] };
const decision = (id) => ({ id, draftId: id, pack: [{ name: 'A' }], pool: [], actual: [], recommendations: [{ name: 'A' }], gate: { kind: 'paused' } });
const rating = (setCode = 'hob') => ({ setCode, source: 'seventeenLands', format: 'quick', label: 'My ratings', text: 'Name,GIH WR,# GIH\nTest,60%,1000' });
function session({ fail = false } = {}) {
  const catalog = structuredClone(require('../fixtures/demo-draft-cards.json'));
  const sourceStore = createSourceImportStore();
  let failed = fail;
  const writes = [];
  const store = createLocalStore('/tmp/pick42-backup-memory-test', { writeJson: (key, value) => { if (failed) throw new Error('Disk full'); writes.push({ key, value }); } });
  const corpusStore = createCorpusStore({ catalog, manualStoragePath: () => 'manual', io: { readText: () => 'null', writeJson: (key, value) => store.writeJsonResource(key, value, 'trophy corpus') } });
  const companion = createDraftCompanion({ catalog, demoCatalog: catalog, sourceStore, corpusStore, activeSet: setDefinition('hob'),
    settings: { read: store.readSettings, write: store.writeSettings }, reviews: { read: store.readGameReviews, write: store.writeGameReviews },
    decisions: { read: store.readDecisions, write: store.writeDecisions }, persistence: store.persistence,
    backupStorage: { rating: (entry) => { writes.push({ rating: entry }); sourceStore.remember(entry.source, 'local.csv', entry.format, entry.label, sourceStore.parse(entry.source, entry.text), entry.setCode); }, corpus: (payload) => { store.writeJsonResource('corpus', payload, 'trophy corpus'); return 'corpus'; } }
  });
  return { companion, sourceStore, store, writes, recover: () => { failed = false; } };
}

test('backup CSV round-trip preserves blank values, small signed percentages, fallback bases and sample counts', () => {
  for (const [source, parser, file] of [['seventeenLands', parseSeventeenLandsCsv, 'sample-17lands-hob.csv'], ['untapped', parseUntappedCsv, 'sample-untapped-hob.csv']]) {
    const rows = parser(fs.readFileSync(`${__dirname}/../fixtures/${file}`, 'utf8'));
    assert.deepEqual(parser(ratingsCsv(source, rows)), rows);
  }
  const rows = parseSeventeenLandsCsv('Name,GIH WR,# GIH,GD WR,# GD,GP WR,# GP,IIH\nDrawn,,,58%,21,,,\nPlayed,,,,,59%,37,\nSmall,60%,2000,,,,,-0.4%\nBlank,,,,,,,');
  assert.deepEqual(parseSeventeenLandsCsv(ratingsCsv('seventeenLands', rows)), rows);
  assert.equal(rows[0].winRateBasis, 'GD'); assert.equal(rows[1].gamesInHand, 37);
});

test('backup validates all sections and rejects unsafe keys, duplicate slots and malformed late records', () => {
  assert.deepEqual(validateBackup(empty()), empty());
  for (const alter of [
    (b) => { b.version = 2; },
    (b) => { b.ratings = [rating(), rating('HOB')]; },
    (b) => { b.recipes.bad = recipe; },
    (b) => { b.reviews.reviews = [{ id: 'broken', deck: { cards: [null] } }]; },
    (b) => { b.decisions.records = [decision('a'), decision('a')]; },
    (b) => { b.decisions.records = [{ ...decision('a'), pack: [null] }]; },
    (b) => { b.reviews.manualRecords.a = { wins: -1, losses: 0 }; }
  ]) { const b = empty(); alter(b); assert.throws(() => validateBackup(b)); }
  assert.throws(() => validateBackup(JSON.parse(JSON.stringify(empty()).replace('"settings":{}', '"settings":{"__proto__":{}}'))), /unsupported key/);
});

test('additive merge keeps current conflicts, separate format slots and current drafts under retention', () => {
  const current = empty(), incoming = empty();
  current.ratings = [rating()]; incoming.ratings = [rating(), { ...rating(), format: 'premier' }];
  current.settings = { activeSetCode: 'hob' }; incoming.settings = { activeSetCode: 'sos', selectedBuildId: 'rakdos' };
  current.recipes[recipeKey] = recipe; incoming.recipes[recipeKey] = { done: [], skipped: [], history: [] };
  current.reviews.manualRecords.a = { wins: 3, losses: 1 }; incoming.reviews.manualRecords.a = { wins: 5, losses: 2 };
  current.decisions.records = Array.from({ length: 10 }, (_, i) => decision(`current${i}`)); incoming.decisions.records = [decision('older')];
  const plan = planRestore(current, incoming);
  assert.equal(plan.ratings.length, 1); assert.equal(plan.ratings[0].format, 'premier');
  assert.equal(plan.settings.activeSetCode, 'hob'); assert.equal(plan.settings.selectedBuildId, 'rakdos');
  assert.deepEqual(plan.recipes[recipeKey], recipe); assert.equal(plan.reviews.manualRecords.a.wins, 3);
  assert.deepEqual(plan.decisions.records, current.decisions.records); assert.equal(plan.summary.decisions, 0);
});

test('session exports only portable state and restores once with a new preview required after malformed input', () => {
  const { companion, store, writes } = session();
  store.writeSettings({ logPath: '/private/Player.log', sourceImportProfiles: { secret: true }, selectedBuildId: 'rakdos' });
  const b = empty(); b.ratings = [rating()]; b.recipes[recipeKey] = recipe;
  b.reviews.manualRecords.a = { wins: 3, losses: 1, format: 'quick' }; b.decisions.records = [decision('a')];
  const preview = companion.previewBackup(JSON.stringify(b));
  assert.equal(preview.summary.ratings, 1); assert.equal(preview.summary.manualRecords, 1);
  const result = companion.restoreBackup(preview.token);
  assert.deepEqual(result.recipes[recipeKey], recipe);
  const exported = companion.exportBackup(result.recipes);
  assert.equal(exported.settings.logPath, undefined); assert.equal(exported.settings.sourceImportProfiles, undefined);
  assert.equal(exported.reviews.manualRecords.a.wins, 3); assert.equal(exported.decisions.records.length, 1);
  assert.equal(exported.ratings[0].setCode, 'hob'); assert.doesNotThrow(() => validateBackup(exported));
  const again = companion.previewBackup(JSON.stringify(b), result.recipes);
  assert.ok(Object.values(again.summary).every((count) => count === 0));
  const before = writes.length;
  assert.throws(() => companion.previewBackup('{broken'));
  assert.throws(() => companion.restoreBackup(again.token), /preview/);
  assert.equal(writes.length, before);
});

test('invalid later backup content causes no writes, and failed saves remain available for retry and export', async () => {
  const s = session({ fail: true });
  const invalid = empty(); invalid.ratings = [rating()]; invalid.recipes.bad = recipe;
  assert.throws(() => s.companion.previewBackup(JSON.stringify(invalid)));
  assert.equal(s.writes.length, 0);
  const valid = empty(); valid.reviews.manualRecords.a = { wins: 2, losses: 1, format: 'quick' };
  const preview = s.companion.previewBackup(JSON.stringify(valid));
  const result = s.companion.restoreBackup(preview.token);
  assert.ok(result.model.persistence.unsaved.includes('game reviews'));
  assert.equal(s.companion.exportBackup().reviews.manualRecords.a.wins, 2);
  s.recover(); await s.companion.retryLocalSaves();
  assert.deepEqual(s.store.persistence.labels(), []);
});

test('trophy libraries and completed reviews survive a portable round-trip with provenance', () => {
  const first = session(), second = session();
  const b = empty();
  b.corpus.importedMetadata = { source: 'Authorized export', license: 'Local use', generatedAt: '2026-09-01' };
  b.corpus.imported = [{ id: 'deck1', setCode: 'HOB', format: 'quick', wins: 7, losses: 1, trophy: true, colors: ['B', 'R'], cards: [{ name: 'Swamp', quantity: 20 }, { name: 'Mountain', quantity: 20 }] }];
  b.corpus.manual = [{ ...b.corpus.imported[0], id: 'manual1' }];
  b.reviews.reviews = [{ id: 'game1', draftId: 'draft1', setCode: 'HOB', format: 'quick', completedAt: '2026-09-05T20:00:00Z', deck: { name: 'Rakdos', cards: [{ name: 'Swamp', quantity: 20 }, { name: 'Mountain', quantity: 20 }] } }];
  const preview = first.companion.previewBackup(JSON.stringify(b));
  assert.equal(preview.summary.corpus, 2); assert.equal(preview.summary.reviews, 1);
  first.companion.restoreBackup(preview.token);
  const exported = first.companion.exportBackup();
  assert.equal(exported.corpus.importedMetadata.license, 'Local use');
  assert.equal(exported.corpus.manual[0].cards[0].quantity, 20);
  const next = second.companion.previewBackup(JSON.stringify(exported));
  second.companion.restoreBackup(next.token);
  assert.deepEqual(second.companion.exportBackup().corpus, exported.corpus);
  assert.equal(second.companion.exportBackup().reviews.reviews[0].id, 'game1');
});
