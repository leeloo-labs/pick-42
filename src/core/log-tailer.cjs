'use strict';

const fs = require('node:fs');
const { StringDecoder } = require('node:string_decoder');
const { EventEmitter } = require('node:events');

class LogTailer extends EventEmitter {
  constructor({ interval = 250, io = fs } = {}) {
    super();
    this.interval = interval;
    this.io = io;
    this.session = null;
  }
  get path() { return this.session?.path ?? null; }
  get offset() { return this.session?.offset ?? 0; }

  async start(path) {
    this.stop();
    const current = { path, offset: 0, reading: false, scanned: false, identity: null, decoder: new StringDecoder('utf8') };
    this.session = current;
    if (!await this.#readAvailable(current) || this.session !== current) return false;
    current.listener = () => this.#readAvailable(current);
    this.io.watchFile(path, { interval: this.interval }, current.listener);
    this.emit('status', { kind: 'live', message: 'Watching Arena log', path });
    return this.session === current;
  }

  stop() {
    const current = this.session;
    this.session = null;
    if (current?.listener) this.io.unwatchFile(current.path, current.listener);
  }

  async #readAvailable(current) {
    if (this.session !== current || current.reading) return false;
    current.reading = true;
    try {
      const handle = await this.io.promises.open(current.path, 'r');
      try {
        if (this.session !== current) return false;
        const stat = await handle.stat();
        if (this.session !== current) return false;
        const identity = `${stat.dev}:${stat.ino}`;
        const rotated = stat.size < current.offset || (current.identity !== null && current.identity !== identity);
        if (rotated) {
          current.offset = 0;
          current.decoder = new StringDecoder('utf8');
          this.emit('rotate');
        }
        current.identity = identity;
        if (this.session !== current) return false;
        while (stat.size > current.offset) {
          const buffer = Buffer.alloc(Math.min(1024 * 1024, stat.size - current.offset));
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, current.offset);
          if (this.session !== current) return false;
          if (!bytesRead) throw new Error('Arena log changed during its scan. Choose or rescan the log again.');
          current.offset += bytesRead;
          const text = current.decoder.write(buffer.subarray(0, bytesRead));
          if (text) this.emit('data', text);
        }
        if (this.session !== current) return false;
        if (!current.scanned || rotated) {
          current.scanned = true;
          this.emit('scan');
          if (rotated && this.session === current) this.emit('status', { kind: 'live', message: 'Watching Arena log', path: current.path });
        }
        return this.session === current;
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (this.session === current) {
        this.stop();
        this.emit('status', { kind: 'error', message: error.message, path: current.path });
      }
      return false;
    } finally {
      current.reading = false;
    }
  }
}
module.exports = { LogTailer };
