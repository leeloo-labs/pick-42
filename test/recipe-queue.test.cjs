'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRecipeTasks, recipeProgress, taskId } = require('../src/draft/recipe-queue.js');

function sampleBuild() {
  return {
    excluded: [
      { name: 'White Card', quantity: 2, manaCost: '{1}{W}', typeLine: 'Creature' },
      { name: 'Off-color Land', quantity: 1, typeLine: 'Land' }
    ],
    mainDeck: [
      { name: 'Three Drop', quantity: 1, manaValue: 3, manaCost: '{2}{B}', typeLine: 'Creature' },
      { name: 'Two Drop', quantity: 2, manaValue: 2, manaCost: '{1}{G}', typeLine: 'Creature' }
    ],
    lands: [
      { name: 'Swamp', quantity: 8, basic: true, typeLine: 'Basic Land — Swamp' },
      { name: 'Mirkwood', quantity: 1, basic: false, typeLine: 'Land', colors: ['B', 'G'] },
      { name: 'Forest', quantity: 8, basic: true, typeLine: 'Basic Land — Forest' }
    ]
  };
}

test('recipe orders removals, spells, drafted lands, then basics', () => {
  const tasks = buildRecipeTasks(sampleBuild());

  assert.deepEqual(tasks.map((task) => task.phase), [
    'REMOVE EXTRAS', 'REMOVE EXTRAS',
    'SET SPELLS', 'SET SPELLS',
    'SET DRAFTED LANDS',
    'SET BASICS', 'SET BASICS'
  ]);
  assert.deepEqual(tasks.map((task) => task.card.name), [
    'Off-color Land', 'White Card', 'Two Drop', 'Three Drop', 'Mirkwood', 'Forest', 'Swamp'
  ]);
  assert.deepEqual(tasks.map((task) => task.target), [0, 0, 2, 1, 1, 8, 8]);
});

test('progress advances past confirmed and skipped tasks', () => {
  const tasks = buildRecipeTasks(sampleBuild());
  const done = new Set([tasks[0].id]);
  const skipped = new Set([tasks[1].id]);
  const progress = recipeProgress(tasks, done, skipped);

  assert.equal(progress.completed, 2);
  assert.equal(progress.remaining, tasks.length - 2);
  assert.equal(progress.current.id, tasks[2].id);
});

test('task identifiers change when the target quantity changes', () => {
  const original = { name: 'Bilbo’s Deadly Slice', quantity: 3, manaCost: '{1}{B}{B}', typeLine: 'Instant' };
  assert.notEqual(taskId('add', original), taskId('add', { ...original, quantity: 4 }));
});
