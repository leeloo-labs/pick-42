'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ArenaSceneTracker } = require('../src/core/arena-scene-tracker.cjs');

test('tracks the last Arena scene change in a log chunk', () => {
  const tracker = new ArenaSceneTracker();
  const events = [];
  tracker.on('scene', (scene) => events.push(scene));

  tracker.feed('[UnityCrossThreadLogger]Client.SceneChange {"fromSceneName":"Home","toSceneName":"EventLanding","context":"HOB_Quick_Draft"}\n');
  tracker.feed('[UnityCrossThreadLogger]Client.SceneChange {"fromSceneName":"EventLanding","toSceneName":"DeckBuilder","context":"deck builder"}\n');

  assert.equal(events.length, 2);
  assert.deepEqual(tracker.snapshot(), {
    scene: 'DeckBuilder',
    previousScene: 'EventLanding',
    context: 'deck builder',
    inDeckBuilder: true
  });
});

test('handles scene JSON split across tailer chunks', () => {
  const tracker = new ArenaSceneTracker();
  tracker.feed('[UnityCrossThreadLogger]Client.SceneChange {"fromSceneName":"EventLanding",');
  tracker.feed('"toSceneName":"DeckBuilder","context":"deck builder"}\n');
  assert.equal(tracker.snapshot().inDeckBuilder, true);
});

test('emits only the final scene when a historical scan contains several transitions', () => {
  const tracker = new ArenaSceneTracker();
  const events = [];
  tracker.on('scene', (scene) => events.push(scene));
  tracker.feed([
    '[UnityCrossThreadLogger]Client.SceneChange {"fromSceneName":"None","toSceneName":"Home"}',
    '[UnityCrossThreadLogger]Client.SceneChange {"fromSceneName":"Home","toSceneName":"DeckBuilder","context":"deck builder"}',
    ''
  ].join('\n'));

  assert.equal(events.length, 1);
  assert.equal(events[0].scene, 'DeckBuilder');
});
