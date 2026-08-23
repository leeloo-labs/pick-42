'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('companion', {
  bootstrap: () => ipcRenderer.invoke('companion:bootstrap'),
  chooseLog: () => ipcRenderer.invoke('companion:choose-log'),
  startDemo: () => ipcRenderer.invoke('companion:start-demo'),
  setClickThrough: (enabled) => ipcRenderer.invoke('companion:set-click-through', enabled),
  collapse: (collapsed) => ipcRenderer.invoke('companion:collapse', collapsed),
  close: () => ipcRenderer.invoke('companion:close'),
  onState: (handler) => {
    const listener = (_event, state) => handler(state);
    ipcRenderer.on('companion:state', listener);
    return () => ipcRenderer.removeListener('companion:state', listener);
  },
  onStatus: (handler) => {
    const listener = (_event, status) => handler(status);
    ipcRenderer.on('companion:status', listener);
    return () => ipcRenderer.removeListener('companion:status', listener);
  },
  onInteraction: (handler) => {
    const listener = (_event, interaction) => handler(interaction);
    ipcRenderer.on('companion:interaction', listener);
    return () => ipcRenderer.removeListener('companion:interaction', listener);
  }
});
