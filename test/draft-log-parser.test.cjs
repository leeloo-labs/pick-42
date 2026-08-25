'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DraftLogParser } = require('../src/draft/draft-log-parser.cjs');
const { buildLimitedDecks } = require('../src/draft/deck-builder.cjs');

const root = path.resolve(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'fixtures', 'demo-draft-cards.json'), 'utf8'));

test('tracks a Player Draft pack and picked-card pool', () => {
  const parser = new DraftLogParser({ catalog });
  const entries = fs.readFileSync(path.join(root, 'fixtures', 'demo-draft.log'), 'utf8').trim().split('\n');
  parser.feed(`${entries[0]}\n${entries[1]}\n${entries[2]}\n`);
  const state = parser.snapshot();

  assert.equal(state.draftId, 'arcane-demo-draft');
  assert.equal(state.format, 'Player Draft');
  assert.equal(state.pickNumber, 2);
  assert.equal(state.pool[0].name, 'Fíli the Pathfinder');
  assert.equal(state.pack.length, 13);
});

test('recognizes zero-based Quick Draft status payloads', () => {
  const parser = new DraftLogParser({ catalog });
  parser.feed(JSON.stringify({
    EventName: 'QuickDraft_HOB_20260820',
    DraftPack: [103382, 103444],
    PickedCards: [103385],
    PackNumber: 0,
    PickNumber: 1
  }));
  const state = parser.snapshot();

  assert.equal(state.draftId, 'QuickDraft_HOB_20260820');
  assert.equal(state.courseId, null);
  assert.equal(state.eventName, 'QuickDraft_HOB_20260820');
  assert.equal(state.format, 'Quick Draft');
  assert.equal(state.setCode, 'HOB');
  assert.equal(state.packNumber, 1);
  assert.equal(state.pickNumber, 2);
  assert.deepEqual(state.pack.map((card) => card.name), ['Fíli the Pathfinder', 'Gollum, Riddle Master']);
  assert.deepEqual(state.pool.map((card) => card.name), ['Kíli the Resourceful']);
});

test('does not treat changing RPC request ids as new drafts', () => {
  const parser = new DraftLogParser({ catalog });
  const wrap = (id, payload) => JSON.stringify({ id, request: JSON.stringify(payload) });

  parser.feed(wrap('request-one', {
    EventName: 'QuickDraft_HOB_20260820',
    DraftPack: [103382, 103444],
    PickedCards: [],
    PackNumber: 0,
    PickNumber: 0
  }));
  parser.feed(wrap('request-two', {
    EventName: 'QuickDraft_HOB_20260820',
    CardIds: ['103382'],
    PackNumber: 0,
    PickNumber: 0
  }));
  const state = parser.snapshot();

  assert.equal(state.draftId, 'QuickDraft_HOB_20260820');
  assert.equal(state.courseId, null);
  assert.equal(state.eventName, 'QuickDraft_HOB_20260820');
  assert.deepEqual(state.pool.map((card) => card.name), ['Fíli the Pathfinder']);
  assert.deepEqual(state.pack.map((card) => card.name), ['Gollum, Riddle Master']);
});

test('restores the completed pool when a saved draft is reopened', () => {
  const parser = new DraftLogParser({ catalog });
  const log = fs.readFileSync(path.join(root, 'fixtures', 'completed-draft-reopen.log'), 'utf8');
  parser.feed(log);
  const state = parser.snapshot();

  assert.equal(state.draftId, 'sanitized-quick-course');
  assert.equal(state.courseId, 'sanitized-quick-course');
  assert.equal(state.eventName, 'QuickDraft_HOB_20260820');
  assert.equal(state.format, 'Quick Draft');
  assert.equal(state.setCode, 'HOB');
  assert.equal(state.packNumber, 3);
  assert.equal(state.pickNumber, 14);
  assert.deepEqual(state.pack, []);
  assert.equal(state.pool.length, 42);
  assert.deepEqual(state.pool.slice(0, 3).map((card) => card.name), [
    'Fíli the Pathfinder',
    'Kíli the Resourceful',
    'Gollum, Riddle Master'
  ]);
  assert.equal(buildLimitedDecks({ pool: state.pool }).length, 3);
});

test('restores the exact registered Arena course deck when it is present', () => {
  const parser = new DraftLogParser({ catalog });
  parser.feed(JSON.stringify({
    Courses: [{
      CourseId: 'sanitized-course',
      InternalEventName: 'QuickDraft_HOB_20260820',
      CurrentModule: 'CreateMatch',
      CardPool: [103382, 103385, 103444],
      CourseDeck: {
        MainDeck: [
          { cardId: 103382, quantity: 2 },
          { cardId: 103385, quantity: 1 }
        ],
        Sideboard: [{ cardId: 103444, quantity: 1 }]
      }
    }]
  }));

  const state = parser.snapshot();
  assert.deepEqual(state.arenaDeck.mainDeck.map((card) => [card.name, card.quantity]), [
    ['Fíli the Pathfinder', 2],
    ['Kíli the Resourceful', 1]
  ]);
  assert.deepEqual(state.arenaDeck.sideboard.map((card) => [card.name, card.quantity]), [
    ['Gollum, Riddle Master', 1]
  ]);
});

test('selects the newest course when consecutive drafts reuse the same event name', () => {
  const parser = new DraftLogParser({ catalog });
  const oldPool = Array.from({ length: 42 }, (_, index) => index % 2 ? 103382 : 103385);
  const newPool = Array.from({ length: 42 }, (_, index) => index % 3 ? 103397 : 103489);

  parser.feed(JSON.stringify({
    Courses: [
      {
        CourseId: 'older-course',
        InternalEventName: 'QuickDraft_HOB_20260820',
        CurrentModule: 'Complete',
        CardPool: oldPool,
        CourseDeck: { MainDeck: [{ cardId: 103382, quantity: 20 }] }
      },
      {
        CourseId: 'newest-course',
        InternalEventName: 'QuickDraft_HOB_20260820',
        CurrentModule: 'DeckSelect',
        CardPool: newPool
      }
    ]
  }));

  const state = parser.snapshot();
  assert.equal(state.draftId, 'newest-course');
  assert.equal(state.courseId, 'newest-course');
  assert.equal(state.eventName, 'QuickDraft_HOB_20260820');
  assert.deepEqual(state.pool.slice(0, 4).map((card) => card.name), [
    'Smaug the Magnificent',
    'An Unexpected Party',
    'An Unexpected Party',
    'Smaug the Magnificent'
  ]);
  assert.deepEqual(state.arenaDeck.mainDeck, []);
  assert.deepEqual(state.arenaDeck.sideboard, []);
});

test('labels a Pick Two draft and restores its 42-card pool', () => {
  const parser = new DraftLogParser({ catalog });
  const poolSlice = Object.keys(catalog).slice(0, 14);
  const pool = [...poolSlice, ...poolSlice, ...poolSlice].map(Number);
  parser.feed(JSON.stringify({
    CourseId: 'pick-two-course',
    InternalEventName: 'PickTwoDraft_HOB_20260811',
    CurrentModule: 'CreateMatch',
    CardPool: pool,
    CourseDeck: { MainDeck: [{ cardId: 103382, quantity: 2 }], Sideboard: [] }
  }));

  const state = parser.snapshot();
  assert.equal(state.format, 'Pick Two Draft');
  assert.equal(state.setCode, 'HOB');
  assert.equal(state.pool.length, 42);
  assert.equal(state.packNumber, 3);
  assert.equal(state.pickNumber, 7);
});

test('tracks a live Pick Two pack and a two-card selection', () => {
  const parser = new DraftLogParser({ catalog });
  parser.feed(JSON.stringify({
    EventName: 'PickTwoDraft_HOB_20260811',
    PackCards: [103382, 103444, 103385, 103397],
    SelfPack: 1,
    SelfPick: 1
  }));
  assert.equal(parser.snapshot().format, 'Pick Two Draft');

  parser.feed(JSON.stringify({ method: 'Draft.MakeHumanDraftPick', CardIds: [103382, 103444] }));
  const state = parser.snapshot();
  assert.equal(state.pool.length, 2);
  assert.deepEqual(state.pool.map((card) => card.grpId), [103382, 103444]);
  assert.equal(state.pack.length, 2);
});

test('reconstructs a live Pick Two draft from human-draft log shapes', () => {
  const parser = new DraftLogParser({ catalog });
  const lines = fs.readFileSync(path.join(root, 'fixtures', 'pick-two-live-draft.log'), 'utf8').trim().split('\n');

  // Course join: empty CardPool, active PlayerDraft module, explicit session DraftId.
  parser.feed(`${lines[0]}\n`);
  let state = parser.snapshot();
  assert.equal(state.format, 'Pick Two Draft');
  assert.equal(state.draftId, 'pick-two-course-0001');

  // First pack arrives as a comma-separated PackCards string under the session id.
  parser.feed(`${lines[1]}\n`);
  state = parser.snapshot();
  assert.equal(state.draftId, 'pick-two-course-0001');
  assert.equal(state.pack.length, 8);
  assert.equal(state.packNumber, 1);
  assert.equal(state.pickNumber, 1);
  assert.equal(state.pack[0].name, 'Fíli the Pathfinder');

  // A wrapped EventPlayerDraftMakePick takes two cards; a replayed request is ignored.
  // The leftover pack passes to another player, so the round ends waiting for the next one.
  parser.feed(`${lines[2]}\n${lines[3]}\n`);
  state = parser.snapshot();
  assert.deepEqual(state.pool.map((card) => card.name), ['Fíli the Pathfinder', 'Gollum, Riddle Master']);
  assert.equal(state.pack.length, 0);
  assert.equal(state.waitingForPack, true);

  // A periodic snapshot of the same course must not wipe live progress.
  parser.feed(`${lines[4]}\n`);
  assert.equal(parser.snapshot().pool.length, 2);

  // The next Draft.Notify clears the waiting state before the round's pick lands.
  parser.feed(`${lines[5]}\n`);
  assert.equal(parser.snapshot().waitingForPack, false);

  // The next round can pick a second copy of an already-drafted card.
  parser.feed(`${lines[6]}\n`);
  state = parser.snapshot();
  assert.equal(state.pickNumber, 2);
  assert.equal(state.waitingForPack, true);
  assert.deepEqual(state.pool.map((card) => card.name), [
    'Fíli the Pathfinder',
    'Gollum, Riddle Master',
    'Fíli the Pathfinder',
    'An Unexpected Party'
  ]);
  assert.equal(state.format, 'Pick Two Draft');
});

test('the Pick Two sample fixture drafts a full pair loop', () => {
  const parser = new DraftLogParser({ catalog });
  const lines = fs.readFileSync(path.join(root, 'fixtures', 'demo-pick-two-draft.log'), 'utf8').trim().split('\n');
  for (const line of lines) parser.feed(`${line}\n`);
  const state = parser.snapshot();
  assert.equal(state.format, 'Pick Two Draft');
  assert.equal(state.setCode, 'HOB');
  assert.equal(state.pool.length, 8);
  assert.equal(state.waitingForPack, true);
  assert.equal(state.pool[0].name, 'Fíli the Pathfinder');
});
