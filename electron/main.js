const { app, BrowserWindow, shell, ipcMain, dialog, session, Tray, Menu, Notification } = require('electron');
const fs = require('fs');
const path = require('path');

const isDev = !app.isPackaged;
const settingsFile = () => path.join(app.getPath('userData'), 'chat-settings.json');
let mainWindow = null;
let splashWindow = null;
let splashCreatedTime = 0;
let tray = null;
let isQuitting = false;
const activeNotifications = new Set();

function clearNotifications() {
  activeNotifications.forEach(notification => {
    try { notification.close(); } catch {}
  });
  activeNotifications.clear();
}

function showMainWindow() {
  if (!mainWindow) createMainWindow();
  if (splashWindow) {
    splashWindow.destroy();
    splashWindow = null;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  clearNotifications();
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getDefaultPaths() {
  return {
    downloadPath: ensureDir(path.join(app.getPath('documents'), 'ChatApp', 'Downloads')),
    messagePath: ensureDir(path.join(app.getPath('userData'), 'chat-data')),
  };
}

function readSettings() {
  try {
    return { ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) };
  } catch {
    return {};
  }
}

function writeSettings(settings) {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(settings || {}, null, 2), 'utf8');
}

function getEffectiveDownloadPath() {
  const settings = readSettings();
  return ensureDir(settings.downloadPath || getDefaultPaths().downloadPath);
}

function getEffectiveMessagePath() {
  const settings = readSettings();
  return ensureDir(settings.messagePath || getDefaultPaths().messagePath);
}

function safeFileName(name) {
  return String(name || `file-${Date.now()}`).replace(/[\\/:*?"<>|]/g, '_');
}

function conversationFile(type, id, userId) {
  const userDir = `user_${safeFileName(userId || 'anonymous')}`;
  return path.join(getEffectiveMessagePath(), userDir, `${Number(type) === 1 ? 'group' : 'private'}_${safeFileName(id)}.json`);
}

function userMessageDir(userId) {
  return path.join(getEffectiveMessagePath(), `user_${safeFileName(userId || 'anonymous')}`);
}

function draftsFile(userId) {
  return path.join(userMessageDir(userId), 'drafts.json');
}

function toTime(value) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function sortMessages(messages) {
  return [...messages].sort((a, b) => {
    const timeDiff = toTime(a.created_at) - toTime(b.created_at);
    if (timeDiff !== 0) return timeDiff;
    return (Number(a.id) || 0) - (Number(b.id) || 0);
  });
}

function readConversation(type, id, userId) {
  try {
    const data = JSON.parse(fs.readFileSync(conversationFile(type, id, userId), 'utf8'));
    return Array.isArray(data) ? sortMessages(data) : [];
  } catch {
    return [];
  }
}

function writeConversation(type, id, userId, messages) {
  const file = conversationFile(type, id, userId);
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(sortMessages(messages), null, 2), 'utf8');
}

function mergeMessages(current, incoming) {
  const byId = new Map();
  current.forEach(msg => byId.set(String(msg.id ?? msg.temp_id), msg));
  incoming.forEach(msg => byId.set(String(msg.id ?? msg.temp_id), msg));
  return sortMessages(Array.from(byId.values()));
}

function deleteMessageFromConversation(type, id, userId, messageId) {
  const current = readConversation(type, id, userId);
  const targetId = String(messageId);
  const next = current.filter(msg => String(msg.id ?? msg.message_id ?? msg.temp_id) !== targetId);
  writeConversation(type, id, userId, next);
}

function messageId(msg) {
  return Number(msg?.id || msg?.message_id || 0) || 0;
}

function latestMessageInfo(messages) {
  const latest = sortMessages(messages).slice(-1)[0] || null;
  return {
    latest,
    lastMessageId: messageId(latest),
    latestTime: toTime(latest?.created_at),
  };
}

function listConversations(userId) {
  const dir = userMessageDir(userId);
  try {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter(file => file.endsWith('.json'))
      .map(file => {
        const match = /^(private|group)_(.+)\.json$/.exec(file);
        if (!match) return null;
        const type = match[1] === 'group' ? 1 : 0;
        const id = match[2];
        const messages = readConversation(type, id, userId);
        const { latest, lastMessageId, latestTime } = latestMessageInfo(messages);
        if (!messages.length && !lastMessageId) return null;
        return { id, type, lastMessageId, latestTime, latest };
      })
      .filter(Boolean)
      .sort((a, b) => b.latestTime - a.latestTime);
  } catch {
    return [];
  }
}

function readDrafts(userId) {
  try {
    const data = JSON.parse(fs.readFileSync(draftsFile(userId), 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function writeDrafts(userId, drafts) {
  const file = draftsFile(userId);
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(drafts || {}, null, 2), 'utf8');
}

function draftKey(type, id) {
  return `${Number(type) === 1 ? 'group' : 'private'}_${safeFileName(id)}`;
}

function registerSettingsHandlers() {
  ipcMain.handle('chat-settings:get-default-paths', () => getDefaultPaths());
  ipcMain.handle('chat-settings:get', () => readSettings());
  ipcMain.handle('chat-settings:set', (_event, settings) => {
    writeSettings(settings);
    return readSettings();
  });
  ipcMain.handle('chat-settings:choose-directory', async (_event, currentPath) => {
    const result = await dialog.showOpenDialog({
      defaultPath: currentPath || app.getPath('documents'),
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  session.defaultSession.on('will-download', (_event, item, webContents) => {
    const fileName = safeFileName(item.getFilename());
    const savePath = path.join(getEffectiveDownloadPath(), fileName);
    item.setSavePath(savePath);
    item.once('done', (_doneEvent, state) => {
      if (state === 'completed') {
        webContents.send('download:completed', { fileName, savePath });
      }
    });
  });

  ipcMain.handle('local-messages:save', (_event, { userId, type, id, messages }) => {
    const current = readConversation(type, id, userId);
    writeConversation(type, id, userId, mergeMessages(current, Array.isArray(messages) ? messages : []));
  });
  ipcMain.handle('local-messages:replace', (_event, { userId, type, id, messages }) => {
    writeConversation(type, id, userId, Array.isArray(messages) ? messages : []);
  });
  ipcMain.handle('local-messages:get-latest', (_event, { userId, type, id, limit }) => {
    const messages = readConversation(type, id, userId);
    return messages.slice(-Number(limit || 50));
  });
  ipcMain.handle('local-messages:get-older', (_event, { userId, type, id, beforeCreatedAt, limit }) => {
    const beforeTime = toTime(beforeCreatedAt);
    return readConversation(type, id, userId)
      .filter(msg => toTime(msg.created_at) < beforeTime)
      .slice(-Number(limit || 50));
  });
  ipcMain.handle('local-messages:delete-message', (_event, { userId, type, id, messageId }) => {
    deleteMessageFromConversation(type, id, userId, messageId);
  });
  ipcMain.handle('local-messages:list', (_event, { userId }) => listConversations(userId));
  ipcMain.handle('local-messages:clear', (_event, items) => {
    (Array.isArray(items) ? items : []).forEach(item => {
      try { fs.rmSync(conversationFile(item.type, item.id, item.userId), { force: true }); } catch {}
    });
  });
  ipcMain.handle('local-messages:get-draft', (_event, { userId, type, id }) => {
    return readDrafts(userId)[draftKey(type, id)]?.text || '';
  });
  ipcMain.handle('local-messages:save-draft', (_event, { userId, type, id, text }) => {
    const drafts = readDrafts(userId);
    const key = draftKey(type, id);
    const value = String(text || '');
    if (value) drafts[key] = { text: value, updated_at: new Date().toISOString() };
    else delete drafts[key];
    writeDrafts(userId, drafts);
  });

  ipcMain.handle('notify:new-message', (_event, payload) => {
    if (!mainWindow || mainWindow.isVisible()) return;
    if (!Notification.isSupported()) return;
    const title = payload?.title || 'ChatApp';
    const body = payload?.body || '浣犳敹鍒颁竴鏉℃柊娑堟伅';
    const notification = new Notification({
      title,
      body,
      icon: path.join(__dirname, '..', 'electron-assets', 'app.ico'),
    });
    activeNotifications.add(notification);
    notification.on('click', () => {
      activeNotifications.delete(notification);
      try { notification.close(); } catch {}
      showMainWindow();
    });
    notification.on('close', () => activeNotifications.delete(notification));
    notification.show();
  });
}

function createSplashWindow() {
  splashCreatedTime = Date.now();
  splashWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: false,
    show: true,
    resizable: false,
    backgroundColor: '#000',
  });
  const splashPath = path.join(__dirname, '..', 'client-desktop', 'build-desktop-app', 'splash.html');
  splashWindow.loadFile(splashPath);
  splashWindow.center();
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#f0f2f7',
    title: 'ChatApp',
    icon: path.join(__dirname, '..', 'electron-assets', 'app.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.removeMenu();

  const MIN_SPLASH_MS = 1500;

  const splashFallback = setTimeout(() => {
    mainWindow.show();
    if (splashWindow) {
      splashWindow.destroy();
      splashWindow = null;
    }
  }, 10000);

  mainWindow.once('ready-to-show', () => {
    clearTimeout(splashFallback);
    const elapsed = Date.now() - splashCreatedTime;
    const delay = Math.max(0, MIN_SPLASH_MS - elapsed);
    setTimeout(() => {
      mainWindow.show();
      mainWindow.focus();
      if (splashWindow) {
        splashWindow.destroy();
        splashWindow = null;
      }
    }, delay);
  });

  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
  });

  mainWindow.on('show', clearNotifications);
  mainWindow.on('focus', clearNotifications);
  mainWindow.on('restore', clearNotifications);

  const appBuildPath = path.join(__dirname, '..', 'client-desktop', 'build-desktop-app', 'index.html');
  const electronBuildPath = path.join(__dirname, '..', 'client-desktop', 'build-electron', 'index.html');
  const defaultBuildPath = path.join(__dirname, '..', 'client-desktop', 'build', 'index.html');
  const indexPath = fs.existsSync(appBuildPath) ? appBuildPath : fs.existsSync(electronBuildPath) ? electronBuildPath : defaultBuildPath;
  mainWindow.loadFile(indexPath);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

function createTray() {
  if (tray) return;
  const iconPath = path.join(__dirname, '..', 'electron-assets', 'app.ico');
  tray = new Tray(iconPath);
  tray.setToolTip('ChatApp');
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: '打开',
      click: () => {
        showMainWindow();
      },
    },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]));
  tray.on('click', () => {
    showMainWindow();
  });
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  dialog.showErrorBox('ChatApp', '当前已有正在运行客户端');
  app.exit(0);
}

app.on('second-instance', () => {
  showMainWindow();
});

app.whenReady().then(() => {
  if (!gotTheLock) return;
  registerSettingsHandlers();
  createSplashWindow();
  createMainWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    showMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (isQuitting && process.platform !== 'darwin') app.quit();
});

