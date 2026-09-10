'use strict';

// Render the native SVG icon layout with the approved raster mark. The app,
// launcher, web favicon and release all consume the resulting assets/icon.png.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'pick42-icon-'));
app.setPath('userData', scratch);
app.dock?.hide();

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1024, height: 1024, useContentSize: true, show: false,
    transparent: true, frame: false, backgroundColor: '#00000000',
    webPreferences: { offscreen: true, backgroundThrottling: false }
  });
  await window.loadFile(path.join(__dirname, '..', 'assets', 'icon.svg'));
  await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const image = await window.webContents.capturePage();
  const output = path.join(__dirname, '..', 'assets', 'icon.png');
  fs.writeFileSync(output, image.resize({ width: 1024, height: 1024 }).toPNG());
  console.log(`Rendered ${output}`);
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => app.quit());

app.on('quit', () => fs.rmSync(scratch, { recursive: true, force: true }));
