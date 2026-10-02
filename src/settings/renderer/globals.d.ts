import type { SettingsApi } from '../../shared/settings-api';

declare global {
  interface Window {
    readonly settingsApi: SettingsApi;
  }
}

export {};
