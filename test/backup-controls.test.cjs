'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { createSaveQueue } = require('../src/draft/save-queue.js');
const recipeKey = 'pick42.recipe.v2.ab12.rakdos';
const recipe = { done: ['task'], skipped: [], history: [] };
function controls(bridge = {}) {
  const nodes = new Map();
  const byId = (id) => {
    if (!nodes.has(id)) nodes.set(id, { hidden: id === 'backup-restore', disabled: false, dataset: {}, value: '', files: [], handlers: {}, addEventListener(event, action) { this.handlers[event] = action; }, click() { return this.handlers.click?.(); } });
    return nodes.get(id);
  };
  const storage = new Map();
  let fail = false;
  const context = vm.createContext({ byId, window: { draftCompanion: bridge }, model: {}, render() {}, setText: (id, text) => { byId(id).text = text; },
    recipeMemory: new Map(), recipeSaveQueue: createSaveQueue(),
    localStorage: { get length() { return storage.size; }, key: (i) => [...storage.keys()][i], getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => { if (fail) throw new Error('Quota'); storage.set(key, value); } }
  });
  vm.runInContext(fs.readFileSync(`${__dirname}/../src/draft-renderer/views/backup.js`, 'utf8'), context);
  return { byId, context, storage, fail: () => { fail = true; }, recover: () => { fail = false; }, choose: async (text = '{}') => { byId('backup-file').files = [{ size: text.length, text: async () => text }]; await byId('backup-file').handlers.change(); } };
}
const preview = { token: 1, summary: { ratings: 1, corpus: 0, reviews: 0, manualRecords: 0, decisions: 0, recipes: 1, preferences: 0 } };

test('backup controls require a valid preview, show additions, and retain recipes through quota failure', async () => {
  let applied = 0;
  const c = controls({ previewBackup: async () => preview, restoreBackup: async () => { applied++; return { recipes: { [recipeKey]: recipe }, model: { persistence: { unsaved: [] } } }; } });
  await c.byId('backup-restore').click(); assert.equal(applied, 0);
  await c.choose(); assert.match(c.byId('backup-message').text, /1 ratings slots/);
  assert.equal(c.byId('backup-restore').hidden, false);
  c.fail(); await c.byId('backup-restore').click();
  assert.equal(applied, 1); assert.match(c.byId('backup-message').text, /not yet saved/);
  assert.ok(c.context.recipeMemory.has(recipeKey)); assert.equal(c.storage.size, 0);
  c.recover(); await c.context.recipeSaveQueue.retry(); assert.ok(c.storage.has(recipeKey));
});

test('choosing malformed data clears previous confirmation and cannot apply the old preview', async () => {
  let valid = true, applied = 0;
  const c = controls({ previewBackup: async () => { if (!valid) throw new Error('Invalid backup'); return preview; }, restoreBackup: async () => { applied++; } });
  await c.choose(); valid = false; await c.choose('broken');
  assert.equal(c.byId('backup-restore').hidden, true);
  assert.match(c.byId('backup-message').text, /not loaded/);
  await c.byId('backup-restore').click(); assert.equal(applied, 0);
});

test('export cancellation and browser download requests are described without claiming a saved file', async () => {
  let result = { canceled: true };
  const c = controls({ exportBackup: async () => result });
  await c.byId('backup-export').click(); assert.equal(c.byId('backup-message').text, 'Export canceled.');
  result = { downloaded: true }; await c.byId('backup-export').click();
  assert.match(c.byId('backup-message').text, /download requested/);
  assert.equal(c.byId('backup-export').disabled, false);
});
