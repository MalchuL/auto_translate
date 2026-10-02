'use strict';

function normalizeText(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\r\n?/g, '\n').trim();
}

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1].toLowerCase() === 'x'
        ? parseInt(entity.slice(2), 16)
        : parseInt(entity.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    const named = NAMED_ENTITIES[entity.toLowerCase()];
    return named === undefined ? match : named;
  });
}

function htmlToPlainText(html) {
  if (typeof html !== 'string' || html.length === 0) return '';
  const text = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|head|template|noscript)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote|pre|section|article|header|footer)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
  return decodeEntities(text);
}

module.exports = { normalizeText, htmlToPlainText };
