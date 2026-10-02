'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { sanitizeSettings } = require('../core/settings-schema');
const log = require('./log');

class SettingsStore {
  constructor(directory) {
    this.file = path.join(directory, 'settings.json');
    this.settings = sanitizeSettings(this.readFile());
    this.saveTimer = null;
  }

  readFile() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') log.warn('settings: unreadable file, using defaults');
      return null;
    }
  }

  get() {
    return this.settings;
  }

  update(patch, { immediate = true } = {}) {
    this.settings = sanitizeSettings({ ...this.settings, ...patch });
    if (immediate) this.flush();
    else this.scheduleFlush();
    return this.settings;
  }

  scheduleFlush() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 500);
  }

  flush() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, `${JSON.stringify(this.settings, null, 2)}\n`, 'utf8');
      fs.renameSync(tmp, this.file);
    } catch (error) {
      log.warn(`settings: failed to save (${error.code || error.message})`);
    }
  }
}

module.exports = { SettingsStore };
