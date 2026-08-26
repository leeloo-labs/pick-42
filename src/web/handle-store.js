'use strict';

// FileSystemHandle objects survive structured cloning into IndexedDB, which is
// the only way to remember the user's Player.log across visits. localStorage
// cannot hold them, so this tiny store exists solely for handles.
const DB_NAME = 'pick42';
const STORE = 'handles';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, run) {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      const request = run(transaction.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

async function loadHandle(key) {
  try {
    return (await withStore('readonly', (store) => store.get(key))) || null;
  } catch {
    return null;
  }
}

async function saveHandle(key, handle) {
  try {
    await withStore('readwrite', (store) => store.put(handle, key));
  } catch {
    // Private mode or blocked storage: the session still works, unpersisted.
  }
}

async function clearHandle(key) {
  try {
    await withStore('readwrite', (store) => store.delete(key));
  } catch {
    // Nothing to clear.
  }
}

module.exports = { loadHandle, saveHandle, clearHandle };
