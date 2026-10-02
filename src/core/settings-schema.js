'use strict';

const { LANGUAGE_CODES } = require('./languages');

const POLL_INTERVAL_MIN = 200;
const POLL_INTERVAL_MAX = 1000;
const MAX_TEXT_LENGTH_MIN = 1;
const MAX_TEXT_LENGTH_MAX = 5000;

const WINDOW_DEFAULTS = { width: 520, height: 420, minWidth: 360, minHeight: 240 };

const DEFAULT_SETTINGS = Object.freeze({
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

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function sanitizeBounds(bounds) {
  if (!bounds || typeof bounds !== 'object') return null;
  const { x, y, width, height } = bounds;
  if (![x, y, width, height].every(Number.isFinite)) return null;
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(WINDOW_DEFAULTS.minWidth, Math.round(width)),
    height: Math.max(WINDOW_DEFAULTS.minHeight, Math.round(height)),
  };
}

function sanitizeSettings(input) {
  const src = input && typeof input === 'object' ? input : {};
  const d = DEFAULT_SETTINGS;
  return {
    targetLanguage: LANGUAGE_CODES.has(src.targetLanguage) ? src.targetLanguage : d.targetLanguage,
    showOnNewText: typeof src.showOnNewText === 'boolean' ? src.showOnNewText : d.showOnNewText,
    alwaysOnTop: typeof src.alwaysOnTop === 'boolean' ? src.alwaysOnTop : d.alwaysOnTop,
    hotkey: typeof src.hotkey === 'string' ? src.hotkey.trim().slice(0, 100) : d.hotkey,
    launchAtLogin: typeof src.launchAtLogin === 'boolean' ? src.launchAtLogin : d.launchAtLogin,
    pollIntervalMs: clampInt(src.pollIntervalMs, POLL_INTERVAL_MIN, POLL_INTERVAL_MAX, d.pollIntervalMs),
    maxTextLength: clampInt(src.maxTextLength, MAX_TEXT_LENGTH_MIN, MAX_TEXT_LENGTH_MAX, d.maxTextLength),
    allowHtmlFallback: typeof src.allowHtmlFallback === 'boolean' ? src.allowHtmlFallback : d.allowHtmlFallback,
    windowBounds: sanitizeBounds(src.windowBounds),
  };
}

module.exports = {
  DEFAULT_SETTINGS,
  WINDOW_DEFAULTS,
  POLL_INTERVAL_MIN,
  POLL_INTERVAL_MAX,
  MAX_TEXT_LENGTH_MIN,
  MAX_TEXT_LENGTH_MAX,
  sanitizeSettings,
};
