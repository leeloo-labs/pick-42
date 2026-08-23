'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { manaPresentation, sortArenaCards } = require('../src/draft/arena-sort.js');

test('distinguishes hybrid choices from gold requirements', () => {
  assert.deepEqual(manaPresentation({ manaCost: '{2}{B/R}' }), {
    colors: ['B', 'R'],
    fixedColors: [],
    genericSymbols: '2',
    hybridGroups: [['B', 'R']],
    mode: 'hybrid',
    sourceColors: ['B', 'R']
  });
  assert.deepEqual(manaPresentation({ manaCost: '{2}{B}{R}' }), {
    colors: ['B', 'R'],
    fixedColors: ['B', 'R'],
    genericSymbols: '2',
    hybridGroups: [],
    mode: 'gold',
    sourceColors: ['B', 'R']
  });
});

test('matches Arena color grouping inside a mana-value column', () => {
  const cards = [
    { name: 'Colorless Relic', manaCost: '{2}' },
    { name: 'Green Card', manaCost: '{1}{G}' },
    { name: 'Double Black', manaCost: '{B}{B}' },
    { name: 'Red Card', manaCost: '{1}{R}' },
    { name: 'Blue Card', manaCost: '{1}{U}' },
    { name: 'Black Card', manaCost: '{1}{B}' },
    { name: 'White Card', manaCost: '{1}{W}' },
    { name: 'Black Green Hybrid', manaCost: '{1}{B/G}' },
    { name: 'Black Red Hybrid', manaCost: '{1}{B/R}' }
  ];

  assert.deepEqual(sortArenaCards(cards).map((card) => card.name), [
    'White Card',
    'Blue Card',
    'Black Card',
    'Double Black',
    'Red Card',
    'Green Card',
    'Black Red Hybrid',
    'Black Green Hybrid',
    'Colorless Relic'
  ]);
});

test('uses Arena basic-land order and puts nonbasics last', () => {
  const lands = [
    { name: 'Mirkwood' },
    { name: 'Forest' },
    { name: 'Swamp' },
    { name: 'Island' },
    { name: 'Plains' },
    { name: 'Mountain' }
  ];

  assert.deepEqual(sortArenaCards(lands, { lands: true }).map((card) => card.name), [
    'Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Mirkwood'
  ]);
});

test('sorting is presentation-only and does not mutate the deck array', () => {
  const cards = [{ name: 'Red Card', manaCost: '{R}' }, { name: 'Black Card', manaCost: '{B}' }];
  const sorted = sortArenaCards(cards);

  assert.deepEqual(cards.map((card) => card.name), ['Red Card', 'Black Card']);
  assert.deepEqual(sorted.map((card) => card.name), ['Black Card', 'Red Card']);
});
