'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSaveQueue } = require('../draft/save-queue.js');

// Where Arena writes Player.log on each platform, most likely first.
function defaultLogCandidates() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    return [path.join(process.env.USERPROFILE || home, 'AppData', 'LocalLow', 'Wizards Of The Coast', 'MTGA', 'Player.log')];
  }
  if (process.platform === 'darwin') {
    return [
      path.join(home, 'Library', 'Logs', 'Wizards Of The Coast', 'MTGA', 'Player.log'),
      path.join(home, 'Library', 'Application Support', 'com.wizards.mtga', 'Player.log')
    ];
  }
  return [path.join(home, '.local', 'share', 'Steam', 'steamapps', 'compatdata', '2141910', 'pfx', 'drive_c', 'users', 'steamuser', 'AppData', 'LocalLow', 'Wizards Of The Coast', 'MTGA', 'Player.log')];
}

// A kill or crash mid-write must never truncate a local store: writing a settings
// file partially once flattened every saved preference on the next merge-write.
function writeFileAtomic(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, contents);
  fs.renameSync(temporary, filePath);
}

function writeJsonAtomic(filePath, value) {
  writeFileAtomic(filePath, JSON.stringify(value, null, 2));
}

// Every file Pick 42 persists lives under one user-data directory; this owns the
// paths and the read/merge-write conventions so callers cannot diverge on either.
function createLocalStore(userDataPath, { onSaveChange = () => {}, writeJson = writeJsonAtomic } = {}) {
  const queue = createSaveQueue({ onChange: onSaveChange });
  const memory = new Map();
  const save = (key, label, value) => {
    memory.set(key, value);
    return queue.save(key, label, () => writeJson(key, value));
  };
  const settingsPath = () => path.join(userDataPath, 'draft-settings.json');
  const decisionsPath = () => path.join(userDataPath, 'draft-decisions.json');
  const gameReviewsPath = () => path.join(userDataPath, 'game-reviews.json');

  const readSettings = () => {
    if (memory.has(settingsPath())) return memory.get(settingsPath());
    try { return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')); } catch { return {}; }
  };

  return {
    persistence: { labels: queue.labels, retry: queue.retry },
    writeJsonResource: (filePath, value, label) => save(filePath, label, value),
    writeTextResource: (filePath, text, label) => queue.save(filePath, label, () => writeFileAtomic(filePath, text)),
    restoredCorpusPath: () => path.join(userDataPath, 'restored-archetype-corpus.json'),
    decisionsPath,
    readDecisions: () => {
      if (memory.has(decisionsPath())) return memory.get(decisionsPath());
      try { return JSON.parse(fs.readFileSync(decisionsPath(), 'utf8')); } catch { return null; }
    },
    writeDecisions: (value) => save(decisionsPath(), 'draft decisions', value),
    settingsPath,
    gameReviewsPath,
    manualArchetypeCorpusPath: () => path.join(userDataPath, 'manual-archetype-corpus.json'),
    scryfallCachePath: (fileName) => path.join(userDataPath, fileName),
    importedCsvStoragePath: (source, format, setCode) => path.join(userDataPath, 'imports', ...(/^[a-z0-9]{1,12}$/i.test(setCode || '') ? [setCode.toLowerCase()] : []), `${source}-${format}.csv`),
    readSettings,
    writeSettings: (patch) => save(settingsPath(), 'preferences', { ...readSettings(), ...patch }),
    readGameReviews: () => {
      if (memory.has(gameReviewsPath())) return memory.get(gameReviewsPath());
      try { return JSON.parse(fs.readFileSync(gameReviewsPath(), 'utf8')); } catch { return []; }
    },
    writeGameReviews: (reviews) => save(gameReviewsPath(), 'game reviews', reviews)
  };
}

module.exports = { createLocalStore, defaultLogCandidates, writeFileAtomic, writeJsonAtomic };
