'use strict';

// Every start owns its offset, decoder and timer. A replaced read may finish,
// but it cannot deliver bytes or create another polling loop.
function createLogPoller({ interval = 750, onData, onRotate, onError, onScanComplete,
  schedule = setInterval, cancel = clearInterval }) {
  let session = null;
  function stop() {
    if (session?.timer != null) cancel(session.timer);
    session = null;
  }
  async function readAvailable(current) {
    if (session !== current || current.reading) return false;
    current.reading = true;
    try {
      const file = await current.handle.getFile();
      if (session !== current) return false;
      const rotated = file.size < current.offset;
      if (rotated) {
        current.offset = 0;
        current.decoder = new TextDecoder();
        onRotate?.();
      }
      if (session !== current) return false;
      if (file.size > current.offset) {
        const bytes = await file.slice(current.offset, file.size).arrayBuffer();
        if (session !== current) return false;
        current.offset += bytes.byteLength;
        const text = current.decoder.decode(bytes, { stream: true });
        if (text) onData?.(text);
      }
      if (session !== current) return false;
      if (!current.scanned || rotated) {
        current.scanned = true;
        onScanComplete?.();
      }
      return session === current;
    } catch (error) {
      if (session === current) {
        stop();
        onError?.(error);
      }
      return false;
    } finally {
      current.reading = false;
    }
  }
  return {
    async start(handle) {
      stop();
      const current = { handle, offset: 0, reading: false, scanned: false, timer: null, decoder: new TextDecoder() };
      session = current;
      if (!await readAvailable(current) || session !== current) return false;
      current.timer = schedule(() => readAvailable(current), interval);
      return true;
    },
    stop,
    active: () => Boolean(session)
  };
}
module.exports = { createLogPoller };
