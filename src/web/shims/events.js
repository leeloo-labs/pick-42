'use strict';

// Minimal EventEmitter for the browser bundle: exactly the surface the parsers
// and trackers use (on/once/off/emit).
class EventEmitter {
  #listeners = new Map();

  on(event, listener) {
    if (!this.#listeners.has(event)) this.#listeners.set(event, []);
    this.#listeners.get(event).push(listener);
    return this;
  }

  once(event, listener) {
    const wrapped = (...args) => {
      this.off(event, wrapped);
      listener(...args);
    };
    return this.on(event, wrapped);
  }

  off(event, listener) {
    const list = this.#listeners.get(event);
    if (list) this.#listeners.set(event, list.filter((entry) => entry !== listener));
    return this;
  }

  removeListener(event, listener) {
    return this.off(event, listener);
  }

  emit(event, ...args) {
    const list = this.#listeners.get(event) || [];
    for (const listener of [...list]) listener(...args);
    return list.length > 0;
  }
}

module.exports = { EventEmitter };
