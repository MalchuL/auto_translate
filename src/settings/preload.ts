import { contextBridge, ipcRenderer } from 'electron';
import type {
  SettingsApi, SettingsInvokeChannel, SettingsLoadResult, SettingsSaveResult, SettingsSendChannel,
} from '../shared/settings-api';

const invoke = <T>(channel: SettingsInvokeChannel, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args) as Promise<T>;
const send = (channel: SettingsSendChannel): void => ipcRenderer.send(channel);

const api: SettingsApi = {
  load: () => invoke<SettingsLoadResult>('settings:load'),
  save: (values) => invoke<SettingsSaveResult>('settings:save', values),
  close: () => send('settings:close'),
};

contextBridge.exposeInMainWorld('settingsApi', api);
