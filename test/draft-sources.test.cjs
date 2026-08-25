'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseSeventeenLandsCsv } = require('../src/draft/sources/seventeenlands.cjs');
const { parseUntappedCsv } = require('../src/draft/sources/untapped.cjs');
const {
  DEFAULT_STRATEGY_ID,
  DRAFT_STRATEGIES,
  analyzeCardRole,
  analyzePoolSynergy,
  evaluateColorFit,
  explicitSubtypeRequirements,
  ferociousEnablerWeight,
  inferColorContext,
  inferDraftLane,
  manaProfile,
  philosophyForStrategy,
  recommendPickTwoPair,
  scoreDraftPack
} = require('../src/draft/blend-engine.cjs');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, 'fixtures', name), 'utf8');
const catalog = JSON.parse(read('demo-draft-cards.json'));
const cards = Object.entries(catalog).map(([grpId, card]) => ({ grpId: Number(grpId), ...card }));

test('normalizes official-style 17Lands and Untapped CSV columns', () => {
  const lands = parseSeventeenLandsCsv(read('sample-17lands-hob.csv'));
  const untapped = parseUntappedCsv(read('sample-untapped-hob.csv'));

  assert.equal(lands.length, 14);
  assert.equal(untapped.length, 14);
  assert.equal(lands.find((card) => card.name === 'Fíli the Pathfinder').gihWinRate, 66);
  assert.equal(untapped.find((card) => card.name === 'Gollum, Riddle Master').inHandWinRate, 61.8);
  assert.equal(lands.find((card) => card.name === 'Gollum, Riddle Master').key, untapped.find((card) => card.name === 'Gollum, Riddle Master').key);
});

test('blends both sources and exposes philosophy adjustments', () => {
  const recommendations = scoreDraftPack({
    cards,
    seventeenLands: parseSeventeenLandsCsv(read('sample-17lands-hob.csv')),
    untapped: parseUntappedCsv(read('sample-untapped-hob.csv')),
    pool: [],
    packNumber: 1,
    pickNumber: 1
  });

  assert.equal(recommendations[0].name, 'Fíli the Pathfinder');
  assert.ok(recommendations[0].metrics.seventeenLands);
  assert.ok(recommendations[0].metrics.untapped);
  assert.ok(recommendations[0].reasons.some((reason) => reason.startsWith('17L')));
  assert.ok(Number.isFinite(recommendations[0].philosophyDelta));
});

test('draft strategies expose five distinct, stable presets', () => {
  assert.equal(DEFAULT_STRATEGY_ID, 'balanced');
  assert.deepEqual(Object.keys(DRAFT_STRATEGIES), ['balanced', 'synergy', 'power', 'aggro', 'control']);
  assert.equal(philosophyForStrategy('aggro').aggressionPriority, 100);
  assert.equal(philosophyForStrategy('control').controlPriority, 100);
  assert.equal(philosophyForStrategy('power').fixingPriority, 100);
  assert.equal(philosophyForStrategy('missing').strategyId, 'balanced');
});

test('Aggro and Control favor meaningfully different card roles', () => {
  const quickblade = {
    name: 'Quickblade', manaCost: '{1}{R}', typeLine: 'Creature — Warrior',
    rulesText: 'Haste', printedPower: '2', printedToughness: '1'
  };
  const tomekeeper = {
    name: 'Ancient Tomekeeper', manaCost: '{5}{U}', typeLine: 'Creature — Sphinx',
    rulesText: 'Flying\nWhen Ancient Tomekeeper enters, draw two cards.', printedPower: '4', printedToughness: '6'
  };
  const sources = {
    seventeenLands: [quickblade, tomekeeper].map((card) => ({ name: card.name, gihWinRate: 56, gamesInHand: 10000 })),
    untapped: [quickblade, tomekeeper].map((card) => ({ name: card.name, inHandWinRate: 56, games: 10000 }))
  };
  const aggro = scoreDraftPack({ cards: [quickblade, tomekeeper], ...sources, philosophy: philosophyForStrategy('aggro') });
  const control = scoreDraftPack({ cards: [quickblade, tomekeeper], ...sources, philosophy: philosophyForStrategy('control') });

  assert.equal(aggro[0].name, 'Quickblade');
  assert.equal(control[0].name, 'Ancient Tomekeeper');
  assert.ok(aggro.find((card) => card.name === 'Quickblade').adjustments.aggression >= 4);
  assert.ok(control.find((card) => card.name === 'Ancient Tomekeeper').adjustments.control >= 3);
  assert.ok(control[0].reasons.some((reason) => reason.includes('Control:')));
});

test('Power & Fixing explicitly rewards flexible mana without ranking basics', () => {
  const fixing = { name: 'Crossroads', manaCost: '', typeLine: 'Land', rulesText: 'Add {B} or {G}.' };
  const recommendation = scoreDraftPack({
    cards: [fixing],
    philosophy: philosophyForStrategy('power'),
    seventeenLands: [{ name: fixing.name, gihWinRate: 56, gamesInHand: 10000, rarity: 'uncommon' }],
    untapped: [{ name: fixing.name, inHandWinRate: 56, games: 10000 }]
  })[0];

  assert.ok(recommendation.adjustments.fixing >= 2.7);
  assert.ok(recommendation.reasons.some((reason) => reason.includes('Power & Fixing: flexible mana fixing')));
});

test('color discipline matters after the early open-draft window', () => {
  const source = {
    seventeenLands: parseSeventeenLandsCsv(read('sample-17lands-hob.csv')),
    untapped: parseUntappedCsv(read('sample-untapped-hob.csv'))
  };
  const pool = [catalog['103382'], catalog['103385'], catalog['103375']];
  const focusedCards = [catalog['103397'], catalog['103489']];
  const loose = scoreDraftPack({ cards: focusedCards, ...source, pool, packNumber: 2, pickNumber: 4, philosophy: { colorDiscipline: 0 } });
  const disciplined = scoreDraftPack({ cards: focusedCards, ...source, pool, packNumber: 2, pickNumber: 4, philosophy: { colorDiscipline: 100 } });
  const partyLoose = loose.find((card) => card.name === 'An Unexpected Party');
  const partyDisciplined = disciplined.find((card) => card.name === 'An Unexpected Party');

  assert.ok(partyDisciplined.score > partyLoose.score);
  assert.ok(partyDisciplined.adjustments.color > 0);
});

test('steers this black-centered P1P8 pool toward Wargling instead of white cards', () => {
  const pool = [
    { name: 'Pinecone Strike', manaCost: '{1}{R}', typeLine: 'Instant' },
    { name: 'Fearsome Goblin Pair', manaCost: '{2}(B/R)', typeLine: 'Creature — Goblin Soldier' },
    { name: "Bilbo's Deadly Slice", manaCost: '{1}{B}{B}', typeLine: 'Instant' },
    { name: 'Nighthowl Pursuer', manaCost: '{B}', typeLine: 'Creature — Wolf' },
    {
      name: 'The Chief Warg', manaCost: '{2}{B}{G}', typeLine: 'Legendary Creature — Wolf',
      rulesText: 'Menace\nFerocious — Whenever you attack while you control a creature with power 4 or greater, you draw a card and lose 1 life.'
    },
    { name: 'Gathering of Darkness', manaCost: '{3}{B}', typeLine: 'Sorcery' },
    { name: 'Nasty Little Rabbit', manaCost: '{G}', typeLine: 'Creature — Rabbit' }
  ];
  const cards = [
    { name: "The Mountain-king's Return", manaCost: '{2}{W}', typeLine: 'Enchantment — Saga' },
    { name: 'Magnificent End', manaCost: '{4}{W}', typeLine: 'Instant' },
    {
      name: 'Wargling', manaCost: '{1}{G}', typeLine: 'Creature — Wolf',
      rulesText: 'Ferocious — Whenever this creature attacks while you control a creature with power 4 or greater, creatures you control gain trample.'
    },
    {
      name: 'Nori, Teller of Tales', manaCost: '{1}(R/W)', typeLine: 'Legendary Creature — Dwarf Bard',
      rulesText: 'Whenever Nori attacks, target attacking creature gains first strike until end of turn.'
    }
  ];
  const sourceRows = [
    [cards[0].name, 59.3, 54.4],
    [cards[1].name, 55.3, 50.8],
    [cards[2].name, 52, 53.2],
    [cards[3].name, 55.4, 50.3]
  ];
  const recommendations = scoreDraftPack({
    cards,
    pool,
    packNumber: 1,
    pickNumber: 8,
    philosophy: {
      sourceBalance: 50,
      powerPriority: 63,
      stayOpen: 65,
      colorDiscipline: 73,
      curveDiscipline: 63,
      signalSensitivity: 73,
      synergyPriority: 79,
      creaturePreference: 50
    },
    seventeenLands: sourceRows.map(([name, gihWinRate]) => ({ name, gihWinRate, gamesInHand: 10000 })),
    untapped: sourceRows.map(([name, , inHandWinRate]) => ({ name, inHandWinRate, games: 10000 }))
  });

  assert.equal(recommendations[0].name, 'Wargling');
  assert.deepEqual(recommendations[0].colorContext.primaryColors, ['B']);
  assert.deepEqual(recommendations[0].colorContext.secondaryColors, ['G']);
  assert.equal(recommendations[0].colorContext.classification, 'secondary');
  assert.ok(recommendations[0].adjustments.color > 3);
  assert.equal(recommendations.find((card) => card.name === 'Nori, Teller of Tales').colorContext.classification, 'new-color');
  for (const whiteCard of recommendations.filter((card) => card.manaCost.includes('{W}'))) {
    assert.equal(whiteCard.colorContext.classification, 'new-color');
    assert.ok(whiteCard.adjustments.color < -10);
    assert.ok(whiteCard.adjustments.flexibility < 0);
  }
});

test('prefers premium removal in this P2P3 pack and keeps impact metrics visible', () => {
  const pool = [
    { name: 'Pinecone Strike', manaCost: '{1}{R}', typeLine: 'Instant', rulesText: 'Pinecone Strike deals 3 damage to target creature.' },
    { name: 'Mirkwood', manaCost: '', typeLine: 'Land', rulesText: 'Put two +1/+1 counters on target Bear, Spider, or Wolf you control.' },
    { name: "Smaug's Fury", manaCost: '{1}{R}', typeLine: 'Instant', rulesText: 'Target creature gets +3/+0 until end of turn.' },
    { name: 'Fearsome Goblin Pair', manaCost: '{2}(B/R)', typeLine: 'Creature — Goblin Soldier', rulesText: 'When this creature dies, amass Goblins 4.', printedPower: '1' },
    { name: "Bilbo's Deadly Slice", manaCost: '{1}{B}{B}', typeLine: 'Instant', rulesText: 'Destroy target creature.' },
    { name: 'Wilderland Scrounger', manaCost: '{4}{G}', typeLine: 'Creature — Wolf', rulesText: 'Ferocious — Whenever this creature attacks while you control a creature with power 4 or greater, put a +1/+1 counter on each creature you control.', printedPower: '3' },
    { name: 'Lakeshore Apothecary', manaCost: '{1}{U}', typeLine: 'Creature — Human Cleric', printedPower: '1' },
    { name: 'Nighthowl Pursuer', manaCost: '{B}', typeLine: 'Creature — Wolf', rulesText: 'Ferocious — Whenever this creature attacks while you control a creature with power 4 or greater, this creature gets +2/+2 until end of turn.', printedPower: '1' },
    { name: 'Elven Raft-Steerer', manaCost: '{2}{U}', typeLine: 'Creature — Elf Pilot', printedPower: '3' },
    { name: 'The Chief Warg', manaCost: '{2}{B}{G}', typeLine: 'Legendary Creature — Wolf', rulesText: 'Ferocious — Whenever you attack while you control a creature with power 4 or greater, draw a card.', printedPower: '3' },
    { name: 'Gathering of Darkness', manaCost: '{3}{B}', typeLine: 'Sorcery' },
    { name: 'Nasty Little Rabbit', manaCost: '{G}', typeLine: 'Creature — Rabbit', rulesText: 'Ferocious — At the beginning of combat, if you control a creature with power 4 or greater, put a +1/+1 counter on this creature.', printedPower: '1' },
    { name: 'Wargling', manaCost: '{1}{G}', typeLine: 'Creature — Wolf', rulesText: 'Ferocious — Whenever this creature attacks while you control a creature with power 4 or greater, creatures you control gain trample.', printedPower: '2' },
    { name: 'Burn, Burn, Tree and Fern', manaCost: '{3}{R}', typeLine: 'Enchantment — Saga' },
    { name: 'Stir Up Trouble', manaCost: '{B}', typeLine: 'Sorcery', rulesText: 'As an additional cost to cast this spell, sacrifice an artifact or creature or pay {4}. Destroy target creature.' }
  ];
  const cards = [
    { name: 'Ravening Warg', manaCost: '{1}{B}', typeLine: 'Creature — Wolf', rulesText: 'Deathtouch\nFerocious — Whenever this creature attacks while you control a creature with power 4 or greater, you gain 2 life.', printedPower: '2' },
    { name: 'Nasty Little Rabbit', manaCost: '{G}', typeLine: 'Creature — Rabbit', rulesText: 'Ferocious — At the beginning of combat, if you control a creature with power 4 or greater, put a +1/+1 counter on this creature.', printedPower: '1' },
    { name: "Bilbo's Deadly Slice", manaCost: '{1}{B}{B}', typeLine: 'Instant', rulesText: 'Destroy target creature.' }
  ];
  const seventeenLands = [
    { name: cards[0].name, gihWinRate: 60.2, gamesInHand: 7198, alsa: 5.06, improvementWhenDrawn: -0.1 },
    { name: cards[1].name, gihWinRate: 59.2, gamesInHand: 1359, alsa: 3.03, improvementWhenDrawn: 3.1 },
    { name: cards[2].name, gihWinRate: 58.9, gamesInHand: 7911, alsa: 3.47, improvementWhenDrawn: 0.5 }
  ];
  const untapped = [
    { name: cards[0].name, inHandWinRate: 58.1, games: 36000, avgLastOffered: 5.7, inHandWinRateDelta: 2.1 },
    { name: cards[1].name, inHandWinRate: 57.4, games: 9400, avgLastOffered: 3.2, inHandWinRateDelta: 6.7 },
    { name: cards[2].name, inHandWinRate: 57.6, games: 41000, avgLastOffered: 3.7, inHandWinRateDelta: 1.8 }
  ];
  const recommendations = scoreDraftPack({
    cards,
    pool,
    packNumber: 2,
    pickNumber: 3,
    seventeenLands,
    untapped,
    philosophy: {
      sourceBalance: 50,
      powerPriority: 63,
      stayOpen: 65,
      colorDiscipline: 67,
      curveDiscipline: 68,
      signalSensitivity: 73,
      synergyPriority: 75,
      interactionPriority: 80
    }
  });
  const slice = recommendations.find((card) => card.name === "Bilbo's Deadly Slice");
  const warg = recommendations.find((card) => card.name === 'Ravening Warg');
  const rabbit = recommendations.find((card) => card.name === 'Nasty Little Rabbit');

  assert.equal(recommendations[0].name, "Bilbo's Deadly Slice");
  assert.equal(slice.role.kind, 'premium-removal');
  assert.ok(slice.adjustments.interaction >= 4.8);
  assert.ok(warg.adjustments.synergy < 2);
  assert.ok(rabbit.adjustments.impact > warg.adjustments.impact + 1);
  assert.ok(slice.reasons.some((reason) => reason.includes('premium unconditional removal')));
});

test('Ferocious payoffs require enablers rather than more Ferocious payoffs', () => {
  const payoff = {
    name: 'Ravening Warg', manaCost: '{1}{B}', typeLine: 'Creature — Wolf', printedPower: '2',
    rulesText: 'Ferocious — Whenever this creature attacks while you control a creature with power 4 or greater, you gain 2 life.'
  };
  const repeatedPayoffs = Array.from({ length: 5 }, (_, index) => ({ ...payoff, name: `Payoff ${index}` }));
  const enabler = { name: 'Hill Giant', manaCost: '{3}{R}', typeLine: 'Creature — Giant', printedPower: '4', rulesText: '' };
  const circular = { name: 'Nighthowl Pursuer', typeLine: 'Creature — Wolf', printedPower: '1', rulesText: 'Ferocious — Whenever this creature attacks while you control a creature with power 4 or greater, this creature gets +2/+2 until end of turn.' };

  assert.equal(analyzePoolSynergy(payoff, repeatedPayoffs).score, 0);
  assert.equal(ferociousEnablerWeight(circular), 0);
  assert.ok(analyzePoolSynergy(payoff, [enabler]).score > 0);
  assert.equal(analyzeCardRole({ rulesText: 'Destroy target creature.' }).kind, 'premium-removal');
});

test('treats hybrid mana as playable through either established color', () => {
  const pool = Array.from({ length: 5 }, (_, index) => ({ name: `Black ${index}`, manaCost: '{B}', typeLine: 'Creature' }));
  const context = inferColorContext(pool, 1, 6);
  const profile = manaProfile('{2}(B/R)');
  const fit = evaluateColorFit({ manaCost: '{2}(B/R)' }, context);

  assert.deepEqual(profile.fixedColors, []);
  assert.deepEqual(profile.hybridGroups, [['B', 'R']]);
  assert.equal(fit.classification, 'hybrid-fit');
  assert.deepEqual(fit.newColors, []);
});

test('an early off-color bomb can still overcome weak lane evidence', () => {
  const black = { name: 'Solid Black Card', manaCost: '{2}{B}', typeLine: 'Creature' };
  const bomb = { name: 'White Bomb', manaCost: '{3}{W}', typeLine: 'Creature' };
  const recommendations = scoreDraftPack({
    cards: [black, bomb],
    pool: [{ name: 'First Pick', manaCost: '{B}', typeLine: 'Creature' }],
    packNumber: 1,
    pickNumber: 2,
    seventeenLands: [
      { name: black.name, gihWinRate: 55, gamesInHand: 10000 },
      { name: bomb.name, gihWinRate: 66, gamesInHand: 10000 }
    ],
    untapped: [
      { name: black.name, inHandWinRate: 55, games: 10000 },
      { name: bomb.name, inHandWinRate: 66, games: 10000 }
    ]
  });

  assert.equal(recommendations[0].name, 'White Bomb');
});

test('does not manufacture rankings when source rows are missing', () => {
  const missing = scoreDraftPack({
    cards: [catalog['103554'] || { name: 'Dwarven Mattock', manaCost: '{2}', typeLine: 'Artifact — Equipment' }, catalog['103568']],
    seventeenLands: [],
    untapped: [],
    pool: [],
    packNumber: 1,
    pickNumber: 2
  });

  assert.equal(missing[0].score, null);
  assert.equal(missing[0].eligible, false);
  assert.ok(missing[0].reasons.some((reason) => reason.includes('unranked')));
  assert.equal(missing.at(-1).name, 'Hobbit Hole');
  assert.equal(missing.at(-1).isBasicLand, false);
});

test('basic lands are never promoted by the colorless flexibility rule', () => {
  const plains = { name: 'Plains', manaCost: '', typeLine: 'Basic Land — Plains' };
  const recommendation = scoreDraftPack({
    cards: [plains],
    seventeenLands: [{ key: 'plains', name: 'Plains', gihWinRate: 70, gamesInHand: 10000 }],
    untapped: [{ key: 'plains', name: 'Plains', inHandWinRate: 70, games: 10000 }]
  })[0];

  assert.equal(recommendation.score, null);
  assert.equal(recommendation.eligible, false);
  assert.equal(recommendation.isBasicLand, true);
  assert.deepEqual(recommendation.reasons, ['17L 70% GIH', 'Untapped 70% in-hand', 'Basic land · not ranked']);
});

test('parses percentage-point suffixes from current source exports', () => {
  const lands = parseSeventeenLandsCsv('Name,# GIH,GIH WR,# GNS,GNS WR,IIH\nDwarven Mattock,738,54.3%,910,54.0%,0.3pp');
  const untapped = parseUntappedCsv('Card,In Hand WR,In Hand WR Difference,Total Games\nDwarven Mattock,55.7%,+6.3% pts,"6,700"');

  assert.equal(lands[0].gamesNotSeen, 910);
  assert.equal(lands[0].gamesNotSeenWinRate, 54);
  assert.equal(lands[0].improvementInHand, 0.3);
  assert.equal(lands[0].improvementWhenDrawn, 0.3);
  assert.equal(untapped[0].improvementInHand, 6.3);
  assert.equal(untapped[0].inHandWinRateDelta, 6.3);
  assert.equal(untapped[0].games, 6700);
});

test('turns reliable extreme IIH into visible positive and negative draft flags', () => {
  const cards = [
    { name: 'Desert Were-Worm', manaCost: '{4}{R}{R}', typeLine: 'Creature — Dragon Wurm' },
    { name: 'Reliable Bomb', manaCost: '{4}{R}', typeLine: 'Creature — Dragon' }
  ];
  const recommendations = scoreDraftPack({
    cards,
    philosophy: { sourceBalance: 50, powerPriority: 63 },
    seventeenLands: [
      { name: cards[0].name, gihWinRate: 52, gamesInHand: 1100, gamesNotSeen: 1800, improvementInHand: -6.2 },
      { name: cards[1].name, gihWinRate: 60, gamesInHand: 2400, gamesNotSeen: 3100, improvementInHand: 5.8 }
    ],
    untapped: [
      { name: cards[0].name, inHandWinRate: 45.3, games: 970, improvementInHand: -7.8 },
      { name: cards[1].name, inHandWinRate: 61, games: 4200, improvementInHand: 6.1 }
    ]
  });
  const liability = recommendations.find((card) => card.name === 'Desert Were-Worm');
  const bomb = recommendations.find((card) => card.name === 'Reliable Bomb');

  assert.equal(liability.metrics.impactFlag.kind, 'negative');
  assert.equal(liability.metrics.impactFlag.severity, 'strong');
  assert.ok(liability.adjustments.impact <= -4);
  assert.ok(liability.reasons[0].includes('IIH'));
  assert.equal(bomb.metrics.impactFlag.kind, 'positive');
  assert.ok(bomb.adjustments.impact >= 4);
});

test('labels extreme IIH from tiny samples as uncertain and requires usable ratings for source coverage', () => {
  const card = { name: 'Suspicious Rare', manaCost: '{5}{R}', typeLine: 'Creature' };
  const result = scoreDraftPack({
    cards: [card],
    philosophy: { sourceBalance: 50, powerPriority: 63 },
    seventeenLands: [{ name: card.name, gihWinRate: null, gamesInHand: 30, gamesNotSeen: 45, improvementInHand: -8 }],
    untapped: [{ name: card.name, inHandWinRate: 53, games: 35, improvementInHand: -8 }]
  })[0];

  assert.equal(result.sourceCoverage, 1);
  assert.equal(result.metrics.impactFlag.kind, 'uncertain');
  assert.ok(Math.abs(result.adjustments.impact) < 3);
  assert.ok(result.reasons.includes('Only one source matched'));
});

test('detects hard subtype requirements in rules text', () => {
  const mattock = {
    name: 'Dwarven Mattock',
    manaCost: '{2}',
    typeLine: 'Artifact — Equipment',
    rulesText: 'When this Equipment enters, attach it to target Dwarf you control.\nEquipped creature gets +2/+2 and has ward {1}.\nEquip {3}'
  };
  assert.deepEqual(explicitSubtypeRequirements(mattock.rulesText), [{ subtype: 'Dwarf', kind: 'hard', detail: 'for its attach trigger' }]);
  const unsupported = analyzePoolSynergy(mattock, [{ name: 'Wolf', typeLine: 'Creature — Wolf' }]);
  const supported = analyzePoolSynergy(mattock, [{ name: 'Dwarf', typeLine: 'Creature — Dwarf Scout' }]);

  assert.equal(unsupported.score, -20);
  assert.equal(unsupported.hardMissing, true);
  assert.ok(supported.score > 0);
  assert.equal(supported.hardMissing, false);
});

test('recognizes Stalwart synergies without misreading Reach as each', () => {
  const stalwart = {
    name: 'Iron Hills Stalwart', manaCost: '{4}{R}', typeLine: 'Creature — Dwarf Warrior',
    rulesText: 'Reach\nTrample\nWhen this creature enters, attach target Equipment you control to up to one target creature you control.'
  };
  const pool = [{
    name: 'Dwarven Mattock', manaCost: '{2}', typeLine: 'Artifact — Equipment',
    rulesText: 'When this Equipment enters, attach it to target Dwarf you control.'
  }];
  const requirements = explicitSubtypeRequirements(stalwart.rulesText);
  const synergy = analyzePoolSynergy(stalwart, pool);

  assert.deepEqual(requirements, [{ subtype: 'Equipment', kind: 'hard', detail: 'for its attach trigger' }]);
  assert.ok(!requirements.some((requirement) => requirement.subtype === 'Trample'));
  assert.ok(synergy.score >= 5);
  assert.ok(synergy.reasons.some((reason) => reason.detail.includes('1 Equipment')));
  assert.ok(synergy.reasons.some((reason) => reason.detail.includes('supports 1 Dwarf payoff')));
});

test('penalizes Mattock without Dwarfs and restores it when supported', () => {
  const mattock = {
    name: 'Dwarven Mattock', manaCost: '{2}', typeLine: 'Artifact — Equipment',
    rulesText: 'When this Equipment enters, attach it to target Dwarf you control. Equipped creature gets +2/+2 and has ward {1}. Equip {3}'
  };
  const source = {
    seventeenLands: [{ key: 'dwarven mattock', name: mattock.name, gihWinRate: 54.3, gamesInHand: 738, alsa: 4.59 }],
    untapped: [{ key: 'dwarven mattock', name: mattock.name, inHandWinRate: 55.7, games: 6700, avgLastOffered: 4.8 }]
  };
  const settings = { sourceBalance: 0, stayOpen: 65, signalSensitivity: 83, synergyPriority: 90 };
  const withoutDwarf = scoreDraftPack({ cards: [mattock], ...source, pool: [{ typeLine: 'Creature — Wolf', manaCost: '{B}' }], packNumber: 1, pickNumber: 5, philosophy: settings })[0];
  const withDwarf = scoreDraftPack({ cards: [mattock], ...source, pool: [{ typeLine: 'Creature — Dwarf Scout', manaCost: '{R}' }], packNumber: 1, pickNumber: 5, philosophy: settings })[0];

  assert.ok(withoutDwarf.adjustments.synergy <= -18);
  assert.ok(withoutDwarf.adjustments.flexibility < 0);
  assert.ok(withoutDwarf.reasons[0].includes('no Dwarf'));
  assert.ok(withDwarf.score > withoutDwarf.score + 15);
});

function borosDraftPool() {
  return [
    { name: 'Misty Mountains Raider', manaCost: '{4}{R}', typeLine: 'Creature — Goblin Soldier' },
    { name: 'Stone by Sunlight', manaCost: '{1}{W}', typeLine: 'Instant' },
    { name: 'Pinecone Strike', manaCost: '{1}{R}', typeLine: 'Instant' },
    { name: 'Patient Instructor', manaCost: '{2}(W/U)', typeLine: 'Creature — Human Citizen' },
    { name: 'Dori, Bearer of Friends', manaCost: '{2}{R}', typeLine: 'Legendary Creature — Dwarf Warrior' },
    { name: 'Lake-town Toymaker', manaCost: '{3}{W}', typeLine: 'Creature — Human Artificer' },
    { name: 'Pinecone Strike', manaCost: '{1}{R}', typeLine: 'Instant' },
    { name: 'Old Thrush', manaCost: '{2}', typeLine: 'Creature — Bird' },
    { name: 'Dori, Bearer of Friends', manaCost: '{2}{R}', typeLine: 'Legendary Creature — Dwarf Warrior' },
    { name: 'Mirkwood Nurturer', manaCost: '{2}(G/U)', typeLine: 'Creature — Elf Druid' },
    { name: 'Dwarven Mattock', manaCost: '{2}', typeLine: 'Artifact — Equipment' },
    { name: 'Dwarven Mauler', manaCost: '{R}', typeLine: 'Creature — Dwarf Warrior' },
    { name: 'Iron Hills Stalwart', manaCost: '{4}{R}', typeLine: 'Creature — Dwarf Warrior' },
    { name: 'The Misty Mountains Cold', manaCost: '{2}{R}', typeLine: 'Enchantment — Saga' },
    { name: 'Lakeshore Apothecary', manaCost: '{1}{U}', typeLine: 'Creature — Elf Druid' }
  ];
}

test('infers a committed Boros Dwarves lane instead of accepting every drafted color', () => {
  const lane = inferDraftLane({
    pool: borosDraftPool(),
    packNumber: 2,
    pickNumber: 2,
    draftId: 'draft-42'
  });

  assert.equal(lane.status, 'committed');
  assert.equal(lane.label, 'Boros Dwarves');
  assert.deepEqual(new Set(lane.colors), new Set(['W', 'R']));
  assert.ok(lane.confidence >= 62);
  assert.notEqual(lane.evidence.runnerUp, 'Boros');
});

test('manual lane choices are scoped to the current draft', () => {
  const common = { pool: borosDraftPool(), packNumber: 2, pickNumber: 2, draftId: 'draft-42' };
  const noSplash = inferDraftLane({
    ...common,
    preference: { mode: 'lock-no-splash', draftId: 'draft-42', colors: ['W', 'R'], label: 'Boros Dwarves' }
  });
  const splash = inferDraftLane({
    ...common,
    preference: { mode: 'lock-splash', draftId: 'draft-42', colors: ['W', 'R'], label: 'Boros Dwarves' }
  });
  const open = inferDraftLane({ ...common, preference: { mode: 'stay-open', draftId: 'draft-42' } });
  const stale = inferDraftLane({ ...common, preference: { mode: 'stay-open', draftId: 'older-draft' } });

  assert.equal(noSplash.status, 'locked');
  assert.equal(noSplash.splashPolicy, 'none');
  assert.equal(splash.status, 'locked');
  assert.equal(splash.splashPolicy, 'open');
  assert.equal(open.status, 'open');
  assert.equal(open.manual, true);
  assert.equal(stale.status, 'committed');
  assert.equal(stale.manual, false);
});

test('a committed lane gates ordinary off-color cards before every Draft Strategy', () => {
  const candidates = [
    { name: 'Desolation Prowler', manaCost: '{1}{B}', typeLine: 'Creature — Wolf', rarity: 'uncommon' },
    { name: 'Long Lake Nuisance', manaCost: '{3}{U}', typeLine: 'Creature — Bird', rarity: 'uncommon' },
    { name: 'Misty Mountains Raider', manaCost: '{4}{R}', typeLine: 'Creature — Goblin Soldier', rarity: 'common' }
  ];
  const seventeenLands = [
    { name: candidates[0].name, gihWinRate: 61.5, gamesInHand: 34000, rarity: 'uncommon' },
    { name: candidates[1].name, gihWinRate: 57.7, gamesInHand: 61000, rarity: 'uncommon' },
    { name: candidates[2].name, gihWinRate: 56.2, gamesInHand: 39000, rarity: 'common' }
  ];
  const untapped = [
    { name: candidates[0].name, inHandWinRate: 58.7, games: 52000, rarity: 'uncommon' },
    { name: candidates[1].name, inHandWinRate: 54.6, games: 50000, rarity: 'uncommon' },
    { name: candidates[2].name, inHandWinRate: 54.8, games: 48000, rarity: 'common' }
  ];
  const common = {
    cards: candidates,
    pool: borosDraftPool(),
    seventeenLands,
    untapped,
    packNumber: 2,
    pickNumber: 2,
    draftId: 'draft-42'
  };

  for (const strategy of Object.keys(DRAFT_STRATEGIES)) {
    const ranked = scoreDraftPack({ ...common, philosophy: philosophyForStrategy(strategy) });
    assert.equal(ranked[0].name, 'Misty Mountains Raider', `${strategy} must rank inside the committed lane first`);
    assert.equal(ranked.find((card) => card.name === 'Misty Mountains Raider').contextualRank, 1);
    assert.equal(ranked.find((card) => card.name === 'Desolation Prowler').rawRank, 1);
    assert.equal(ranked.find((card) => card.name === 'Desolation Prowler').draftLane.tier, 2);
    assert.equal(ranked.find((card) => card.name === 'Long Lake Nuisance').draftLane.tier, 2);
  }
});

test('labels the best pick as a likely sideboard fallback when the locked lane has no fit', () => {
  const cards = [
    { name: 'Long Lake Nuisance', manaCost: '{3}{U}', typeLine: 'Creature — Bird', rarity: 'uncommon' },
    { name: 'Old Fat Spider', manaCost: '{4}{G}{G}', typeLine: 'Creature — Spider', rarity: 'common' }
  ];
  const seventeenLands = cards.map((card, index) => ({
    name: card.name,
    gihWinRate: index ? 53.1 : 56.4,
    gamesInHand: 42000,
    rarity: card.rarity
  }));
  const untapped = cards.map((card, index) => ({
    name: card.name,
    inHandWinRate: index ? 51.2 : 54.3,
    games: 38000,
    rarity: card.rarity
  }));
  const lane = {
    status: 'locked',
    mode: 'lock-no-splash',
    splashPolicy: 'none',
    colors: ['W', 'R'],
    label: 'Boros Dwarves',
    confidence: 100
  };
  const common = { cards, seventeenLands, untapped, lane, pool: borosDraftPool(), packNumber: 3, pickNumber: 8 };
  const ranked = scoreDraftPack(common);

  assert.equal(ranked[0].name, 'Long Lake Nuisance');
  assert.equal(ranked[0].pickOutlook.kind, 'likely-sideboard');
  assert.equal(ranked[0].pickOutlook.fallback, true);
  assert.equal(ranked[0].pickOutlook.likelyToPlay, false);
  assert.match(ranked[0].pickOutlook.detail, /does not expect it to make the deck/);
  assert.equal(ranked[1].pickOutlook.fallback, false);

  const onLane = { name: 'Misty Mountains Raider', manaCost: '{4}{R}', typeLine: 'Creature — Goblin Soldier', rarity: 'common' };
  const withFit = scoreDraftPack({
    ...common,
    cards: [...cards, onLane],
    seventeenLands: [...seventeenLands, { name: onLane.name, gihWinRate: 49.5, gamesInHand: 42000, rarity: 'common' }],
    untapped: [...untapped, { name: onLane.name, inHandWinRate: 48.8, games: 38000, rarity: 'common' }]
  });
  assert.equal(withFit[0].name, onLane.name);
  assert.equal(withFit[0].pickOutlook, null);
});

test('carries an OUT decision forward when another copy appears in a later pack', () => {
  const thrush = {
    name: 'Old Thrush',
    manaCost: '{2}',
    typeLine: 'Creature — Bird',
    rulesText: 'Flying\nWhen this creature enters, you gain 2 life.',
    rarity: 'common'
  };
  const nuisance = { name: 'Long Lake Nuisance', manaCost: '{3}{U}', typeLine: 'Creature — Bird', rarity: 'uncommon' };
  const lane = {
    status: 'locked',
    mode: 'lock-no-splash',
    splashPolicy: 'none',
    colors: ['W', 'R'],
    label: 'Boros Dwarves',
    confidence: 100
  };
  const common = {
    cards: [thrush, nuisance],
    pool: borosDraftPool(),
    excludedPoolNames: ['old thrush'],
    lane,
    packNumber: 3,
    pickNumber: 9,
    seventeenLands: [
      { name: thrush.name, gihWinRate: 55, gamesInHand: 48000, rarity: 'common' },
      { name: nuisance.name, gihWinRate: 59, gamesInHand: 48000, rarity: 'uncommon' }
    ],
    untapped: [
      { name: thrush.name, inHandWinRate: 53.5, games: 43000, rarity: 'common' },
      { name: nuisance.name, inHandWinRate: 57, games: 43000, rarity: 'uncommon' }
    ]
  };
  const ranked = scoreDraftPack(common);
  const recommendation = ranked.find((card) => card.name === thrush.name);

  assert.equal(ranked[0].name, thrush.name);
  assert.equal(recommendation.poolPlan.previouslyExcluded, true);
  assert.equal(recommendation.poolPlan.reconsidered, false);
  assert.equal(recommendation.adjustments.poolPlan, -16);
  assert.equal(recommendation.pickOutlook.kind, 'likely-sideboard');
  assert.equal(recommendation.pickOutlook.source, 'pool-choice');
  assert.match(recommendation.reasons[0], /earlier Old Thrush is marked OUT/);

  const exceptional = scoreDraftPack({
    ...common,
    cards: [thrush],
    seventeenLands: [{ name: thrush.name, gihWinRate: 63, gamesInHand: 48000, rarity: 'common' }],
    untapped: [{ name: thrush.name, inHandWinRate: 63, games: 43000, rarity: 'common' }]
  })[0];
  assert.equal(exceptional.poolPlan.reconsidered, true);
  assert.equal(exceptional.adjustments.poolPlan, -2);
  assert.equal(exceptional.pickOutlook, null);
  assert.match(exceptional.reasons[0], /reconsider the earlier OUT mark/);
});

test('recommends a Pick Two pair with the pool updated between picks', () => {
  const seventeenLands = parseSeventeenLandsCsv(read('sample-17lands-hob.csv'));
  const untapped = parseUntappedCsv(read('sample-untapped-hob.csv'));
  const args = { seventeenLands, untapped, pool: [], packNumber: 1, pickNumber: 1, format: 'Pick Two Draft' };
  const recommendations = scoreDraftPack({ cards, ...args });

  const pair = recommendPickTwoPair({ recommendations, cards, ...args });
  assert.ok(pair);
  assert.equal(pair.first.name, recommendations[0].name);
  assert.notEqual(pair.second.name, pair.first.name);
  assert.ok(Number.isFinite(pair.second.score));
  assert.equal(typeof pair.secondDiffersFromList, 'boolean');
});

test('a Pick Two pair may take the second copy of the best card', () => {
  const fili = cards.find((card) => card.name === 'Fíli the Pathfinder');
  const twoCopies = [fili, { ...fili }, cards.find((card) => card.name === 'Gollum, Riddle Master')];
  const seventeenLands = parseSeventeenLandsCsv(read('sample-17lands-hob.csv'));
  const untapped = parseUntappedCsv(read('sample-untapped-hob.csv'));
  const args = { seventeenLands, untapped, pool: [], packNumber: 1, pickNumber: 1 };
  const recommendations = scoreDraftPack({ cards: twoCopies, ...args });

  const pair = recommendPickTwoPair({ recommendations, cards: twoCopies, ...args });
  assert.ok(pair);
  assert.equal(pair.first.name, 'Fíli the Pathfinder');
  // Only one physical copy leaves the pack; the second selection is scored over the rest.
  assert.ok(['Fíli the Pathfinder', 'Gollum, Riddle Master'].includes(pair.second.name));
});

test('falls back to GP win rate when 17Lands blanks low-sample GIH cells', () => {
  const csv = [
    '"Name","Color","Rarity","# GP","% GP","GP WR","# GIH","GIH WR","# GNS","GNS WR","IIH"',
    '"Covered Common","W","C","1000","70%","61.5%","400","","600","58.0%",""',
    '"Popular Card","U","C","900","65%","64.0%","800","65.2%","700","57.0%","8.2"'
  ].join('\n');
  const cards = parseSeventeenLandsCsv(csv);
  const fallback = cards.find((card) => card.name === 'Covered Common');
  assert.equal(fallback.gihWinRate, 61.5);
  assert.equal(fallback.winRateBasis, 'GP');
  assert.equal(fallback.gamesInHand, 1000);
  assert.equal(fallback.improvementInHand, null);
  const direct = cards.find((card) => card.name === 'Popular Card');
  assert.equal(direct.winRateBasis, 'GIH');
  assert.equal(direct.gihWinRate, 65.2);
  assert.equal(direct.gamesInHand, 800);
  assert.equal(direct.improvementInHand, 8.2);
});
