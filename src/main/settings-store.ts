import fs from 'node:fs';
import path from 'node:path';
import { sanitizeSettings, type Settings } from '../core/settings-schema';
import * as log from './log';

export class SettingsStore {
  private readonly file: string;
  private settings: Settings;
  private saveTimer: NodeJS.Timeout | undefined;

  constructor(directory: string) {
    this.file = path.join(directory, 'settings.json');
    this.settings = sanitizeSettings(this.readFile());
  }

  private readFile(): unknown {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') log.warn('settings: unreadable file, using defaults');
      return null;
    }
  }

  get(): Settings {
    return this.settings;
  }

  update(patch: Partial<Settings>, { immediate = true }: { immediate?: boolean } = {}): Settings {
    this.settings = sanitizeSettings({ ...this.settings, ...patch });
    if (immediate) this.flush();
    else this.scheduleFlush();
    return this.settings;
  }

  private scheduleFlush(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 500);
  }

  flush(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, `${JSON.stringify(this.settings, null, 2)}\n`, 'utf8');
      fs.renameSync(tmp, this.file);
    } catch (error) {
      log.warn(`settings: failed to save (${log.errorCode(error)})`);
    }
  }
}
