'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeVisualGuide, nameSimilarity } = require('../src/draft/visual-guide-analyzer.cjs');

function observation(text, x, y, width = 0.08, height = 0.014) {
  return { text, x, y, width, height, confidence: 1 };
}

const pool = [
  { name: 'Nighthowl Pursuer' },
  { name: 'Nasty Little Rabbit' },
  { name: 'Bilbo\'s Deadly Slice' },
  { name: 'Wargling' }
];
const build = {
  mainDeck: [
    { name: 'Nighthowl Pursuer', quantity: 2 },
    { name: 'Nasty Little Rabbit', quantity: 1 },
    { name: 'Bilbo\'s Deadly Slice', quantity: 1 }
  ],
  lands: [{ name: 'Swamp', quantity: 2, basic: true }]
};

test('matches truncated and lightly misread card names', () => {
  assert.ok(nameSimilarity('Bilbos Deadly Slice', "Bilbo's Deadly Slice") > 0.9);
  assert.ok(nameSimilarity('Nighthowl Pursu...', 'Nighthowl Pursuer') > 0.9);
});

test('builds add and drop annotations only after the deck list reconciles', () => {
  const result = analyzeVisualGuide({
    pool,
    build,
    recognition: {
      imageWidth: 2000,
      imageHeight: 1200,
      observations: [
        observation('3/40 Cards', 0.79, 0.86),
        observation('Nighthowl Pursuer', 0.77, 0.78, 0.14, 0.02),
        observation('1x', 0.73, 0.78, 0.02, 0.02),
        observation('Swamp', 0.77, 0.73, 0.07, 0.02),
        observation('2x', 0.73, 0.73, 0.02, 0.02),
        observation('Nighthowl Pursuer', 0.14, 0.78),
        observation('Nasty Little Rabbit', 0.28, 0.78),
        observation("Bilbo's Deadly Slice", 0.42, 0.51),
        observation('Wargling', 0.56, 0.51)
      ]
    }
  });

  assert.equal(result.ready, true);
  assert.deepEqual(result.annotations.cards.map((entry) => [entry.name, entry.quantity]), [
    ['Nighthowl Pursuer', 1],
    ['Nasty Little Rabbit', 1],
    ["Bilbo's Deadly Slice", 1]
  ]);
  assert.deepEqual(result.annotations.deckRows.map((entry) => [entry.kind, entry.name, entry.quantity]), [
    ['add', 'Nighthowl Pursuer', 1]
  ]);
});

test('fails closed when OCR misses a deck-list row', () => {
  const result = analyzeVisualGuide({
    pool,
    build,
    recognition: {
      imageWidth: 2000,
      imageHeight: 1200,
      observations: [
        observation('3/40 Cards', 0.79, 0.86),
        observation('Nighthowl Pursuer', 0.77, 0.78),
        observation('1x', 0.73, 0.78)
      ]
    }
  });
  assert.equal(result.ready, false);
  assert.match(result.reason, /Recognized 1 of 3/);
});

test('accepts right-aligned single-digit deck quantities', () => {
  const result = analyzeVisualGuide({
    pool,
    build,
    recognition: {
      imageWidth: 2046,
      imageHeight: 796,
      observations: [
        observation('3/40 Cards', 0.833, 0.821),
        observation('Nighthowl Pursuer', 0.814, 0.766),
        observation('1x', 0.7906, 0.766, 0.014, 0.02),
        observation('Swamp', 0.814, 0.679),
        observation('2x', 0.7891, 0.679, 0.016, 0.02)
      ]
    }
  });

  assert.equal(result.ready, true);
  assert.equal(result.recognizedDeckCount, 3);
});

test('accepts a deck divider joined to a cropped quantity', () => {
  const result = analyzeVisualGuide({
    pool,
    build: {
      mainDeck: [{ name: 'Nighthowl Pursuer', quantity: 1 }],
      lands: [{ name: 'Swamp', quantity: 11, basic: true }]
    },
    recognition: {
      imageWidth: 2046,
      imageHeight: 1536,
      observations: [
        observation('12/40 Cards', 0.79, 0.85),
        observation('Nighthowl Pursuer', 0.765, 0.79),
        observation('1x', 0.731, 0.79),
        observation('Swamp', 0.765, 0.39),
        observation('11xl', 0.728, 0.39)
      ]
    }
  });

  assert.equal(result.ready, true);
  assert.equal(result.recognizedDeckCount, 12);
});

test('distinguishes a clear visible page from a completed build', () => {
  const result = analyzeVisualGuide({
    pool,
    build,
    recognition: {
      imageWidth: 2000,
      imageHeight: 1200,
      observations: [
        observation('2/40 Cards', 0.79, 0.85),
        observation('Swamp', 0.77, 0.73),
        observation('2x', 0.73, 0.73)
      ]
    }
  });

  assert.equal(result.ready, true);
  assert.equal(result.annotations.cards.length, 0);
  assert.match(result.reason, /Page clear/);
  assert.equal(result.remainingTargetCount, 4);
});
