'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { migrateLegacyUserData, rewriteLegacyPaths } = require('../src/draft-app/migrate-user-data.cjs');

function tempAppData() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pick42-migrate-'));
}

function seedLegacy(appData, { settings = null, prototypeSettings = null } = {}) {
  const legacy = path.join(appData, 'arcane-arena-companion');
  fs.mkdirSync(path.join(legacy, 'imports'), { recursive: true });
  fs.mkdirSync(path.join(legacy, 'Local Storage'), { recursive: true });
  fs.writeFileSync(path.join(legacy, 'imports', 'seventeenLands-pick-two.csv'), 'Name,GIH WR\nCard,60%\n');
  fs.writeFileSync(path.join(legacy, 'game-reviews.json'), '[]');
  fs.writeFileSync(path.join(legacy, 'Local Storage', 'ldb.marker'), 'recipe progress lives here');
  if (settings) fs.writeFileSync(path.join(legacy, 'draft-settings.json'), JSON.stringify(settings, null, 2));
  if (prototypeSettings) fs.writeFileSync(path.join(legacy, 'settings.json'), JSON.stringify(prototypeSettings, null, 2));
  return legacy;
}

test('renames the legacy directory and rewrites settings paths inside it', () => {
  const appData = tempAppData();
  const legacy = seedLegacy(appData, {
    settings: {
      logPath: '/logs/Wizards Of The Coast/MTGA/Player.log',
      seventeenLandsPath: '/downloads/card-ratings.csv',
      archetypeCorpusPath: path.join(appData, 'arcane-arena-companion', 'trophy-corpus-HOB-premier.json'),
      sourceImportPaths: {
        seventeenLands: { 'pick-two': { path: path.join(appData, 'arcane-arena-companion', 'imports', 'seventeenLands-pick-two.csv'), label: 'x.csv' } },
        untapped: {}
      },
      decoy: path.join(appData, 'arcane-arena-companion-backup', 'file.json')
    },
    prototypeSettings: { logPath: path.join(appData, 'arcane-arena-companion', 'somewhere.log') }
  });

  const result = migrateLegacyUserData({ appDataPath: appData });
  const current = path.join(appData, 'Pick 42');

  assert.equal(result.migrated, true);
  assert.equal(result.userDataPath, current);
  assert.equal(fs.existsSync(legacy), false);
  assert.equal(fs.readFileSync(path.join(current, 'Local Storage', 'ldb.marker'), 'utf8'), 'recipe progress lives here');
  assert.ok(fs.existsSync(path.join(current, 'imports', 'seventeenLands-pick-two.csv')));

  const rewritten = JSON.parse(fs.readFileSync(path.join(current, 'draft-settings.json'), 'utf8'));
  assert.equal(rewritten.logPath, '/logs/Wizards Of The Coast/MTGA/Player.log', 'paths outside the legacy dir are untouched');
  assert.equal(rewritten.seventeenLandsPath, '/downloads/card-ratings.csv');
  assert.equal(rewritten.archetypeCorpusPath, path.join(current, 'trophy-corpus-HOB-premier.json'));
  assert.equal(
    rewritten.sourceImportPaths.seventeenLands['pick-two'].path,
    path.join(current, 'imports', 'seventeenLands-pick-two.csv')
  );
  assert.equal(rewritten.decoy, path.join(appData, 'arcane-arena-companion-backup', 'file.json'), 'a sibling name sharing the prefix is not rewritten');

  const prototype = JSON.parse(fs.readFileSync(path.join(current, 'settings.json'), 'utf8'));
  assert.equal(prototype.logPath, path.join(current, 'somewhere.log'));
});

test('is a no-op when the current directory already exists', () => {
  const appData = tempAppData();
  const legacy = seedLegacy(appData);
  fs.mkdirSync(path.join(appData, 'Pick 42'));
  fs.writeFileSync(path.join(appData, 'Pick 42', 'draft-settings.json'), '{"existing":true}');

  const result = migrateLegacyUserData({ appDataPath: appData });

  assert.equal(result.migrated, false);
  assert.equal(result.reason, 'current-exists');
  assert.equal(result.userDataPath, path.join(appData, 'Pick 42'));
  assert.equal(fs.existsSync(legacy), true, 'the legacy directory is never merged or deleted');
  assert.equal(JSON.parse(fs.readFileSync(path.join(appData, 'Pick 42', 'draft-settings.json'), 'utf8')).existing, true);
});

test('a fresh install with no legacy directory points at the new location', () => {
  const appData = tempAppData();
  const result = migrateLegacyUserData({ appDataPath: appData });
  assert.equal(result.migrated, false);
  assert.equal(result.reason, 'no-legacy');
  assert.equal(result.userDataPath, path.join(appData, 'Pick 42'));
});

test('running twice migrates once and then settles', () => {
  const appData = tempAppData();
  seedLegacy(appData, { settings: { selectedBuildId: 'azorius' } });
  const first = migrateLegacyUserData({ appDataPath: appData });
  const second = migrateLegacyUserData({ appDataPath: appData });
  assert.equal(first.migrated, true);
  assert.equal(second.migrated, false);
  assert.equal(second.reason, 'current-exists');
  assert.equal(first.userDataPath, second.userDataPath);
});

test('rewriteLegacyPaths walks nested arrays and objects', () => {
  const legacy = '/data/arcane-arena-companion';
  const current = '/data/Pick 42';
  const value = {
    list: [`${legacy}/a.json`, '/elsewhere/b.json'],
    nested: { exact: legacy, number: 7, flag: true, missing: null }
  };
  assert.deepEqual(rewriteLegacyPaths(value, legacy, current), {
    list: [`${current}/a.json`, '/elsewhere/b.json'],
    nested: { exact: current, number: 7, flag: true, missing: null }
  });
});
