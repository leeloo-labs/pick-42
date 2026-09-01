'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('draftCompanion', {
  bootstrap: () => ipcRenderer.invoke('draft:bootstrap'),
  importSource: (source, format) => ipcRenderer.invoke('draft:import-source', source, format),
  importArchetypeCorpus: () => ipcRenderer.invoke('draft:import-archetype-corpus'),
  addTrophyDeck: (value) => ipcRenderer.invoke('draft:add-trophy-deck', value),
  removeTrophyDeck: (deckId) => ipcRenderer.invoke('draft:remove-trophy-deck', deckId),
  readClipboard: () => ipcRenderer.invoke('draft:read-clipboard'),
  chooseLog: () => ipcRenderer.invoke('draft:choose-log'),
  useStandardLog: () => ipcRenderer.invoke('draft:use-standard-log'),
  setLanePreference: (mode) => ipcRenderer.invoke('draft:set-lane-preference', mode),
  setPoolCardExcluded: (cardName, excluded) => ipcRenderer.invoke('draft:set-pool-card-excluded', cardName, excluded),
  setManualRecord: (record) => ipcRenderer.invoke('draft:set-manual-record', record),
  setActiveSet: (setCode) => ipcRenderer.invoke('draft:set-active-set', setCode),
  setPrepFormat: (format) => ipcRenderer.invoke('draft:set-prep-format', format),
  startDemo: (mode) => ipcRenderer.invoke('draft:start-demo', mode),
  advanceDemo: () => ipcRenderer.invoke('draft:advance-demo'),
  pickPairFor: (cardName) => ipcRenderer.invoke('draft:pick-pair-for', cardName),
  selectBuild: (buildId) => ipcRenderer.invoke('draft:select-build', buildId),
  copySearch: (text) => ipcRenderer.invoke('draft:copy-search', text),
  toggleVisualGuide: () => ipcRenderer.invoke('draft:toggle-visual-guide'),
  scanVisualGuide: () => ipcRenderer.invoke('draft:scan-visual-guide'),
  openScreenSettings: () => ipcRenderer.invoke('draft:open-screen-settings'),
  openLink: (key) => ipcRenderer.invoke('draft:open-link', key),
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
