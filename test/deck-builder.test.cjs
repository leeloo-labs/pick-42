'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildLimitedDecks, canPlay, lowCurveLandCount } = require('../src/draft/deck-builder.cjs');
const { manaProfile } = require('../src/draft/blend-engine.cjs');

function card(name, manaCost, typeLine = 'Creature — Test', rulesText = '') {
  return { name, manaCost, typeLine, rulesText, printedPower: /Creature/.test(typeLine) ? '2' : null, printedToughness: /Creature/.test(typeLine) ? '2' : null };
}

function syntheticPool() {
  const pool = [];
  for (let index = 0; index < 10; index += 1) pool.push(card(`Black Creature ${index}`, index < 3 ? '{B}' : (index < 7 ? '{1}{B}' : '{2}{B}')));
  for (let index = 0; index < 5; index += 1) pool.push(card(`Black Removal ${index}`, '{1}{B}{B}', 'Instant', 'Destroy target creature.'));
  for (let index = 0; index < 8; index += 1) pool.push(card(`Green Creature ${index}`, index < 2 ? '{G}' : (index < 6 ? '{1}{G}' : '{3}{G}')));
  for (let index = 0; index < 2; index += 1) pool.push(card(`Green Spell ${index}`, '{2}{G}', 'Sorcery', 'Put two +1/+1 counters on target creature.'));
  for (let index = 0; index < 8; index += 1) pool.push(card(`Red Creature ${index}`, index < 5 ? '{1}{R}' : '{3}{R}'));
  for (let index = 0; index < 2; index += 1) pool.push(card(`Red Removal ${index}`, '{1}{R}', 'Instant', 'This spell deals 3 damage to target creature.'));
  pool.push(card('Flexible Body', '{2}(B/R)'));
  pool.push({ name: 'Mirkwood', manaCost: '', typeLine: 'Land', rulesText: '{T}: Add {B} or {G}.' });
  pool.push({ name: 'Island', manaCost: '', typeLine: 'Basic Land — Island', rulesText: '' });
  return pool;
}

function sourceRows(pool) {
  const spells = pool.filter((entry) => !/\bLand\b/.test(entry.typeLine));
  return {
    seventeenLands: spells.map((entry, index) => ({ name: entry.name, gihWinRate: 55 + (index % 7) * 0.7, gamesInHand: 5000, improvementWhenDrawn: (index % 5) * 0.4 })),
    untapped: spells.map((entry, index) => ({ name: entry.name, inHandWinRate: 54.5 + (index % 6) * 0.7, games: 8000, inHandWinRateDelta: (index % 4) * 0.5 }))
  };
}

test('builds complete Golgari, Jund, and Rakdos limited decks', () => {
  const pool = syntheticPool();
  const builds = buildLimitedDecks({ pool, ...sourceRows(pool), philosophy: { interactionPriority: 80 } });

  assert.deepEqual(builds.map((build) => build.id), ['golgari', 'jund', 'rakdos']);
  for (const build of builds) {
    assert.equal(build.available, true);
    assert.equal(build.summary.total, 40);
    assert.equal(build.summary.lands, 17);
    assert.equal(build.summary.spells, 23);
    assert.equal(build.mainDeck.reduce((total, entry) => total + entry.quantity, 0), 23);
    assert.equal(build.lands.reduce((total, entry) => total + entry.quantity, 0), 17);
    const draftedTargetLands = build.lands.filter((land) => !land.basic).reduce((total, entry) => total + entry.quantity, 0);
    assert.equal(
      build.mainDeck.reduce((total, entry) => total + entry.quantity, 0)
        + draftedTargetLands
        + build.excluded.reduce((total, entry) => total + entry.quantity, 0),
      pool.filter((entry) => !/\bBasic Land\b/.test(entry.typeLine)).length
    );
  }

  assert.ok(builds.find((build) => build.id === 'golgari').lands.some((land) => land.name === 'Mirkwood'));
  assert.ok(builds.find((build) => build.id === 'jund').lands.some((land) => land.name === 'Mirkwood'));
  assert.ok(!builds.find((build) => build.id === 'rakdos').lands.some((land) => land.name === 'Mirkwood'));
  assert.ok(builds.find((build) => build.id === 'rakdos').excluded.some((entry) => entry.name === 'Mirkwood'));
});

test('every suggested spell is castable within its archetype colors', () => {
  const pool = syntheticPool();
  const builds = buildLimitedDecks({ pool, ...sourceRows(pool) });

  for (const build of builds) {
    for (const entry of build.mainDeck) assert.equal(canPlay(entry, build.colors), true, `${entry.name} is not castable in ${build.name}`);
  }
  assert.equal(canPlay(card('Hybrid', '{2}(B/R)'), ['B']), true);
  assert.equal(canPlay(card('Gold', '{B}{G}'), ['B']), false);
});

test('only drops to 16 lands for a genuinely low curve with card flow', () => {
  const lowCurve = Array.from({ length: 24 }, (_, index) => ({
    manaValue: index < 12 ? 1 : 2,
    roles: { cardAdvantage: index < 2 }
  }));
  const ordinaryCurve = lowCurve.map((entry, index) => ({ ...entry, manaValue: index < 5 ? 4 : 2 }));

  assert.equal(lowCurveLandCount(lowCurve), 16);
  assert.equal(lowCurveLandCount(ordinaryCurve), 17);
});

test('mana profiles preserve fixed versus hybrid color requirements', () => {
  const hybrid = manaProfile('{2}(B/R)');
  const gold = manaProfile('{2}{B}{G}');
  const dualLand = manaProfile({ name: 'Lake-town', typeLine: 'Land', rulesText: '{T}: Add {W} or {U}.' });

  assert.deepEqual(hybrid.fixedColors, []);
  assert.deepEqual(hybrid.hybridGroups, [['B', 'R']]);
  assert.deepEqual(gold.fixedColors, ['B', 'G']);
  assert.deepEqual(dualLand.hybridGroups, [['W', 'U']]);
  assert.equal(dualLand.isLandSource, true);
});

test('builds the preferred lane from the newest pool instead of fixed prototype colors', () => {
  const pool = [];
  for (let index = 0; index < 13; index += 1) pool.push(card(`Red Dwarf ${index}`, index < 7 ? '{1}{R}' : '{3}{R}', 'Creature — Dwarf Warrior'));
  for (let index = 0; index < 10; index += 1) pool.push(card(`White Dwarf ${index}`, index < 6 ? '{1}{W}' : '{3}{W}', 'Creature — Dwarf Soldier'));
  for (let index = 0; index < 4; index += 1) pool.push(card(`Boros Removal ${index}`, index % 2 ? '{1}{R}' : '{1}{W}', 'Instant', 'Destroy target creature.'));
  for (let index = 0; index < 3; index += 1) pool.push(card(`Blue Detour ${index}`, '{2}{U}'));

  const builds = buildLimitedDecks({
    pool,
    ...sourceRows(pool),
    preferredLane: { colors: ['W', 'R'], label: 'Boros Dwarves' }
  });

  assert.equal(builds[0].id, 'boros');
  assert.equal(builds[0].name, 'Boros Dwarves');
  assert.deepEqual(builds[0].colors, ['W', 'R']);
  assert.match(builds[0].label, /CURRENT LANE/);
  assert.equal(builds[0].summary.total, 40);
  assert.ok(builds.every((build) => build.id !== 'golgari' && build.id !== 'rakdos'));
});
