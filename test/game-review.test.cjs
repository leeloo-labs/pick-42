'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ArenaLogParser } = require('../src/core/arena-log-parser.cjs');
const {
  GameReviewTracker,
  analyzePostGameReview,
  buildDeviationAnalysis,
  castableByManaBase,
  castingProblem,
  dominanceAnalysis,
  draftDeckMatchDecision,
  eventWrapUpVerdict,
  gameShapeAnalysis,
  isEarlyConcession,
  replaceRebuiltReviewInPlace,
  reviewDeckIdentity,
  reviewEventGroups,
  sourceCounts,
  turningPointAnalysis
} = require('../src/draft/game-review.cjs');

const projectRoot = path.resolve(__dirname, '..');

function card(instanceId, name, manaCost, typeLine, ownerSeatId = 1) {
  return { instanceId, grpId: instanceId + 1000, name, manaCost, typeLine, ownerSeatId, controllerSeatId: ownerSeatId };
}

function state({ turn, hand, lands, complete = false, won = null }) {
  return {
    connected: true,
    complete,
    result: complete ? { winnerSeatId: won ? 1 : 2, won, reason: 'Concede' } : null,
    matchId: 'review-match',
    gameNumber: 1,
    stage: 'GameStage_Play',
    localSeatId: 1,
    turn: { number: turn, phase: 'First main', step: '', activeSeatId: 1, prioritySeatId: 1, decisionSeatId: 1 },
    players: [{ seatId: 1, label: 'You', life: 20, mulligans: 0 }],
    hand,
    graveyard: [],
    exile: [],
    stack: [],
    battlefield: lands,
    knownOpponentCards: [card(901, 'Opponent Red Spell', '{1}{R}', 'Instant', 2)]
  };
}

const burn = card(11, 'Double Red Removal', '{1}{R}', 'Instant');
const swampOne = card(21, 'Swamp', '', 'Basic Land — Swamp');
const swampTwo = card(22, 'Swamp', '', 'Basic Land — Swamp');
const swampThree = card(23, 'Swamp', '', 'Basic Land — Swamp');

test('counts visible mana sources and explains casting problems', () => {
  const sources = sourceCounts([swampOne, swampTwo]);
  assert.equal(sources.B, 2);
  assert.deepEqual(castingProblem(burn, [swampOne, swampTwo], sources), {
    kind: 'color',
    missingColors: ['R'],
    manaValue: 2
  });
});

test('keeps the selected Rakdos identity when the exact deck contains a green hybrid symbol', () => {
  const identity = reviewDeckIdentity({
    selectedBuild: { id: 'rakdos', name: 'Rakdos' },
    selectedBuildId: 'rakdos',
    mainDeck: [{ name: 'Hybrid Playable', manaCost: '{1}{B/G}' }]
  });
  assert.deepEqual(identity, { buildId: 'rakdos', name: 'Rakdos' });
});

test('only accepts a game whose deck size and opening hand match the registered draft deck', () => {
  const deck = {
    name: 'Boros Dwarves',
    total: 40,
    cards: [
      { name: 'Dwarven Mauler', grpId: 103471, quantity: 1 },
      { name: 'Stone by Sunlight', grpId: 103395, quantity: 2 }
    ],
    lands: [
      { name: 'Plains', grpId: 89204, quantity: 8 },
      { name: 'Mountain', grpId: 84597, quantity: 9 }
    ]
  };
  const base = {
    matchId: 'limited-match',
    gameNumber: 1,
    localSeatId: 1,
    battlefield: [],
    stack: [],
    zones: [{ seatId: 1, hand: 7, library: 33, graveyard: 0, exile: 0 }]
  };

  assert.equal(draftDeckMatchDecision({
    ...base,
    hand: [103471, 103395, 89204, 89204, 84597, 84597, 84597].map((grpId) => ({ grpId }))
  }, deck).status, 'accepted');

  const constructed = draftDeckMatchDecision({
    ...base,
    zones: [{ seatId: 1, hand: 7, library: 53, graveyard: 0, exile: 0 }],
    hand: [{ grpId: 103471 }]
  }, deck);
  assert.equal(constructed.status, 'rejected');
  assert.match(constructed.reason, /60-card game deck/);

  const wrongCards = draftDeckMatchDecision({ ...base, hand: [{ grpId: 999999 }] }, deck);
  assert.equal(wrongCards.status, 'rejected');
  assert.match(wrongCards.reason, /opening hand/i);
});

test('rejects an off-color replacement even when its raw score is higher', () => {
  assert.equal(castableByManaBase({ name: 'Elven Raft-Steerer', manaCost: '{2}{U}', typeLine: 'Creature' }, { B: 10, R: 7 }), false);
  assert.equal(castableByManaBase({ name: 'Smaug\'s Fury', manaCost: '{1}{R}', typeLine: 'Instant' }, { B: 10, R: 7 }), true);

  const tracker = new GameReviewTracker();
  const finisher = card(31, 'Expensive Finisher', '{4}{B}', 'Creature');
  tracker.arm({ deck: {
    name: 'Rakdos',
    cards: [{ ...finisher, quantity: 1 }],
    lands: [],
    cuts: [
      { name: 'Elven Raft-Steerer', manaCost: '{2}{U}', typeLine: 'Creature', deckValue: 99 },
      { name: 'Smaug\'s Fury', manaCost: '{1}{R}', typeLine: 'Instant', deckValue: 38 }
    ],
    total: 40,
    mana: { sources: { B: 10, R: 7 }, targets: { B: 9, R: 7 } }
  } });
  tracker.consume(state({ turn: 1, hand: [finisher], lands: [swampOne] }));
  tracker.consume(state({ turn: 3, hand: [finisher], lands: [swampOne, swampTwo] }));
  tracker.consume(state({ turn: 5, hand: [finisher], lands: [swampOne, swampTwo, swampThree], complete: true, won: false }));

  const suggestion = tracker.snapshot().latest.suggestion;
  assert.equal(suggestion.kind, 'card-swap');
  assert.equal(suggestion.title, "Test Smaug's Fury over Expensive Finisher");
  assert.match(suggestion.detail, /registered B\/R mana base/);
});

test('excludes conditional cost reductions from printed-mana curve evidence', () => {
  const tracker = new GameReviewTracker();
  const batCloud = {
    ...card(41, 'Dreaded Bat-Cloud', '{4}{B}', 'Creature — Bat'),
    rulesText: 'This spell costs {3} less to cast if a creature died this turn.'
  };
  tracker.arm({ deck: {
    name: 'Rakdos',
    cards: [{ ...batCloud, quantity: 1 }],
    lands: [],
    cuts: [{ name: 'Valid Two Drop', manaCost: '{1}{B}', typeLine: 'Creature', deckValue: 40 }],
    total: 40,
    mana: { sources: { B: 10, R: 7 }, targets: { B: 9, R: 7 } }
  } });
  tracker.consume(state({ turn: 1, hand: [batCloud], lands: [swampOne] }));
  tracker.consume(state({ turn: 3, hand: [batCloud], lands: [swampOne, swampTwo] }));
  tracker.consume(state({ turn: 5, hand: [batCloud], lands: [swampOne, swampTwo, swampThree], complete: true, won: false }));

  const review = tracker.snapshot().latest;
  assert.equal(review.stranded.some((entry) => entry.name === 'Dreaded Bat-Cloud'), false);
  assert.equal(review.suggestion.kind, 'hold');
  assert.ok(review.observations.some((fact) => /conditional cost reduction/i.test(fact)));
});

test('counts multiple copies stranded on one turn as one distinct turn', () => {
  const tracker = new GameReviewTracker();
  const first = card(51, 'Double-Black Spell', '{1}{B}{B}', 'Instant');
  const second = card(52, 'Double-Black Spell', '{1}{B}{B}', 'Instant');
  tracker.arm({ deck: { name: 'Rakdos', cards: [], lands: [], cuts: [], total: 40, mana: { sources: { B: 10, R: 7 }, targets: {} } } });
  tracker.consume(state({ turn: 1, hand: [first, second], lands: [swampOne] }));
  tracker.consume(state({ turn: 3, hand: [first, second], lands: [swampOne, swampTwo], complete: true, won: false }));
  assert.equal(tracker.snapshot().latest.stranded[0].turns, 2);
});

test('turn evidence produces one low-confidence land test after a completed game', () => {
  const tracker = new GameReviewTracker();
  tracker.arm({
    draftId: 'QuickDraft_HOB_test',
    setCode: 'HOB',
    format: 'Quick Draft',
    sourceEvidence: {
      format: 'Quick Draft',
      sourceLabel: 'quick-hob.csv',
      seventeenLands: [{ name: 'Double Red Removal', improvementInHand: 2.1, gamesInHand: 5000 }]
    },
    deck: {
      source: 'Arena course deck',
      name: 'Rakdos',
      cards: [{ ...burn, quantity: 1 }],
      lands: [
        { name: 'Swamp', typeLine: 'Basic Land — Swamp', quantity: 10 },
        { name: 'Mountain', typeLine: 'Basic Land — Mountain', quantity: 7 }
      ],
      cuts: [],
      total: 40,
      mana: { sources: { B: 10, R: 7 }, targets: { B: 9, R: 7 } }
    }
  });

  tracker.consume(state({ turn: 1, hand: [burn], lands: [swampOne, swampTwo] }));
  tracker.consume(state({ turn: 3, hand: [burn], lands: [swampOne, swampTwo, swampThree] }));
  tracker.consume(state({ turn: 5, hand: [burn], lands: [swampOne, swampTwo, swampThree], complete: true, won: false }));

  const review = tracker.snapshot().latest;
  assert.equal(review.status, 'complete');
  assert.equal(review.format, 'Quick Draft');
  assert.equal(review.sourceEvidence.sourceLabel, 'quick-hob.csv');
  assert.equal(review.sourceEvidence.seventeenLands[0].improvementInHand, 2.1);
  assert.equal(review.won, false);
  assert.equal(review.yourTurnsObserved, 3);
  assert.equal(review.stranded[0].name, 'Double Red Removal');
  assert.equal(review.stranded[0].turns, 3);
  assert.equal(review.suggestion.kind, 'land-swap');
  assert.equal(review.suggestion.title, 'Test +1 Mountain / −1 Swamp');
  assert.match(review.disclaimer, /not prove/i);
});

test('a loss without repeated mana evidence recommends holding the build', () => {
  const tracker = new GameReviewTracker();
  tracker.arm({ deck: { name: 'Rakdos', cards: [], lands: [], cuts: [], total: 40, mana: { sources: {}, targets: {} } } });
  tracker.consume(state({ turn: 1, hand: [], lands: [swampOne], complete: true, won: false }));

  const review = tracker.snapshot().latest;
  assert.equal(review.won, false);
  assert.equal(review.suggestion.kind, 'hold');
  assert.match(review.suggestion.detail, /not enough reason/i);
});

test('persisted reviews hydrate without reviving an old active match', () => {
  const tracker = new GameReviewTracker();
  tracker.hydrate([{ id: 'old:1', status: 'complete', gameNumber: 1 }]);
  tracker.arm({});
  const snapshot = tracker.snapshot();
  assert.equal(snapshot.status, 'ready');
  assert.equal(snapshot.latest.id, 'old:1');
  assert.equal(snapshot.active, null);
});

test('persisted reviews are presented by game chronology rather than file order', () => {
  const tracker = new GameReviewTracker();
  tracker.hydrate([
    { id: 'older:1', status: 'complete', startedAt: '2026-08-24T20:00:00.000Z', completedAt: '2026-08-24T20:10:00.000Z' },
    { id: 'newer:1', status: 'complete', startedAt: '2026-08-24T22:00:00.000Z', completedAt: '2026-08-24T22:10:00.000Z' }
  ]);
  assert.equal(tracker.snapshot().latest.id, 'newer:1');
});

test('history retention never keeps a misleading partial draft event', () => {
  const tracker = new GameReviewTracker({ maxReviews: 4 });
  const reviews = [];
  for (let game = 1; game <= 3; game += 1) {
    reviews.push({
      id: `old:${game}`,
      draftId: 'old-draft',
      status: 'complete',
      analysisVersion: 4,
      completedAt: `2026-08-23T20:0${game}:00.000Z`
    });
    reviews.push({
      id: `new:${game}`,
      draftId: 'new-draft',
      status: 'complete',
      analysisVersion: 4,
      completedAt: `2026-08-24T20:0${game}:00.000Z`
    });
  }
  tracker.hydrate(reviews);
  assert.deepEqual(tracker.snapshot().reviews.map((review) => review.id), ['new:3', 'new:2', 'new:1']);
});

test('legacy review rebuilds preserve chronology and replace the review in place', () => {
  const reviews = [
    { id: 'newer:1', startedAt: '2026-08-24T23:00:00.000Z', completedAt: '2026-08-24T23:10:00.000Z' },
    { id: 'legacy:1', startedAt: '2026-08-24T21:00:00.000Z', completedAt: '2026-08-24T21:10:00.000Z', captureVersion: 3 },
    { id: 'older:1', startedAt: '2026-08-24T20:00:00.000Z', completedAt: '2026-08-24T20:10:00.000Z' }
  ];
  const rebuilt = {
    id: 'legacy:1',
    startedAt: '2026-08-24T23:30:00.000Z',
    completedAt: '2026-08-24T23:30:00.100Z',
    captureVersion: 4,
    gameTrajectory: [{ gameTurn: 1 }]
  };

  const next = replaceRebuiltReviewInPlace(reviews, reviews[1], rebuilt);
  assert.deepEqual(next.map((review) => review.id), ['newer:1', 'legacy:1', 'older:1']);
  assert.equal(next[1].startedAt, reviews[1].startedAt);
  assert.equal(next[1].completedAt, reviews[1].completedAt);
  assert.equal(next[1].captureVersion, 4);
  assert.equal(next[1].gameTrajectory.length, 1);
});

test('drops a persisted review when the observed cards clearly came from another deck', () => {
  const tracker = new GameReviewTracker();
  tracker.hydrate([
    {
      id: 'wrong-deck:1',
      status: 'complete',
      deck: {
        cards: [{ name: 'Dwarven Mauler' }],
        lands: [{ name: 'Mountain' }]
      },
      drawnCards: [
        { name: 'Vampire Nighthawk', quantity: 1 },
        { name: 'Forest', quantity: 3 },
        { name: 'Overgrown Tomb', quantity: 1 }
      ]
    },
    {
      id: 'draft-deck:1',
      status: 'complete',
      deck: {
        cards: [{ name: 'Dwarven Mauler' }],
        lands: [{ name: 'Mountain' }]
      },
      drawnCards: [
        { name: 'Dwarven Mauler', quantity: 1 },
        { name: 'Mountain', quantity: 3 }
      ]
    }
  ]);

  assert.deepEqual(tracker.snapshot().reviews.map((review) => review.id), ['draft-deck:1']);
});

test('migrates the old Bat-Cloud and off-color recommendation out of saved reviews', () => {
  const tracker = new GameReviewTracker();
  tracker.hydrate([{
    id: 'old-bat-review:1',
    status: 'complete',
    gameNumber: 1,
    deck: {
      name: 'Rakdos',
      cards: [{
        name: 'Dreaded Bat-Cloud',
        manaCost: '{4}{B}',
        typeLine: 'Creature — Bat',
        rulesText: 'This spell costs {3} less to cast if a creature died this turn.'
      }],
      cuts: [{ name: 'Elven Raft-Steerer', manaCost: '{2}{U}', typeLine: 'Creature', deckValue: 99 }],
      mana: { sources: { B: 10, R: 7 }, targets: { B: 9, R: 7 } }
    },
    stranded: [{ name: 'Dreaded Bat-Cloud', kind: 'curve', turns: 4, manaValue: 5, missingColors: [] }],
    observations: ['Dreaded Bat-Cloud was stranded across 4 of your turns.'],
    suggestion: { kind: 'card-swap', title: 'Test Elven Raft-Steerer over Dreaded Bat-Cloud' }
  }]);

  const review = tracker.snapshot().latest;
  assert.equal(review.analysisVersion, 4);
  assert.deepEqual(review.stranded, []);
  assert.equal(review.suggestion.kind, 'hold');
  assert.ok(review.observations.some((fact) => /conditional cost reduction/i.test(fact)));
});

test('summarizes opponent mana variance, IIH draw quality, and observable card contribution', () => {
  const review = {
    captureVersion: 2,
    deck: {
      total: 40,
      lands: [{ name: 'Mountain', typeLine: 'Basic Land — Mountain', quantity: 17 }],
      cards: [
        { name: 'High Impact Dwarf', typeLine: 'Creature — Dwarf', quantity: 1 },
        { name: 'Draw Liability', typeLine: 'Creature — Dwarf', quantity: 1 }
      ]
    },
    drawnCards: [
      { name: 'Mountain', typeLine: 'Basic Land — Mountain', quantity: 4 },
      { name: 'High Impact Dwarf', typeLine: 'Creature — Dwarf', quantity: 1 },
      { name: 'Draw Liability', typeLine: 'Creature — Dwarf', quantity: 1 }
    ],
    cardsPlayed: [{ name: 'High Impact Dwarf', damage: 7, playerDamage: 5, turnsInPlay: 3 }],
    stranded: [{ name: 'Draw Liability', turns: 3, kind: 'curve' }],
    playerMana: {
      you: { timeline: [
        { playerTurn: 1, lands: 1 },
        { playerTurn: 2, lands: 2 },
        { playerTurn: 3, lands: 3 },
        { playerTurn: 4, lands: 4 }
      ] },
      opponent: { timeline: [
        { playerTurn: 1, lands: 1, visibleNonlands: 0 },
        { playerTurn: 2, lands: 2, visibleNonlands: 1 },
        { playerTurn: 3, lands: 2, visibleNonlands: 2 },
        { playerTurn: 4, lands: 2, visibleNonlands: 3 }
      ] }
    }
  };
  const analyzed = analyzePostGameReview(review, { seventeenLands: [
    { name: 'High Impact Dwarf', improvementInHand: 5.2, gamesInHand: 20000 },
    { name: 'Draw Liability', improvementInHand: -4.1, gamesInHand: 18000 }
  ] });

  assert.equal(analyzed.postGame.variance.level, 'HIGH');
  assert.equal(analyzed.postGame.variance.opponent.kind, 'starved');
  assert.match(analyzed.postGame.drawQuality.summary, /2 of the 2/);
  assert.deepEqual(analyzed.postGame.drawQuality.cards.map((card) => card.category), ['TOP-4 · DRAWN', 'TOP-4 · DRAWN']);
  assert.equal(analyzed.postGame.contributions.mvp[0].name, 'High Impact Dwarf');
  assert.equal(analyzed.postGame.contributions.lvp[0].name, 'Draw Liability');
});

function drawLuckReview({ copies, drawnFiller, captureVersion = 2 }) {
  const filler = Array.from({ length: 20 }, (_, index) => ({ name: `Filler ${index + 1}`, typeLine: 'Creature', quantity: 1 }));
  return {
    captureVersion,
    deck: {
      total: 40,
      lands: [
        { name: 'Mountain', typeLine: 'Basic Land — Mountain', quantity: 9 },
        { name: 'Swamp', typeLine: 'Basic Land — Swamp', quantity: 8 }
      ],
      cards: [
        { name: 'Burn, Burn.', typeLine: 'Instant', quantity: copies },
        { name: 'Top Two', typeLine: 'Creature', quantity: 1 },
        { name: 'Top Three', typeLine: 'Creature', quantity: 1 },
        { name: 'Top Four', typeLine: 'Creature', quantity: 1 },
        ...filler
      ]
    },
    drawnCards: [
      { name: 'Burn, Burn.', typeLine: 'Instant', quantity: 1 },
      { name: 'Top Two', typeLine: 'Creature', quantity: 1 },
      { name: 'Mountain', typeLine: 'Basic Land — Mountain', quantity: 4 },
      { name: 'Swamp', typeLine: 'Basic Land — Swamp', quantity: 2 },
      ...filler.slice(0, drawnFiller).map((card) => ({ ...card, quantity: 1 }))
    ],
    cardsPlayed: [],
    stranded: [],
    playerMana: { you: { timeline: [] }, opponent: { timeline: [] } }
  };
}

const drawLuckRows = [
  { name: 'Burn, Burn.', improvementInHand: 5, gamesInHand: 10000 },
  { name: 'Top Two', improvementInHand: 4, gamesInHand: 10000 },
  { name: 'Top Three', improvementInHand: 3, gamesInHand: 10000 },
  { name: 'Top Four', improvementInHand: 2, gamesInHand: 10000 }
];

test('drawing one of three copies is the expected baseline, not a strong draw', () => {
  const analyzed = analyzePostGameReview(drawLuckReview({ copies: 3, drawnFiller: 8 }), { seventeenLands: drawLuckRows });
  const drawQuality = analyzed.postGame.drawQuality;

  assert.equal(drawQuality.topDrawnCount, 2);
  assert.equal(drawQuality.expectedTopDrawn, 2);
  assert.equal(drawQuality.tier, 'average');
  assert.match(drawQuality.summary, /near 2\.0 of 4 for the 16 cards you saw/);
});

test('the same two top draws stay strong when every top card is a singleton seen early', () => {
  const analyzed = analyzePostGameReview(drawLuckReview({ copies: 1, drawnFiller: 0 }), { seventeenLands: drawLuckRows });
  const drawQuality = analyzed.postGame.drawQuality;

  assert.equal(drawQuality.topDrawnCount, 2);
  assert.equal(drawQuality.tier, 'strong');
  assert.ok(drawQuality.expectedTopDrawn < 1.25);
});

test('captures without drawn quantities keep the absolute draw tiers', () => {
  const analyzed = analyzePostGameReview(drawLuckReview({ copies: 3, drawnFiller: 8, captureVersion: 1 }), { seventeenLands: drawLuckRows });
  const drawQuality = analyzed.postGame.drawQuality;

  assert.equal(drawQuality.expectedTopDrawn, null);
  assert.equal(drawQuality.tier, 'strong');
});

test('IIH review hides near-neutral draws and keeps reliable material liabilities', () => {
  const review = {
    captureVersion: 2,
    deck: {
      total: 40,
      lands: [],
      cards: ['Top One', 'Top Two', 'Top Three', 'Top Four', 'Liability', 'Neutral'].map((name) => ({ name, typeLine: 'Creature' }))
    },
    drawnCards: [
      { name: 'Top One', typeLine: 'Creature', quantity: 1 },
      { name: 'Liability', typeLine: 'Creature', quantity: 1 },
      { name: 'Neutral', typeLine: 'Creature', quantity: 1 }
    ],
    cardsPlayed: [],
    stranded: [],
    playerMana: { you: { timeline: [] }, opponent: { timeline: [] } }
  };
  const values = { 'Top One': 5, 'Top Two': 4, 'Top Three': 3, 'Top Four': 2, Liability: -3.1, Neutral: -0.8 };
  const analyzed = analyzePostGameReview(review, { seventeenLands: Object.entries(values).map(([name, improvementInHand]) => ({ name, improvementInHand, gamesInHand: 10000 })) });

  assert.deepEqual(analyzed.postGame.drawQuality.cards.map((card) => [card.name, card.category]), [
    ['Top One', 'TOP-4 · DRAWN'],
    ['Top Two', 'TOP-4 · NOT DRAWN'],
    ['Top Three', 'TOP-4 · NOT DRAWN'],
    ['Top Four', 'TOP-4 · NOT DRAWN'],
    ['Liability', 'NOTABLE LIABILITY']
  ]);
});

test('does not invent an LVP for a played card with no attributable damage', () => {
  const analyzed = analyzePostGameReview({
    deck: { total: 40, lands: [], cards: [{ name: 'Quiet Support Card', typeLine: 'Creature' }] },
    drawnCards: [{ name: 'Quiet Support Card', typeLine: 'Creature', quantity: 1 }],
    cardsPlayed: [{ name: 'Quiet Support Card', damage: 0, playerDamage: 0, turnsInPlay: 1 }],
    stranded: [],
    playerMana: { you: { timeline: [] }, opponent: { timeline: [] } }
  });

  assert.deepEqual(analyzed.postGame.contributions.lvp, []);
  assert.match(analyzed.postGame.contributions.lvpEmpty, /will not call a card bad/i);
});

test('turns result, draw quality, mana variance, and underperformance into a concise verdict', () => {
  const ratedCards = ['Top One', 'Top Two', 'Top Three', 'Top Four'];
  const seventeenLands = ratedCards.map((name, index) => ({
    name,
    improvementInHand: 5 - index,
    gamesInHand: 12000
  }));
  const stableMana = {
    you: { timeline: [
      { playerTurn: 1, lands: 1 },
      { playerTurn: 2, lands: 2 },
      { playerTurn: 3, lands: 3 },
      { playerTurn: 4, lands: 4 }
    ] },
    opponent: { timeline: [
      { playerTurn: 1, lands: 1, visibleNonlands: 0 },
      { playerTurn: 2, lands: 2, visibleNonlands: 1 },
      { playerTurn: 3, lands: 3, visibleNonlands: 2 },
      { playerTurn: 4, lands: 4, visibleNonlands: 3 }
    ] }
  };
  const base = {
    status: 'complete',
    captureVersion: 2,
    deck: {
      total: 40,
      lands: [{ name: 'Mountain', typeLine: 'Basic Land — Mountain', quantity: 17 }],
      cards: ratedCards.map((name) => ({ name, typeLine: 'Creature', quantity: 1 }))
    },
    cardsPlayed: [],
    stranded: [],
    playerMana: stableMana,
    suggestion: { kind: 'hold', title: 'Hold the current build' }
  };

  const averageWin = analyzePostGameReview({
    ...base,
    won: true,
    drawnCards: [{ name: 'Top One', typeLine: 'Creature', quantity: 1 }]
  }, { seventeenLands });
  assert.equal(averageWin.postGame.verdict.label, 'RUN IT BACK');
  assert.match(averageWin.postGame.verdict.title, /average draw/i);

  const ceilingWin = analyzePostGameReview({
    ...base,
    won: true,
    drawnCards: ratedCards.map((name) => ({ name, typeLine: 'Creature', quantity: 1 }))
  }, { seventeenLands });
  assert.equal(ceilingWin.postGame.verdict.label, 'TEMPER EXPECTATIONS');
  assert.match(ceilingWin.postGame.verdict.title, /near-ceiling/i);

  const floodedLoss = analyzePostGameReview({
    ...base,
    won: false,
    drawnCards: [
      { name: 'Mountain', typeLine: 'Basic Land — Mountain', quantity: 8 },
      { name: 'Top One', typeLine: 'Creature', quantity: 1 },
      { name: 'Top Two', typeLine: 'Creature', quantity: 1 }
    ]
  }, { seventeenLands });
  assert.equal(floodedLoss.postGame.verdict.label, 'RUN IT BACK');
  assert.match(floodedLoss.postGame.verdict.title, /mana was flooded/i);

  const goodDrawLoss = analyzePostGameReview({
    ...base,
    won: false,
    drawnCards: ratedCards.slice(0, 3).map((name) => ({ name, typeLine: 'Creature', quantity: 1 })),
    stranded: [{ name: 'Top One', turns: 3, kind: 'curve' }],
    suggestion: { kind: 'card-swap', title: 'Test Reliable Two-Drop over Top One' }
  }, { seventeenLands });
  assert.equal(goodDrawLoss.postGame.verdict.label, 'TEST A CHANGE');
  assert.match(goodDrawLoss.postGame.verdict.summary, /Top One/);
  assert.match(goodDrawLoss.postGame.verdict.action, /Reliable Two-Drop/);
});

test('combines matching games into a deck-version verdict and resets after a deck change', () => {
  const seventeenLands = ['Top One', 'Top Two', 'Top Three', 'Top Four'].map((name, index) => ({
    name,
    improvementInHand: 5 - index,
    gamesInHand: 15000
  }));
  const mana = {
    you: { timeline: [
      { playerTurn: 1, lands: 1 },
      { playerTurn: 2, lands: 2 },
      { playerTurn: 3, lands: 3 },
      { playerTurn: 4, lands: 4 }
    ] },
    opponent: { timeline: [
      { playerTurn: 1, lands: 1, visibleNonlands: 0 },
      { playerTurn: 2, lands: 2, visibleNonlands: 1 },
      { playerTurn: 3, lands: 3, visibleNonlands: 2 },
      { playerTurn: 4, lands: 4, visibleNonlands: 3 }
    ] }
  };
  const deck = {
    name: 'Boros Dwarves',
    total: 40,
    cards: ['Top One', 'Top Two', 'Top Three', 'Top Four'].map((name, index) => ({ name, grpId: 100 + index, typeLine: 'Creature', quantity: 1 })),
    lands: [{ name: 'Mountain', grpId: 200, typeLine: 'Basic Land — Mountain', quantity: 17 }]
  };
  const first = {
    id: 'series-one:1',
    draftId: 'draft-series',
    completedAt: '2026-08-24T10:00:00.000Z',
    status: 'complete',
    won: true,
    deck,
    drawnCards: [{ name: 'Top One', typeLine: 'Creature', quantity: 1 }],
    cardsPlayed: [],
    stranded: [],
    playerMana: mana,
    suggestion: { kind: 'hold', title: 'Hold the current build' }
  };
  const second = {
    ...first,
    id: 'series-two:1',
    completedAt: '2026-08-24T10:20:00.000Z',
    drawnCards: [
      { name: 'Top One', typeLine: 'Creature', quantity: 1 },
      { name: 'Top Two', typeLine: 'Creature', quantity: 1 }
    ]
  };
  const combined = analyzePostGameReview(second, { seventeenLands, relatedReviews: [first, second] });
  assert.equal(combined.postGame.series.games, 2);
  assert.equal(combined.postGame.series.record, '2–0');
  assert.equal(combined.postGame.verdict.scope, 'series');
  assert.equal(combined.postGame.verdict.label, 'KEEP RUNNING IT');

  const changedDeckGame = {
    ...second,
    id: 'series-three:1',
    deck: {
      ...deck,
      cards: [...deck.cards, { name: 'New Two-Drop', grpId: 999, typeLine: 'Creature', quantity: 1 }]
    }
  };
  const reset = analyzePostGameReview(changedDeckGame, { seventeenLands, relatedReviews: [first, second, changedDeckGame] });
  assert.equal(reset.postGame.series.games, 1);
  assert.equal(reset.postGame.verdict.scope, 'game');
});

test('promotes a repeated stable-game LVP into a multi-game change test', () => {
  const seventeenLands = [
    { name: 'Top One', improvementInHand: 5, gamesInHand: 12000 },
    { name: 'Top Two', improvementInHand: 4, gamesInHand: 12000 },
    { name: 'Top Three', improvementInHand: 3, gamesInHand: 12000 },
    { name: 'Top Four', improvementInHand: 2, gamesInHand: 12000 }
  ];
  const deck = {
    name: 'Boros Dwarves',
    total: 40,
    cards: seventeenLands.map((row, index) => ({ name: row.name, grpId: 300 + index, typeLine: 'Creature', quantity: 1 })),
    lands: [{ name: 'Mountain', grpId: 400, typeLine: 'Basic Land — Mountain', quantity: 17 }]
  };
  const stableMana = {
    you: { timeline: [{ playerTurn: 1, lands: 1 }, { playerTurn: 2, lands: 2 }, { playerTurn: 3, lands: 3 }, { playerTurn: 4, lands: 4 }] },
    opponent: { timeline: [{ playerTurn: 1, lands: 1 }, { playerTurn: 2, lands: 2 }, { playerTurn: 3, lands: 3 }, { playerTurn: 4, lands: 4 }] }
  };
  const games = [1, 2].map((gameNumber) => ({
    id: `repeat-lvp:${gameNumber}`,
    draftId: 'repeat-lvp-draft',
    completedAt: `2026-08-24T11:${gameNumber}0:00.000Z`,
    status: 'complete',
    won: gameNumber === 1,
    deck,
    drawnCards: [{ name: 'Top One', typeLine: 'Creature', quantity: 1 }],
    cardsPlayed: [],
    stranded: [{ name: 'Top One', turns: 3, kind: 'curve' }],
    playerMana: stableMana,
    suggestion: { kind: 'card-swap', title: 'Test Reliable Two-Drop over Top One' }
  }));

  const analyzed = analyzePostGameReview(games[1], { seventeenLands, relatedReviews: games });
  assert.equal(analyzed.postGame.series.repeatedLvp.name, 'Top One');
  assert.equal(analyzed.postGame.series.repeatedLvp.count, 2);
  assert.equal(analyzed.postGame.verdict.label, 'TEST A CHANGE');
  assert.match(analyzed.postGame.verdict.action, /Reliable Two-Drop/);
});

test('celebrates a wire-to-wire board-and-life blowout without using final life alone', () => {
  const gameTrajectory = Array.from({ length: 10 }, (_, index) => {
    const gameTurn = index + 1;
    return {
      gameTurn,
      you: {
        life: 20,
        hand: Math.max(2, 7 - Math.ceil(gameTurn / 2)),
        nonlands: Math.max(0, Math.floor(gameTurn / 2) - 1),
        creatures: Math.max(0, Math.floor(gameTurn / 3)),
        power: Math.max(0, Math.floor(gameTurn / 3) * 3)
      },
      opponent: {
        life: Math.max(4, 20 - Math.max(0, gameTurn - 2) * 2),
        hand: Math.max(3, 7 - Math.floor(gameTurn / 3)),
        nonlands: gameTurn >= 7 ? 1 : 0,
        creatures: gameTurn >= 7 ? 1 : 0,
        power: gameTurn >= 7 ? 2 : 0
      }
    };
  });
  const review = {
    id: 'blowout:1',
    draftId: 'blowout-draft',
    status: 'complete',
    won: true,
    result: { reason: 'Concede' },
    deck: { total: 40, cards: [], lands: [] },
    drawnCards: [],
    cardsPlayed: [],
    stranded: [],
    playerMana: { you: { timeline: [] }, opponent: { timeline: [] } },
    suggestion: { kind: 'hold', title: 'Hold the current build' },
    gameTrajectory
  };

  const dominance = dominanceAnalysis(review);
  assert.equal(dominance.tier, 'blowout');
  assert.equal(dominance.neverBehind, true);
  assert.ok(dominance.controlRate >= 75);

  const analyzed = analyzePostGameReview(review);
  assert.equal(analyzed.postGame.verdict.label, 'ABSOLUTE DESTRUCTION');
  assert.equal(analyzed.postGame.verdict.tone, 'celebration');
  assert.match(analyzed.postGame.verdict.summary, /nonland permanents/i);

  const lifeOnly = dominanceAnalysis({
    ...review,
    gameTrajectory: gameTrajectory.map((snapshot, index) => ({
      ...snapshot,
      you: { ...snapshot.you, life: index < 8 ? 5 : 20, nonlands: 0, creatures: 0, power: 0 },
      opponent: { ...snapshot.opponent, nonlands: 3, creatures: 2, power: 7 }
    }))
  });
  assert.notEqual(lifeOnly.tier, 'blowout');
});

test('labels a genuinely back-and-forth win as close and recognizes a recorded triple block', () => {
  const scores = [0, -2.5, 2.3, -2.1, 4.6, 3, 8.4, 2.8, 5.3, -2.7, 1, -3.4, 2.6, 2.4, 16, 10];
  const gameTrajectory = scores.map((score, index) => ({
    gameTurn: index + 1,
    you: { life: 13, hand: 2, nonlands: 3, creatures: 2, power: 5 + score },
    opponent: { life: 13, hand: 2, nonlands: 3, creatures: 2, power: 5 }
  }));
  const review = {
    status: 'complete',
    won: true,
    result: { winnerSeatId: 2, won: true, reason: 'Concede' },
    gameTrajectory,
    damageEvents: [1, 2, 3].map((id) => ({
      kind: 'damage',
      turn: 9,
      affectedIds: [900],
      sourceCard: { stableId: id, name: `Blocker ${id}`, ownerSeatId: 2, blockState: 'BlockState_Blocking' }
    }))
  };

  const shape = gameShapeAnalysis(review);
  assert.equal(shape.tier, 'close');
  assert.equal(shape.label, 'CLOSE');
  assert.equal(shape.multiBlock.count, 3);
  assert.match(shape.detail, /3-creature block/i);
});

test('does not call a mostly controlled win close after a single brief setback', () => {
  const gameTrajectory = [0, -3, 1, 1, 8, 1, 3, -3, 4, 3, 14, 9, 14, 6, 9].map((score, index) => ({
    gameTurn: index + 1,
    you: { life: 16, hand: 3, nonlands: 3, creatures: 2, power: 5 + score },
    opponent: { life: Math.max(-1, 20 - index), hand: 3, nonlands: 3, creatures: 2, power: 5 }
  }));
  const shape = gameShapeAnalysis({
    status: 'complete',
    won: true,
    result: { winnerSeatId: 1, won: true },
    gameTrajectory,
    damageEvents: []
  });
  assert.notEqual(shape.tier, 'close');
});

test('surfaces only a fully confirmed nonlethal-attack-to-menace-lethal turning point', () => {
  const tacticalCatalog = {
    5001: { name: 'Human Soldier', typeLine: 'Creature — Human Soldier', rulesText: '' },
    5002: { name: "Eagle's Rescue", typeLine: 'Enchantment — Aura', rulesText: 'Enchanted creature gets +2/+2 and has flying.' },
    5003: { name: 'Dragon', typeLine: 'Creature — Dragon', rulesText: 'Flying' },
    5004: { name: 'Goblin Plate Mail', typeLine: 'Artifact — Equipment', rulesText: 'Equipped creature gets +1/+0 and has menace.' },
    5005: { name: 'Dreaded Bat-Cloud', typeLine: 'Creature — Bat', rulesText: 'Flying\nDeathtouch' },
    5006: { name: 'Patient Instructor', typeLine: 'Creature — Human Citizen', rulesText: 'Vigilance' },
    5007: { name: 'Thorin Oakenshield', typeLine: 'Creature — Dwarf Noble', rulesText: '' },
    5008: { name: 'Misty Mountains Raider', typeLine: 'Creature — Goblin Soldier', rulesText: '' },
    5009: { name: 'Army', typeLine: 'Creature — Goblin Army', rulesText: '' },
    5010: { name: 'Great Goblin', typeLine: 'Creature — Goblin Soldier', rulesText: '' }
  };
  const parser = new ArenaLogParser({ catalog: tacticalCatalog });
  const tracker = new GameReviewTracker();
  const context = {
    draftId: 'sanitized-draft',
    deck: { name: 'Boros Dwarves', total: 40, cards: [], lands: [], cuts: [], mana: { sources: {}, targets: {} } }
  };
  tracker.arm(context);
  parser.on('state', (next) => {
    if (next.matchId === 'sanitized-tactical-match') tracker.consume(next, context);
  });
  parser.feed(fs.readFileSync(path.join(projectRoot, 'fixtures', 'tactical-turning-point.log'), 'utf8'));

  const review = tracker.snapshot().latest;
  const turningPoint = turningPointAnalysis(review);
  assert.equal(review.captureVersion, 5);
  assert.equal(turningPoint.detected, true);
  assert.equal(turningPoint.label, 'TACTICAL EXPOSURE');
  assert.match(turningPoint.title, /Turn 20/);
  assert.match(turningPoint.summary, /Goblin Plate Mail gave Dreaded Bat-Cloud menace/);
  assert.deepEqual(turningPoint.evidence, {
    choiceTurn: 20,
    lethalTurn: 21,
    yourLife: 4,
    opponentLifeBefore: 6,
    opponentLifeAfter: 2,
    aerialBlockersBefore: 2,
    aerialBlockersAfterAttack: 1,
    lethalDamage: 5,
    attackerNames: ['Human Soldier'],
    lethalSource: 'Dreaded Bat-Cloud',
    menaceSource: 'Goblin Plate Mail'
  });

  const analyzed = analyzePostGameReview(review);
  assert.equal(analyzed.postGame.turningPoint.detected, true);
  assert.equal(analyzed.postGame.gameVerdict.label, 'RUN IT BACK');
  assert.match(analyzed.postGame.gameVerdict.title, /tactical turning point/i);
});

test('keeps the turning-point section silent when any decisive threshold is missing', () => {
  const base = {
    status: 'complete',
    won: false,
    combatChoices: [{
      id: 'choice',
      turn: 8,
      localSeatId: 1,
      board: {
        you: { life: 4, creatures: [
          { instanceId: 10, name: 'Attacking Flyer', typeLine: 'Creature', rulesText: 'Flying', tapped: false },
          { instanceId: 11, name: 'Held Flyer', typeLine: 'Creature', rulesText: 'Flying', tapped: false }
        ] },
        opponent: { life: 6, creatures: [] }
      },
      attackers: [{ instanceId: 10, name: 'Attacking Flyer', typeLine: 'Creature', rulesText: 'Flying' }]
    }],
    damageEvents: [{
      id: 'damage',
      kind: 'damage',
      turn: 9,
      amount: 5,
      affectedIds: [1],
      sourceCard: { name: 'Menace Flyer', ownerSeatId: 2, typeLine: 'Creature', rulesText: 'Flying\nMenace' }
    }],
    gameTrajectory: [{
      gameTurn: 8,
      you: { life: 4, power: 12, creatures: 4 },
      opponent: { life: 2, power: 5, creatures: 2 }
    }]
  };

  assert.equal(turningPointAnalysis({
    ...base,
    gameTrajectory: [{ ...base.gameTrajectory[0], opponent: { ...base.gameTrajectory[0].opponent, life: 0 } }]
  }).detected, false, 'a lethal attack should not be second-guessed');
  assert.equal(turningPointAnalysis({
    ...base,
    damageEvents: [{ ...base.damageEvents[0], sourceCard: { ...base.damageEvents[0].sourceCard, rulesText: 'Flying' } }]
  }).detected, false, 'ordinary flying lethal is not enough without the verified menace constraint');
  assert.equal(turningPointAnalysis({
    ...base,
    gameTrajectory: [{ ...base.gameTrajectory[0], you: { ...base.gameTrajectory[0].you, power: 5, creatures: 2 } }]
  }).detected, false, 'Pick 42 should stay silent unless the player was clearly ahead on board');
});

test('diffs the registered deck against the modeled build', () => {
  const deck = {
    source: 'Arena course deck',
    cards: [
      { name: 'Dwarven Mauler', quantity: 2 },
      { name: 'Warg Tactics', quantity: 1 },
      { name: 'Pinecone Strike', quantity: 2 }
    ],
    lands: [
      { name: 'Mountain', quantity: 10 },
      { name: 'Plains', quantity: 7 }
    ],
    modeledBuild: {
      name: 'Boros Dwarves',
      score: 55.6,
      cards: { 'Dwarven Mauler': 2, 'Stone by Sunlight': 1, 'Pinecone Strike': 2, Mountain: 9, Plains: 8 }
    }
  };
  const deviation = buildDeviationAnalysis(deck);
  assert.equal(deviation.comparable, true);
  assert.equal(deviation.differs, true);
  assert.deepEqual(deviation.added, [{ name: 'Warg Tactics', quantity: 1 }]);
  assert.deepEqual(deviation.cut, [{ name: 'Stone by Sunlight', quantity: 1 }]);
  assert.deepEqual(deviation.basics.sort((a, b) => a.name.localeCompare(b.name)), [
    { name: 'Mountain', delta: 1 },
    { name: 'Plains', delta: -1 }
  ]);

  const exactDeck = { ...deck, cards: [{ name: 'Dwarven Mauler', quantity: 2 }, { name: 'Stone by Sunlight', quantity: 1 }, { name: 'Pinecone Strike', quantity: 2 }], lands: [{ name: 'Mountain', quantity: 9 }, { name: 'Plains', quantity: 8 }] };
  assert.equal(buildDeviationAnalysis(exactDeck).differs, false);

  assert.equal(buildDeviationAnalysis({ ...deck, modeledBuild: null }), null);
  assert.equal(buildDeviationAnalysis({ ...deck, source: 'Selected Pick 42 recipe' }).comparable, false);
});

test('a loss with a deviated build offers a reversible swap toward the model', () => {
  const review = {
    status: 'complete',
    won: false,
    draftId: 'deviation-draft',
    turns: 9,
    deck: {
      source: 'Arena course deck',
      total: 40,
      fingerprint: 'dev-1',
      cards: [{ name: 'Warg Tactics', quantity: 2 }],
      lands: [{ name: 'Mountain', quantity: 17 }],
      modeledBuild: { name: 'Boros Dwarves', score: 55.6, cards: { 'Stone by Sunlight': 2, Mountain: 17 } }
    },
    drawnCards: [{ name: 'Warg Tactics', typeLine: 'Instant', quantity: 2 }],
    cardsPlayed: [],
    stranded: [{ name: 'Warg Tactics', turns: 3, kind: 'curve' }],
    playerMana: { you: { timeline: [{ playerTurn: 1, lands: 1 }, { playerTurn: 2, lands: 2 }, { playerTurn: 3, lands: 3 }] }, opponent: { timeline: [] } }
  };
  const analyzed = analyzePostGameReview(review, {});
  const verdict = analyzed.postGame.verdict;
  assert.equal(analyzed.postGame.buildDeviation.differs, true);
  assert.ok(verdict.deviation);
  assert.match(verdict.deviation.phrase, /\+2× Warg Tactics/);
  assert.match(verdict.action, /Stone by Sunlight/);
  assert.match(verdict.action, /Boros Dwarves/);
});

test('groups reviews per draft with format-aware trophy and elimination states', () => {
  const game = (draftId, index, won, extra = {}) => ({
    id: `${draftId}:${index}`,
    draftId,
    won,
    turns: 10,
    completedAt: `2026-08-2${draftId === 'p2' ? 5 : 4}T0${index}:00:00Z`,
    deck: { name: draftId === 'p2' ? 'Golgari' : 'Boros Dwarves' },
    ...extra
  });

  const quickGames = [true, true, false, true, true, true, false, false].map((won, index) => game('qd', index + 1, won, { format: 'Quick Draft' }));
  const pickTwoGames = [false, true, true, true, true].map((won, index) => game('p2', index + 1, won));
  const groups = reviewEventGroups([...quickGames, ...pickTwoGames], { currentDraftId: 'p2', currentFormat: 'Pick Two Draft' });

  assert.equal(groups.length, 2);
  const [pickTwo, quick] = groups;
  assert.equal(pickTwo.draftId, 'p2');
  assert.equal(pickTwo.record, '4-1');
  assert.equal(pickTwo.trophy, true);
  assert.equal(pickTwo.status, 'trophy');
  assert.deepEqual(pickTwo.games.map((entry) => entry.draftGameNumber), [1, 2, 3, 4, 5]);

  assert.equal(quick.record, '5-3');
  assert.equal(quick.trophy, false);
  assert.equal(quick.eliminated, true);
  assert.equal(quick.status, 'eliminated');
});

test('a pick-two draft ends at two losses and stays live before that', () => {
  const game = (index, won) => ({ id: `p2b:${index}`, draftId: 'p2b', won, completedAt: `2026-08-25T0${index}:00:00Z`, deck: { name: 'Golgari' } });
  const context = { currentDraftId: 'p2b', currentFormat: 'Pick Two Draft' };

  const live = reviewEventGroups([game(1, false), game(2, true)], context)[0];
  assert.equal(live.status, 'live');
  assert.equal(live.record, '1-1');

  const out = reviewEventGroups([game(1, false), game(2, true), game(3, false)], context)[0];
  assert.equal(out.eliminated, true);
  assert.equal(out.status, 'eliminated');
});

test('traditional drafts derive match records and trophy at three match wins', () => {
  const trad = (matchId, gameNumber, won) => ({
    id: `td:${matchId}:${gameNumber}`,
    draftId: 'td',
    matchId,
    won,
    format: 'TradDraft',
    completedAt: `2026-08-24T1${matchId}:0${gameNumber}:00Z`,
    deck: { name: 'Azorius' }
  });
  const games = [
    trad('m1', 1, true), trad('m1', 2, true),
    trad('m2', 1, true), trad('m2', 2, false), trad('m2', 3, true),
    trad('m3', 1, false), trad('m3', 2, true), trad('m3', 3, true)
  ];
  const [group] = reviewEventGroups(games, {});
  assert.equal(group.record, '3-0');
  assert.equal(group.trophy, true);
});

test('an early concession carries no deck evidence but keeps its place in the record', () => {
  const conceded = {
    status: 'complete',
    won: false,
    draftId: 'p2c',
    turns: 8,
    yourTurnsObserved: 4,
    result: { reason: 'Concede' },
    completedAt: '2026-08-25T01:00:00Z',
    deck: { name: 'Golgari', total: 40, fingerprint: 'p2c-1' },
    drawnCards: [],
    cardsPlayed: [],
    stranded: [{ name: 'Wandering Ent', turns: 2, kind: 'curve' }],
    playerMana: { you: { timeline: [{ playerTurn: 1, lands: 1 }] }, opponent: { timeline: [] } }
  };
  assert.equal(isEarlyConcession(conceded), true);
  assert.equal(isEarlyConcession({ ...conceded, won: true }), false);
  assert.equal(isEarlyConcession({ ...conceded, yourTurnsObserved: 9 }), false);
  assert.equal(isEarlyConcession({ ...conceded, result: { reason: 'Defeated' } }), false);

  const analyzed = analyzePostGameReview(conceded, {});
  assert.equal(analyzed.postGame.verdict.label, 'LIMITED EVIDENCE');
  assert.match(analyzed.postGame.verdict.summary, /still counts toward the event record/);

  const [group] = reviewEventGroups([conceded], { currentDraftId: 'p2c', currentFormat: 'Pick Two Draft' });
  assert.equal(group.record, '0-1');
  assert.equal(group.games[0].earlyConcession, true);
});

test('a decided event replaces the final verdict with a draft wrap-up', () => {
  const game = (index, won, extra = {}) => ({
    id: `wrap:${index}`,
    draftId: 'wrap',
    won,
    status: 'complete',
    completedAt: `2026-08-25T0${index}:00:00Z`,
    deck: { name: 'Golgari' },
    postGame: {
      variance: { you: { level: 'LOW', kind: 'stable' } },
      contributions: { mvp: [], lvp: [] },
      ...extra.postGame
    },
    ...extra
  });

  const eliminated = reviewEventGroups([
    game(1, false, { result: { reason: 'Concede' }, yourTurnsObserved: 3 }),
    game(2, true),
    game(3, true),
    game(4, false, { postGame: { variance: { you: { level: 'LOW', kind: 'stable' } }, contributions: { mvp: [], lvp: [{ name: 'Wandering Ent' }] } } })
  ], { currentDraftId: 'wrap', currentFormat: 'Pick Two Draft' });
  const group = eliminated[0];
  assert.equal(group.eliminated, true);
  const wrap = eventWrapUpVerdict(group);
  assert.equal(wrap.scope, 'event');
  assert.equal(wrap.label, 'DRAFT COMPLETE');
  assert.match(wrap.title, /2-2: this event is over/);
  assert.match(wrap.action, /No more games with this deck/);

  const trophyGroup = reviewEventGroups(
    [game(1, true), game(2, true), game(3, false), game(4, true), game(5, true)],
    { currentDraftId: 'wrap', currentFormat: 'Pick Two Draft' }
  )[0];
  assert.equal(trophyGroup.trophy, true);
  const trophyWrap = eventWrapUpVerdict(trophyGroup);
  assert.equal(trophyWrap.label, 'TROPHY');
  assert.equal(trophyWrap.tone, 'celebration');

  assert.equal(eventWrapUpVerdict(reviewEventGroups([game(1, true)], { currentDraftId: 'wrap', currentFormat: 'Pick Two Draft' })[0]), null);
});

test('a cast that never snapshots on the stack is excluded from LVP', () => {
  const dragon = card(31, 'Countered Dragon', '{5}{R}{R}', 'Creature — Dragon');
  const tracker = new GameReviewTracker();
  tracker.arm({
    draftId: 'PickTwoDraft_HOB_test',
    setCode: 'HOB',
    format: 'Pick Two Draft',
    deck: {
      source: 'Arena course deck',
      name: 'Rakdos',
      cards: [{ ...dragon, quantity: 1 }],
      lands: [{ name: 'Mountain', typeLine: 'Basic Land — Mountain', quantity: 17 }],
      cuts: [],
      total: 40,
      mana: { sources: { R: 17 }, targets: { R: 17 } }
    }
  });

  tracker.consume(state({ turn: 1, hand: [dragon], lands: [swampOne] }));
  tracker.consume(state({ turn: 3, hand: [dragon], lands: [swampOne, swampTwo] }));
  // The cast and its counter resolve within one log batch: the only trace is
  // the parser's cast event, never a stack snapshot.
  tracker.consume({
    ...state({ turn: 5, hand: [], lands: [swampOne, swampTwo], complete: true, won: true }),
    events: [{ id: 'cast-1', kind: 'cast', turn: 5, sourceCard: { ...dragon, objectType: 'GameObjectType_Card' } }]
  });

  const review = tracker.snapshot().latest;
  assert.equal(review.status, 'complete');
  assert.equal(review.stranded[0]?.name, 'Countered Dragon', 'curve evidence is still recorded');
  assert.ok(review.observations.some((fact) => /cast but never reached the battlefield/.test(fact)));

  const analyzed = analyzePostGameReview(review, { seventeenLands: [] });
  const contributions = analyzed.postGame.contributions;
  assert.deepEqual(contributions.lvp, [], 'a cast card is never a NEVER DEPLOYED LVP, countered or not');
});

test('a face-cast card is played, not LVP, and the observation names the face', () => {
  const dragon = card(41, 'Great Dragon', '{5}{R}{R}', 'Legendary Creature — Dragon');
  const tracker = new GameReviewTracker();
  tracker.arm({ deck: { name: 'Rakdos', cards: [{ ...dragon, quantity: 1 }], lands: [], cuts: [], total: 40, mana: { sources: {}, targets: {} } } });
  tracker.consume(state({ turn: 1, hand: [dragon], lands: [swampOne] }));
  tracker.consume(state({ turn: 3, hand: [dragon], lands: [swampOne, swampTwo] }));
  tracker.consume({
    ...state({ turn: 5, hand: [], lands: [swampOne, swampTwo], complete: true, won: true }),
    events: [{
      id: 'cast-face-1',
      kind: 'cast',
      turn: 5,
      sourceCard: { ...dragon, objectType: 'GameObjectType_Card' },
      faceCard: { name: 'Dragon Breath', typeLine: 'Sorcery' }
    }]
  });

  const review = tracker.snapshot().latest;
  assert.ok(review.observations.some((fact) => fact === 'Great Dragon was cast as Dragon Breath.'));
  assert.ok(!review.observations.some((fact) => /never reached the battlefield/.test(fact)), 'a face cast did what it was played to do');

  const analyzed = analyzePostGameReview(review, { seventeenLands: [] });
  assert.deepEqual(analyzed.postGame.contributions.lvp, []);
});

test('resolved instants are never described as failing to reach the battlefield', () => {
  const trick = card(51, 'Simple Shock', '{R}', 'Instant');
  const tracker = new GameReviewTracker();
  tracker.arm({ deck: { name: 'Rakdos', cards: [{ ...trick, quantity: 1 }], lands: [], cuts: [], total: 40, mana: { sources: {}, targets: {} } } });
  tracker.consume({
    ...state({ turn: 2, hand: [], lands: [swampOne], complete: true, won: true }),
    events: [{ id: 'cast-trick-1', kind: 'cast', turn: 2, sourceCard: { ...trick, objectType: 'GameObjectType_Card' } }]
  });

  const review = tracker.snapshot().latest;
  assert.ok(!review.observations.some((fact) => /never reached the battlefield/.test(fact)));
});
