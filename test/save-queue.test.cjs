'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSaveQueue } = require('../src/draft/save-queue.js');
const { createLocalStore, writeJsonAtomic } = require('../src/draft-app/local-store.cjs');

test('failed saves retain the newest value and retry independent records', async () => {
  const queue = createSaveQueue(), disk = {};
  let blocked = true;
  const write = (key, value) => () => { if (blocked) throw new Error('full'); disk[key] = value; };
  assert.equal(queue.save('settings', 'preferences', write('settings', 'old')), false);
  queue.save('settings', 'preferences', write('settings', 'new'));
  queue.save('reviews', 'game reviews', write('reviews', 'game'));
  assert.deepEqual(queue.labels(), ['preferences', 'game reviews']);
  blocked = false; await queue.retry();
  assert.deepEqual(disk, { settings: 'new', reviews: 'game' }); assert.deepEqual(queue.labels(), []);
});

test('asynchronous writes stay ordered and an old success cannot clear a newer failure', async () => {
  const queue = createSaveQueue();
  let resolve, disk = 'initial';
  const old = queue.save('catalog', 'card catalog', () => new Promise((yes) => { resolve = () => { disk = 'old'; yes(); }; }));
  const newer = queue.save('catalog', 'card catalog', async () => { throw new Error('quota'); });
  resolve(); await old; await newer;
  assert.deepEqual(queue.labels(), ['card catalog']); assert.equal(disk, 'old');
  await queue.save('catalog', 'card catalog', async () => { disk = 'latest'; });
  assert.equal(disk, 'latest'); assert.deepEqual(queue.labels(), []);
});

test('desktop failed preference patches preserve prior fields, saved files, and session reviews', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pick42-save-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  writeJsonAtomic(path.join(dir, 'draft-settings.json'), { activeSetCode: 'hob', prepFormat: 'any' });
  let blocked = true;
  const store = createLocalStore(dir, { writeJson: (file, value) => { if (blocked) throw new Error('full'); writeJsonAtomic(file, value); } });
  store.writeSettings({ prepFormat: 'quick' }); store.writeSettings({ selectedBuildId: 'boros' });
  store.writeGameReviews({ reviews: [{ id: 'local-game' }], manualRecords: {} });
  assert.equal(JSON.parse(fs.readFileSync(store.settingsPath())).prepFormat, 'any');
  assert.deepEqual(store.readSettings(), { activeSetCode: 'hob', prepFormat: 'quick', selectedBuildId: 'boros' });
  assert.equal(store.readGameReviews().reviews[0].id, 'local-game');
  blocked = false; await store.persistence.retry();
  assert.deepEqual(JSON.parse(fs.readFileSync(store.settingsPath())), store.readSettings());
  assert.equal(JSON.parse(fs.readFileSync(store.gameReviewsPath())).reviews[0].id, 'local-game');
  assert.deepEqual(store.persistence.labels(), []);
});
