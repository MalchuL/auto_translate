const TRANSLATE_ORIGIN = 'https://translate.google.com';

export const ALLOWED_HOSTS: ReadonlySet<string> = new Set(['translate.google.com', 'consent.google.com']);

export function buildTranslateUrl(text: string, targetLanguage: string): string {
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

export function isAllowedTranslatorUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol === 'about:' && url.href === 'about:blank') return true;
  return url.protocol === 'https:' && ALLOWED_HOSTS.has(url.hostname);
}

export function isExternalWebUrl(rawUrl: string): boolean {
  try {
    const { protocol } = new URL(rawUrl);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}
