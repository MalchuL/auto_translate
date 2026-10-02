import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import * as log from './log';

const DESKTOP_FILE = 'clipboard-translate-overlay.desktop';

export function linuxAutostartPath(): string {
  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(configHome, 'autostart', DESKTOP_FILE);
}

function quote(arg: string): string {
  return `"${arg.replace(/(["`$\\])/g, '\\$1')}"`;
}

function linuxExecLine(): string {
  if (process.env.APPIMAGE) return quote(process.env.APPIMAGE);
  const args = [process.execPath];
  if (!app.isPackaged) args.push(app.getAppPath());
  return args.map(quote).join(' ');
}

export function setLaunchAtLogin(enabled: boolean): void {
  try {
    if (process.platform !== 'linux') {
      app.setLoginItemSettings({ openAtLogin: enabled });
      return;
    }
    const file = linuxAutostartPath();
    if (!enabled) {
      fs.rmSync(file, { force: true });
      return;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      [
        '[Desktop Entry]',
        'Type=Application',
        'Name=Clipboard Translate Overlay',
        `Exec=${linuxExecLine()}`,
        'X-GNOME-Autostart-enabled=true',
        'Terminal=false',
        '',
      ].join('\n'),
      'utf8',
    );
  } catch (error) {
    log.warn(`autostart: failed to update (${log.errorCode(error)})`);
  }
}
