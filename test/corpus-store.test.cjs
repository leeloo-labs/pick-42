'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCorpusStore } = require('../src/draft-app/corpus-store.cjs');
const deckText = 'Deck\n23 Test Creature\n17 Mountain\n\nSideboard\n1 Sideboard Card';
const entry = { setCode: 'FRA', format: 'PremierDraft', deckText };

function memoryStore(initial = null) {
  let saved = initial;
  const options = {
    catalog: {}, setCodeExample: 'FRA', manualStoragePath: () => 'manual',
    io: { readText: () => JSON.stringify(saved), writeJson: (_path, value) => { saved = structuredClone(value); } }
  };
  return { store: createCorpusStore(options), reload: () => { const store = createCorpusStore(options); store.readManual(); return store; } };
}

test('pasted trophy decks accept omitted records and retain unknown results after reload', () => {
  for (const format of ['PremierDraft', 'QuickDraft', 'TraditionalDraft', 'PickTwoDraft']) {
    const memory = memoryStore();
    const deck = memory.store.addManual({ ...entry, format, record: ' ' });
    assert.equal(deck.trophy, true);
    assert.equal(deck.wins, null);
    assert.equal(deck.losses, null);
    assert.equal(deck.cards.reduce((sum, card) => sum + card.quantity, 0), 40);
    assert.equal(deck.cards.some((card) => card.name === 'Sideboard Card'), false);
    const restored = memory.reload();
    assert.equal(restored.sourceInfo().trophyCount, 1);
    assert.equal(restored.manualDecks()[0].wins, null);
    assert.equal(restored.manualDecks()[0].losses, null);
  }
});

test('optional records still validate supplied results and complete decks', () => {
  const { store } = memoryStore();
  for (const record of ['5-3', 'not a record']) assert.throws(() => store.addManual({ ...entry, record }), /not a trophy record/);
  assert.throws(() => store.addManual({ ...entry, format: 'TraditionalDraft', record: '2-1' }), /requires 3 wins/);
  assert.throws(() => store.addManual({ ...entry, deckText: 'Deck\n2 Test Creature' }), /at least 40/);
  assert.throws(() => store.addManual({ ...entry, format: '' }), /Choose the draft format/);
  const deck = store.addManual({ ...entry, record: '7-2' });
  assert.equal(deck.wins, 7);
  assert.equal(deck.losses, 2);
});

test('adding or omitting a record cannot duplicate a new or legacy pasted deck', () => {
  const memory = memoryStore();
  const saved = memory.store.addManual(entry);
  assert.throws(() => memory.store.addManual({ ...entry, record: '7-2' }), /already/);
  const legacy = memoryStore({ decks: [{ ...saved, id: 'legacy-record-dependent-id', wins: 7, losses: 2 }] }).reload();
  assert.throws(() => legacy.addManual({ ...entry, format: 'premier' }), /already/);
  assert.equal(legacy.manualDecks().length, 1);
});
