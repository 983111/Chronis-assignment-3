'use strict';

const { app, BrowserWindow, ipcMain, session, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

// ── Storage paths ────────────────────────────────────────────────────────────
const DATA_DIR = path.join(app.getPath('userData'), 'chronis-data');
const DB_FILE  = path.join(DATA_DIR, 'sessions.json');
const LOG_FILE = path.join(DATA_DIR, 'deletion-audit.json');
const CFG_FILE = path.join(DATA_DIR, 'config.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { return fallback; }
}

function writeJSON(file, data) {
  ensureDataDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

// ── Window ───────────────────────────────────────────────────────────────────
let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#FBEAF0',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Grant microphone permission without prompting
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media') return callback(true);
    callback(false);
  });

  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    if (permission === 'media') return true;
    return false;
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// ── IPC handlers ─────────────────────────────────────────────────────────────

// Config
ipcMain.handle('config:get', () => readJSON(CFG_FILE, {}));
ipcMain.handle('config:set', (_, cfg) => { writeJSON(CFG_FILE, cfg); return true; });

// Sessions
ipcMain.handle('sessions:list', () => readJSON(DB_FILE, []));

ipcMain.handle('sessions:save', (_, session_data) => {
  const sessions = readJSON(DB_FILE, []);
  const existing = sessions.findIndex(s => s._id === session_data._id);
  if (existing >= 0) sessions[existing] = session_data;
  else sessions.push(session_data);
  writeJSON(DB_FILE, sessions);
  return true;
});

ipcMain.handle('sessions:delete', (_, id) => {
  const sessions = readJSON(DB_FILE, []).filter(s => s._id !== id);
  writeJSON(DB_FILE, sessions);
  return true;
});

ipcMain.handle('sessions:clear', () => {
  writeJSON(DB_FILE, []);
  return true;
});

// Deletion audit log
ipcMain.handle('audit:list', () => readJSON(LOG_FILE, []));

ipcMain.handle('audit:append', (_, entry) => {
  const log = readJSON(LOG_FILE, []);
  log.push(entry);
  writeJSON(LOG_FILE, log);
  return true;
});

// SHA-256 hash (done in main so raw text never has to go through renderer IPC round-trip just for hashing)
ipcMain.handle('util:sha256', (_, text) => {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 40) + '...';
});

// App info
ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  platform: process.platform,
  dataDir: DATA_DIR,
  dbFile: DB_FILE,
}));
