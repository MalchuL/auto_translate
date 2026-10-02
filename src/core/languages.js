'use strict';

const LANGUAGES = [
  { code: 'ru', name: 'Русский' },
  { code: 'en', name: 'English' },
  { code: 'uk', name: 'Українська' },
  { code: 'de', name: 'Deutsch' },
  { code: 'fr', name: 'Français' },
  { code: 'es', name: 'Español' },
  { code: 'it', name: 'Italiano' },
  { code: 'pt', name: 'Português' },
  { code: 'pl', name: 'Polski' },
  { code: 'tr', name: 'Türkçe' },
  { code: 'zh-CN', name: '中文 (简体)' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'ar', name: 'العربية' },
  { code: 'hi', name: 'हिन्दी' },
];

const LANGUAGE_CODES = new Set(LANGUAGES.map((l) => l.code));

module.exports = { LANGUAGES, LANGUAGE_CODES };
