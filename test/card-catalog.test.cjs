'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { abilityLocalizationIds, manaCost, plainRulesText } = require('../src/core/card-catalog.cjs');

test('normalizes Arena old-school mana notation', () => {
  assert.equal(manaCost('o4oBoB'), '{4}{B}{B}');
  assert.equal(manaCost('oXoRoR'), '{X}{R}{R}');
  assert.equal(manaCost(''), '');
});

test('extracts and cleans localized Arena ability text', () => {
  assert.deepEqual(abilityLocalizationIds('205257:1113876,205258:1113877,1156:2568'), [1113876, 1113877, 2568]);
  assert.equal(plainRulesText('Equipped creature gets <nobr>+2/+2</nobr> and has ward {o1}.'), 'Equipped creature gets +2/+2 and has ward {1}.');
});
