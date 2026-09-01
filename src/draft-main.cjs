'use strict';

const { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, screen, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_SET_CODE, scryfallCacheFileName, setDefinition, untappedCardDataUrl } = require('./draft/set-definitions.cjs');
const { createLocalStore, defaultLogCandidates, writeFileAtomic, writeJsonAtomic } = require('./draft-app/local-store.cjs');
const { migrateLegacyUserData } = require('./draft-app/migrate-user-data.cjs');
const { SOURCE_FORMATS, SOURCE_FORMAT_LABELS, createSourceImportStore } = require('./draft-app/source-imports.cjs');
const { createCorpusStore } = require('./draft-app/corpus-store.cjs');
const { createDraftCompanion } = require('./draft-app/companion.cjs');
const { loadScryfallSet, readScryfallCache } = require('./draft/scryfall.cjs');
const { extractTrophyDecksFromGameData, isSeventeenLandsGameData } = require('./draft/seventeenlands-dataset.cjs');
const { loadArenaCardCatalog } = require('./core/card-catalog.cjs');
const { LogTailer } = require('./core/log-tailer.cjs');
const { VisualGuideController } = require('./draft/visual-guide-controller.cjs');

app.setName('Pick 42');
// Move the legacy Arcane-era user data (imports, reviews, recipe progress) to
// the product's own directory once; a failed move keeps using the legacy path.
const migration = migrateLegacyUserData({ appDataPath: app.getPath('appData') });
if (migration.migrated) console.log(`Migrated user data to ${migration.userDataPath}`);
else if (migration.reason.startsWith('rename-failed')) console.warn(`User-data migration skipped · ${migration.reason}`);
app.setPath('userData', migration.userDataPath);

const projectRoot = path.resolve(__dirname, '..');
const fixturePath = (...parts) => path.join(projectRoot, 'fixtures', ...parts);
const demoCatalog = JSON.parse(fs.readFileSync(fixturePath('demo-draft-cards.json'), 'utf8'));
const arenaCatalogResult = loadArenaCardCatalog();
// Keep demo cards as a fallback, but preserve Arena's richer localized rules text in live drafts.
const catalog = { ...demoCatalog, ...arenaCatalogResult.catalog };
const tailer = new LogTailer();

const ACTIVE_SET = setDefinition(DEFAULT_SET_CODE);
const store = createLocalStore(app.getPath('userData'));
const { readSettings, writeSettings, readGameReviews, writeGameReviews, manualArchetypeCorpusPath } = store;
const scryfallCachePath = (setCode = ACTIVE_SET.code) => store.scryfallCachePath(scryfallCacheFileName(setCode));
// Imports are copied into the app's own storage so they keep working after the
// original download is moved, deleted, or blocked by macOS folder permissions.
const importedCsvStoragePath = store.importedCsvStoragePath;
const sourceStore = createSourceImportStore();
const corpusStore = createCorpusStore({ catalog, manualStoragePath: manualArchetypeCorpusPath, setCodeExample: ACTIVE_SET.displayCode });
const loadSampleSources = () => sourceStore.loadSamples({
  seventeenLands: fixturePath(ACTIVE_SET.sampleFixtures.seventeenLands),
  untapped: fixturePath(ACTIVE_SET.sampleFixtures.untapped)
});

let draftWindow;
let watchedLogPath = null;
let lastLogActivityAt = null;
let normalWindowBounds = null;
let compactBuildMode = false;
let buildModeSource = null;
let suppressAutomaticBuildMode = false;
let visualGuideController = null;
let visualGuideState = {
  enabled: false,
  status: 'off',
  message: 'Visual guide off',
  permission: 'not-determined',
  annotationCount: 0
};

const companion = createDraftCompanion({
  catalog,
  demoCatalog,
  catalogInfo: { count: arenaCatalogResult.count, source: arenaCatalogResult.source },
  activeSet: ACTIVE_SET,
  sourceStore,
  corpusStore,
  settings: { read: readSettings, write: writeSettings },
  reviews: { read: readGameReviews, write: writeGameReviews },
  scryfall: {
    readCache: (set = ACTIVE_SET) => readScryfallCache(scryfallCachePath(set.code)),
    load: (set = ACTIVE_SET) => loadScryfallSet({ cachePath: scryfallCachePath(set.code), setCode: set.scryfallSetCode })
  },
  describeLog: () => ({
    path: watchedLogPath,
    source: watchedLogPath ? (defaultLogCandidates().includes(watchedLogPath) ? 'standard' : 'custom') : 'none',
    lastActivityAt: lastLogActivityAt,
    standardAvailable: defaultLogCandidates().some((entry) => fs.existsSync(entry))
  }),
  readLogText: () => {
    try { return watchedLogPath ? fs.readFileSync(watchedLogPath, 'utf8') : null; } catch { return null; }
  },
  arenaExtras: () => ({ compactBuildMode, buildModeSource }),
  visualGuideView: () => visualGuideState,
  onState: () => sendState(),
  onScene: (nextScene) => {
    if (nextScene.inDeckBuilder) {
      if (!suppressAutomaticBuildMode && buildModeSource !== 'manual') setCompactBuildMode(true, 'automatic');
    } else {
      suppressAutomaticBuildMode = false;
      if (buildModeSource === 'automatic') setCompactBuildMode(false);
    }
  },
  onContextChanged: () => visualGuideController?.contextChanged(),
  onDemoStart: () => tailer.stop()
});

const viewModel = companion.viewModel;
const setStatus = companion.setStatus;

function sendState() {
  if (draftWindow && !draftWindow.isDestroyed() && !draftWindow.webContents.isLoading()) {
    draftWindow.webContents.send('draft:state', viewModel());
  }
}

async function watchLog(logPath) {
  watchedLogPath = logPath;
  companion.beginLogSession();
  writeSettings({ logPath });
  setStatus({ kind: 'loading', message: 'Scanning Arena draft events', path: logPath });
  await tailer.start(logPath);
  companion.completeLogScan();
}

tailer.on('data', (chunk) => {
  lastLogActivityAt = Date.now();
  companion.feedLog(chunk);
});
tailer.on('rotate', () => {
  if (buildModeSource === 'automatic') setCompactBuildMode(false);
  companion.logRotated();
});
tailer.on('status', (next) => setStatus(next));

function createWindow() {
  const display = screen.getPrimaryDisplay().workArea;
  const windowWidth = Math.max(780, Math.min(1280, display.width - 36));
  const windowHeight = Math.max(620, Math.min(840, display.height - 36));
  draftWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    minWidth: Math.min(1020, windowWidth),
    minHeight: 620,
    frame: false,
    transparent: false,
    backgroundColor: '#bebbb5',
    alwaysOnTop: false,
    resizable: true,
    title: 'Pick 42 Draft Companion',
    webPreferences: {
      preload: path.join(__dirname, 'draft-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  draftWindow.setPosition(Math.max(display.x, display.x + display.width - windowWidth - 18), Math.max(display.y, display.y + 18));
  normalWindowBounds = draftWindow.getBounds();
  draftWindow.loadFile(path.join(__dirname, 'draft-renderer', 'index.html'));
  draftWindow.webContents.on('did-finish-load', sendState);
}

function setCompactBuildMode(enabled, source = null) {
  if (!draftWindow || draftWindow.isDestroyed()) return;
  const next = Boolean(enabled);
  if (next === compactBuildMode && (!next || source === buildModeSource)) {
    sendState();
    return;
  }

  if (next) {
    if (!compactBuildMode) normalWindowBounds = draftWindow.getBounds();
    const workArea = screen.getDisplayMatching(draftWindow.getBounds()).workArea;
    const width = Math.min(400, Math.max(350, workArea.width - 36));
    const height = Math.min(780, Math.max(540, workArea.height - 36));
    draftWindow.setMinimumSize(340, 500);
    // The panel may be shrunk by hand but never dragged wider; returning to the
    // full app is the expand button's job.
    draftWindow.setMaximumSize(width, 100000);
    draftWindow.setBounds({
      x: workArea.x + workArea.width - width - 18,
      y: workArea.y + 18,
      width,
      height
    }, true);
    draftWindow.showInactive();
  } else {
    const fallback = screen.getPrimaryDisplay().workArea;
    const fallbackWidth = Math.max(780, Math.min(1280, fallback.width - 36));
    const fallbackHeight = Math.max(620, Math.min(840, fallback.height - 36));
    const bounds = normalWindowBounds || {
      x: Math.max(fallback.x, fallback.x + fallback.width - fallbackWidth - 18),
      y: fallback.y + 18,
      width: fallbackWidth,
      height: fallbackHeight
    };
    draftWindow.setMaximumSize(100000, 100000);
    draftWindow.setBounds(bounds, true);
    draftWindow.setMinimumSize(780, 620);
  }

  compactBuildMode = next;
  buildModeSource = next ? source : null;
  sendState();
}

function registerIpc() {
  ipcMain.handle('draft:bootstrap', () => viewModel());
  ipcMain.handle('draft:import-source', async (_event, source, format) => {
    if (!['seventeenLands', 'untapped'].includes(source)) throw new Error('Unknown draft data source.');
    const formatKey = SOURCE_FORMATS.includes(format) ? format : 'any';
    const sourceName = source === 'seventeenLands' ? '17Lands' : 'Untapped';
    const result = await dialog.showOpenDialog(draftWindow, {
      title: `Import ${sourceName} CSV for ${SOURCE_FORMAT_LABELS[formatKey]}`,
      properties: ['openFile'],
      filters: [{ name: 'CSV export', extensions: ['csv'] }]
    });
    if (result.canceled || !result.filePaths[0]) return viewModel();
    try {
      // Copy the chosen export into the app's own storage: the dialog grants read
      // access now, and the stored copy stays loadable after the original moves.
      const chosenPath = result.filePaths[0];
      const storagePath = importedCsvStoragePath(source, formatKey);
      const contents = fs.readFileSync(chosenPath, 'utf8');
      // Validate before replacing the app-owned copy. A bad replacement must not
      // destroy the last working import on the next restart.
      const data = sourceStore.parse(source, contents);
      writeFileAtomic(storagePath, contents);
      sourceStore.remember(source, storagePath, formatKey, path.basename(chosenPath), data);
      writeSettings({ sourceImportPaths: sourceStore.settingsPayload() });
      setStatus({ kind: 'live', message: `${sourceName} · ${SOURCE_FORMAT_LABELS[formatKey]} · ${data.length} rows imported` });
    } catch (error) {
      setStatus({ kind: 'error', message: error.message });
    }
    return viewModel();
  });
  ipcMain.handle('draft:import-archetype-corpus', async () => {
    const result = await dialog.showOpenDialog(draftWindow, {
      title: 'Import a normalized corpus or a 17Lands game-data export',
      properties: ['openFile'],
      filters: [
        { name: 'Corpus or 17Lands game data', extensions: ['csv', 'json', 'gz'] },
        { name: 'All files', extensions: ['*'] }
      ]
    });
    if (result.canceled || !result.filePaths[0]) return viewModel();
    const filePath = result.filePaths[0];
    try {
      if (await isSeventeenLandsGameData(filePath)) {
        setStatus({ kind: 'live', message: 'Processing 17Lands game data · deriving event records' });
        const extraction = await extractTrophyDecksFromGameData(filePath, {
          onProgress: ({ phase, games }) => setStatus({
            kind: 'live',
            message: phase === 'records'
              ? `Processing 17Lands game data · ${games.toLocaleString()} games scanned`
              : 'Processing 17Lands game data · reconstructing trophy decks'
          })
        });
        const corpusPath = path.join(app.getPath('userData'), `trophy-corpus-${extraction.setCode}-${extraction.format}.json`);
        writeJsonAtomic(corpusPath, {
          source: `17Lands public dataset · ${path.basename(filePath)}`,
          license: 'Processed offline from the 17Lands public datasets (17lands.com/public_datasets)',
          generatedAt: new Date().toISOString(),
          decks: extraction.decks
        });
        corpusStore.loadImported(corpusPath);
        writeSettings({ archetypeCorpusPath: corpusPath });
        setStatus({
          kind: 'live',
          message: `${extraction.decks.length} ${extraction.setCode} trophy decks derived from ${extraction.scanned.games.toLocaleString()} games`
        });
      } else {
        corpusStore.loadImported(filePath);
        writeSettings({ archetypeCorpusPath: filePath });
        setStatus({ kind: 'live', message: `${corpusStore.sourceInfo().trophyCount} trophy exemplars imported` });
      }
    } catch (error) {
      setStatus({ kind: 'error', message: error.message });
    }
    return viewModel();
  });
  ipcMain.handle('draft:add-trophy-deck', (_event, payload) => {
    try {
      companion.addTrophyDeck(payload);
    } catch (error) {
      setStatus({ kind: 'error', message: error.message });
      throw error;
    }
    return viewModel();
  });
  ipcMain.handle('draft:remove-trophy-deck', (_event, deckId) => {
    companion.removeTrophyDeck(deckId);
    return viewModel();
  });
  ipcMain.handle('draft:read-clipboard', () => ({ text: clipboard.readText() }));
  ipcMain.handle('draft:choose-log', async () => {
    const result = await dialog.showOpenDialog(draftWindow, {
      title: 'Choose MTG Arena Player.log',
      properties: ['openFile'],
      filters: [{ name: 'Arena log', extensions: ['log', 'txt'] }]
    });
    if (!result.canceled && result.filePaths[0]) await watchLog(result.filePaths[0]);
    return viewModel();
  });
  ipcMain.handle('draft:use-standard-log', async () => {
    const candidate = defaultLogCandidates().find((entry) => fs.existsSync(entry));
    if (!candidate) {
      setStatus({ kind: 'error', message: 'No Arena Player.log was found in the standard location. Choose the file manually.' });
      return viewModel();
    }
    await watchLog(candidate);
    return viewModel();
  });
  ipcMain.handle('draft:set-lane-preference', (_event, mode) => companion.setLanePreference(mode));
  ipcMain.handle('draft:set-pool-card-excluded', (_event, cardName, excluded) => companion.setPoolCardExcluded(cardName, excluded));
  ipcMain.handle('draft:set-manual-record', (_event, record) => companion.setManualRecord(record));
  ipcMain.handle('draft:set-active-set', (_event, setCode) => companion.setActiveSet(setCode));
  ipcMain.handle('draft:set-prep-format', (_event, format) => companion.setPrepFormat(format));
  ipcMain.handle('draft:start-demo', (_event, mode) => { companion.startDemo(mode); return viewModel(); });
  ipcMain.handle('draft:advance-demo', () => { companion.advanceDemo(); return viewModel(); });
  ipcMain.handle('draft:select-build', (_event, buildId) => companion.selectBuild(buildId));
  ipcMain.handle('draft:pick-pair-for', (_event, cardName) => companion.pickPairFor(cardName));
  ipcMain.handle('draft:copy-search', (_event, text) => {
    const value = String(text || '').trim().slice(0, 200);
    if (value) clipboard.writeText(value);
    return { copied: value };
  });
  ipcMain.handle('draft:toggle-visual-guide', async () => {
    const enabled = !visualGuideState.enabled;
    writeSettings({ visualGuideEnabled: enabled });
    await visualGuideController?.setEnabled(enabled);
    return viewModel();
  });
  ipcMain.handle('draft:scan-visual-guide', async () => {
    await visualGuideController?.scan({ forceFull: true });
    return viewModel();
  });
  ipcMain.handle('draft:open-screen-settings', () => shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'));
  // Links resolve at click time so they always point at the active set.
  const EXTERNAL_LINKS = {
    seventeenLandsCardData: () => `https://www.17lands.com/card_data?expansion=${companion.activeSetInfo().displayCode}`,
    seventeenLandsTrophies: () => 'https://www.17lands.com/trophy_decks',
    untappedCardData: () => untappedCardDataUrl(companion.activeSetInfo().code)
  };
  ipcMain.handle('draft:open-link', (_event, key) => {
    const url = EXTERNAL_LINKS[String(key || '')]?.();
    if (url) shell.openExternal(url);
    return Boolean(url);
  });
  ipcMain.handle('draft:enter-build-mode', () => {
    suppressAutomaticBuildMode = false;
    setCompactBuildMode(true, 'manual');
    return viewModel();
  });
  ipcMain.handle('draft:exit-build-mode', () => {
    suppressAutomaticBuildMode = companion.sceneSnapshot().inDeckBuilder;
    setCompactBuildMode(false);
    return viewModel();
  });
  ipcMain.handle('draft:minimize', () => draftWindow.minimize());
  ipcMain.handle('draft:close', () => app.quit());
}

// The web shell has no Arena installation to read grpIds from, so the desktop
// exports its catalog as a droppable file whenever Arena's database is newer.
function exportArenaCatalog() {
  if (!arenaCatalogResult.count || !arenaCatalogResult.source) return;
  const exportPath = path.join(app.getPath('userData'), 'arena-card-catalog.json');
  try {
    const sourceMtime = fs.statSync(arenaCatalogResult.source).mtimeMs;
    if (fs.existsSync(exportPath) && fs.statSync(exportPath).mtimeMs > sourceMtime) return;
    writeFileAtomic(exportPath, JSON.stringify({
      version: 1,
      source: 'Arena card database',
      generatedAt: new Date().toISOString(),
      count: arenaCatalogResult.count,
      cards: arenaCatalogResult.catalog
    }));
  } catch {
    // The export is a convenience for the web shell; the desktop app is whole without it.
  }
}

app.whenReady().then(async () => {
  // The dev checkout launches through Electron's own binary; brand the Dock.
  try { app.dock?.setIcon(path.join(projectRoot, 'assets', 'icon.png')); } catch { /* Icon missing is cosmetic. */ }
  loadSampleSources();
  corpusStore.readManual();
  exportArenaCatalog();
  const saved = companion.hydrate();
  if (saved.archetypeCorpusPath && fs.existsSync(saved.archetypeCorpusPath)) {
    try { corpusStore.loadImported(saved.archetypeCorpusPath); } catch { /* Keep drafting if an old corpus moved or changed. */ }
  }
  const savedSourceImports = saved.sourceImportPaths || {};
  for (const source of ['seventeenLands', 'untapped']) {
    for (const [format, savedEntry] of Object.entries(savedSourceImports[source] || {})) {
      const savedPath = typeof savedEntry === 'string' ? savedEntry : savedEntry?.path;
      const savedLabel = typeof savedEntry === 'string' ? null : savedEntry?.label;
      if (SOURCE_FORMATS.includes(format) && savedPath && fs.existsSync(savedPath)) {
        try { sourceStore.loadCsv(source, savedPath, format, savedLabel); } catch { /* Skip an export that moved or changed. */ }
      }
    }
    // Legacy single-path settings become the all-formats slot.
    const legacyPath = saved[`${source}Path`];
    if (!sourceStore.has(source, 'any') && legacyPath && fs.existsSync(legacyPath)) {
      try { sourceStore.loadCsv(source, legacyPath, 'any'); } catch { /* Keep the bundled sample if an old export moved or changed. */ }
    }
  }
  visualGuideController = new VisualGuideController({
    projectRoot,
    preloadPath: path.join(__dirname, 'visual-preload.cjs'),
    rendererPath: path.join(__dirname, 'visual-renderer', 'index.html'),
    context: () => {
      const current = viewModel();
      return {
        inDeckBuilder: Boolean(current.arena.inDeckBuilder),
        pool: current.draft.pool,
        build: current.deckBuilds.find((build) => build.id === companion.selectedBuildId()) || current.deckBuilds[0] || null
      };
    },
    onState: (next) => {
      visualGuideState = next;
      sendState();
    }
  });
  visualGuideState = visualGuideController.snapshot();
  registerIpc();
  createWindow();
  void companion.initializeScryfall();
  globalShortcut.register('CommandOrControl+Shift+D', () => {
    if (draftWindow.isVisible()) draftWindow.hide(); else draftWindow.showInactive();
  });
  const sendRecipeCommand = (command) => {
    if (draftWindow && !draftWindow.isDestroyed()) draftWindow.webContents.send('draft:recipe-command', command);
  };
  globalShortcut.register('CommandOrControl+Shift+C', () => sendRecipeCommand('copy'));
  globalShortcut.register('CommandOrControl+Shift+Right', () => sendRecipeCommand('next'));
  globalShortcut.register('CommandOrControl+Shift+Left', () => sendRecipeCommand('undo'));

  const candidate = [saved.logPath, ...defaultLogCandidates()].find((entry) => entry && fs.existsSync(entry));
  if (candidate) await watchLog(candidate);
  else companion.startDemo();
  // Positional OCR tracking is retained only as an experimental implementation.
  // Recipe Mode is the default and does not start screen capture automatically.
  if (saved.visualGuideEnabled) writeSettings({ visualGuideEnabled: false });
});

app.on('will-quit', () => {
  tailer.stop();
  visualGuideController?.dispose();
  globalShortcut.unregisterAll();
});
