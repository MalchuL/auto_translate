'use strict';

const TRANSLATE_ORIGIN = 'https://translate.google.com';

const ALLOWED_HOSTS = new Set(['translate.google.com', 'consent.google.com']);

function buildTranslateUrl(text, targetLanguage) {
  const params = new URLSearchParams({
    sl: 'auto',
    tl: targetLanguage,
    text,
    op: 'translate',
  });
  // URLSearchParams encodes spaces as '+'; Google Translate expects %20 so
  // literal '+' characters in the text survive.
  return `${TRANSLATE_ORIGIN}/?${params.toString().replace(/\+/g, '%20')}`;
}

function isAllowedTranslatorUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol === 'about:' && url.href === 'about:blank') return true;
  return url.protocol === 'https:' && ALLOWED_HOSTS.has(url.hostname);
}

function isExternalWebUrl(rawUrl) {
  try {
    const { protocol } = new URL(rawUrl);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

module.exports = { buildTranslateUrl, isAllowedTranslatorUrl, isExternalWebUrl, ALLOWED_HOSTS };
