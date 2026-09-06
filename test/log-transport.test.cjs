'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createLogPoller } = require('../src/web/log-poller.js');
const { LogTailer } = require('../src/core/log-tailer.cjs');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

function harness(kind) {
  const data = [], events = [], loops = new Map();
  let next = 0, closed = 0;
  const files = new Map();
  const put = (name, bytes, extra = {}) => files.set(name, { bytes: Buffer.from(bytes), inode: 1, ...extra });
  const get = async (name) => {
    const file = files.get(name);
    if (!file) throw new Error('Missing log');
    await file.pending?.promise;
    if (file.error) throw file.error;
    return file;
  };
  let transport, start;
  if (kind === 'browser') {
    transport = createLogPoller({
      onData: (text) => data.push(text), onRotate: () => events.push('rotate'),
      onScanComplete: () => events.push('scan'), onError: () => events.push('error'),
      schedule: (fn) => { loops.set(++next, fn); return next; }, cancel: (id) => loops.delete(id)
    });
    start = (name) => transport.start({ getFile: async () => {
      const file = await get(name);
      return { size: file.bytes.length, slice: (from, to) => ({ arrayBuffer: async () => {
        await file.readPending?.promise;
        return Uint8Array.from(file.bytes.subarray(from, to)).buffer;
      } }) };
    } });
  } else {
    transport = new LogTailer({ io: {
      promises: { open: async (name) => {
        const file = await get(name);
        return {
          stat: async () => ({ size: file.bytes.length, dev: 1, ino: file.inode }),
          read: async (buffer, offset, length, position) => {
            await file.readPending?.promise;
            const bytesRead = file.bytes.copy(buffer, offset, position, position + Math.min(length, file.maxRead || length));
            return { bytesRead };
          },
          close: async () => { closed += 1; }
        };
      } },
      watchFile: (path, options, fn) => loops.set(path, fn),
      unwatchFile: (path, fn) => { if (loops.get(path) === fn) loops.delete(path); }
    } });
    transport.on('data', (text) => data.push(text));
    transport.on('rotate', () => events.push('rotate'));
    transport.on('scan', () => events.push('scan'));
    transport.on('status', (status) => { if (status.kind === 'error') events.push('error'); });
    start = (name) => transport.start(name);
  }
  return { data, events, loops, put, start, stop: () => transport.stop(), closed: () => closed,
    tick: async () => { for (const fn of [...loops.values()]) await fn(); } };
}

for (const kind of ['browser', 'desktop']) {
  test(`${kind}: replaced initial reads cannot feed data, arm review, or create a second loop`, async () => {
    const h = harness(kind), pending = deferred();
    h.put('old', 'old log', { pending }); h.put('new', 'new log');
    const old = h.start('old');
    assert.equal(await h.start('new'), true);
    pending.resolve();
    assert.equal(await old, false);
    assert.deepEqual(h.data, ['new log']);
    assert.deepEqual(h.events, ['scan']);
    assert.equal(h.loops.size, 1);
    h.stop(); assert.equal(h.loops.size, 0);
  });
  test(`${kind}: stop during byte reads discards data and closes the session`, async () => {
    const h = harness(kind), readPending = deferred();
    h.put('log', 'delayed', { readPending });
    const reading = h.start('log');
    // Allow getFile/open and stat to resolve before stopping.
    for (let i = 0; i < 6; i++) await Promise.resolve();
    h.stop(); readPending.resolve();
    assert.equal(await reading, false);
    assert.deepEqual(h.data, []); assert.deepEqual(h.events, []); assert.equal(h.loops.size, 0);
    if (kind === 'desktop') assert.equal(h.closed(), 1);
  });
  test(`${kind}: initial access failures never complete a scan or keep polling`, async () => {
    const h = harness(kind);
    assert.equal(await h.start('missing'), false);
    assert.deepEqual(h.events, ['error']); assert.equal(h.loops.size, 0);
  });
  test(`${kind}: revoked access stops polling and obsolete errors stay silent`, async () => {
    const h = harness(kind), pending = deferred();
    h.put('old', 'old', { pending, error: new Error('revoked') }); h.put('new', 'new');
    const old = h.start('old'); await h.start('new'); pending.resolve(); await old;
    assert.deepEqual(h.events, ['scan']);
    h.put('new', '', { error: new Error('revoked') }); await h.tick();
    assert.deepEqual(h.events, ['scan', 'error']); assert.equal(h.loops.size, 0);
  });
  test(`${kind}: UTF-8 characters survive append boundaries and rotation resets decoding`, async () => {
    const h = harness(kind), bytes = Buffer.from('Fíli 🧙');
    h.put('log', bytes.subarray(0, 2)); await h.start('log');
    h.put('log', bytes.subarray(0, bytes.length - 2)); await h.tick();
    h.put('log', bytes); await h.tick();
    assert.equal(h.data.join(''), 'Fíli 🧙');
    h.put('log', 'new'); await h.tick();
    assert.deepEqual(h.events, ['scan', 'rotate', 'scan']);
    assert.equal(h.data.at(-1), 'new'); h.stop();
  });
}

test('desktop: replacement with the same size is a new log and short reads finish before scan', async () => {
  const h = harness('desktop');
  h.put('log', 'first', { maxRead: 2 }); await h.start('log');
  assert.equal(h.data.join(''), 'first'); assert.deepEqual(h.events, ['scan']);
  h.put('log', 'other', { inode: 2, maxRead: 1 }); await h.tick();
  assert.equal(h.data.join(''), 'firstother'); assert.deepEqual(h.events, ['scan', 'rotate', 'scan']); h.stop();
});
