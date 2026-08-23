'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DraftLogParser } = require('../src/draft/draft-log-parser.cjs');

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
  assert.deepEqual(state.pool.map((card) => card.name), ['Fíli the Pathfinder']);
  assert.deepEqual(state.pack.map((card) => card.name), ['Gollum, Riddle Master']);
});
