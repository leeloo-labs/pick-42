'use strict';

const { app, BrowserWindow, dialog, globalShortcut, ipcMain, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { ArenaLogParser } = require('./core/arena-log-parser.cjs');
const { loadArenaCardCatalog } = require('./core/card-catalog.cjs');
const { LogTailer } = require('./core/log-tailer.cjs');
const { migrateLegacyUserData } = require('./draft-app/migrate-user-data.cjs');

app.setName('Pick 42');
// Both entry points share one user-data directory; the migration is one-time
// and settles wherever src/draft-main.cjs left it.
app.setPath('userData', migrateLegacyUserData({ appDataPath: app.getPath('appData') }).userDataPath);

const projectRoot = path.resolve(__dirname, '..');
const demoLogPath = path.join(projectRoot, 'fixtures', 'demo-match.log');
const catalogPath = path.join(projectRoot, 'fixtures', 'demo-cards.json');

let overlayWindow;
let demoTimer;
let clickThrough = false;
let currentStatus = { kind: 'starting', message: 'Starting companion' };
let latestState;

const demoCatalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const arenaCatalog = loadArenaCardCatalog();
const catalog = { ...arenaCatalog.catalog, ...demoCatalog };
const parser = new ArenaLogParser({ catalog });
const tailer = new LogTailer();

function send(channel, payload) {
  if (overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.webContents.isLoading() === false) {
    overlayWindow.webContents.send(channel, payload);
  }
}

function setStatus(status) {
  currentStatus = status;
  send('companion:status', status);
}

parser.on('state', (state) => {
  latestState = state;
  send('companion:state', state);
});

tailer.on('data', (chunk) => parser.feed(chunk));
tailer.on('rotate', () => {
  parser.reset();
  setStatus({ kind: 'loading', message: 'Arena started a new log session' });
});
tailer.on('status', setStatus);

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
  return [
    path.join(home, '.local', 'share', 'Steam', 'steamapps', 'compatdata', '2141910', 'pfx', 'drive_c', 'users', 'steamuser', 'AppData', 'LocalLow', 'Wizards Of The Coast', 'MTGA', 'Player.log')
  ];
}

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  } catch {
    return {};
  }
}

function writeSettings(patch) {
  const next = { ...readSettings(), ...patch };
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2));
  return next;
}

function positionOverlay() {
  const display = screen.getPrimaryDisplay();
  const { x, y, width } = display.workArea;
  overlayWindow.setPosition(Math.round(x + width - 404), Math.round(y + 24));
}

function createWindow() {
  overlayWindow = new BrowserWindow({
    width: 380,
    height: 720,
    minWidth: 344,
    minHeight: 480,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: false,
    resizable: true,
    hasShadow: false,
    skipTaskbar: true,
    title: 'Pick 42 Arena Companion',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  positionOverlay();
  overlayWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  overlayWindow.webContents.on('did-finish-load', () => {
    send('companion:status', currentStatus);
    if (latestState) send('companion:state', latestState);
    send('companion:interaction', { clickThrough });
  });
}

function stopDemo() {
  if (demoTimer) clearInterval(demoTimer);
  demoTimer = null;
}

function startDemo() {
  stopDemo();
  tailer.stop();
  parser.reset();
  parser.setCatalog(demoCatalog);
  setStatus({ kind: 'demo', message: 'Replaying a sample match' });

  const entries = fs.readFileSync(demoLogPath, 'utf8').split('\n').filter((line) => line.includes('{'));
  let index = 0;
  const playNext = () => {
    if (index >= entries.length) {
      clearInterval(demoTimer);
      demoTimer = null;
      setStatus({ kind: 'demo', message: 'Sample match complete · replay anytime' });
      return;
    }
    parser.feed(`${entries[index]}\n`);
    index += 1;
  };
  playNext();
  demoTimer = setInterval(playNext, 1400);
}

async function watchLog(logPath) {
  stopDemo();
  parser.reset();
  parser.setCatalog(catalog);
  writeSettings({ logPath });
  setStatus({ kind: 'loading', message: 'Reading Arena log', path: logPath });
  await tailer.start(logPath);
}

function setClickThrough(enabled) {
  clickThrough = Boolean(enabled);
  overlayWindow.setIgnoreMouseEvents(clickThrough, { forward: true });
  send('companion:interaction', { clickThrough });
}

function registerIpc() {
  ipcMain.handle('companion:bootstrap', () => ({
    state: latestState,
    status: currentStatus,
    clickThrough,
    platform: process.platform
  }));

  ipcMain.handle('companion:choose-log', async () => {
    const result = await dialog.showOpenDialog(overlayWindow, {
      title: 'Choose MTG Arena Player.log',
      properties: ['openFile'],
      filters: [{ name: 'Arena log', extensions: ['log', 'txt'] }]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    await watchLog(result.filePaths[0]);
    return result.filePaths[0];
  });

  ipcMain.handle('companion:start-demo', () => startDemo());
  ipcMain.handle('companion:set-click-through', (_event, enabled) => setClickThrough(enabled));
  ipcMain.handle('companion:collapse', (_event, collapsed) => {
    const [width] = overlayWindow.getSize();
    overlayWindow.setSize(width, collapsed ? 106 : 720, true);
  });
  ipcMain.handle('companion:close', () => app.quit());
}

async function startDataSource() {
  const saved = readSettings().logPath;
  const candidate = [saved, ...defaultLogCandidates()].find((entry) => entry && fs.existsSync(entry));
  if (candidate) {
    await watchLog(candidate);
  } else {
    startDemo();
  }
}

app.whenReady().then(async () => {
  registerIpc();
  createWindow();

  globalShortcut.register('CommandOrControl+Shift+O', () => {
    if (overlayWindow.isVisible()) overlayWindow.hide();
    else overlayWindow.showInactive();
  });
  globalShortcut.register('CommandOrControl+Shift+Space', () => setClickThrough(!clickThrough));

  await startDataSource();
});

app.on('will-quit', () => {
  stopDemo();
  tailer.stop();
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => app.quit());
