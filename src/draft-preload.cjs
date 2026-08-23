'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('draftCompanion', {
  bootstrap: () => ipcRenderer.invoke('draft:bootstrap'),
  importSource: (source) => ipcRenderer.invoke('draft:import-source', source),
  chooseLog: () => ipcRenderer.invoke('draft:choose-log'),
  updatePhilosophy: (patch) => ipcRenderer.invoke('draft:update-philosophy', patch),
  startDemo: () => ipcRenderer.invoke('draft:start-demo'),
  advanceDemo: () => ipcRenderer.invoke('draft:advance-demo'),
  selectBuild: (buildId) => ipcRenderer.invoke('draft:select-build', buildId),
  copySearch: (text) => ipcRenderer.invoke('draft:copy-search', text),
  toggleVisualGuide: () => ipcRenderer.invoke('draft:toggle-visual-guide'),
  scanVisualGuide: () => ipcRenderer.invoke('draft:scan-visual-guide'),
  openScreenSettings: () => ipcRenderer.invoke('draft:open-screen-settings'),
  enterBuildMode: () => ipcRenderer.invoke('draft:enter-build-mode'),
  exitBuildMode: () => ipcRenderer.invoke('draft:exit-build-mode'),
  minimize: () => ipcRenderer.invoke('draft:minimize'),
  close: () => ipcRenderer.invoke('draft:close'),
  onState: (handler) => {
    const listener = (_event, state) => handler(state);
    ipcRenderer.on('draft:state', listener);
    return () => ipcRenderer.removeListener('draft:state', listener);
  },
  onRecipeCommand: (handler) => {
    const listener = (_event, command) => handler(command);
    ipcRenderer.on('draft:recipe-command', listener);
    return () => ipcRenderer.removeListener('draft:recipe-command', listener);
  }
});
