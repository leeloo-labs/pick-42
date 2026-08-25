'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createArchetypeDeck,
  evaluateArchetypeSignal,
  normalizeFormat,
  parseArenaDeckText,
  parseArchetypeCorpus,
  summarizeArchetypeCorpus,
  trophyThreshold
} = require('../src/draft/archetype-corpus.cjs');
const { philosophyForStrategy, scoreDraftPack } = require('../src/draft/blend-engine.cjs');

function exemplarCorpus() {
  const decks = [];
  for (let index = 0; index < 6; index += 1) {
    decks.push({
      id: `boros-${index}`,
      setCode: 'HOB',
      format: 'premier',
      eventDate: `2026-08-${String(10 + index).padStart(2, '0')}`,
      wins: 7,
      losses: index % 3,
      trophy: true,
      archetype: 'Boros Dwarves',
      colors: ['W', 'R'],
      cards: [
        { name: 'Dori, Bearer of Friends', key: 'dori bearer of friends', quantity: index % 2 ? 1 : 2 },
        { name: 'Dwarven Mattock', key: 'dwarven mattock', quantity: 1 },
        ...(index < 4 ? [{ name: 'Dwarven Mauler', key: 'dwarven mauler', quantity: 1 }] : []),
        { name: 'Stone by Sunlight', key: 'stone by sunlight', quantity: 1 },
        ...(index < 2 ? [{ name: 'Iron Hills Stalwart', key: 'iron hills stalwart', quantity: 1 }] : []),
        ...(index < 2 ? [{ name: 'Patient Instructor', key: 'patient instructor', quantity: 1 }] : []),
        ...(index < 3 ? [{ name: 'Pinecone Strike', key: 'pinecone strike', quantity: 1 }] : [])
      ]
    });
    decks.push({
      id: `rakdos-${index}`,
      setCode: 'HOB',
      format: 'premier',
      eventDate: `2026-08-${String(10 + index).padStart(2, '0')}`,
      wins: 7,
      losses: index % 2,
      trophy: true,
      archetype: 'Rakdos',
      colors: ['B', 'R'],
      cards: [
        { name: 'Desolation Prowler', key: 'desolation prowler', quantity: 1 },
        { name: "Bilbo's Deadly Slice", key: 'bilbo s deadly slice', quantity: 1 },
        { name: 'Fearsome Goblin Pair', key: 'fearsome goblin pair', quantity: 1 },
        { name: 'Ravening Warg', key: 'ravening warg', quantity: 1 },
        ...(index < 3 ? [{ name: 'Pinecone Strike', key: 'pinecone strike', quantity: 1 }] : [])
      ]
    });
  }
  return { version: 1, decks, summary: summarizeArchetypeCorpus({ decks }) };
}

test('parses long-form CSV and infers format-specific trophy records', () => {
  const csv = [
    'Deck ID,Set Code,Format,Record,Archetype,Colors,Card Name,Quantity,Zone',
    'a,HOB,PremierDraft,7-2,Boros Dwarves,WR,"Dori, Bearer of Friends",2,Main',
    'a,HOB,PremierDraft,7-2,Boros Dwarves,WR,Dwarven Mattock,1,Main',
    'a,HOB,PremierDraft,7-2,Boros Dwarves,WR,Sideboard Card,1,Sideboard',
    'b,HOB,PremierDraft,5-3,Rakdos,BR,Desolation Prowler,1,Main'
  ].join('\n');
  const corpus = parseArchetypeCorpus(csv, { fileName: 'corpus.csv' });

  assert.equal(corpus.decks.length, 2);
  assert.equal(corpus.summary.trophyCount, 1);
  assert.equal(corpus.decks[0].cards.length, 2);
  assert.equal(corpus.decks[0].trophy, true);
  assert.equal(corpus.decks[1].trophy, false);
  assert.deepEqual(corpus.decks[0].colors, ['W', 'R']);
});

test('normalizes event formats and their trophy thresholds', () => {
  assert.equal(normalizeFormat('Player Draft'), 'premier');
  assert.equal(normalizeFormat('QuickDraft'), 'quick');
  assert.equal(normalizeFormat('PickTwoDraft'), 'pick-two');
  assert.equal(trophyThreshold('Traditional Draft'), 3);
  assert.equal(trophyThreshold('Pick-Two Draft'), 4);
});

test('parses a copied Arena deck and ignores its sideboard', () => {
  const copied = [
    'Deck',
    '20 Dwarven Mauler (HOB) 123',
    '20 Mountain (HOB) 456',
    '',
    'Sideboard',
    '3 Desolation Prowler (HOB) 789'
  ].join('\n');
  const parsed = parseArenaDeckText(copied);
  const deck = createArchetypeDeck({
    id: 'copied-1', setCode: 'HOB', format: 'PremierDraft', record: '7-2', cards: parsed.cards
  }, {
    catalog: { 1: { name: 'Dwarven Mauler', manaCost: '{3}{R}' }, 2: { name: 'Mountain', manaCost: '', typeLine: 'Basic Land — Mountain' } }
  });

  assert.equal(parsed.total, 40);
  assert.equal(parsed.cards.length, 2);
  assert.equal(deck.trophy, true);
  assert.equal(deck.archetype, 'Red');
  assert.throws(() => parseArenaDeckText('Deck\n2 Dwarven Mauler'), /at least 40/);
});

test('round-trips a pasted trophy deck through the persisted JSON corpus', () => {
  const payload = {
    version: 1,
    source: 'Manually pasted trophy deck lists',
    decks: [{
      id: 'manual-test', setCode: 'HOB', format: 'QuickDraft', record: '7-1', archetype: 'Rakdos', colors: 'BR',
      cards: { 'Desolation Prowler': 20, Mountain: 10, Swamp: 10 }
    }]
  };
  const first = parseArchetypeCorpus(JSON.stringify(payload), { fileName: 'manual-archetype-corpus.json' });
  const restored = parseArchetypeCorpus(JSON.stringify(first), { fileName: 'manual-archetype-corpus.json' });

  assert.equal(restored.summary.trophyCount, 1);
  assert.equal(restored.decks[0].id, 'manual-test');
  assert.equal(restored.decks[0].cards.reduce((sum, card) => sum + card.quantity, 0), 40);
});

test('does not mistake an off-pair hybrid payment option for a third deck color', () => {
  const catalog = {
    1: { name: 'White Spell', manaCost: '{1}{W}', typeLine: 'Creature' },
    2: { name: 'Blue Spell', manaCost: '{1}{U}', typeLine: 'Creature' },
    3: { name: 'Mirkwood Nurturer', manaCost: '{2}(G/U)', typeLine: 'Creature' }
  };
  const deck = createArchetypeDeck({
    cards: [
      { name: 'White Spell', quantity: 8 },
      { name: 'Blue Spell', quantity: 8 },
      { name: 'Mirkwood Nurturer', quantity: 2 },
      { name: 'Plains', quantity: 9 },
      { name: 'Island', quantity: 8 }
    ]
  }, { catalog });

  assert.deepEqual(deck.colors, ['W', 'U']);
  assert.deepEqual(deck.splashColors, []);
  assert.equal(deck.archetype, 'Azorius');
  assert.equal(deck.colorEvidence.hybridOptions.G, 2);
});

test('records a small fixed-cost third color as a splash', () => {
  const catalog = {
    1: { name: 'White Spell', manaCost: '{W}', typeLine: 'Creature' },
    2: { name: 'Blue Spell', manaCost: '{U}', typeLine: 'Creature' },
    3: { name: 'Green Splash', manaCost: '{2}{G}{G}', typeLine: 'Creature' }
  };
  const deck = createArchetypeDeck({
    cards: [
      { name: 'White Spell', quantity: 10 },
      { name: 'Blue Spell', quantity: 10 },
      { name: 'Green Splash', quantity: 1 },
      { name: 'Plains', quantity: 8 },
      { name: 'Island', quantity: 8 },
      { name: 'Forest', quantity: 1 }
    ]
  }, { catalog });

  assert.deepEqual(deck.colors, ['W', 'U']);
  assert.deepEqual(deck.splashColors, ['G']);
  assert.deepEqual(deck.colorIdentity, ['W', 'U', 'G']);
  assert.equal(deck.archetype, 'Azorius');
});

test('keeps a substantially supported third color in a true three-color deck', () => {
  const catalog = {
    1: { name: 'White Spell', manaCost: '{W}', typeLine: 'Creature' },
    2: { name: 'Blue Spell', manaCost: '{U}', typeLine: 'Creature' },
    3: { name: 'Green Spell', manaCost: '{G}', typeLine: 'Creature' }
  };
  const deck = createArchetypeDeck({
    cards: [
      { name: 'White Spell', quantity: 7 },
      { name: 'Blue Spell', quantity: 7 },
      { name: 'Green Spell', quantity: 6 },
      { name: 'Plains', quantity: 5 },
      { name: 'Island', quantity: 5 },
      { name: 'Forest', quantity: 5 }
    ]
  }, { catalog });

  assert.deepEqual(deck.colors, ['W', 'U', 'G']);
  assert.deepEqual(deck.splashColors, []);
  assert.equal(deck.archetype, 'White/Blue/Green');
});

test('reclassifies generated labels while preserving custom archetype labels', () => {
  const catalog = {
    1: { name: 'White Spell', manaCost: '{W}', typeLine: 'Creature' },
    2: { name: 'Blue Spell', manaCost: '{U}', typeLine: 'Creature' },
    3: { name: 'Hybrid Spell', manaCost: '(G/U)', typeLine: 'Creature' }
  };
  const saved = {
    colors: ['W', 'U', 'G'],
    cards: [
      { name: 'White Spell', quantity: 8 },
      { name: 'Blue Spell', quantity: 8 },
      { name: 'Hybrid Spell', quantity: 4 },
      { name: 'Plains', quantity: 8 },
      { name: 'Island', quantity: 8 }
    ]
  };
  const generated = createArchetypeDeck({ ...saved, archetype: 'White/Blue/Green' }, {
    catalog, reclassifyColors: true, reclassifyArchetype: true
  });
  const custom = createArchetypeDeck({ ...saved, archetype: 'Azorius Flyers' }, {
    catalog, reclassifyColors: true, reclassifyArchetype: false
  });

  assert.deepEqual(generated.colors, ['W', 'U']);
  assert.equal(generated.archetype, 'Azorius');
  assert.deepEqual(custom.colors, ['W', 'U']);
  assert.equal(custom.archetype, 'Azorius Flyers');
});

test('finds a supported trophy archetype only with enough pool and sample evidence', () => {
  const corpus = exemplarCorpus();
  const pool = [
    { name: 'Dori, Bearer of Friends', quantity: 2 },
    { name: 'Dwarven Mattock' },
    { name: 'Stone by Sunlight' },
    { name: 'Pinecone Strike' }
  ];
  const mauler = evaluateArchetypeSignal({
    card: { name: 'Dwarven Mauler' }, pool, corpus, setCode: 'HOB', format: 'Player Draft'
  });
  const prowler = evaluateArchetypeSignal({
    card: { name: 'Desolation Prowler' }, pool, corpus, setCode: 'HOB', format: 'Player Draft'
  });
  const mismatch = evaluateArchetypeSignal({
    card: { name: 'Dwarven Mauler' }, pool, corpus, setCode: 'HOB', format: 'Quick Draft'
  });

  assert.equal(mauler.available, true);
  assert.equal(mauler.archetype, 'Boros Dwarves');
  assert.ok(mauler.score > 2);
  assert.ok(mauler.detail.includes('4/6 decks'));
  assert.ok(prowler.score < -2);
  assert.equal(mismatch.available, false);
  assert.equal(mismatch.status, 'mismatch');
});

test('trophy exemplars flip Synergy First toward Mauler without changing Balanced', () => {
  const corpus = exemplarCorpus();
  const cards = [
    { name: 'Desolation Prowler', manaCost: '{1}{B}', typeLine: 'Creature — Wolf', rulesText: 'Pay 2 life: This creature gets +2/+2 until end of turn. Activate only once each turn.', printedPower: '2', printedToughness: '2' },
    { name: 'Dwarven Mauler', manaCost: '{R}', typeLine: 'Creature — Dwarf Warrior', rulesText: 'Equip abilities you activate that target this creature cost {2} less to activate.', printedPower: '2', printedToughness: '1' }
  ];
  const pool = [
    { name: 'Dori, Bearer of Friends', manaCost: '{2}{R}', typeLine: 'Legendary Creature — Dwarf Warrior', rulesText: 'Trample\nWhen Dori enters, create a Treasure token.', printedPower: '3', printedToughness: '2' },
    { name: 'Dori, Bearer of Friends', manaCost: '{2}{R}', typeLine: 'Legendary Creature — Dwarf Warrior', rulesText: 'Trample\nWhen Dori enters, create a Treasure token.', printedPower: '3', printedToughness: '2' },
    { name: 'Dwarven Mattock', manaCost: '{2}', typeLine: 'Artifact — Equipment', rulesText: 'When this Equipment enters, attach it to target Dwarf you control.\nEquipped creature gets +2/+2 and has ward {1}.\nEquip {3}' },
    { name: 'Stone by Sunlight', manaCost: '{1}{W}', typeLine: 'Instant', rulesText: 'Destroy target creature with power 4 or greater.' },
    { name: 'Pinecone Strike', manaCost: '{1}{R}', typeLine: 'Instant', rulesText: 'Pinecone Strike deals 3 damage to target creature.' },
    { name: 'Pinecone Strike', manaCost: '{1}{R}', typeLine: 'Instant', rulesText: 'Pinecone Strike deals 3 damage to target creature.' }
  ];
  const sources = {
    seventeenLands: [
      { name: cards[0].name, gihWinRate: 61.5, gamesInHand: 34202, gamesNotSeen: 50322, gamesNotSeenWinRate: 57.3, improvementInHand: 4.2 },
      { name: cards[1].name, gihWinRate: 56.6, gamesInHand: 21030, gamesNotSeen: 30208, gamesNotSeenWinRate: 57.4, improvementInHand: -0.7 }
    ],
    untapped: [
      { name: cards[0].name, inHandWinRate: 58.7, inHandWinRateDelta: 6.2, improvementInHand: 6.2, games: 52000 },
      { name: cards[1].name, inHandWinRate: 53.9, inHandWinRateDelta: 0.9, improvementInHand: 0.9, games: 35000 }
    ]
  };
  const common = { cards, pool, ...sources, archetypeCorpus: corpus, setCode: 'HOB', format: 'Player Draft', packNumber: 1, pickNumber: 7 };
  const balanced = scoreDraftPack({ ...common, philosophy: philosophyForStrategy('balanced') });
  const synergy = scoreDraftPack({ ...common, philosophy: philosophyForStrategy('synergy') });

  assert.equal(balanced[0].name, 'Desolation Prowler');
  assert.equal(synergy[0].name, 'Dwarven Mauler');
  assert.equal(philosophyForStrategy('synergy').powerPriority, 60);
  assert.equal(balanced.find((card) => card.name === 'Dwarven Mauler').adjustments.archetype, 0);
  assert.ok(synergy.find((card) => card.name === 'Dwarven Mauler').adjustments.archetype > 2);
  assert.ok(synergy[0].reasons.some((reason) => reason.includes('Boros Dwarves lane and trophy pattern support')));
});

test('Synergy First keeps an established Boros lane over a high-IIH blue card', () => {
  const corpus = exemplarCorpus();
  const cards = [
    { name: 'Long Lake Nuisance', manaCost: '{3}{U}', typeLine: 'Creature — Bird', rulesText: 'Flying\nWhen this creature enters, recruit.', printedPower: '3', printedToughness: '1' },
    { name: 'Old Thrush', manaCost: '{2}', typeLine: 'Creature — Bird', printedPower: '1', printedToughness: '1' },
    { name: 'Iron Hills Stalwart', manaCost: '{4}{R}', typeLine: 'Creature — Dwarf Warrior', rulesText: 'Reach\nTrample\nWhen this creature enters, attach target Equipment you control to up to one target creature you control.', printedPower: '4', printedToughness: '5' }
  ];
  const dori = { name: 'Dori, Bearer of Friends', manaCost: '{2}{R}', typeLine: 'Legendary Creature — Dwarf Warrior', rulesText: 'Trample\nWhen Dori enters, create a Treasure token.', printedPower: '3', printedToughness: '2' };
  const pinecone = { name: 'Pinecone Strike', manaCost: '{1}{R}', typeLine: 'Instant', rulesText: 'Pinecone Strike deals 3 damage to target creature.' };
  const pool = [
    { name: 'Stone by Sunlight', manaCost: '{1}{W}', typeLine: 'Instant', rulesText: 'Destroy target creature with power 4 or greater.' },
    pinecone,
    dori,
    pinecone,
    dori,
    { name: 'Dwarven Mattock', manaCost: '{2}', typeLine: 'Artifact — Equipment', rulesText: 'When this Equipment enters, attach it to target Dwarf you control.' },
    { name: 'Dwarven Mauler', manaCost: '{R}', typeLine: 'Creature — Dwarf Warrior', rulesText: 'Equip abilities you activate that target this creature cost {2} less to activate.', printedPower: '2', printedToughness: '1' }
  ];
  const sources = {
    seventeenLands: [
      { name: cards[0].name, gihWinRate: 57.7, gamesInHand: 61274, gamesNotSeen: 61524, gamesNotSeenWinRate: 52.9, improvementInHand: 4.8 },
      { name: cards[1].name, gihWinRate: 52.2, gamesInHand: 10660, gamesNotSeen: 13914, gamesNotSeenWinRate: 51.2, improvementInHand: 1 },
      { name: cards[2].name, gihWinRate: 51.3, gamesInHand: 11415, gamesNotSeen: 16710, gamesNotSeenWinRate: 54.5, improvementInHand: -3.3 }
    ],
    untapped: [
      { name: cards[0].name, inHandWinRate: 54.6, inHandWinRateDelta: 7.7, improvementInHand: 7.7, games: 50000 },
      { name: cards[1].name, inHandWinRate: 50.3, inHandWinRateDelta: 1.7, improvementInHand: 1.7, games: 16000 },
      { name: cards[2].name, inHandWinRate: 47.4, inHandWinRateDelta: -3.9, improvementInHand: -3.9, games: 20000 }
    ]
  };
  const common = { cards, pool, ...sources, archetypeCorpus: corpus, setCode: 'HOB', format: 'Player Draft', packNumber: 1, pickNumber: 8 };
  const balanced = scoreDraftPack({ ...common, philosophy: philosophyForStrategy('balanced') });
  const synergy = scoreDraftPack({ ...common, philosophy: philosophyForStrategy('synergy') });
  const stalwart = synergy.find((card) => card.name === 'Iron Hills Stalwart');
  const nuisance = synergy.find((card) => card.name === 'Long Lake Nuisance');

  assert.equal(balanced[0].name, 'Long Lake Nuisance');
  assert.equal(synergy[0].name, 'Iron Hills Stalwart');
  assert.ok(stalwart.adjustments.supportedLane > 0);
  assert.ok(nuisance.adjustments.supportedLane < 0);
  assert.ok(stalwart.reasons.some((reason) => reason.includes('supports 1 Dwarf payoff')));
  assert.ok(nuisance.reasons.some((reason) => reason.includes('outside the supported Boros Dwarves lane')));
});

test('Patient Instructor outranks unsupported Azorius fixing in this Boros lane', () => {
  const corpus = exemplarCorpus();
  const cards = [
    { name: 'Patient Instructor', manaCost: '{2}(W/U)', typeLine: 'Creature — Human Citizen', rulesText: 'Vigilance\nWhen this creature enters, recruit.', printedPower: '2', printedToughness: '2' },
    { name: 'Lake-town', manaCost: '', typeLine: 'Land', rulesText: 'This land enters tapped.\n{T}: Add {W} or {U}.\n{2}{W}{U}, {T}, Sacrifice this land: Put two +1/+1 counters on target Human you control.' }
  ];
  const dori = { name: 'Dori, Bearer of Friends', manaCost: '{2}{R}', typeLine: 'Legendary Creature — Dwarf Warrior', rulesText: 'Trample\nWhen Dori enters, create a Treasure token.', printedPower: '3', printedToughness: '2' };
  const pinecone = { name: 'Pinecone Strike', manaCost: '{1}{R}', typeLine: 'Instant', rulesText: 'Pinecone Strike deals 3 damage to target creature.' };
  const pool = [
    { name: 'Misty Mountains Raider', manaCost: '{4}{R}', typeLine: 'Creature — Goblin Soldier', rulesText: 'Whenever you attack, amass Goblins 2.', printedPower: '4', printedToughness: '4' },
    { name: 'Stone by Sunlight', manaCost: '{1}{W}', typeLine: 'Instant', rulesText: 'Destroy target creature with power 4 or greater.' },
    pinecone,
    dori,
    pinecone,
    dori,
    { name: 'Dwarven Mattock', manaCost: '{2}', typeLine: 'Artifact — Equipment', rulesText: 'When this Equipment enters, attach it to target Dwarf you control.' },
    { name: 'Dwarven Mauler', manaCost: '{R}', typeLine: 'Creature — Dwarf Warrior', rulesText: 'Equip abilities you activate that target this creature cost {2} less to activate.' },
    { name: 'Iron Hills Stalwart', manaCost: '{4}{R}', typeLine: 'Creature — Dwarf Warrior', rulesText: 'Reach\nTrample\nWhen this creature enters, attach target Equipment you control to up to one target creature you control.' }
  ];
  const sources = {
    seventeenLands: [
      { name: cards[0].name, gihWinRate: 58.2, gamesInHand: 68914, gamesNotSeen: 72705, gamesNotSeenWinRate: 53.9, improvementInHand: 4.2 },
      { name: cards[1].name, gihWinRate: 55.5, gamesInHand: 35422, gamesNotSeen: 36880, gamesNotSeenWinRate: 54.3, improvementInHand: 1.2 }
    ],
    untapped: [
      { name: cards[0].name, inHandWinRate: 54.7, inHandWinRateDelta: 5.6, improvementInHand: 5.6, games: 57000 },
      { name: cards[1].name, inHandWinRate: 51.8, inHandWinRateDelta: 1.2, improvementInHand: 1.2, games: 41000 }
    ]
  };
  const common = {
    cards,
    pool,
    ...sources,
    archetypeCorpus: corpus,
    setCode: 'HOB',
    format: 'Player Draft',
    packNumber: 1,
    pickNumber: 10,
    lane: {
      status: 'locked',
      mode: 'lock-no-splash',
      splashPolicy: 'none',
      colors: ['W', 'R'],
      label: 'Boros Dwarves',
      confidence: 100
    }
  };

  for (const strategy of ['balanced', 'synergy', 'power', 'aggro', 'control']) {
    const ranked = scoreDraftPack({ ...common, philosophy: philosophyForStrategy(strategy) });
    assert.equal(ranked[0].name, 'Patient Instructor', `${strategy} should prefer the playable hybrid creature`);
    const lakeTown = ranked.find((card) => card.name === 'Lake-town');
    assert.equal(lakeTown.colorContext.classification, 'partial-land');
    assert.equal(lakeTown.draftLane.tier, 1);
    assert.equal(lakeTown.adjustments.fixing, 0);
  }
  const synergy = scoreDraftPack({ ...common, philosophy: philosophyForStrategy('synergy') });
  const instructor = synergy.find((card) => card.name === 'Patient Instructor');
  const lakeTown = synergy.find((card) => card.name === 'Lake-town');
  assert.ok(instructor.adjustments.supportedLane > 0);
  assert.equal(instructor.reasons.filter((reason) => reason.includes('Boros Dwarves')).length, 1);
  assert.ok(lakeTown.adjustments.archetype < 0);
  assert.equal(lakeTown.adjustments.supportedLane, 0);
  assert.equal(lakeTown.adjustments.archetypeRecommendation, lakeTown.adjustments.archetype + lakeTown.adjustments.supportedLane);
  assert.equal(lakeTown.reasons.filter((reason) => reason.includes('Boros Dwarves')).length, 1);
});

test('a third Dori falls behind the first Thorin in a committed Dwarf deck', () => {
  const corpus = exemplarCorpus();
  for (const deck of corpus.decks.filter((entry) => entry.archetype === 'Boros Dwarves')) {
    deck.cards.push({ name: 'Thorin Oakenshield', key: 'thorin oakenshield', quantity: 1 });
  }
  const dori = {
    name: 'Dori, Bearer of Friends', manaCost: '{2}{R}', typeLine: 'Legendary Creature — Dwarf Warrior',
    rulesText: 'Trample\nWhen Dori enters, create a Treasure token.', printedPower: '3', printedToughness: '2'
  };
  const thorin = {
    name: 'Thorin Oakenshield', manaCost: '{R}{W}', typeLine: 'Legendary Creature — Dwarf Noble',
    rulesText: 'Trample\nStoried\nAs long as you have an enduring story, artifacts and creatures you control have ward {1}.',
    printedPower: '3', printedToughness: '2'
  };
  const pool = [
    dori,
    dori,
    { name: 'Dwarven Mattock', manaCost: '{2}', typeLine: 'Artifact — Equipment', rulesText: 'When this Equipment enters, attach it to target Dwarf you control.' },
    { name: 'Dwarven Mauler', manaCost: '{R}', typeLine: 'Creature — Dwarf Warrior' },
    { name: 'Stone by Sunlight', manaCost: '{1}{W}', typeLine: 'Instant' },
    { name: 'Pinecone Strike', manaCost: '{1}{R}', typeLine: 'Instant' },
    { name: 'Pinecone Strike', manaCost: '{1}{R}', typeLine: 'Instant' }
  ];
  const sources = {
    seventeenLands: [
      { name: dori.name, gihWinRate: 56.9, gamesInHand: 40000 },
      { name: thorin.name, gihWinRate: 55.7, gamesInHand: 40000 }
    ],
    untapped: [
      { name: dori.name, inHandWinRate: 54, games: 40000 },
      { name: thorin.name, inHandWinRate: 52.9, games: 40000 }
    ]
  };
  const common = {
    cards: [dori, thorin],
    pool,
    ...sources,
    archetypeCorpus: corpus,
    setCode: 'HOB',
    format: 'Player Draft',
    packNumber: 2,
    pickNumber: 3,
    lane: { status: 'locked', mode: 'lock-no-splash', label: 'Boros Dwarves', colors: ['W', 'R'], confidence: 100 }
  };

  for (const strategy of ['balanced', 'synergy', 'power', 'aggro', 'control']) {
    const ranked = scoreDraftPack({ ...common, philosophy: philosophyForStrategy(strategy) });
    const duplicate = ranked.find((card) => card.name === dori.name);
    assert.equal(ranked[0].name, thorin.name, `${strategy} should take the first Thorin over a third Dori`);
    assert.equal(duplicate.adjustments.duplicate, -15);
    assert.equal(duplicate.duplicate.candidateCopy, 3);
    assert.ok(duplicate.reasons.some((reason) => reason.includes('third legendary copy')));
  }
});

test('Iron Hills Blacksmith beats a second Instructor when its Dwarf and Equipment package is live', () => {
  const corpus = exemplarCorpus();
  const borosDecks = corpus.decks.filter((entry) => entry.archetype === 'Boros Dwarves');
  for (const [index, deck] of borosDecks.entries()) {
    if (index < 3) deck.cards.push({ name: 'Iron Hills Blacksmith', key: 'iron hills blacksmith', quantity: 1 });
  }
  const blacksmith = {
    name: 'Iron Hills Blacksmith', manaCost: '{1}{W}', typeLine: 'Creature — Dwarf Artificer',
    rulesText: 'Double strike\nWhen this creature enters, create a colorless Equipment artifact token named Axe with “Equipped creature gets +1/+0” and equip {1}.',
    printedPower: '1', printedToughness: '1'
  };
  const instructor = {
    name: 'Patient Instructor', manaCost: '{2}(W/U)', typeLine: 'Creature — Human Citizen',
    rulesText: 'Vigilance\nWhen this creature enters, recruit.', printedPower: '2', printedToughness: '2'
  };
  const pool = [
    { name: 'Misty Mountains Raider', manaCost: '{4}{R}', typeLine: 'Creature — Goblin Soldier' },
    { name: 'Misty Mountains Raider', manaCost: '{4}{R}', typeLine: 'Creature — Goblin Soldier' },
    { name: 'Stone by Sunlight', manaCost: '{1}{W}', typeLine: 'Instant' },
    { name: 'Pinecone Strike', manaCost: '{1}{R}', typeLine: 'Instant' },
    { name: 'Pinecone Strike', manaCost: '{1}{R}', typeLine: 'Instant' },
    instructor,
    { name: 'Dori, Bearer of Friends', manaCost: '{2}{R}', typeLine: 'Legendary Creature — Dwarf Warrior' },
    { name: 'Dori, Bearer of Friends', manaCost: '{2}{R}', typeLine: 'Legendary Creature — Dwarf Warrior' },
    { name: 'Lake-town Toymaker', manaCost: '{3}{W}', typeLine: 'Creature — Human Artificer' },
    { name: 'Old Thrush', manaCost: '{2}', typeLine: 'Creature — Bird' },
    { name: 'Lakeshore Apothecary', manaCost: '{1}{U}', typeLine: 'Creature — Elf Druid' },
    { name: 'Mirkwood Nurturer', manaCost: '{2}(G/U)', typeLine: 'Creature — Elf Ranger' },
    { name: 'Thorin Oakenshield', manaCost: '{R}{W}', typeLine: 'Legendary Creature — Dwarf Noble' },
    { name: 'Dwarven Mattock', manaCost: '{2}', typeLine: 'Artifact — Equipment', rulesText: 'When this Equipment enters, attach it to target Dwarf you control.' },
    { name: 'Goblin Plate Mail', manaCost: '{1}{R}', typeLine: 'Artifact — Equipment' },
    { name: 'Dwarven Mauler', manaCost: '{R}', typeLine: 'Creature — Dwarf Warrior', rulesText: 'Equip abilities you activate that target this creature cost {2} less to activate.' },
    { name: 'Iron Hills Stalwart', manaCost: '{4}{R}', typeLine: 'Creature — Dwarf Warrior', rulesText: 'When this creature enters, attach target Equipment you control to up to one target creature you control.' },
    { name: 'The Misty Mountains Cold', manaCost: '{2}{R}', typeLine: 'Enchantment — Saga' }
  ];
  const sources = {
    seventeenLands: [
      { name: blacksmith.name, gihWinRate: 57.5, improvementInHand: 2.1, gamesInHand: 25295, alsa: 3.35, rarity: 'U' },
      { name: instructor.name, gihWinRate: 58.2, improvementInHand: 4.2, gamesInHand: 68914, alsa: 5.75, rarity: 'C' }
    ],
    untapped: [
      { name: blacksmith.name, inHandWinRate: 53.5, inHandWinRateDelta: 2.4, improvementInHand: 2.4, avgLastOffered: 3.5, games: 36000 },
      { name: instructor.name, inHandWinRate: 54.7, inHandWinRateDelta: 5.6, improvementInHand: 5.6, avgLastOffered: 6, games: 57000 }
    ]
  };
  const common = {
    cards: [blacksmith, instructor],
    pool,
    ...sources,
    archetypeCorpus: corpus,
    setCode: 'HOB',
    format: 'Player Draft',
    packNumber: 2,
    pickNumber: 5,
    lane: { status: 'locked', mode: 'lock-splash', label: 'Boros Dwarves', colors: ['W', 'R'], confidence: 100 }
  };

  for (const strategy of ['balanced', 'synergy', 'power', 'aggro', 'control']) {
    const ranked = scoreDraftPack({ ...common, philosophy: philosophyForStrategy(strategy, { sourceBalance: 50 }) });
    const smith = ranked.find((card) => card.name === blacksmith.name);
    const secondInstructor = ranked.find((card) => card.name === instructor.name);
    assert.equal(ranked[0].name, blacksmith.name, `${strategy} should prefer the live Blacksmith package`);
    assert.ok(smith.adjustments.synergy > secondInstructor.adjustments.synergy);
    assert.ok(secondInstructor.adjustments.duplicate <= -0.7);
    assert.ok(smith.reasons.some((reason) => reason.includes('Equipment payoff')));
    assert.ok(smith.reasons.some((reason) => reason.includes('double-strike Equipment package')));
  }
});
