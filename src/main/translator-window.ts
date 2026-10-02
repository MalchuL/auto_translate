import path from 'node:path';
import { BrowserWindow, net, screen, session, shell, type Event, type NativeImage, type Session } from 'electron';
import { WINDOW_DEFAULTS, type Settings, type WindowBounds } from '../core/settings-schema';
import { buildTranslateUrl, isAllowedTranslatorUrl, isExternalWebUrl } from '../core/translate-url';
import { measureSkew, removeSkew, type BoundsSkew, type RequestedBounds } from '../core/bounds-skew';
import * as log from './log';

const ERROR_PAGE = path.join(__dirname, '..', 'pages', 'error.html');
const RETRY_DELAY_MS = 1500;
const SKEW_SETTLE_MS = 400;
const ERR_ABORTED = -3;
const ERR_RENDERER_GONE = -2;
const OFFLINE_ERRORS: ReadonlySet<number> = new Set([-106, -105, -21, -137]);
const WINDOW_TITLE = 'Clipboard Translate Overlay';

// No "persist:" prefix: cookies, cache and storage live in memory only, so
// copied text that ends up in URLs or page storage never reaches the disk.
const PARTITION = 'translator';

export type PageStatus = 'idle' | 'loading' | 'ready' | 'offline' | 'error';

export interface TranslatorWindowOptions {
  getSettings: () => Settings;
  onBoundsChanged: (bounds: WindowBounds) => void;
  onStatus: (status: PageStatus) => void;
  onVisibilityChanged: (visible: boolean) => void;
  icon: NativeImage;
}

function hardenSession(ses: Session): void {
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.setDevicePermissionHandler(() => false);
}

function boundsAreVisible(bounds: WindowBounds): boolean {
  return screen.getAllDisplays().some(({ workArea: a }) =>
    bounds.x < a.x + a.width - 40
    && bounds.x + bounds.width > a.x + 40
    && bounds.y >= a.y - 10
    && bounds.y < a.y + a.height - 40);
}

export class TranslatorWindow {
  currentText: string | null = null;
  status: PageStatus = 'idle';

  private readonly options: TranslatorWindowOptions;
  private win: BrowserWindow | null = null;
  private allowClose = false;
  private requestId = 0;
  private attempt = 0;
  private loadFailed = false;
  private retryTimer: NodeJS.Timeout | undefined;
  private requestedBounds: RequestedBounds = { width: WINDOW_DEFAULTS.width, height: WINDOW_DEFAULTS.height };
  private skew: BoundsSkew | null = null;

  constructor(options: TranslatorWindowOptions) {
    this.options = options;
  }

  create(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win;
    const settings = this.options.getSettings();
    const saved = settings.windowBounds;
    const bounds: RequestedBounds = saved && boundsAreVisible(saved)
      ? saved
      : { width: WINDOW_DEFAULTS.width, height: WINDOW_DEFAULTS.height };
    this.requestedBounds = bounds;
    this.skew = null;

    const ses = session.fromPartition(PARTITION);
    hardenSession(ses);

    const win = new BrowserWindow({
      ...bounds,
      // Width/height are the page size; frame extents differ between window managers.
      useContentSize: true,
      minWidth: WINDOW_DEFAULTS.minWidth,
      minHeight: WINDOW_DEFAULTS.minHeight,
      show: false,
      title: WINDOW_TITLE,
      icon: this.options.icon,
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
    this.win = win;
    win.removeMenu();
    this.applyAlwaysOnTop(settings.alwaysOnTop);
    this.attachGuards(win);
    this.attachLifecycle(win);
    return win;
  }

  private attachGuards(win: BrowserWindow): void {
    const wc = win.webContents;
    const blockUnexpected = (event: Event, url: string): void => {
      if (isAllowedTranslatorUrl(url)) return;
      event.preventDefault();
      if (isExternalWebUrl(url)) void shell.openExternal(url);
      log.info('translator: blocked navigation to non-translate origin');
    };
    wc.on('will-navigate', (event) => blockUnexpected(event, event.url));
    wc.on('will-redirect', (event) => {
      if (event.isMainFrame) blockUnexpected(event, event.url);
    });
    wc.setWindowOpenHandler(({ url }) => {
      if (isExternalWebUrl(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    wc.on('will-attach-webview', (event) => event.preventDefault());
  }

  private attachLifecycle(win: BrowserWindow): void {
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

    const currentBounds = (): WindowBounds => {
      const [x = 0, y = 0] = win.getPosition();
      const [width = 0, height = 0] = win.getContentSize();
      return { x, y, width, height };
    };
    const emitBounds = (): void => {
      if (this.skew === null || win.isMinimized() || win.isMaximized() || win.isFullScreen()) return;
      this.options.onBoundsChanged(removeSkew(currentBounds(), this.skew));
    };
    win.once('show', () => {
      setTimeout(() => {
        if (win.isDestroyed()) return;
        this.skew = measureSkew(this.requestedBounds, currentBounds());
      }, SKEW_SETTLE_MS);
    });
    win.on('resize', emitBounds);
    win.on('move', emitBounds);
    win.on('show', () => this.options.onVisibilityChanged(true));
    win.on('hide', () => this.options.onVisibilityChanged(false));

    // Chromium fires did-finish-load for its own error page after a failure.
    wc.on('did-finish-load', () => {
      if (!this.loadFailed && isAllowedTranslatorUrl(wc.getURL())) this.setStatus('ready');
    });
    wc.on('did-fail-load', (_event, errorCode, _description, _url, isMainFrame) => {
      if (!isMainFrame || errorCode === ERR_ABORTED) return;
      this.loadFailed = true;
      this.handleLoadFailure(errorCode);
    });
    wc.on('render-process-gone', () => this.handleLoadFailure(ERR_RENDERER_GONE));
  }

  private setStatus(status: PageStatus): void {
    this.status = status;
    this.options.onStatus(status);
  }

  private handleLoadFailure(errorCode: number): void {
    const offline = OFFLINE_ERRORS.has(errorCode) || !net.isOnline();
    log.info(`translator: load failed (code=${errorCode}, attempt=${this.attempt + 1})`);
    if (this.attempt === 0) {
      this.attempt = 1;
      const { requestId } = this;
      clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => {
        if (requestId === this.requestId) this.load();
      }, RETRY_DELAY_MS);
      return;
    }
    const status: PageStatus = offline ? 'offline' : 'error';
    this.setStatus(status);
    this.create()
      .loadFile(ERROR_PAGE, { query: { reason: status, code: String(errorCode) } })
      .catch(() => {});
  }

  private url(): string {
    return buildTranslateUrl(this.currentText ?? '', this.options.getSettings().targetLanguage);
  }

  private load(): void {
    const win = this.create();
    this.loadFailed = false;
    this.setStatus('loading');
    win.loadURL(this.url()).catch(() => {});
  }

  translate(text: string, { reveal }: { reveal: boolean }): void {
    this.create();
    this.currentText = text;
    this.requestId += 1;
    this.attempt = 0;
    clearTimeout(this.retryTimer);
    this.load();
    if (reveal) this.show({ focus: false });
  }

  retranslate(): void {
    if (!this.win || this.win.isDestroyed()) return;
    this.requestId += 1;
    this.attempt = 0;
    clearTimeout(this.retryTimer);
    this.load();
  }

  isVisible(): boolean {
    return Boolean(this.win && !this.win.isDestroyed() && this.win.isVisible());
  }

  show({ focus = true }: { focus?: boolean } = {}): void {
    const win = this.create();
    if (!win.webContents.getURL()) this.load();
    if (win.isMinimized()) win.restore();
    if (focus) {
      win.show();
      win.focus();
    } else if (!win.isVisible()) {
      win.showInactive();
    }
    this.applyAlwaysOnTop(this.options.getSettings().alwaysOnTop);
  }

  hide(): void {
    if (this.isVisible()) this.win?.hide();
  }

  toggle(): void {
    if (this.isVisible()) this.hide();
    else this.show({ focus: true });
  }

  applyAlwaysOnTop(enabled: boolean): void {
    const { win } = this;
    if (!win || win.isDestroyed()) return;
    if (process.platform === 'darwin') {
      win.setAlwaysOnTop(enabled, 'floating');
      win.setVisibleOnAllWorkspaces(enabled, { visibleOnFullScreen: true });
    } else {
      win.setAlwaysOnTop(enabled);
    }
  }

  destroy(): void {
    clearTimeout(this.retryTimer);
    this.allowClose = true;
    this.currentText = null;
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
  }
}
