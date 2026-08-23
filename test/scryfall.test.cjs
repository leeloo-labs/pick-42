'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  REQUEST_HEADERS,
  buildScryfallIndex,
  fetchScryfallSet,
  findScryfallCard,
  loadScryfallSet,
  writeScryfallCache
} = require('../src/draft/scryfall.cjs');

function response(data) {
  return { ok: true, status: 200, json: async () => data };
}

test('fetches every set page with required headers and a paced search', async () => {
  const calls = [];
  const pauses = [];
  const firstCard = {
    id: 'one', name: 'Bilbo’s Deadly Slice', set: 'hob', mana_cost: '{1}{B}{B}', type_line: 'Instant',
    oracle_text: 'Destroy target creature.', image_uris: { normal: 'normal-one', art_crop: 'art-one' }
  };
  const secondCard = {
    id: 'two', name: 'Mirkwood', set: 'hob', type_line: 'Land', oracle_text: '{T}: Add {B} or {G}.',
    image_uris: { normal: 'normal-two', art_crop: 'art-two' }
  };
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/sets/')) return response({ name: 'The Hobbit' });
    if (url.includes('page=2')) return response({ has_more: false, data: [secondCard] });
    return response({ has_more: true, next_page: 'https://api.scryfall.com/cards/search?page=2', data: [firstCard] });
  };

  const payload = await fetchScryfallSet({
    fetchImpl,
    pause: async (milliseconds) => pauses.push(milliseconds),
    now: 1234
  });

  assert.equal(payload.setName, 'The Hobbit');
  assert.equal(payload.cards.length, 2);
  assert.deepEqual(pauses, [500]);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0].options.headers, REQUEST_HEADERS);
  assert.equal(payload.cards[0].imageUris.normal, 'normal-one');
  assert.equal(payload.cards[0].oracleText, 'Destroy target creature.');
});

test('indexes accented names and individual double-faced card faces', () => {
  const index = buildScryfallIndex([{
    id: 'dfc',
    name: 'Óin the Brave // Óin’s Saga',
    setCode: 'hob',
    imageUris: { normal: null },
    cardFaces: [
      { name: 'Óin the Brave', oracleText: 'Front text', imageUris: { normal: 'front' } },
      { name: 'Óin’s Saga', oracleText: 'Back text', imageUris: { normal: 'back' } }
    ]
  }]);

  assert.equal(findScryfallCard(index, 'Oin the Brave').imageUris.normal, 'front');
  assert.equal(findScryfallCard(index, "Oin's Saga").oracleText, 'Back text');
});

test('uses a fresh disk cache without issuing network requests', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arcane-scryfall-test-'));
  const cachePath = path.join(directory, 'hob.json');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  writeScryfallCache(cachePath, {
    version: 1,
    setCode: 'hob',
    setName: 'The Hobbit',
    fetchedAt: 10_000,
    cards: [{ name: 'Attercop', imageUris: { normal: 'cached' } }]
  });

  const payload = await loadScryfallSet({
    cachePath,
    now: 10_001,
    fetchImpl: async () => { throw new Error('network should not run'); }
  });

  assert.equal(payload.source, 'cache');
  assert.equal(payload.cards[0].imageUris.normal, 'cached');
});
