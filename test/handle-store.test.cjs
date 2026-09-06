'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function storage() {
  let transaction, request, closed = false;
  const database = {
    close: () => { closed = true; },
    transaction: () => {
      transaction = { objectStore: () => ({ put: () => { request = {}; return request; } }) };
      return transaction;
    }
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/web/handle-store.js'), 'utf8'), {
    module, indexedDB: { open: () => { const opening = { result: database }; queueMicrotask(() => opening.onsuccess()); return opening; } }
  });
  return { store: module.exports, tx: () => transaction, request: () => request, closed: () => closed };
}

test('browser data saves wait for transaction commit rather than a successful write request', async () => {
  const h = storage(); let saved = false;
  const saving = h.store.saveData('catalog', { cards: [] }).then(() => { saved = true; });
  for (let i = 0; i < 5; i++) await Promise.resolve();
  h.request().onsuccess?.(); await Promise.resolve();
  assert.equal(saved, false); assert.equal(h.closed(), false);
  h.tx().oncomplete(); await saving;
  assert.equal(saved, true); assert.equal(h.closed(), true);
});

test('browser remembered handles report aborted transactions as failed saves', async () => {
  const h = storage(); const saving = h.store.saveHandle('log', {});
  for (let i = 0; i < 5; i++) await Promise.resolve();
  h.tx().error = new Error('Quota reached'); h.tx().onabort();
  await assert.rejects(saving, /Quota reached/); assert.equal(h.closed(), true);
});
