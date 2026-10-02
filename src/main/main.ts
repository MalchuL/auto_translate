import path from 'node:path';
import {
  app, BrowserWindow, Menu, Notification, Tray, clipboard, globalShortcut, ipcMain,
  type IpcMainEvent, type IpcMainInvokeEvent, type MenuItemConstructorOptions,
} from 'electron';

import { ClipboardWatcher, type ClipboardSnapshot, type Rejection } from '../core/clipboard-watcher';
import { LANGUAGES } from '../core/languages';
import {
  POLL_INTERVAL_MIN, POLL_INTERVAL_MAX, MAX_TEXT_LENGTH_MIN, MAX_TEXT_LENGTH_MAX, type Settings,
} from '../core/settings-schema';
import type { PublicSettings, SettingsLoadResult, SettingsSaveResult } from '../shared/settings-api';
import { SettingsStore } from './settings-store';
import { TranslatorWindow, type PageStatus } from './translator-window';
import { setLaunchAtLogin } from './autostart';
import { trayIcon, appIcon, type TrayState } from './tray-icons';
import * as log from './log';

const APP_NAME = 'Clipboard Translate Overlay';
const SETTINGS_DIR = path.join(__dirname, '..', 'settings');

type Monitoring = 'active' | 'paused';

if (process.platform === 'linux' && !process.env.CTO_ALLOW_WAYLAND) {
  // Always-on-top and window positioning need X11 (native or XWayland).
  app.commandLine.appendSwitch('ozone-platform', 'x11');
}
if (process.env.CTO_USER_DATA) app.setPath('userData', path.resolve(process.env.CTO_USER_DATA));
app.setName(APP_NAME);

const PLATFORM_TOKENS: Partial<Record<NodeJS.Platform, string>> = {
  darwin: 'Macintosh; Intel Mac OS X 10_15_7',
  win32: 'Windows NT 10.0; Win64; x64',
  linux: 'X11; Linux x86_64',
};
// Present a plain Chrome UA so Google serves the regular Translate page.
app.userAgentFallback = `Mozilla/5.0 (${PLATFORM_TOKENS[process.platform] ?? PLATFORM_TOKENS.linux}) `
  + `AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;

const STATUS_LABELS: Readonly<Record<PageStatus, string>> = {
  idle: 'ожидание текста',
  loading: 'загрузка перевода',
  ready: 'перевод показан',
  offline: 'нет соединения',
  error: 'ошибка загрузки',
};

const READ_ERROR_LOG_INTERVAL_MS = 10_000;

function publicSettings(settings: Settings): PublicSettings {
  const result: Partial<Settings> = { ...settings };
  delete result.windowBounds;
  return result as PublicSettings;
}

// The settings renderer is untrusted input: drop window bounds and let
// sanitizeSettings() validate every other field.
function settingsPatch(values: unknown): Partial<Settings> {
  if (!values || typeof values !== 'object') return {};
  const patch: Record<string, unknown> = { ...values };
  delete patch.windowBounds;
  return patch as Partial<Settings>;
}

// clipboard.read() only lists formats; data is fetched lazily by getType().
async function readClipboardSnapshot(): Promise<ClipboardSnapshot> {
  const items = await clipboard.read();
  const item = items.find((i) => i.types.includes('text/plain')) ?? items[0];
  const readType = async (type: string): Promise<string> => {
    if (!item) return '';
    const data = await item.getType(type);
    return data instanceof Blob ? data.text() : '';
  };
  return {
    formats: item ? item.types : [],
    readText: () => readType('text/plain'),
    readHTML: () => readType('text/html'),
  };
}

function notify(body: string): void {
  if (!Notification.isSupported()) return;
  new Notification({ title: APP_NAME, body, silent: true }).show();
}

class OverlayApp {
  private readonly store: SettingsStore;
  private readonly translator: TranslatorWindow;
  private readonly watcher: ClipboardWatcher;
  private readonly tray: Tray;
  private settingsWindow: BrowserWindow | null = null;

  private monitoring: Monitoring = 'active';
  private page: PageStatus = 'idle';
  private windowVisible = false;
  private registeredHotkey: string | null = null;
  private lastReadErrorAt = 0;

  constructor() {
    this.store = new SettingsStore(app.getPath('userData'));
    // Created first: translator callbacks refresh the tray.
    this.tray = new Tray(trayIcon('active'));
    this.translator = new TranslatorWindow({
      getSettings: () => this.store.get(),
      icon: appIcon(),
      onBoundsChanged: (bounds) => this.store.update({ windowBounds: bounds }, { immediate: false }),
      onStatus: (status) => {
        if (this.page !== status) log.info(`translator: ${status}`);
        this.page = status;
        this.refreshTray();
      },
      onVisibilityChanged: (visible) => {
        this.windowVisible = visible;
        log.info(`window: ${visible ? 'shown' : 'hidden'}`);
        this.refreshTray();
      },
    });
    this.translator.create();

    this.watcher = new ClipboardWatcher({
      clipboard: { snapshot: readClipboardSnapshot },
      getOptions: () => this.store.get(),
      onText: (text) => this.handleNewText(text),
      onRejected: (rejection) => this.handleRejected(rejection),
      onReadError: (error) => this.handleReadError(error),
    });

    this.registerIpc();
    this.tray.on('click', () => this.translator.toggle());
    this.refreshTray();
  }

  async start(): Promise<void> {
    const settings = this.store.get();
    const hotkeyError = this.registerHotkey(settings.hotkey);
    if (hotkeyError) log.warn(`hotkey: ${hotkeyError}`);
    if (settings.launchAtLogin) setLaunchAtLogin(true);

    await this.watcher.start(settings.pollIntervalMs);
    log.info(`ready (poll ${settings.pollIntervalMs} ms, target ${settings.targetLanguage})`);
  }

  showWindow(): void {
    this.translator.show({ focus: true });
  }

  shutdown(): void {
    this.watcher.stop();
    this.store.flush();
    this.translator.destroy();
  }

  private trayState(): TrayState {
    if (this.monitoring === 'paused') return 'paused';
    if (this.page === 'error' || this.page === 'offline') return 'error';
    if (this.page === 'loading') return 'loading';
    return 'active';
  }

  private statusLine(): string {
    const monitoring = this.monitoring === 'paused' ? 'Мониторинг: приостановлен' : 'Мониторинг: активен';
    return `${monitoring} · ${STATUS_LABELS[this.page]}`;
  }

  private setMonitoring(next: Monitoring): void {
    if (this.monitoring === next) return;
    this.monitoring = next;
    if (next === 'paused') this.watcher.pause();
    else void this.watcher.resume();
    log.info(`monitoring: ${next}`);
    this.refreshTray();
  }

  private setTargetLanguage(code: string): void {
    if (this.store.get().targetLanguage === code) return;
    this.store.update({ targetLanguage: code });
    log.info(`settings: target language -> ${code}`);
    if (this.translator.currentText) this.translator.retranslate();
    this.refreshTray();
  }

  private buildTrayMenu(): Menu {
    const { targetLanguage } = this.store.get();
    const paused = this.monitoring === 'paused';
    const template: MenuItemConstructorOptions[] = [
      { label: this.statusLine(), enabled: false },
      { type: 'separator' },
      { label: 'Показать окно', enabled: !this.windowVisible, click: () => this.translator.show({ focus: true }) },
      { label: 'Скрыть окно', enabled: this.windowVisible, click: () => this.translator.hide() },
      { type: 'separator' },
      { label: 'Приостановить перевод', enabled: !paused, click: () => this.setMonitoring('paused') },
      { label: 'Возобновить перевод', enabled: paused, click: () => this.setMonitoring('active') },
      {
        label: 'Целевой язык',
        submenu: LANGUAGES.map(({ code, name }): MenuItemConstructorOptions => ({
          label: `${name} (${code})`,
          type: 'radio',
          checked: targetLanguage === code,
          click: () => this.setTargetLanguage(code),
        })),
      },
      { type: 'separator' },
      { label: 'Настройки…', click: () => this.openSettings() },
      { label: 'Выход', click: () => app.quit() },
    ];
    return Menu.buildFromTemplate(template);
  }

  private refreshTray(): void {
    const { tray } = this;
    if (tray.isDestroyed()) return;
    const iconState = this.trayState();
    tray.setImage(trayIcon(iconState));
    tray.setToolTip(`${APP_NAME}\n${this.statusLine()}`);
    if (process.platform === 'darwin') tray.setTitle(iconState === 'paused' ? '⏸' : '');
    tray.setContextMenu(this.buildTrayMenu());
  }

  /** Returns a user-facing error message, or null on success. */
  private registerHotkey(accelerator: string): string | null {
    if (this.registeredHotkey) {
      globalShortcut.unregister(this.registeredHotkey);
      this.registeredHotkey = null;
    }
    if (!accelerator) return null;
    try {
      if (!globalShortcut.register(accelerator, () => this.translator.toggle())) {
        return 'сочетание занято другим приложением';
      }
      this.registeredHotkey = accelerator;
      return null;
    } catch {
      return 'некорректное сочетание клавиш';
    }
  }

  private handleNewText(text: string): void {
    const { showOnNewText } = this.store.get();
    log.info(`clipboard: new text (${text.length} chars) -> translate${showOnNewText ? ' + reveal' : ''}`);
    this.translator.translate(text, { reveal: showOnNewText });
  }

  private handleRejected({ length }: Rejection): void {
    const { maxTextLength } = this.store.get();
    log.info(`clipboard: text too long (${length} > ${maxTextLength}), skipped`);
    notify(`Текст слишком длинный (${length} символов, лимит ${maxTextLength}). Перевод не запущен.`);
  }

  private handleReadError(error: unknown): void {
    const now = Date.now();
    if (now - this.lastReadErrorAt > READ_ERROR_LOG_INTERVAL_MS) {
      log.warn(`clipboard: read failed (${log.errorCode(error)})`);
    }
    this.lastReadErrorAt = now;
  }

  private applySettings(previous: Settings, next: Settings): string | null {
    if (previous.alwaysOnTop !== next.alwaysOnTop) this.translator.applyAlwaysOnTop(next.alwaysOnTop);
    if (previous.pollIntervalMs !== next.pollIntervalMs) this.watcher.setIntervalMs(next.pollIntervalMs);
    if (previous.launchAtLogin !== next.launchAtLogin) setLaunchAtLogin(next.launchAtLogin);
    if (previous.targetLanguage !== next.targetLanguage && this.translator.currentText) {
      this.translator.retranslate();
    }
    const hotkeyError = previous.hotkey !== next.hotkey || !this.registeredHotkey
      ? this.registerHotkey(next.hotkey)
      : null;
    this.refreshTray();
    return hotkeyError;
  }

  private openSettings(): void {
    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
      this.settingsWindow.show();
      this.settingsWindow.focus();
      return;
    }
    const win = new BrowserWindow({
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
        preload: path.join(SETTINGS_DIR, 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webviewTag: false,
      },
    });
    this.settingsWindow = win;
    win.removeMenu();
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.once('ready-to-show', () => win.show());
    win.on('closed', () => {
      this.settingsWindow = null;
    });
    void win.loadFile(path.join(SETTINGS_DIR, 'renderer', 'settings.html'));
  }

  private isSettingsSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
    const win = this.settingsWindow;
    return Boolean(win && !win.isDestroyed() && event.sender === win.webContents);
  }

  private registerIpc(): void {
    ipcMain.handle('settings:load', (event): SettingsLoadResult => {
      if (!this.isSettingsSender(event)) throw new Error('forbidden');
      return {
        settings: publicSettings(this.store.get()),
        languages: LANGUAGES,
        limits: {
          pollIntervalMin: POLL_INTERVAL_MIN,
          pollIntervalMax: POLL_INTERVAL_MAX,
          maxTextLengthMin: MAX_TEXT_LENGTH_MIN,
          maxTextLengthMax: MAX_TEXT_LENGTH_MAX,
        },
      };
    });
    ipcMain.handle('settings:save', (event, values: unknown): SettingsSaveResult => {
      if (!this.isSettingsSender(event)) throw new Error('forbidden');
      const previous = this.store.get();
      const next = this.store.update(settingsPatch(values));
      const hotkeyError = this.applySettings(previous, next);
      log.info('settings: saved');
      return { settings: publicSettings(next), hotkeyError };
    });
    ipcMain.on('settings:close', (event) => {
      if (this.isSettingsSender(event)) this.settingsWindow?.close();
    });
  }
}

let overlay: OverlayApp | null = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => overlay?.showWindow());
  app.on('window-all-closed', () => {});
  app.on('before-quit', () => overlay?.shutdown());
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.on('activate', () => overlay?.showWindow());
  void app.whenReady().then(async () => {
    if (process.platform === 'darwin') app.dock?.hide();
    overlay = new OverlayApp();
    await overlay.start();
  });
}
