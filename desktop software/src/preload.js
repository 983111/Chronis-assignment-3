'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('chronis', {
  // Config
  configGet:       ()      => ipcRenderer.invoke('config:get'),
  configSet:       (cfg)   => ipcRenderer.invoke('config:set', cfg),

  // Sessions
  sessionsList:    ()      => ipcRenderer.invoke('sessions:list'),
  sessionsSave:    (s)     => ipcRenderer.invoke('sessions:save', s),
  sessionsDelete:  (id)    => ipcRenderer.invoke('sessions:delete', id),
  sessionsClear:   ()      => ipcRenderer.invoke('sessions:clear'),

  // Audit
  auditList:       ()      => ipcRenderer.invoke('audit:list'),
  auditAppend:     (entry) => ipcRenderer.invoke('audit:append', entry),

  // Utils
  sha256:          (text)  => ipcRenderer.invoke('util:sha256', text),
  appInfo:         ()      => ipcRenderer.invoke('app:info'),
});
