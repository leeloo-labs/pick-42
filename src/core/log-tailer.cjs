'use strict';

const fs = require('node:fs');
const { EventEmitter } = require('node:events');

class LogTailer extends EventEmitter {
  constructor({ interval = 250 } = {}) {
    super();
    this.interval = interval;
    this.path = null;
    this.offset = 0;
    this.reading = false;
  }

  async start(path) {
    this.stop();
    this.path = path;
    this.offset = 0;
    await this.#readAvailable();
    fs.watchFile(this.path, { interval: this.interval }, () => this.#readAvailable());
    this.emit('status', { kind: 'live', message: 'Watching Arena log', path: this.path });
  }

  stop() {
    if (this.path) fs.unwatchFile(this.path);
    this.path = null;
    this.offset = 0;
  }

  async #readAvailable() {
    if (!this.path || this.reading) return;
    this.reading = true;

    try {
      const stat = await fs.promises.stat(this.path);
      if (stat.size < this.offset) {
        this.offset = 0;
        this.emit('rotate');
      }
      if (stat.size === this.offset) return;

      const handle = await fs.promises.open(this.path, 'r');
      try {
        const length = stat.size - this.offset;
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, this.offset);
        this.offset += bytesRead;
        if (bytesRead) this.emit('data', buffer.subarray(0, bytesRead).toString('utf8'));
      } finally {
        await handle.close();
      }
    } catch (error) {
      this.emit('status', { kind: 'error', message: error.message, path: this.path });
    } finally {
      this.reading = false;
    }
  }
}

module.exports = { LogTailer };
