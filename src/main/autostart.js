'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');
const log = require('./log');

const DESKTOP_FILE = 'clipboard-translate-overlay.desktop';

function linuxAutostartPath() {
  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(configHome, 'autostart', DESKTOP_FILE);
}

function quote(arg) {
  return `"${String(arg).replace(/(["`$\\])/g, '\\$1')}"`;
}

function linuxExecLine() {
  if (process.env.APPIMAGE) return quote(process.env.APPIMAGE);
  const args = [process.execPath];
  if (!app.isPackaged) args.push(app.getAppPath());
  return args.map(quote).join(' ');
}

function setLaunchAtLogin(enabled) {
  try {
    if (process.platform !== 'linux') {
      app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: true });
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
    log.warn(`autostart: failed to update (${error.code || error.message})`);
  }
}

module.exports = { setLaunchAtLogin, linuxAutostartPath };
