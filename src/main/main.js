'use strict';

const path = require('node:path');
const { app, BrowserWindow, Menu, Notification, Tray, clipboard, globalShortcut, ipcMain } = require('electron');

const { ClipboardWatcher } = require('../core/clipboard-watcher');
const { LANGUAGES } = require('../core/languages');
const {
  POLL_INTERVAL_MIN, POLL_INTERVAL_MAX, MAX_TEXT_LENGTH_MIN, MAX_TEXT_LENGTH_MAX,
} = require('../core/settings-schema');
const { SettingsStore } = require('./settings-store');
const { TranslatorWindow } = require('./translator-window');
const { setLaunchAtLogin } = require('./autostart');
const { trayIcon, appIcon } = require('./tray-icons');
const log = require('./log');

const APP_NAME = 'Clipboard Translate Overlay';

if (process.platform === 'linux' && !process.env.CTO_ALLOW_WAYLAND) {
  // Always-on-top and window positioning need X11 (native or XWayland).
  app.commandLine.appendSwitch('ozone-platform', 'x11');
}
if (process.env.CTO_USER_DATA) app.setPath('userData', path.resolve(process.env.CTO_USER_DATA));
app.setName(APP_NAME);

const PLATFORM_TOKENS = {
  darwin: 'Macintosh; Intel Mac OS X 10_15_7',
  win32: 'Windows NT 10.0; Win64; x64',
  linux: 'X11; Linux x86_64',
};
// Present a plain Chrome UA so Google serves the regular Translate page.
app.userAgentFallback = `Mozilla/5.0 (${PLATFORM_TOKENS[process.platform] || PLATFORM_TOKENS.linux}) `
  + `AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;

const state = {
  monitoring: 'active',
  page: 'idle',
  windowVisible: false,
  registeredHotkey: null,
};

let store;
let translator;
let watcher;
let tray;
let settingsWindow = null;

const STATUS_LABELS = {
  idle: 'ожидание текста',
  loading: 'загрузка перевода',
  ready: 'перевод показан',
  offline: 'нет соединения',
  error: 'ошибка загрузки',
};

function trayState() {
  if (state.monitoring === 'paused') return 'paused';
  if (state.page === 'error' || state.page === 'offline') return 'error';
  if (state.page === 'loading') return 'loading';
  return 'active';
}

function statusLine() {
  const monitoring = state.monitoring === 'paused' ? 'Мониторинг: приостановлен' : 'Мониторинг: активен';
  return `${monitoring} · ${STATUS_LABELS[state.page]}`;
}

function setMonitoring(next) {
  if (state.monitoring === next) return;
  state.monitoring = next;
  if (next === 'paused') watcher.pause();
  else watcher.resume();
  log.info(`monitoring: ${next}`);
  refreshTray();
}

function setTargetLanguage(code) {
  if (store.get().targetLanguage === code) return;
  store.update({ targetLanguage: code });
  log.info(`settings: target language -> ${code}`);
  if (translator.currentText) translator.retranslate();
  refreshTray();
}

function buildTrayMenu() {
  const settings = store.get();
  const paused = state.monitoring === 'paused';
  return Menu.buildFromTemplate([
    { label: statusLine(), enabled: false },
    { type: 'separator' },
    { label: 'Показать окно', enabled: !state.windowVisible, click: () => translator.show({ focus: true }) },
    { label: 'Скрыть окно', enabled: state.windowVisible, click: () => translator.hide() },
    { type: 'separator' },
    { label: 'Приостановить перевод', enabled: !paused, click: () => setMonitoring('paused') },
    { label: 'Возобновить перевод', enabled: paused, click: () => setMonitoring('active') },
    {
      label: 'Целевой язык',
      submenu: LANGUAGES.map(({ code, name }) => ({
        label: `${name} (${code})`,
        type: 'radio',
        checked: settings.targetLanguage === code,
        click: () => setTargetLanguage(code),
      })),
    },
    { type: 'separator' },
    { label: 'Настройки…', click: openSettings },
    { label: 'Выход', click: quit },
  ]);
}

function refreshTray() {
  if (!tray || tray.isDestroyed()) return;
  const iconState = trayState();
  tray.setImage(trayIcon(iconState));
  tray.setToolTip(`${APP_NAME}\n${statusLine()}`);
  if (process.platform === 'darwin') tray.setTitle(iconState === 'paused' ? '⏸' : '');
  tray.setContextMenu(buildTrayMenu());
}

function createTray() {
  tray = new Tray(trayIcon('active'));
  tray.on('click', () => translator.toggle());
  refreshTray();
}

function registerHotkey(accelerator) {
  if (state.registeredHotkey) {
    globalShortcut.unregister(state.registeredHotkey);
    state.registeredHotkey = null;
  }
  if (!accelerator) return null;
  try {
    if (!globalShortcut.register(accelerator, () => translator.toggle())) {
      return 'сочетание занято другим приложением';
    }
    state.registeredHotkey = accelerator;
    return null;
  } catch {
    return 'некорректное сочетание клавиш';
  }
}

function notify(body) {
  if (!Notification.isSupported()) return;
  new Notification({ title: APP_NAME, body, silent: true }).show();
}

function handleNewText(text) {
  const { showOnNewText } = store.get();
  log.info(`clipboard: new text (${text.length} chars) -> translate${showOnNewText ? ' + reveal' : ''}`);
  translator.translate(text, { reveal: showOnNewText });
}

function handleRejected({ reason, length }) {
  if (reason !== 'too-long') return;
  const { maxTextLength } = store.get();
  log.info(`clipboard: text too long (${length} > ${maxTextLength}), skipped`);
  notify(`Текст слишком длинный (${length} символов, лимит ${maxTextLength}). Перевод не запущен.`);
}

// clipboard.read() only lists formats; data is fetched lazily by getType().
async function readClipboardSnapshot() {
  const items = await clipboard.read();
  const item = items.find((i) => i.types.includes('text/plain')) || items[0];
  const readType = async (type) => (await item.getType(type)).text();
  return {
    formats: item ? item.types : [],
    readText: () => readType('text/plain'),
    readHTML: () => readType('text/html'),
  };
}

let lastReadErrorAt = 0;
function handleReadError(error) {
  const now = Date.now();
  if (now - lastReadErrorAt > 10000) log.warn(`clipboard: read failed (${error.name})`);
  lastReadErrorAt = now;
}

function applySettings(previous, next) {
  if (previous.alwaysOnTop !== next.alwaysOnTop) translator.applyAlwaysOnTop(next.alwaysOnTop);
  if (previous.pollIntervalMs !== next.pollIntervalMs) watcher.setIntervalMs(next.pollIntervalMs);
  if (previous.launchAtLogin !== next.launchAtLogin) setLaunchAtLogin(next.launchAtLogin);
  if (previous.targetLanguage !== next.targetLanguage && translator.currentText) translator.retranslate();
  const hotkeyError = previous.hotkey !== next.hotkey || !state.registeredHotkey
    ? registerHotkey(next.hotkey)
    : null;
  refreshTray();
  return hotkeyError;
}

function publicSettings(settings) {
  const { windowBounds, ...rest } = settings;
  return rest;
}

function openSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 480,
    height: 600,
    useContentSize: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    // Otherwise it opens underneath the always-on-top translator window.
    alwaysOnTop: true,
    title: `Настройки — ${APP_NAME}`,
    icon: appIcon(),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'settings', 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false,
    },
  });
  settingsWindow.removeMenu();
  settingsWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  settingsWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  settingsWindow.once('ready-to-show', () => settingsWindow.show());
  settingsWindow.on('closed', () => { settingsWindow = null; });
  settingsWindow.loadFile(path.join(__dirname, '..', 'settings', 'settings.html'));
}

function isSettingsSender(event) {
  return Boolean(settingsWindow && !settingsWindow.isDestroyed() && event.sender === settingsWindow.webContents);
}

function registerIpc() {
  ipcMain.handle('settings:load', (event) => {
    if (!isSettingsSender(event)) throw new Error('forbidden');
    return {
      settings: publicSettings(store.get()),
      languages: LANGUAGES,
      limits: {
        pollIntervalMin: POLL_INTERVAL_MIN,
        pollIntervalMax: POLL_INTERVAL_MAX,
        maxTextLengthMin: MAX_TEXT_LENGTH_MIN,
        maxTextLengthMax: MAX_TEXT_LENGTH_MAX,
      },
    };
  });
  ipcMain.handle('settings:save', (event, values) => {
    if (!isSettingsSender(event)) throw new Error('forbidden');
    const previous = store.get();
    const { windowBounds, ...patch } = values && typeof values === 'object' ? values : {};
    const next = store.update(patch);
    const hotkeyError = applySettings(previous, next);
    log.info('settings: saved');
    return { settings: publicSettings(next), hotkeyError };
  });
  ipcMain.on('settings:close', (event) => {
    if (isSettingsSender(event)) settingsWindow.close();
  });
}

function quit() {
  app.quit();
}

function bootstrap() {
  if (process.platform === 'darwin' && app.dock) app.dock.hide();

  store = new SettingsStore(app.getPath('userData'));
  translator = new TranslatorWindow({
    getSettings: () => store.get(),
    icon: appIcon(),
    onBoundsChanged: (bounds) => store.update({ windowBounds: bounds }, { immediate: false }),
    onStatus: (status) => {
      if (state.page !== status) log.info(`translator: ${status}`);
      state.page = status;
      refreshTray();
    },
    onVisibilityChanged: (visible) => {
      state.windowVisible = visible;
      log.info(`window: ${visible ? 'shown' : 'hidden'}`);
      refreshTray();
    },
  });
  translator.create();

  watcher = new ClipboardWatcher({
    clipboard: { snapshot: readClipboardSnapshot },
    getOptions: () => store.get(),
    onText: handleNewText,
    onRejected: handleRejected,
    onReadError: handleReadError,
  });

  registerIpc();
  createTray();
  const hotkeyError = registerHotkey(store.get().hotkey);
  if (hotkeyError) log.warn(`hotkey: ${hotkeyError}`);
  if (store.get().launchAtLogin) setLaunchAtLogin(true);

  watcher.start(store.get().pollIntervalMs);
  log.info(`ready (poll ${store.get().pollIntervalMs} ms, target ${store.get().targetLanguage})`);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => translator && translator.show({ focus: true }));
  app.on('window-all-closed', () => {});
  app.on('before-quit', () => {
    if (watcher) watcher.stop();
    if (store) store.flush();
    if (translator) translator.destroy();
  });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('activate', () => translator && translator.show({ focus: true }));
  app.whenReady().then(bootstrap);
}
