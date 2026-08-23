'use strict';

const { BrowserWindow, desktopCapturer, screen, systemPreferences } = require('electron');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const { analyzeVisualGuide } = require('./visual-guide-analyzer.cjs');

const execFileAsync = promisify(execFile);

function uniqueNames(pool, build) {
  return [...new Set([
    ...pool.map((card) => card.name),
    ...(build?.mainDeck || []).map((card) => card.name),
    ...(build?.lands || []).map((card) => card.name),
    'Plains', 'Island', 'Swamp', 'Mountain', 'Forest'
  ].filter(Boolean))];
}

class VisualGuideController {
  constructor({ projectRoot, preloadPath, rendererPath, context, onState }) {
    this.projectRoot = projectRoot;
    this.preloadPath = preloadPath;
    this.rendererPath = rendererPath;
    this.context = context;
    this.onState = onState;
    this.window = null;
    this.timer = null;
    this.scanning = false;
    this.guideMisses = 0;
    this.disposed = false;
    this.state = {
      enabled: false,
      status: 'off',
      message: 'Visual guide off',
      permission: process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') : 'unsupported',
      recognizedDeckCount: null,
      arenaDeckCount: null,
      annotationCount: 0,
      lastScanAt: null
    };
  }

  snapshot() {
    return { ...this.state };
  }

  setState(patch) {
    this.state = { ...this.state, ...patch };
    this.onState?.(this.snapshot());
  }

  async setEnabled(enabled) {
    if (process.platform !== 'darwin') {
      this.setState({ enabled: false, status: 'unsupported', message: 'Visual guide currently requires macOS' });
      return this.snapshot();
    }
    this.setState({ enabled: Boolean(enabled) });
    if (!enabled) {
      this.stopTimer();
      this.hide();
      this.setState({ status: 'off', message: 'Visual guide off', annotationCount: 0 });
      return this.snapshot();
    }
    await this.scan();
    return this.snapshot();
  }

  contextChanged() {
    if (!this.state.enabled || this.disposed) return;
    const current = this.context();
    if (!current?.inDeckBuilder) {
      this.stopTimer();
      this.hide();
      this.setState({ status: 'waiting', message: 'Waiting for Arena’s deck builder', annotationCount: 0 });
      return;
    }
    this.schedule(180);
  }

  schedule(delay = 3500) {
    this.stopTimer();
    if (!this.state.enabled || this.disposed) return;
    this.timer = setTimeout(() => this.scan(), delay);
  }

  stopTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  helperPath() {
    return path.join(this.projectRoot, 'bin', 'arcane-vision');
  }

  async runHelper(...args) {
    if (!fs.existsSync(this.helperPath())) throw new Error('Visual helper is missing. Run npm run build:vision.');
    const { stdout } = await execFileAsync(this.helperPath(), args, { timeout: 20_000, maxBuffer: 32 * 1024 * 1024 });
    return JSON.parse(stdout);
  }

  async arenaWindow() {
    const windows = await this.runHelper('windows');
    return windows
      .filter((entry) => entry.layer === 0 && entry.width >= 800 && entry.height >= 500)
      .find((entry) => /^MTGA$/i.test(entry.owner) || /^MTGA$/i.test(entry.name) || /Magic.*Arena/i.test(entry.name));
  }

  async captureArena(bounds) {
    const display = screen.getDisplayMatching(bounds);
    const scaleFactor = Math.max(1, Number(display.scaleFactor) || 1);
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: {
        width: Math.max(1, Math.round(bounds.width * scaleFactor)),
        height: Math.max(1, Math.round(bounds.height * scaleFactor))
      },
      fetchWindowIcons: false
    });
    const source = sources.find((entry) => /^MTGA$/i.test(entry.name) || /Magic.*Arena/i.test(entry.name));
    if (!source || source.thumbnail.isEmpty()) throw new Error('Arena’s window could not be captured');
    return source.thumbnail;
  }

  async recognize(image, pool, build, command = 'ocr-guide') {
    const tempRoot = path.join(os.tmpdir(), 'arcane-visual-guide');
    fs.mkdirSync(tempRoot, { recursive: true });
    const framePath = path.join(tempRoot, 'arena-deckbuilder.png');
    const wordsPath = path.join(tempRoot, 'known-card-names.json');
    fs.writeFileSync(framePath, image.toPNG());
    fs.writeFileSync(wordsPath, JSON.stringify(uniqueNames(pool, build)));
    return this.runHelper(command, framePath, wordsPath);
  }

  createWindow() {
    if (this.window && !this.window.isDestroyed()) return this.window;
    this.window = new BrowserWindow({
      x: 0,
      y: 0,
      width: 800,
      height: 600,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      focusable: false,
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      show: false,
      title: 'Pick 42 Visual Guide',
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false
      }
    });
    this.window.setIgnoreMouseEvents(true, { forward: true });
    this.window.setAlwaysOnTop(true, 'floating');
    this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.window.loadFile(this.rendererPath);
    return this.window;
  }

  render(result, bounds, build) {
    const overlay = this.createWindow();
    overlay.setBounds({
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height)
    }, false);
    const annotationCount = result.annotations.cards.length + result.annotations.deckRows.length;
    const payload = {
      build: { id: build.id, name: build.name },
      reason: result.reason,
      source: { width: result.imageWidth, height: result.imageHeight },
      annotations: result.annotations,
      badge: annotationCount === 0
        ? {
            variant: result.remainingTargetCount > 0 ? 'clear' : 'complete',
            label: result.remainingTargetCount > 0 ? 'PICK 42 · PAGE CLEAR · SCROLL FOR MORE' : 'PICK 42 · BUILD COMPLETE'
          }
        : null
    };
    const send = () => overlay.webContents.send('visual-guide:state', payload);
    if (overlay.webContents.isLoading()) overlay.webContents.once('did-finish-load', send);
    else send();
    overlay.showInactive();
  }

  showStatus(bounds, build, label, variant = 'tracking') {
    const overlay = this.createWindow();
    overlay.setBounds({
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height)
    }, false);
    const payload = {
      build: { id: build.id, name: build.name },
      reason: label,
      source: { width: bounds.width, height: bounds.height },
      annotations: { cards: [], deckRows: [] },
      badge: { label, variant }
    };
    const send = () => overlay.webContents.send('visual-guide:state', payload);
    if (overlay.webContents.isLoading()) overlay.webContents.once('did-finish-load', send);
    else send();
    overlay.showInactive();
  }

  hide() {
    if (this.window && !this.window.isDestroyed()) this.window.hide();
  }

  async scan({ forceFull = false } = {}) {
    if (this.scanning || !this.state.enabled || this.disposed) return this.snapshot();
    const current = this.context();
    if (!current?.inDeckBuilder) {
      this.hide();
      this.setState({ status: 'waiting', message: 'Waiting for Arena’s deck builder', annotationCount: 0 });
      return this.snapshot();
    }
    if (!current.build) {
      this.hide();
      this.setState({ status: 'waiting', message: 'Waiting for a complete Pick 42 build', annotationCount: 0 });
      return this.snapshot();
    }

    this.scanning = true;
    let nextDelay = 450;
    const wasActive = this.state.status === 'active';
    this.setState({
      status: wasActive ? 'active' : 'scanning',
      message: wasActive ? this.state.message : 'Reading Arena’s visible deck builder',
      permission: systemPreferences.getMediaAccessStatus('screen')
    });
    try {
      const arena = await this.arenaWindow();
      if (!arena) throw new Error('Arena window not found');
      const bounds = { x: arena.x, y: arena.y, width: arena.width, height: arena.height };
      const image = await this.captureArena(bounds);
      this.setState({ permission: systemPreferences.getMediaAccessStatus('screen') });
      const recognitionMode = forceFull ? 'ocr' : 'ocr-guide';
      const recognition = await this.recognize(image, current.pool, current.build, recognitionMode);
      let result = analyzeVisualGuide({ recognition, pool: current.pool, build: current.build });

      // A click or scroll can leave Arena between two grid layouts for several
      // frames. Never block the live loop with full-image OCR: remove stale
      // geometry and keep issuing quick cropped reads until Arena settles.
      // The user can still request a deliberate full pass with SCAN.
      if (!result.ready && !forceFull) {
        const nextMissCount = this.guideMisses + 1;
        const overlayVisible = Boolean(this.window && !this.window.isDestroyed() && this.window.isVisible());
        const sameDeckCount = result.deckCount !== null && result.deckCount === this.state.arenaDeckCount;
        const retainLastGoodFrame = wasActive && overlayVisible && (
          (sameDeckCount && nextMissCount <= 3) ||
          (result.deckCount === null && nextMissCount === 1)
        );
        this.guideMisses = nextMissCount;
        nextDelay = this.guideMisses < 8 ? 120 : 350;
        if (retainLastGoodFrame) {
          this.setState({ status: 'active', lastScanAt: Date.now() });
          return this.snapshot();
        }
        this.showStatus(bounds, current.build, 'PICK 42 · REALIGNING', 'tracking');
        this.setState({
          status: this.guideMisses < 8 ? 'tracking' : 'fallback',
          message: this.guideMisses < 8 ? 'Arena changed · realigning' : result.reason,
          recognizedDeckCount: result.recognizedDeckCount ?? null,
          arenaDeckCount: result.deckCount ?? null,
          annotationCount: 0,
          lastScanAt: Date.now()
        });
        return this.snapshot();
      }
      this.guideMisses = 0;
      if (!result.ready) {
        this.showStatus(bounds, current.build, 'PICK 42 · FRAME NOT RECONCILED', 'fallback');
        this.setState({
          status: 'fallback',
          message: result.reason,
          recognizedDeckCount: result.recognizedDeckCount ?? null,
          arenaDeckCount: result.deckCount ?? null,
          annotationCount: 0,
          lastScanAt: Date.now()
        });
      } else {
        this.render(result, bounds, current.build);
        const annotationCount = result.annotations.cards.length + result.annotations.deckRows.length;
        this.setState({
          status: 'active',
          message: result.reason,
          recognizedDeckCount: result.recognizedDeckCount,
          arenaDeckCount: result.deckCount,
          annotationCount,
          lastScanAt: Date.now()
        });
      }
    } catch (error) {
      this.hide();
      const permission = systemPreferences.getMediaAccessStatus('screen');
      this.setState({
        status: permission === 'denied' ? 'permission' : 'error',
        message: permission === 'denied' ? 'Allow Screen Recording for Pick 42, then restart it' : error.message,
        permission,
        annotationCount: 0,
        lastScanAt: Date.now()
      });
    } finally {
      this.scanning = false;
      this.schedule(nextDelay);
    }
    return this.snapshot();
  }

  dispose() {
    this.disposed = true;
    this.stopTimer();
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
  }
}

module.exports = { VisualGuideController, uniqueNames };
