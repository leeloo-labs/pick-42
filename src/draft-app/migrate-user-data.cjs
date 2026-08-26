'use strict';

const fs = require('node:fs');
const path = require('node:path');

// One-time move of the legacy Arcane user-data directory to the product's own
// name. The directory is renamed in place (atomic within appData — imports,
// reviews, recipe progress in Local Storage, and caches all move together),
// and absolute paths persisted in the settings files that point inside the old
// directory are rewritten to the new one. Nothing is ever merged or
// overwritten: when the new directory already exists, the legacy one is left
// exactly as it is.

function rewriteLegacyPaths(value, legacyDir, currentDir) {
  if (typeof value === 'string') {
    if (value === legacyDir) return currentDir;
    const prefix = legacyDir + path.sep;
    return value.startsWith(prefix) ? currentDir + path.sep + value.slice(prefix.length) : value;
  }
  if (Array.isArray(value)) return value.map((entry) => rewriteLegacyPaths(entry, legacyDir, currentDir));
  if (value && typeof value === 'object') {
    const result = {};
    for (const [key, entry] of Object.entries(value)) result[key] = rewriteLegacyPaths(entry, legacyDir, currentDir);
    return result;
  }
  return value;
}

function migrateLegacyUserData({
  appDataPath,
  legacyName = 'arcane-arena-companion',
  currentName = 'Pick 42',
  settingsFiles = ['draft-settings.json', 'settings.json']
}) {
  const legacyDir = path.join(appDataPath, legacyName);
  const currentDir = path.join(appDataPath, currentName);
  if (fs.existsSync(currentDir)) return { userDataPath: currentDir, migrated: false, reason: 'current-exists' };
  if (!fs.existsSync(legacyDir)) return { userDataPath: currentDir, migrated: false, reason: 'no-legacy' };

  try {
    fs.renameSync(legacyDir, currentDir);
  } catch (error) {
    // The move failed (another instance holding files, permissions). Keep
    // running from the legacy directory rather than risk a partial copy.
    return { userDataPath: legacyDir, migrated: false, reason: `rename-failed: ${error.message}` };
  }

  for (const name of settingsFiles) {
    const settingsPath = path.join(currentDir, name);
    try {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      const rewritten = rewriteLegacyPaths(settings, legacyDir, currentDir);
      const temporary = `${settingsPath}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(rewritten, null, 2));
      fs.renameSync(temporary, settingsPath);
    } catch {
      // No such settings file, or unparseable: nothing to rewrite.
    }
  }
  return { userDataPath: currentDir, migrated: true, reason: 'renamed' };
}

module.exports = { migrateLegacyUserData, rewriteLegacyPaths };
