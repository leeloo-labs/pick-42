'use strict';

const { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, screen, shell } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DEFAULT_PHILOSOPHY, scoreDraftPack } = require('./draft/blend-engine.cjs');
const { buildLimitedDecks } = require('./draft/deck-builder.cjs');
const { DraftLogParser } = require('./draft/draft-log-parser.cjs');
const { buildScryfallIndex, findScryfallCard, loadScryfallSet, readScryfallCache } = require('./draft/scryfall.cjs');
const { parseSeventeenLandsCsv } = require('./draft/sources/seventeenlands.cjs');
const { parseUntappedCsv } = require('./draft/sources/untapped.cjs');
const { loadArenaCardCatalog } = require('./core/card-catalog.cjs');
const { ArenaSceneTracker } = require('./core/arena-scene-tracker.cjs');
const { LogTailer } = require('./core/log-tailer.cjs');
const { VisualGuideController } = require('./draft/visual-guide-controller.cjs');

// Preserve prototype settings and imports while presenting the new product name.
const legacyUserDataPath = path.join(app.getPath('appData'), 'arcane-arena-companion');
app.setName('Pick 42');
app.setPath('userData', legacyUserDataPath);

const projectRoot = path.resolve(__dirname, '..');
const fixturePath = (...parts) => path.join(projectRoot, 'fixtures', ...parts);
const demoCatalog = JSON.parse(fs.readFileSync(fixturePath('demo-draft-cards.json'), 'utf8'));
const arenaCatalogResult = loadArenaCardCatalog();
// Keep demo cards as a fallback, but preserve Arena's richer localized rules text in live drafts.
const catalog = { ...demoCatalog, ...arenaCatalogResult.catalog };
const parser = new DraftLogParser({ catalog });
const sceneTracker = new ArenaSceneTracker();
const tailer = new LogTailer();

let draftWindow;
let normalWindowBounds = null;
let compactBuildMode = false;
let buildModeSource = null;
let suppressAutomaticBuildMode = false;
let selectedBuildId = 'golgari';
let visualGuideController = null;
let visualGuideState = {
  enabled: false,
  status: 'off',
  message: 'Visual guide off',
  permission: 'not-determined',
  annotationCount: 0
};
let draftState = parser.snapshot();
let status = { kind: 'demo', message: 'Sample HOB pack · import current exports when ready' };
let philosophy = { ...DEFAULT_PHILOSOPHY };
let sourceData = { seventeenLands: [], untapped: [] };
let sources = {
  seventeenLands: { label: '17Lands sample', kind: 'sample', count: 0 },
  untapped: { label: 'Untapped sample', kind: 'sample', count: 0 }
};
let scryfallIndex = {};
let scryfallState = {
  kind: 'loading',
  setCode: 'hob',
  setName: 'The Hobbit',
  count: 0,
  fetchedAt: null,
  source: null,
  message: 'Loading Scryfall card images'
};
let demoEntries = [];
let demoIndex = 0;

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

function settingsPath() {
  return path.join(app.getPath('userData'), 'draft-settings.json');
}

function scryfallCachePath() {
  return path.join(app.getPath('userData'), 'scryfall-hob.json');
}

function readSettings() {
  try { return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')); } catch { return {}; }
}

function writeSettings(patch) {
  const next = { ...readSettings(), ...patch };
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2));
}

function loadCsv(source, filePath, kind = 'import') {
  const text = fs.readFileSync(filePath, 'utf8');
  const data = source === 'seventeenLands' ? parseSeventeenLandsCsv(text) : parseUntappedCsv(text);
  sourceData[source] = data;
  sources[source] = { label: path.basename(filePath), kind, count: data.length, path: kind === 'import' ? filePath : null };
  return data;
}

function loadSampleSources() {
  loadCsv('seventeenLands', fixturePath('sample-17lands-hob.csv'), 'sample');
  loadCsv('untapped', fixturePath('sample-untapped-hob.csv'), 'sample');
}

function poolSummary(pool) {
  const curve = { '1': 0, '2': 0, '3': 0, '4': 0, '5+': 0 };
  const colors = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  let creatures = 0;
  for (const card of pool) {
    const symbols = String(card.manaCost || '').match(/[WUBRG]/g) || [];
    for (const color of new Set(symbols)) colors[color] += 1;
    const generic = Number(String(card.manaCost || '').match(/\{(\d+)\}/)?.[1] || 0);
    const manaValue = generic + symbols.length;
    const bucket = manaValue >= 5 ? '5+' : String(Math.max(1, manaValue));
    curve[bucket] = (curve[bucket] || 0) + 1;
    if (/Creature/i.test(card.typeLine || '')) creatures += 1;
  }
  return { curve, colors, creatures, total: pool.length };
}

function activeSourceData() {
  const samplesAllowed = status.kind === 'demo';
  return {
    seventeenLands: samplesAllowed || sources.seventeenLands.kind === 'import' ? sourceData.seventeenLands : [],
    untapped: samplesAllowed || sources.untapped.kind === 'import' ? sourceData.untapped : []
  };
}

function recommendationGate(recommendations) {
  const draftable = recommendations.filter((card) => !card.isBasicLand);
  const coveredByBoth = draftable.filter((card) => card.sourceCoverage === 2).length;
  const coverage = draftable.length ? coveredByBoth / draftable.length : 0;

  if (!draftable.length) {
    return { ready: false, kind: 'waiting', message: 'Waiting for a draft pack', coveredByBoth, total: draftable.length };
  }
  if (status.kind === 'demo') {
    return { ready: true, kind: 'demo', message: 'Sample data is active for the sample draft only', coveredByBoth, total: draftable.length };
  }
  const importedBoth = sources.seventeenLands.kind === 'import' && sources.untapped.kind === 'import';
  if (!importedBoth) {
    return {
      ready: false,
      kind: 'missing-sources',
      message: `Recommendations paused · import full 17Lands and Untapped exports for ${draftState.setCode || 'this set'}`,
      coveredByBoth,
      total: draftable.length
    };
  }
  if (coverage < 0.9) {
    return {
      ready: false,
      kind: 'low-coverage',
      message: `Recommendations paused · only ${coveredByBoth}/${draftable.length} draftable cards match both imports`,
      coveredByBoth,
      total: draftable.length
    };
  }
  return { ready: true, kind: 'ready', message: 'Both sources cover the live pack', coveredByBoth, total: draftable.length };
}

function applyScryfallPayload(payload, source = payload?.source || 'cache') {
  if (!payload?.cards?.length) return;
  scryfallIndex = buildScryfallIndex(payload.cards);
  scryfallState = {
    kind: 'ready',
    setCode: payload.setCode || 'hob',
    setName: payload.setName || 'The Hobbit',
    count: payload.cards.length,
    fetchedAt: payload.fetchedAt || null,
    source,
    message: `${payload.cards.length} Scryfall cards · ${source}`
  };
}

async function initializeScryfall() {
  const cachePath = scryfallCachePath();
  const cached = readScryfallCache(cachePath);
  if (cached?.cards?.length) {
    applyScryfallPayload(cached, 'cache');
    sendState();
  }

  try {
    if (!cached) {
      scryfallState = { ...scryfallState, kind: 'loading', message: 'Downloading The Hobbit card images from Scryfall' };
      sendState();
    }
    const payload = await loadScryfallSet({ cachePath, setCode: 'hob' });
    applyScryfallPayload(payload, payload.source);
  } catch (error) {
    scryfallState = {
      ...scryfallState,
      kind: cached ? 'ready' : 'offline',
      message: cached ? 'Using cached Scryfall images' : `Scryfall unavailable · ${error.message}`
    };
  }
  sendState();
}

function scryfallCardsForView(recommendations, deckBuilds) {
  const names = new Set([
    ...draftState.pack.map((card) => card.name),
    ...draftState.pool.map((card) => card.name),
    ...recommendations.map((card) => card.name),
    ...deckBuilds.flatMap((build) => [...build.mainDeck, ...build.lands, ...build.cuts].map((card) => card.name))
  ].filter(Boolean));
  const cards = {};
  for (const name of names) {
    const matched = findScryfallCard(scryfallIndex, name);
    if (matched) cards[name] = matched;
  }
  return cards;
}

function viewModel() {
  const activeSources = activeSourceData();
  const recommendations = scoreDraftPack({
    cards: draftState.pack,
    seventeenLands: activeSources.seventeenLands,
    untapped: activeSources.untapped,
    pool: draftState.pool,
    packNumber: draftState.packNumber,
    pickNumber: draftState.pickNumber,
    philosophy
  });
  const deckBuilds = buildLimitedDecks({
    pool: draftState.pool,
    seventeenLands: activeSources.seventeenLands,
    untapped: activeSources.untapped,
    philosophy
  });
  return {
    draft: draftState,
    recommendations,
    deckBuilds,
    selectedBuildId,
    recommendationGate: recommendationGate(recommendations),
    poolSummary: poolSummary(draftState.pool),
    sources,
    philosophy,
    status,
    arena: {
      ...sceneTracker.snapshot(),
      compactBuildMode,
      buildModeSource
    },
    visualGuide: visualGuideState,
    scryfall: {
      ...scryfallState,
      cards: scryfallCardsForView(recommendations, deckBuilds)
    },
    catalog: { count: arenaCatalogResult.count, source: arenaCatalogResult.source },
    demo: { index: demoIndex, total: demoEntries.length }
  };
}

function sendState() {
  if (draftWindow && !draftWindow.isDestroyed() && !draftWindow.webContents.isLoading()) {
    draftWindow.webContents.send('draft:state', viewModel());
  }
}

function setStatus(next) {
  status = next;
  sendState();
}

function startDemo() {
  tailer.stop();
  parser.reset();
  demoEntries = fs.readFileSync(fixturePath('demo-draft.log'), 'utf8').split('\n').filter(Boolean);
  demoIndex = 0;
  parser.feed(`${demoEntries[demoIndex]}\n`);
  demoIndex += 1;
  setStatus({ kind: 'demo', message: 'Sample HOB pack · use Next pick to see philosophy adapt' });
}

function advanceDemo() {
  if (demoIndex >= demoEntries.length) return startDemo();
  const entry = demoEntries[demoIndex];
  parser.feed(`${entry}\n`);
  demoIndex += 1;
  if (/MakePick|DraftPick/i.test(entry) && demoIndex < demoEntries.length && /Draft\.Notify|DraftStatus/i.test(demoEntries[demoIndex])) {
    parser.feed(`${demoEntries[demoIndex]}\n`);
    demoIndex += 1;
  }
  setStatus({ kind: 'demo', message: demoIndex >= demoEntries.length ? 'Sample complete · Next pick restarts it' : 'Sample draft advanced' });
}

async function watchLog(logPath) {
  parser.reset();
  sceneTracker.reset();
  draftState = parser.snapshot();
  writeSettings({ logPath });
  setStatus({ kind: 'loading', message: 'Scanning Arena draft events', path: logPath });
  await tailer.start(logPath);
}

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
    backgroundColor: '#111016',
    alwaysOnTop: true,
    resizable: true,
    title: 'Pick 42 Draft Companion',
    webPreferences: {
      preload: path.join(__dirname, 'draft-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  draftWindow.setAlwaysOnTop(true, process.platform === 'darwin' ? 'floating' : 'screen-saver');
  if (process.platform === 'darwin') draftWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
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
    draftWindow.setBounds(bounds, true);
    draftWindow.setMinimumSize(780, 620);
  }

  compactBuildMode = next;
  buildModeSource = next ? source : null;
  sendState();
}

function registerIpc() {
  ipcMain.handle('draft:bootstrap', () => viewModel());
  ipcMain.handle('draft:import-source', async (_event, source) => {
    if (!['seventeenLands', 'untapped'].includes(source)) throw new Error('Unknown draft data source.');
    const result = await dialog.showOpenDialog(draftWindow, {
      title: `Import ${source === 'seventeenLands' ? '17Lands' : 'Untapped'} CSV`,
      properties: ['openFile'],
      filters: [{ name: 'CSV export', extensions: ['csv'] }]
    });
    if (result.canceled || !result.filePaths[0]) return viewModel();
    try {
      loadCsv(source, result.filePaths[0]);
      writeSettings({ [`${source}Path`]: result.filePaths[0] });
      setStatus({ kind: 'live', message: `${sources[source].label} imported` });
    } catch (error) {
      setStatus({ kind: 'error', message: error.message });
    }
    return viewModel();
  });
  ipcMain.handle('draft:choose-log', async () => {
    const result = await dialog.showOpenDialog(draftWindow, {
      title: 'Choose MTG Arena Player.log',
      properties: ['openFile'],
      filters: [{ name: 'Arena log', extensions: ['log', 'txt'] }]
    });
    if (!result.canceled && result.filePaths[0]) await watchLog(result.filePaths[0]);
    return viewModel();
  });
  ipcMain.handle('draft:update-philosophy', (_event, patch) => {
    const allowed = ['sourceBalance', 'powerPriority', 'stayOpen', 'colorDiscipline', 'curveDiscipline', 'signalSensitivity', 'synergyPriority', 'interactionPriority', 'creaturePreference'];
    for (const key of allowed) if (Number.isFinite(Number(patch?.[key]))) philosophy[key] = Math.max(0, Math.min(100, Number(patch[key])));
    writeSettings({ philosophy });
    visualGuideController?.contextChanged();
    sendState();
    return viewModel();
  });
  ipcMain.handle('draft:start-demo', () => { startDemo(); return viewModel(); });
  ipcMain.handle('draft:advance-demo', () => { advanceDemo(); return viewModel(); });
  ipcMain.handle('draft:select-build', (_event, buildId) => {
    const available = new Set((viewModel().deckBuilds || []).map((build) => build.id));
    if (available.has(buildId)) {
      selectedBuildId = buildId;
      writeSettings({ selectedBuildId });
      visualGuideController?.contextChanged();
      sendState();
    }
    return viewModel();
  });
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
  ipcMain.handle('draft:enter-build-mode', () => {
    suppressAutomaticBuildMode = false;
    setCompactBuildMode(true, 'manual');
    return viewModel();
  });
  ipcMain.handle('draft:exit-build-mode', () => {
    suppressAutomaticBuildMode = sceneTracker.snapshot().inDeckBuilder;
    setCompactBuildMode(false);
    return viewModel();
  });
  ipcMain.handle('draft:minimize', () => draftWindow.minimize());
  ipcMain.handle('draft:close', () => app.quit());
}

parser.on('state', (nextState) => {
  draftState = nextState;
  visualGuideController?.contextChanged();
  sendState();
});
sceneTracker.on('scene', (nextScene) => {
  if (nextScene.inDeckBuilder) {
    if (!suppressAutomaticBuildMode && buildModeSource !== 'manual') setCompactBuildMode(true, 'automatic');
  } else {
    suppressAutomaticBuildMode = false;
    if (buildModeSource === 'automatic') setCompactBuildMode(false);
  }
  visualGuideController?.contextChanged();
  sendState();
});
tailer.on('data', (chunk) => {
  parser.feed(chunk);
  sceneTracker.feed(chunk);
});
tailer.on('rotate', () => {
  parser.reset();
  sceneTracker.reset();
  draftState = parser.snapshot();
  if (buildModeSource === 'automatic') setCompactBuildMode(false);
  setStatus({ kind: 'loading', message: 'Arena started a new log session' });
});
tailer.on('status', (next) => setStatus(next));

app.whenReady().then(async () => {
  loadSampleSources();
  const saved = readSettings();
  philosophy = { ...DEFAULT_PHILOSOPHY, ...(saved.philosophy || {}) };
  selectedBuildId = ['golgari', 'jund', 'rakdos'].includes(saved.selectedBuildId) ? saved.selectedBuildId : 'golgari';
  for (const source of ['seventeenLands', 'untapped']) {
    const savedPath = saved[`${source}Path`];
    if (savedPath && fs.existsSync(savedPath)) {
      try { loadCsv(source, savedPath); } catch { /* Keep the bundled sample if an old export moved or changed. */ }
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
        build: current.deckBuilds.find((build) => build.id === selectedBuildId) || current.deckBuilds[0] || null
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
  void initializeScryfall();
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
  else startDemo();
  // Positional OCR tracking is retained only as an experimental implementation.
  // Recipe Mode is the default and does not start screen capture automatically.
  if (saved.visualGuideEnabled) writeSettings({ visualGuideEnabled: false });
});

app.on('will-quit', () => {
  tailer.stop();
  visualGuideController?.dispose();
  globalShortcut.unregisterAll();
});
app.on('window-all-closed', () => app.quit());
