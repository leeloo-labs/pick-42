'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

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
function createLocalStore(userDataPath) {
  const settingsPath = () => path.join(userDataPath, 'draft-settings.json');
  const gameReviewsPath = () => path.join(userDataPath, 'game-reviews.json');

  const readSettings = () => {
    try { return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')); } catch { return {}; }
  };

  return {
    settingsPath,
    gameReviewsPath,
    manualArchetypeCorpusPath: () => path.join(userDataPath, 'manual-archetype-corpus.json'),
    scryfallCachePath: (fileName) => path.join(userDataPath, fileName),
    importedCsvStoragePath: (source, format) => path.join(userDataPath, 'imports', `${source}-${format}.csv`),
    readSettings,
    writeSettings: (patch) => writeJsonAtomic(settingsPath(), { ...readSettings(), ...patch }),
    readGameReviews: () => {
      try { return JSON.parse(fs.readFileSync(gameReviewsPath(), 'utf8')); } catch { return []; }
    },
    writeGameReviews: (reviews) => writeJsonAtomic(gameReviewsPath(), reviews)
  };
}

module.exports = { createLocalStore, defaultLogCandidates, writeFileAtomic, writeJsonAtomic };
