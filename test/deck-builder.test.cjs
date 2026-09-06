'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildLimitedDecks, canPlay, lowCurveLandCount } = require('../src/draft/deck-builder.cjs');
const { manaProfile } = require('../src/draft/blend-engine.cjs');
const { buildRecipeTasks } = require('../src/draft/recipe-queue.js');

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

test('incomplete color combinations expose their shortage without a score or recipe', () => {
  const colors = ['W', 'U', 'B', 'R', 'G'];
  const pool = Array.from({ length: 23 }, (_, i) => card(`Spell ${i}`, `{2}{${colors[i % 5]}}`));
  const builds = buildLimitedDecks({ pool, ...sourceRows(pool) });
  assert.ok(builds.length);
  for (const build of builds) {
    assert.equal(build.available, false);
    assert.equal(build.shortage, 40 - build.summary.total);
    assert.equal(build.score, null);
    assert.deepEqual(buildRecipeTasks(build), []);
  }
});

test('unrated complete decks expose coverage without a fabricated blended score', () => {
  const pool = Array.from({ length: 23 }, (_, i) => card(`Spell ${i}`, '{2}{B}'));
  const build = buildLimitedDecks({ pool })[0];
  assert.equal(build.available, true);
  assert.equal(build.score, null);
  assert.equal(build.evidence.kind, 'unrated');
  assert.equal(build.evidence.rated, 0);
  assert.ok(build.mainDeck.every((entry) => entry.sourceValue === null));
  assert.ok(buildRecipeTasks(build).length);
});

test('single-source builds carry partial evidence while retaining a supported score', () => {
  const pool = Array.from({ length: 23 }, (_, i) => card(`Spell ${i}`, '{2}{B}'));
  const build = buildLimitedDecks({ pool, seventeenLands: sourceRows(pool).seventeenLands })[0];
  assert.equal(build.evidence.kind, 'partial');
  assert.equal(build.evidence.both, 0);
  assert.equal(build.evidence.rated, 23);
  assert.ok(Number.isFinite(build.score));
});

test('a low-curve pool with only 23 spells keeps 17 lands and a complete recipe', () => {
  const pool = Array.from({ length: 23 }, (_, i) => card(`Cheap creature ${i}`, '{B}', 'Creature — Human', i < 3 ? 'When this enters, draw a card.' : ''));
  const build = buildLimitedDecks({ pool, ...sourceRows(pool) })[0];
  assert.equal(build.summary.total, 40);
  assert.equal(build.summary.lands, 17);
  assert.ok(buildRecipeTasks(build).length);
});

test('legend-rule pressure leaves a third ordinary legend out when a comparable creature is available', () => {
  const legend = card('Test Legend', '{2}{B}', 'Legendary Creature — Human');
  const pool = [legend, { ...legend }, { ...legend }, ...Array.from({ length: 22 }, (_, i) => card(`Creature ${i}`, '{2}{B}'))];
  const source = sourceRows(pool);
  for (const row of source.seventeenLands) row.gihWinRate = row.name === legend.name ? 60 : 59;
  for (const row of source.untapped) row.inHandWinRate = row.name === legend.name ? 60 : 59;
  const build = buildLimitedDecks({ pool, ...source })[0];
  assert.ok(build.mainDeck.find((entry) => entry.name === legend.name).quantity <= 2);
  const cut = build.cuts.find((entry) => entry.name === legend.name);
  assert.ok(cut);
  assert.ok(cut.construction.legend <= -15);
  assert.ok(cut.reasons.some((reason) => /third legendary/.test(reason)));
});

test('support evidence is measured against the final deck rather than a drafted off-color enabler', () => {
  const payoff = card('Dwarf Tool', '{2}', 'Artifact — Equipment', 'When this enters, attach it to target Dwarf you control.');
  const dwarf = card('Off-color Dwarf', '{G}', 'Creature — Dwarf');
  const pool = [payoff, dwarf, ...Array.from({ length: 22 }, (_, i) => card(`Black creature ${i}`, '{2}{B}'))];
  const build = buildLimitedDecks({ pool, ...sourceRows(pool), preferredLane: { colors: ['U', 'B'], label: 'Dimir' } })[0];
  const tool = build.mainDeck.find((entry) => entry.name === payoff.name);
  assert.equal(tool.construction.hardMissing, true);
  assert.ok(build.constructionNotes.some((note) => /Dwarf Tool.*support.*absent/.test(note)));
  const supported = buildLimitedDecks({ pool: [...pool, card('Black Dwarf', '{B}', 'Creature — Dwarf')], preferredLane: { colors: ['U', 'B'], label: 'Dimir' } })[0];
  const supportedTool = [...supported.mainDeck, ...supported.cuts].find((entry) => entry.name === payoff.name);
  assert.equal(supportedTool.construction.hardMissing, false);
});

test('builds complete Golgari, Jund, and Rakdos limited decks', () => {
  const pool = syntheticPool();
  const builds = buildLimitedDecks({ pool, ...sourceRows(pool) });

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

test('a basic-fetching land always starts when the deck has no dual land', () => {
  const pool = syntheticPool();
  pool.push({
    name: 'Hobbit Hole',
    manaCost: '',
    typeLine: 'Land',
    rulesText: '{T}, Sacrifice this land: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.\nHalflingcycling {4}'
  });
  const builds = buildLimitedDecks({ pool, ...sourceRows(pool) });

  const rakdos = builds.find((build) => build.id === 'rakdos');
  const fetcher = rakdos.lands.find((land) => land.name === 'Hobbit Hole');
  assert.ok(fetcher, 'Hobbit Hole missing from the dual-less Rakdos mana base');
  assert.equal(fetcher.quantity, 1);
  assert.deepEqual(fetcher.colors, rakdos.colors);
  assert.equal(rakdos.lands.reduce((total, entry) => total + entry.quantity, 0), 17);
  assert.equal(rakdos.mana.warnings.length, 0);

  const golgari = builds.find((build) => build.id === 'golgari');
  assert.ok(golgari.lands.some((land) => land.name === 'Mirkwood'));
  assert.ok(!golgari.lands.some((land) => land.name === 'Hobbit Hole'));
  assert.ok(golgari.excluded.some((entry) => entry.name === 'Hobbit Hole'));

  // A splash build starts the fetcher even alongside its dual: it also finds
  // the splash basic.
  const jund = builds.find((build) => build.id === 'jund');
  assert.ok(jund.splashColors.length > 0);
  assert.ok(jund.lands.some((land) => land.name === 'Mirkwood'));
  const splashFetcher = jund.lands.find((land) => land.name === 'Hobbit Hole');
  assert.ok(splashFetcher, 'Hobbit Hole missing from the splash mana base');
  assert.deepEqual(splashFetcher.colors, jund.colors);
  assert.equal(jund.lands.reduce((total, entry) => total + entry.quantity, 0), 17);
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
