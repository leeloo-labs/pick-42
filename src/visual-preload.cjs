'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('arcaneVisualGuide', {
  onState: (handler) => {
    const listener = (_event, state) => handler(state);
    ipcRenderer.on('visual-guide:state', listener);
    return () => ipcRenderer.removeListener('visual-guide:state', listener);
  }
});
