'use strict';

// The web shell: drives the shared draft companion with browser adapters —
// localStorage persistence, File System Access log polling, file pickers for
// imports, and fetch for Scryfall — and exposes the same window.draftCompanion
// surface the Electron preload provides, so the renderer runs unchanged.
const { createDraftCompanion } = require('../draft-app/companion.cjs');
const { SOURCE_FORMATS, SOURCE_FORMAT_LABELS, createSourceImportStore } = require('../draft-app/source-imports.cjs');
const { createCorpusStore } = require('../draft-app/corpus-store.cjs');
const { DEFAULT_SET_CODE, setDefinition, untappedCardDataUrl } = require('../draft/set-definitions.cjs');
const { fetchScryfallSet } = require('../draft/scryfall.cjs');
const { extractTrophyDecksFromGameData, isSeventeenLandsGameData } = require('../draft/seventeenlands-dataset.cjs');
const { createLogPoller } = require('./log-poller.js');
const { fileLineSource } = require('./file-lines.js');
const { loadData, loadHandle, saveData, saveHandle } = require('./handle-store.js');
const demoCatalogFixture = require('../../fixtures/demo-draft-cards.json');
// Bundled sample data must be statically imported; mirror set-definitions'
// sampleFixtures when the active set changes.
const sampleSeventeenLandsCsv = require('../../fixtures/sample-17lands-hob.csv');
const sampleUntappedCsv = require('../../fixtures/sample-untapped-hob.csv');

const asText = (module_) => (typeof module_ === 'string' ? module_ : module_?.default ?? '');
const ACTIVE_SET = setDefinition(DEFAULT_SET_CODE);
const SCRYFALL_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const storageKey = (...parts) => ['pick42', ...parts].join(':');

const readStoredJson = (key, fallback = null) => {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
};

const writeStoredJson = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota or private-mode failure: the session keeps working in memory.
  }
};

const demoCatalog = demoCatalogFixture.default ?? demoCatalogFixture;
const catalog = { ...demoCatalog };
const catalogInfo = { count: 0, source: null };

const sourceStore = createSourceImportStore();
const corpusStore = createCorpusStore({
  catalog,
  manualStoragePath: () => storageKey('manual-corpus'),
  setCodeExample: ACTIVE_SET.displayCode,
  io: {
    readText: (key) => localStorage.getItem(key) ?? 'null',
    writeJson: writeStoredJson
  }
});

let companion = null;
let watchedLogName = null;
let lastLogActivityAt = null;
let webCompactBuildMode = false;
const stateHandlers = new Set();

function buildCatalogFromScryfall(payload) {
  const entries = {};
  for (const card of payload?.cards || []) {
    if (!card.arenaId) continue;
    entries[String(card.arenaId)] = {
      name: card.name,
      manaCost: card.manaCost || '',
      typeLine: card.typeLine || '',
      rulesText: card.oracleText || '',
      printedPower: card.power ?? null,
      printedToughness: card.toughness ?? null
    };
  }
  return entries;
}

const scryfallCacheKey = storageKey('scryfall', ACTIVE_SET.code);

const scryfallAdapter = {
  readCache: () => {
    const cached = readStoredJson(scryfallCacheKey);
    return cached?.cards?.length ? cached : null;
  },
  load: async () => {
    const cached = scryfallAdapter.readCache();
    let payload;
    if (cached && Date.now() - (cached.fetchedAt || 0) < SCRYFALL_CACHE_TTL_MS) {
      payload = { ...cached, source: 'cache' };
    } else {
      payload = { ...(await fetchScryfallSet({ setCode: ACTIVE_SET.scryfallSetCode })), source: 'network' };
      writeStoredJson(scryfallCacheKey, payload);
    }
    // Scryfall's arena ids double as the live-draft card catalog: the web has
    // no Arena installation to read, so the set payload fills that role.
    const added = companion.augmentCatalog(buildCatalogFromScryfall(payload));
    if (added || !catalogInfo.source) {
      catalogInfo.count = Object.keys(catalog).length;
      catalogInfo.source = 'Scryfall arena ids';
    }
    return payload;
  }
};

const poller = createLogPoller({
  onData: (text) => {
    lastLogActivityAt = Date.now();
    companion.feedLog(text);
  },
  onRotate: () => companion.logRotated(),
  onError: () => {
    poller.stop();
    watchedLogName = null;
    companion.setStatus({ kind: 'error', message: 'Lost access to Player.log · choose the file again' });
  }
});

companion = createDraftCompanion({
  catalog,
  demoCatalog,
  catalogInfo,
  activeSet: ACTIVE_SET,
  sourceStore,
  corpusStore,
  settings: {
    read: () => readStoredJson(storageKey('settings'), {}) || {},
    write: (patch) => writeStoredJson(storageKey('settings'), { ...(readStoredJson(storageKey('settings'), {}) || {}), ...patch })
  },
  reviews: {
    read: () => readStoredJson(storageKey('reviews'), []) || [],
    write: (reviews) => writeStoredJson(storageKey('reviews'), reviews)
  },
  scryfall: scryfallAdapter,
  describeLog: () => ({
    path: watchedLogName,
    source: watchedLogName ? 'custom' : 'none',
    lastActivityAt: lastLogActivityAt,
    standardAvailable: false
  }),
  arenaExtras: () => ({ compactBuildMode: webCompactBuildMode, buildModeSource: webCompactBuildMode ? 'manual' : null }),
  onState: () => {
    const model = companion.viewModel();
    for (const handler of stateHandlers) handler(model);
  },
  onDemoStart: () => {
    poller.stop();
    watchedLogName = null;
  }
});

async function pickFile({ description, accept }) {
  if (!window.showOpenFilePicker) {
    companion.setStatus({ kind: 'error', message: 'This browser cannot open local files live. Use Chrome or Edge.' });
    return null;
  }
  try {
    const [handle] = await window.showOpenFilePicker({ types: [{ description, accept }], multiple: false });
    return handle || null;
  } catch {
    return null; // The user cancelled the picker.
  }
}

const LOG_HANDLE_KEY = 'player-log';
let watchedLogHandle = null;

// Cards the catalog cannot name render as "Arena card <id>"; say how to fix it.
function watchingStatusMessage() {
  const unresolved = companion.draftState().pool.filter((card) => /^Arena card \d+$/.test(card.name)).length;
  return unresolved
    ? `Watching Arena log · ${unresolved} cards need names — drag arena-card-catalog.json from the Pick 42 data folder`
    : 'Watching Arena log';
}

async function watchLogHandle(handle, { remember = true } = {}) {
  watchedLogHandle = handle;
  watchedLogName = handle.name;
  companion.beginLogSession();
  companion.setStatus({ kind: 'loading', message: 'Scanning Arena draft events', path: handle.name });
  await poller.start(handle);
  companion.completeLogScan();
  companion.setStatus({ kind: 'live', message: watchingStatusMessage(), path: handle.name });
  if (remember) void saveHandle(LOG_HANDLE_KEY, handle);
}

// Resume the remembered Player.log when the browser lets us: silently when the
// permission survived, otherwise only from a user gesture (the LOG menu).
async function resumeStoredLog({ gesture }) {
  const handle = await loadHandle(LOG_HANDLE_KEY);
  if (!handle) return false;
  try {
    let permission = await handle.queryPermission({ mode: 'read' });
    if (permission === 'prompt' && gesture) permission = await handle.requestPermission({ mode: 'read' });
    if (permission !== 'granted') return false;
    await watchLogHandle(handle, { remember: false });
    return true;
  } catch {
    return false;
  }
}

const importStorageKey = (source, format) => storageKey('import', source, format);

function rememberWebImport(source, format, label, text) {
  const data = sourceStore.parse(source, text);
  sourceStore.remember(source, label, format, label, data);
  writeStoredJson(importStorageKey(source, format), { label, text });
  return data;
}

function restorePersistedData() {
  for (const source of ['seventeenLands', 'untapped']) {
    for (const format of SOURCE_FORMATS) {
      const saved = readStoredJson(importStorageKey(source, format));
      if (!saved?.text) continue;
      try {
        sourceStore.remember(source, saved.label || 'import', format, saved.label, sourceStore.parse(source, saved.text));
      } catch { /* Skip an import that no longer parses. */ }
    }
  }
  const corpus = readStoredJson(storageKey('corpus'));
  if (corpus?.text) {
    try { corpusStore.loadImportedText(corpus.text, corpus.label || 'corpus'); } catch { /* Skip a stale corpus. */ }
  }
}

const CATALOG_DATA_KEY = 'arena-catalog';

function applyArenaCatalog(payload) {
  // The desktop's Arena database is authoritative: it overwrites the bundled
  // sample entries so live drafts show Arena's real names, and the parsers see
  // the change through the shared catalog object.
  Object.assign(catalog, payload.cards);
  catalogInfo.count = Object.keys(catalog).length;
  catalogInfo.source = payload.source || 'Imported Arena catalog';
}

// An arena-card-catalog.json exported by the desktop app: apply it, remember
// it, and re-read a watched log so the current draft picks up real names.
async function importArenaCatalog(payload) {
  applyArenaCatalog(payload);
  await saveData(CATALOG_DATA_KEY, payload);
  const cardCount = Object.keys(payload.cards || {}).length.toLocaleString();
  if (poller.active() && watchedLogHandle) {
    await watchLogHandle(watchedLogHandle, { remember: false });
    companion.setStatus({ kind: 'live', message: `${cardCount} Arena card names imported · log re-read`, path: watchedLogName });
  } else {
    companion.setStatus({ kind: 'live', message: `${cardCount} Arena card names imported` });
  }
}

// Shared by the corpus picker and the console test seam. A 17Lands game-data
// export (plain or .gz, inflated via DecompressionStream) is processed into a
// trophy corpus exactly like the desktop shell; anything else imports as a
// normalized corpus file.
async function importCorpusFromFile(file) {
  if (await isSeventeenLandsGameData(fileLineSource(file))) {
    companion.setStatus({ kind: 'live', message: 'Processing 17Lands game data · deriving event records' });
    const extraction = await extractTrophyDecksFromGameData(fileLineSource(file), {
      onProgress: ({ phase, games }) => companion.setStatus({
        kind: 'live',
        message: phase === 'records'
          ? `Processing 17Lands game data · ${games.toLocaleString()} games scanned`
          : 'Processing 17Lands game data · reconstructing trophy decks'
      })
    });
    const label = `trophy-corpus-${extraction.setCode}-${extraction.format}.json`;
    const text = JSON.stringify({
      source: `17Lands public dataset · ${file.name}`,
      license: 'Processed offline from the 17Lands public datasets (17lands.com/public_datasets)',
      generatedAt: new Date().toISOString(),
      decks: extraction.decks
    });
    corpusStore.loadImportedText(text, label);
    writeStoredJson(storageKey('corpus'), { label, text });
    companion.setStatus({
      kind: 'live',
      message: `${extraction.decks.length} ${extraction.setCode} trophy decks derived from ${extraction.scanned.games.toLocaleString()} games`
    });
    return;
  }
  const text = await file.text();
  corpusStore.loadImportedText(text, file.name);
  writeStoredJson(storageKey('corpus'), { label: file.name, text });
  companion.setStatus({ kind: 'live', message: `${corpusStore.sourceInfo().trophyCount} trophy exemplars imported` });
}

const EXTERNAL_LINKS = {
  seventeenLandsCardData: 'https://www.17lands.com/card_data',
  seventeenLandsTrophies: 'https://www.17lands.com/trophy_decks',
  untappedCardData: untappedCardDataUrl(ACTIVE_SET.code)
};

// A one-time read of a dropped log for engines that cannot hand out a live
// handle: the whole file feeds through the normal session once, and the user
// drops it again for a refresh.
async function importLogSnapshot(file) {
  poller.stop();
  watchedLogHandle = null;
  watchedLogName = `${file.name} (snapshot)`;
  companion.beginLogSession();
  companion.setStatus({ kind: 'loading', message: 'Reading the dropped Arena log' });
  companion.feedLog(await file.text());
  companion.completeLogScan();
  lastLogActivityAt = Date.now();
  const unresolved = companion.draftState().pool.filter((card) => /^Arena card \d+$/.test(card.name)).length;
  companion.setStatus({
    kind: 'live',
    message: unresolved
      ? `Read ${file.name} once · ${unresolved} cards need names — drag arena-card-catalog.json from the Pick 42 data folder`
      : `Read ${file.name} once · drop it again after more games for a refresh`
  });
}

// Dropped files route by what they are: Arena's log becomes the watched
// session, corpus files (including the desktop app's
// manual-archetype-corpus.json and 17Lands game-data exports) import as a
// trophy corpus, and ratings CSVs are pointed at the source buttons, which
// need a draft-type slot a drop cannot choose.
async function routeDroppedFile(file, handlePromise) {
  const name = file?.name || '';
  if (/\.(log|txt)$/i.test(name)) {
    const handle = await handlePromise;
    if (handle?.kind === 'file') await watchLogHandle(handle);
    else if (file) await importLogSnapshot(file);
    return;
  }
  if (/\.json$/i.test(name)) {
    const parsed = JSON.parse(await file.text());
    if (parsed && parsed.cards && !parsed.decks) {
      await importArenaCatalog(parsed);
      return;
    }
    await importCorpusFromFile(file);
    return;
  }
  if (/\.gz$/i.test(name)) {
    await importCorpusFromFile(file);
    return;
  }
  if (/\.csv$/i.test(name)) {
    if (await isSeventeenLandsGameData(fileLineSource(file))) {
      await importCorpusFromFile(file);
      return;
    }
    const headerLine = (await file.slice(0, 4096).text()).split('\n')[0] || '';
    if (/^deck id,/i.test(headerLine.replace(/^﻿/, ''))) {
      await importCorpusFromFile(file);
      return;
    }
    companion.setStatus({ kind: 'error', message: 'Ratings CSVs need a draft-type slot · use the 17L or UT buttons to import this file' });
    return;
  }
  companion.setStatus({ kind: 'error', message: 'Drop Player.log or a trophy-corpus file (.json, .csv, .gz)' });
}

// Drag-and-drop is the reliable way to hand the web shell Arena's log and the
// desktop app's corpus files: Chromium's file pickers refuse the folders they
// live in (~/Library on macOS, AppData on Windows), but handles delivered by a
// drop deliberately bypass that blocklist.
function installDropTarget() {
  const overlay = document.createElement('div');
  overlay.className = 'drop-overlay';
  const label = document.createElement('div');
  label.textContent = 'Drop Player.log to watch drafts · drop a corpus file to import trophy decks';
  overlay.append(label);
  document.body.append(overlay);

  let depth = 0;
  const hide = () => {
    depth = 0;
    overlay.classList.remove('active');
  };
  window.addEventListener('dragenter', (event) => {
    event.preventDefault();
    depth += 1;
    overlay.classList.add('active');
  });
  window.addEventListener('dragover', (event) => event.preventDefault());
  window.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (!depth) overlay.classList.remove('active');
  });
  window.addEventListener('drop', (event) => {
    event.preventDefault();
    hide();
    // Both accessors must be called synchronously, before the event settles.
    // Some drag sources populate files but not items; take whichever exists.
    const item = event.dataTransfer?.items?.[0];
    const file = (item?.kind === 'file' ? item.getAsFile() : null) || event.dataTransfer?.files?.[0] || null;
    if (!file) {
      companion.setStatus({ kind: 'error', message: 'Nothing droppable was received · drop a file from Finder or Explorer' });
      return;
    }
    const handlePromise = item && typeof item.getAsFileSystemHandle === 'function'
      ? item.getAsFileSystemHandle().catch(() => null)
      : Promise.resolve(null);
    void (async () => {
      try {
        await routeDroppedFile(file, handlePromise);
      } catch (error) {
        console.warn('Pick 42 drop failed:', error);
        companion.setStatus({ kind: 'error', message: `Could not read the dropped file · ${error.message}` });
      }
    })();
  });
}

window.draftCompanion = {
  bootstrap: async () => companion.viewModel(),
  importSource: async (source, format) => {
    if (!['seventeenLands', 'untapped'].includes(source)) throw new Error('Unknown draft data source.');
    const formatKey = SOURCE_FORMATS.includes(format) ? format : 'any';
    const handle = await pickFile({ description: 'CSV export', accept: { 'text/csv': ['.csv'] } });
    if (!handle) return companion.viewModel();
    try {
      const text = await (await handle.getFile()).text();
      const sourceName = source === 'seventeenLands' ? '17Lands' : 'Untapped';
      const data = rememberWebImport(source, formatKey, handle.name, text);
      companion.setStatus({ kind: 'live', message: `${sourceName} · ${SOURCE_FORMAT_LABELS[formatKey]} · ${data.length} rows imported` });
    } catch (error) {
      companion.setStatus({ kind: 'error', message: error.message });
    }
    return companion.viewModel();
  },
  importArchetypeCorpus: async () => {
    const handle = await pickFile({
      description: 'Corpus, or a 17Lands game-data export',
      accept: { 'application/json': ['.json'], 'text/csv': ['.csv'], 'application/gzip': ['.gz'] }
    });
    if (!handle) return companion.viewModel();
    try {
      await importCorpusFromFile(await handle.getFile());
    } catch (error) {
      companion.setStatus({ kind: 'error', message: error.message });
    }
    return companion.viewModel();
  },
  addTrophyDeck: async (payload) => {
    try {
      companion.addTrophyDeck(payload);
    } catch (error) {
      companion.setStatus({ kind: 'error', message: error.message });
      throw error;
    }
    return companion.viewModel();
  },
  removeTrophyDeck: async (deckId) => {
    companion.removeTrophyDeck(deckId);
    return companion.viewModel();
  },
  readClipboard: async () => {
    try {
      return { text: await navigator.clipboard.readText() };
    } catch {
      return { text: '' };
    }
  },
  chooseLog: async () => {
    // A remembered handle resumes on this click's gesture; the picker only
    // opens when nothing is remembered, permission is refused, or the
    // remembered file is already being watched (the user wants a new one).
    if (!poller.active() && await resumeStoredLog({ gesture: true })) return companion.viewModel();
    const handle = await pickFile({ description: 'Arena Player.log', accept: { 'text/plain': ['.log', '.txt'] } });
    if (handle) await watchLogHandle(handle);
    return companion.viewModel();
  },
  useStandardLog: async () => {
    companion.setStatus({
      kind: 'error',
      message: 'The web app cannot find Player.log on its own · drag the file onto this window, or choose it via BROWSE'
    });
    return companion.viewModel();
  },
  setLanePreference: async (mode) => companion.setLanePreference(mode),
  setManualRecord: async (record) => companion.setManualRecord(record),
  setPoolCardExcluded: async (cardName, excluded) => companion.setPoolCardExcluded(cardName, excluded),
  startDemo: async (mode) => {
    companion.startDemo(mode);
    return companion.viewModel();
  },
  advanceDemo: async () => {
    companion.advanceDemo();
    return companion.viewModel();
  },
  pickPairFor: async (cardName) => companion.pickPairFor(cardName),
  selectBuild: async (buildId) => companion.selectBuild(buildId),
  copySearch: async (text) => {
    const value = String(text || '').trim().slice(0, 200);
    if (value) {
      try { await navigator.clipboard.writeText(value); } catch { /* Clipboard denied; the copy chip simply has no effect. */ }
    }
    return { copied: value };
  },
  toggleVisualGuide: async () => companion.viewModel(),
  scanVisualGuide: async () => companion.viewModel(),
  openScreenSettings: async () => {},
  openLink: async (key) => {
    const url = EXTERNAL_LINKS[String(key || '')];
    if (url) window.open(url, '_blank', 'noopener');
    return Boolean(url);
  },
  enterBuildMode: async () => {
    webCompactBuildMode = true;
    companion.notify();
    return companion.viewModel();
  },
  exitBuildMode: async () => {
    webCompactBuildMode = false;
    companion.notify();
    return companion.viewModel();
  },
  minimize: async () => {},
  close: async () => {},
  onState: (handler) => {
    stateHandlers.add(handler);
    return () => stateHandlers.delete(handler);
  },
  onRecipeCommand: () => () => {}
};

// Boot: samples, persisted preferences and data, then the remembered log when
// its permission survived the visit, otherwise the sample draft.
sourceStore.setSamples({
  seventeenLands: sourceStore.parse('seventeenLands', asText(sampleSeventeenLandsCsv)),
  untapped: sourceStore.parse('untapped', asText(sampleUntappedCsv))
});
corpusStore.readManual();
companion.hydrate();
restorePersistedData();
installDropTarget();
void (async () => {
  // The remembered catalog must be in place before the log replays, so the
  // resumed draft resolves real names on the first parse.
  const storedCatalog = await loadData(CATALOG_DATA_KEY);
  if (storedCatalog?.cards) applyArenaCatalog(storedCatalog);
  if (await resumeStoredLog({ gesture: false })) return;
  const remembered = await loadHandle(LOG_HANDLE_KEY);
  companion.startDemo();
  if (remembered) {
    companion.setStatus({
      kind: 'demo',
      message: `Sample draft active · click LOG ▸ BROWSE to resume watching ${remembered.name}`
    });
  }
})();
void companion.initializeScryfall();

// Console access for debugging and fixture-driven testing.
window.__pick42 = { companion, sourceStore, corpusStore, importCorpusFromFile };
