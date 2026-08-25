'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { exclusionKeysForDraft, filterActivePool, updatePoolExclusion } = require('../src/draft/pool-plan.cjs');

const pool = [
  { name: 'Dwarven Mauler' },
  { name: 'Lake-town Nuisance' },
  { name: 'Lake-town Nuisance' }
];

test('pool exclusions remove every copy from the active modeling pool', () => {
  const preference = updatePoolExclusion(null, 'draft-42', 'Lake-town Nuisance', true);
  assert.deepEqual(filterActivePool(pool, preference, 'draft-42').map((card) => card.name), ['Dwarven Mauler']);
  assert.deepEqual([...exclusionKeysForDraft(preference, 'draft-42')], ['lake town nuisance']);

  const restored = updatePoolExclusion(preference, 'draft-42', 'Lake-town Nuisance', false);
  assert.equal(filterActivePool(pool, restored, 'draft-42').length, 3);
});

test('pool exclusions never leak into a different draft', () => {
  const preference = updatePoolExclusion(null, 'draft-42', 'Lake-town Nuisance', true);
  assert.equal(filterActivePool(pool, preference, 'draft-43').length, 3);
  assert.equal(exclusionKeysForDraft(preference, 'draft-43').size, 0);
});
