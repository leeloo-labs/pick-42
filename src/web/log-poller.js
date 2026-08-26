'use strict';

// Browser counterpart of the fs LogTailer: polls a File System Access handle
// and reads only the appended bytes. Same event shape — data chunks, a rotate
// signal when the file shrinks, and an initial full read on start.
function createLogPoller({ interval = 750, onData, onRotate, onError }) {
  let handle = null;
  let offset = 0;
  let timer = null;
  let reading = false;

  async function readAvailable() {
    if (!handle || reading) return;
    reading = true;
    try {
      const file = await handle.getFile();
      if (file.size < offset) {
        offset = 0;
        onRotate?.();
      }
      if (file.size > offset) {
        const text = await file.slice(offset).text();
        offset = file.size;
        if (text) onData?.(text);
      }
    } catch (error) {
      onError?.(error);
    } finally {
      reading = false;
    }
  }

  return {
    async start(fileHandle) {
      this.stop();
      handle = fileHandle;
      offset = 0;
      await readAvailable();
      timer = setInterval(readAvailable, interval);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      handle = null;
      offset = 0;
    },
    active: () => Boolean(handle)
  };
}

module.exports = { createLogPoller };
