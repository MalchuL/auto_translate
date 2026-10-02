import { LANGUAGE_CODES } from './languages';

export const POLL_INTERVAL_MIN = 200;
export const POLL_INTERVAL_MAX = 1000;
export const MAX_TEXT_LENGTH_MIN = 1;
export const MAX_TEXT_LENGTH_MAX = 5000;

export const WINDOW_DEFAULTS = { width: 520, height: 420, minWidth: 360, minHeight: 240 } as const;

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Settings {
  targetLanguage: string;
  showOnNewText: boolean;
  alwaysOnTop: boolean;
  hotkey: string;
  launchAtLogin: boolean;
  pollIntervalMs: number;
  maxTextLength: number;
  allowHtmlFallback: boolean;
  windowBounds: WindowBounds | null;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  targetLanguage: 'ru',
  showOnNewText: true,
  alwaysOnTop: true,
  hotkey: 'CommandOrControl+Shift+Y',
  launchAtLogin: false,
  pollIntervalMs: 300,
  maxTextLength: 5000,
  allowHtmlFallback: false,
  windowBounds: null,
});

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function sanitizeBounds(bounds: unknown): WindowBounds | null {
  if (!bounds || typeof bounds !== 'object') return null;
  const { x, y, width, height } = bounds as Record<string, unknown>;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(width) || !isFiniteNumber(height)) return null;
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(WINDOW_DEFAULTS.minWidth, Math.round(width)),
    height: Math.max(WINDOW_DEFAULTS.minHeight, Math.round(height)),
  };
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function sanitizeSettings(input: unknown): Settings {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  return {
    targetLanguage: typeof src.targetLanguage === 'string' && LANGUAGE_CODES.has(src.targetLanguage)
      ? src.targetLanguage
      : d.targetLanguage,
    showOnNewText: booleanOr(src.showOnNewText, d.showOnNewText),
    alwaysOnTop: booleanOr(src.alwaysOnTop, d.alwaysOnTop),
    hotkey: typeof src.hotkey === 'string' ? src.hotkey.trim().slice(0, 100) : d.hotkey,
    launchAtLogin: booleanOr(src.launchAtLogin, d.launchAtLogin),
    pollIntervalMs: clampInt(src.pollIntervalMs, POLL_INTERVAL_MIN, POLL_INTERVAL_MAX, d.pollIntervalMs),
    maxTextLength: clampInt(src.maxTextLength, MAX_TEXT_LENGTH_MIN, MAX_TEXT_LENGTH_MAX, d.maxTextLength),
    allowHtmlFallback: booleanOr(src.allowHtmlFallback, d.allowHtmlFallback),
    windowBounds: sanitizeBounds(src.windowBounds),
  };
}
