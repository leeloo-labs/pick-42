'use strict';

const { EventEmitter } = require('node:events');

class ArenaSceneTracker extends EventEmitter {
  constructor() {
    super();
    this.reset();
  }

  reset() {
    this.buffer = '';
    this.state = {
      scene: null,
      previousScene: null,
      context: null,
      inDeckBuilder: false
    };
  }

  feed(chunk) {
    this.buffer += String(chunk || '');
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() || '';
    let nextState = null;

    for (const line of lines) {
      const marker = line.indexOf('Client.SceneChange');
      if (marker < 0) continue;
      const jsonStart = line.indexOf('{', marker);
      if (jsonStart < 0) continue;

      try {
        const event = JSON.parse(line.slice(jsonStart));
        const scene = String(event.toSceneName || '').trim();
        if (!scene) continue;
        nextState = {
          scene,
          previousScene: event.fromSceneName ? String(event.fromSceneName) : this.state.scene,
          context: event.context ? String(event.context) : null,
          inDeckBuilder: /^DeckBuilder$/i.test(scene)
        };
      } catch {
        // Player.log contains unrelated text on most lines; malformed scene entries are ignored.
      }
    }

    if (this.buffer.length > 16_384) this.buffer = this.buffer.slice(-16_384);
    if (!nextState) return;
    const changed = nextState.scene !== this.state.scene || nextState.context !== this.state.context;
    this.state = nextState;
    if (changed) this.emit('scene', this.snapshot());
  }

  snapshot() {
    return { ...this.state };
  }
}

module.exports = { ArenaSceneTracker };
