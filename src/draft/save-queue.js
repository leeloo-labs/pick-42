'use strict';

// Failed writes retain their newest operation for an explicit local retry.
// A delayed older write cannot clear a newer failure for the same record.
function createSaveQueue({ onChange = () => {} } = {}) {
  const pending = new Map();
  const running = new Map();
  function save(key, label, write) {
    const entry = { key, label, write };
    pending.set(key, entry);
    const settle = (ok) => {
      if (pending.get(key) === entry) {
        if (ok) pending.delete(key);
        onChange();
      }
      return ok;
    };
    const execute = () => {
      if (pending.get(key) !== entry) return false;
      try {
        const result = write();
        return result?.then ? result.then(() => settle(true), () => settle(false)) : settle(true);
      } catch { return settle(false); }
    };
    const result = running.has(key) ? running.get(key).then(execute) : execute();
    if (result?.then) {
      running.set(key, result);
      void result.then(() => { if (running.get(key) === result) running.delete(key); });
    }
    return result;
  }
  return {
    save,
    labels: () => [...new Set([...pending.values()].map((entry) => entry.label))],
    retry: async () => { await Promise.all([...pending.values()].map((entry) => save(entry.key, entry.label, entry.write))); }
  };
}
if (typeof module !== 'undefined' && module.exports) module.exports = { createSaveQueue };
else globalThis.Pick42SaveQueue = { createSaveQueue };
