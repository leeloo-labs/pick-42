'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDecisionHistory } = require('../src/draft/decision-history.cjs');
const card = (grpId) => ({ grpId, name: `Card ${grpId}` });
const snapshot = (patch = {}) => ({ draftId: 'course-a', setCode: 'HOB', format: 'Player Draft', packNumber: 1, pickNumber: 1, demo: false, pickCount: 1, pack: [card(1), card(2)], pool: [], gate: { ready: true, kind: 'ready' }, recommendations: [{ ...card(1), score: 60 }], recommended: ['Card 1'], ...patch });

test('advice updates before selection and freezes after a recorded pick', () => {
  let writes = 0;
  const history = createDecisionHistory({ write: () => writes++ });
  const before = snapshot(); history.capture(before); history.capture(before);
  assert.equal(writes, 1);
  history.capture(snapshot({ recommended: ['Card 2'] }));
  history.observePool({ ...before, pool: [card(1)] }, false, before);
  const entry = history.list()[0];
  assert.deepEqual(entry.actual, ['Card 1']);
  history.capture(snapshot({ recommended: ['Card 1'] }));
  assert.deepEqual(history.details(entry.id).recommended, ['Card 2']);
  const copy = history.details(entry.id); copy.pack[0].name = 'Changed';
  assert.equal(history.details(entry.id).pack[0].name, 'Card 1');
});

test('copy-aware Pick Two selection records two copies and ignores repeated pool notifications', () => {
  const history = createDecisionHistory();
  const before = snapshot({ format: 'Pick Two Draft', pickCount: 2, pool: [card(1)], pack: [card(1), card(1), card(2)] });
  history.capture(before);
  assert.equal(history.observePool({ ...before, pool: [card(1), card(1), card(1)] }, false, before), true);
  assert.deepEqual(history.list()[0].actual, ['Card 1', 'Card 1']);
  assert.equal(history.observePool({ ...before, pool: [card(1), card(1), card(1)] }, false, before), false);
});

test('unseen picks, course jumps, and later-round duplicates do not manufacture a selection', () => {
  const history = createDecisionHistory(), before = snapshot(); history.capture(before);
  assert.equal(history.observePool({ ...before, pool: [card(3)] }, false, before), false);
  assert.equal(history.observePool({ ...before, draftId: 'other', pool: [card(1)] }, false, before), false);
  assert.equal(history.observePool({ ...before, pool: [card(1), card(2), card(3)] }, false, before), false);
  assert.equal(history.observePool({ ...before, pool: [card(1)] }, false, { ...before, pickNumber: 2 }), false);
  assert.deepEqual(history.list()[0].actual, []);
});

test('retention bounds whole drafts, bookmarks persist, and samples never reach disk', () => {
  let saved;
  const history = createDecisionHistory({ write: (value) => { saved = value; }, maxDrafts: 2 });
  history.capture(snapshot({ draftId: 'a' })); history.capture(snapshot({ draftId: 'b' })); history.capture(snapshot({ draftId: 'c' }));
  assert.deepEqual(history.list().map((entry) => entry.draftId), ['b', 'c']);
  history.bookmark(history.list()[1].id, true);
  history.capture(snapshot({ draftId: 'sample', demo: true }));
  assert.equal(saved.records.some((entry) => entry.demo), false);
  const restored = createDecisionHistory(); restored.hydrate(saved);
  assert.equal(restored.list()[1].bookmarked, true);
  history.resetSample(); assert.equal(history.list().length, 2);
});


test('late storage hydration preserves newer decisions captured during startup', () => {
  let saved;
  const old = createDecisionHistory({ write: (value) => { saved = value; } });
  old.capture(snapshot());
  const current = createDecisionHistory();
  current.capture(snapshot({ recommended: ['Card 2'] }));
  current.hydrate(saved);
  assert.deepEqual(current.list()[0].recommended, ['Card 2']);
});
