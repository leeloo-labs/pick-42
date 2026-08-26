'use strict';

// IndexedDB for what localStorage cannot hold: FileSystemHandle objects (which
// survive structured cloning, and are the only way to remember Player.log
// across visits) and payloads past the localStorage quota, like the multi-MB
// Arena card catalog exported by the desktop app.
const DB_NAME = 'pick42';
const DB_VERSION = 2;
const STORES = ['handles', 'data'];

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      for (const name of STORES) {
        if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(storeName, mode, run) {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      const request = run(transaction.objectStore(storeName));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

async function loadHandle(key) {
  try {
    return (await withStore('handles', 'readonly', (store) => store.get(key))) || null;
  } catch {
    return null;
  }
}

async function saveHandle(key, handle) {
  try {
    await withStore('handles', 'readwrite', (store) => store.put(handle, key));
  } catch {
    // Private mode or blocked storage: the session still works, unpersisted.
  }
}

async function clearHandle(key) {
  try {
    await withStore('handles', 'readwrite', (store) => store.delete(key));
  } catch {
    // Nothing to clear.
  }
}

async function loadData(key) {
  try {
    return (await withStore('data', 'readonly', (store) => store.get(key))) ?? null;
  } catch {
    return null;
  }
}

async function saveData(key, value) {
  try {
    await withStore('data', 'readwrite', (store) => store.put(value, key));
  } catch {
    // Private mode or blocked storage: the session still works, unpersisted.
  }
}

module.exports = { clearHandle, loadData, loadHandle, saveData, saveHandle };
