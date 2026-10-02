// Type-only module shared by the main process, the sandboxed preload (which
// may only require 'electron') and the settings renderer. Keep it free of
// runtime code.
import type { Language } from '../core/languages';
import type { Settings } from '../core/settings-schema';

export type PublicSettings = Omit<Settings, 'windowBounds'>;

export interface SettingsLimits {
  pollIntervalMin: number;
  pollIntervalMax: number;
  maxTextLengthMin: number;
  maxTextLengthMax: number;
}

export interface SettingsLoadResult {
  settings: PublicSettings;
  languages: readonly Language[];
  limits: SettingsLimits;
}

export interface SettingsSaveResult {
  settings: PublicSettings;
  hotkeyError: string | null;
}

export interface SettingsApi {
  load(): Promise<SettingsLoadResult>;
  save(values: Partial<PublicSettings>): Promise<SettingsSaveResult>;
  close(): void;
}

export type SettingsInvokeChannel = 'settings:load' | 'settings:save';
export type SettingsSendChannel = 'settings:close';
