'use strict';

const path = require('node:path');
const { BrowserWindow, net, screen, session, shell } = require('electron');
const { WINDOW_DEFAULTS } = require('../core/settings-schema');
const { buildTranslateUrl, isAllowedTranslatorUrl, isExternalWebUrl } = require('../core/translate-url');
const log = require('./log');

const ERROR_PAGE = path.join(__dirname, '..', 'pages', 'error.html');
const RETRY_DELAY_MS = 1500;
const ERR_ABORTED = -3;
const OFFLINE_ERRORS = new Set([-106, -105, -21, -137]);
const WINDOW_TITLE = 'Clipboard Translate Overlay';

// No "persist:" prefix: cookies, cache and storage live in memory only, so
// copied text that ends up in URLs or page storage never reaches the disk.
const PARTITION = 'translator';

function hardenSession(ses) {
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.setDevicePermissionHandler(() => false);
}

function boundsAreVisible(bounds) {
  return screen.getAllDisplays().some(({ workArea: a }) =>
    bounds.x < a.x + a.width - 40
    && bounds.x + bounds.width > a.x + 40
    && bounds.y >= a.y - 10
    && bounds.y < a.y + a.height - 40);
}

class TranslatorWindow {
  constructor({ getSettings, onBoundsChanged, onStatus, onVisibilityChanged, icon }) {
    this.getSettings = getSettings;
    this.onBoundsChanged = onBoundsChanged;
    this.onStatus = onStatus;
    this.onVisibilityChanged = onVisibilityChanged;
    this.icon = icon;
    this.win = null;
    this.allowClose = false;
    this.currentText = null;
    this.requestId = 0;
    this.attempt = 0;
    this.retryTimer = null;
    this.status = 'idle';
  }

  create() {
    if (this.win && !this.win.isDestroyed()) return this.win;
    const settings = this.getSettings();
    const saved = settings.windowBounds;
    const bounds = saved && boundsAreVisible(saved) ? saved : { width: WINDOW_DEFAULTS.width, height: WINDOW_DEFAULTS.height };

    const ses = session.fromPartition(PARTITION);
    hardenSession(ses);

    this.win = new BrowserWindow({
      ...bounds,
      minWidth: WINDOW_DEFAULTS.minWidth,
      minHeight: WINDOW_DEFAULTS.minHeight,
      show: false,
      title: WINDOW_TITLE,
      icon: this.icon,
      alwaysOnTop: settings.alwaysOnTop,
      skipTaskbar: false,
      autoHideMenuBar: true,
      backgroundColor: '#ffffff',
      webPreferences: {
        session: ses,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        spellcheck: false,
        navigateOnDragDrop: false,
        backgroundThrottling: false,
      },
    });
    this.win.removeMenu();
    this.applyAlwaysOnTop(settings.alwaysOnTop);
    this.attachGuards();
    this.attachLifecycle();
    return this.win;
  }

  attachGuards() {
    const wc = this.win.webContents;
    const blockUnexpected = (event, url) => {
      if (isAllowedTranslatorUrl(url)) return;
      event.preventDefault();
      if (isExternalWebUrl(url)) shell.openExternal(url);
      log.info('translator: blocked navigation to non-translate origin');
    };
    wc.on('will-navigate', blockUnexpected);
    wc.on('will-redirect', (event) => {
      if (event.isMainFrame) blockUnexpected(event, event.url);
    });
    wc.setWindowOpenHandler(({ url }) => {
      if (isExternalWebUrl(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    wc.on('will-attach-webview', (event) => event.preventDefault());
  }

  attachLifecycle() {
    const { win } = this;
    const wc = win.webContents;

    win.on('page-title-updated', (event) => {
      event.preventDefault();
      win.setTitle(WINDOW_TITLE);
    });

    win.on('close', (event) => {
      if (this.allowClose) return;
      event.preventDefault();
      this.hide();
    });

    const emitBounds = () => {
      if (!win.isMinimized() && !win.isMaximized() && !win.isFullScreen()) {
        this.onBoundsChanged(win.getNormalBounds());
      }
    };
    win.on('resize', emitBounds);
    win.on('move', emitBounds);
    win.on('show', () => this.onVisibilityChanged(true));
    win.on('hide', () => this.onVisibilityChanged(false));

    wc.on('did-finish-load', () => {
      if (this.isTranslatePage()) {
        this.attempt = 0;
        this.setStatus('ready');
      }
    });
    wc.on('did-fail-load', (_event, errorCode, _description, _url, isMainFrame) => {
      if (!isMainFrame || errorCode === ERR_ABORTED) return;
      this.handleLoadFailure(errorCode);
    });
    wc.on('render-process-gone', () => this.handleLoadFailure(-2));
  }

  isTranslatePage() {
    return isAllowedTranslatorUrl(this.win.webContents.getURL());
  }

  setStatus(status, detail = {}) {
    this.status = status;
    this.onStatus(status, detail);
  }

  handleLoadFailure(errorCode) {
    const offline = OFFLINE_ERRORS.has(errorCode) || !net.isOnline();
    log.info(`translator: load failed (code=${errorCode}, attempt=${this.attempt + 1})`);
    if (this.attempt === 0) {
      this.attempt = 1;
      const requestId = this.requestId;
      clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => {
        if (requestId === this.requestId) this.load();
      }, RETRY_DELAY_MS);
      return;
    }
    const status = offline ? 'offline' : 'error';
    this.setStatus(status, { errorCode });
    this.win.loadFile(ERROR_PAGE, { query: { reason: status, code: String(errorCode) } }).catch(() => {});
  }

  url() {
    const { targetLanguage } = this.getSettings();
    return buildTranslateUrl(this.currentText || '', targetLanguage);
  }

  load() {
    this.create();
    this.setStatus('loading', { retry: this.attempt > 0 });
    this.win.loadURL(this.url()).catch(() => {});
  }

  translate(text, { reveal }) {
    this.create();
    this.currentText = text;
    this.requestId += 1;
    this.attempt = 0;
    clearTimeout(this.retryTimer);
    this.load();
    if (reveal) this.show({ focus: false });
  }

  retranslate() {
    if (!this.win || this.win.isDestroyed()) return;
    this.requestId += 1;
    this.attempt = 0;
    this.load();
  }

  isVisible() {
    return Boolean(this.win && !this.win.isDestroyed() && this.win.isVisible());
  }

  show({ focus = true } = {}) {
    this.create();
    if (!this.win.webContents.getURL()) this.load();
    if (this.win.isMinimized()) this.win.restore();
    if (focus) {
      this.win.show();
      this.win.focus();
    } else if (!this.win.isVisible()) {
      this.win.showInactive();
    }
    this.applyAlwaysOnTop(this.getSettings().alwaysOnTop);
  }

  hide() {
    if (this.isVisible()) this.win.hide();
  }

  toggle() {
    if (this.isVisible()) this.hide();
    else this.show({ focus: true });
  }

  applyAlwaysOnTop(enabled) {
    if (!this.win || this.win.isDestroyed()) return;
    if (process.platform === 'darwin') {
      this.win.setAlwaysOnTop(enabled, 'floating');
      this.win.setVisibleOnAllWorkspaces(enabled, { visibleOnFullScreen: true });
    } else {
      this.win.setAlwaysOnTop(enabled);
    }
  }

  destroy() {
    clearTimeout(this.retryTimer);
    this.allowClose = true;
    this.currentText = null;
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
  }
}

module.exports = { TranslatorWindow };
