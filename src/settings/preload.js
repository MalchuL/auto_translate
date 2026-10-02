'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settingsApi', {
  load: () => ipcRenderer.invoke('settings:load'),
  save: (values) => ipcRenderer.invoke('settings:save', values),
  close: () => ipcRenderer.send('settings:close'),
});
