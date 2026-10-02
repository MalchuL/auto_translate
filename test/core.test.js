'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeText, htmlToPlainText } = require('../src/core/text');
const { classifyFormats } = require('../src/core/formats');
const { buildTranslateUrl, isAllowedTranslatorUrl } = require('../src/core/translate-url');
const { sanitizeSettings, DEFAULT_SETTINGS } = require('../src/core/settings-schema');

test('normalizeText trims outer whitespace and unifies line endings only', () => {
  assert.equal(normalizeText('  hello  world \r\nnext\rline\n\n'), 'hello  world \nnext\nline');
  assert.equal(normalizeText('   \n\t '), '');
  assert.equal(normalizeText(undefined), '');
});

test('htmlToPlainText strips markup, scripts and decodes entities', () => {
  const html = '<style>p{}</style><p>Hello&nbsp;<b>world</b> &amp; co</p><div>Line&#33;<br>two &#x263A;</div><script>x()</script>';
  assert.equal(normalizeText(htmlToPlainText(html)), 'Hello world & co\nLine!\ntwo ☺');
});

test('classifyFormats prefers text/plain', () => {
  assert.deepEqual(classifyFormats(['text/html', 'text/plain']), { kind: 'plain', reason: 'text/plain' });
  assert.equal(classifyFormats(['TEXT/PLAIN;charset=utf-8']).kind, 'plain');
});

test('classifyFormats uses html only as an opt-in fallback', () => {
  assert.equal(classifyFormats(['text/html']).kind, null);
  assert.equal(classifyFormats(['text/html'], { allowHtmlFallback: true }).kind, 'html');
});

test('classifyFormats rejects images, files and custom types', () => {
  assert.equal(classifyFormats(['image/png']).reason, 'non-text');
  assert.equal(classifyFormats(['text/uri-list', 'text/plain']).reason, 'files');
  assert.equal(classifyFormats(['x-special/gnome-copied-files', 'text/plain']).reason, 'files');
  assert.equal(classifyFormats(['application/x-custom']).kind, null);
  assert.equal(classifyFormats(['my/custom-type']).reason, 'unsupported');
  assert.equal(classifyFormats([]).reason, 'empty');
});

test('classifyFormats understands Electron raw OS format entries', () => {
  const raw = (name) => `electron application/osclipboard;format="${name}"`;
  assert.equal(classifyFormats(['text/plain', raw('TARGETS'), raw('UTF8_STRING')]).kind, 'plain');
  assert.equal(classifyFormats([raw('TARGETS')]).reason, 'empty');
  assert.equal(classifyFormats(['text/plain', raw('public.file-url')]).reason, 'files');
  assert.equal(classifyFormats(['image/png', raw('TARGETS')]).reason, 'non-text');
});

test('buildTranslateUrl encodes text with %20 and keeps plus signs', () => {
  const url = buildTranslateUrl('a + b & c\nd', 'ru');
  assert.equal(url, 'https://translate.google.com/?sl=auto&tl=ru&text=a%20%2B%20b%20%26%20c%0Ad&op=translate');
  assert.equal(new URL(url).searchParams.get('text'), 'a + b & c\nd');
});

test('isAllowedTranslatorUrl allows only Google Translate (and consent)', () => {
  assert.ok(isAllowedTranslatorUrl('https://translate.google.com/?sl=auto'));
  assert.ok(isAllowedTranslatorUrl('https://consent.google.com/m?continue=x'));
  assert.ok(!isAllowedTranslatorUrl('http://translate.google.com/'));
  assert.ok(!isAllowedTranslatorUrl('https://translate.google.com.evil.example/'));
  assert.ok(!isAllowedTranslatorUrl('https://example.com/'));
  assert.ok(!isAllowedTranslatorUrl('file:///etc/passwd'));
  assert.ok(!isAllowedTranslatorUrl('not a url'));
});

test('sanitizeSettings applies defaults and clamps ranges', () => {
  assert.deepEqual(sanitizeSettings(undefined), { ...DEFAULT_SETTINGS });
  const s = sanitizeSettings({ pollIntervalMs: 50, maxTextLength: 999999, targetLanguage: 'xx', alwaysOnTop: 'yes' });
  assert.equal(s.pollIntervalMs, 200);
  assert.equal(s.maxTextLength, 5000);
  assert.equal(s.targetLanguage, DEFAULT_SETTINGS.targetLanguage);
  assert.equal(s.alwaysOnTop, true);
  assert.equal(sanitizeSettings({ pollIntervalMs: 5000 }).pollIntervalMs, 1000);
  assert.deepEqual(
    sanitizeSettings({ windowBounds: { x: 1, y: 2, width: 100, height: 100 } }).windowBounds,
    { x: 1, y: 2, width: 360, height: 240 },
  );
  assert.equal(sanitizeSettings({ windowBounds: { x: 'a' } }).windowBounds, null);
});
