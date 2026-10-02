'use strict';

// Formats that mean the clipboard holds files/directories even if a textual
// representation (e.g. a path list) is offered alongside.
const FILE_FORMATS = new Set([
  'text/uri-list',
  'x-special/gnome-copied-files',
  'application/x-kde-cutselection',
  'public.file-url',
  'nsfilenamespboardtype',
  'com.apple.finder.node',
  'application/vnd.portal.files',
  'application/vnd.portal.filetransfer',
]);

const NON_TEXT_PREFIXES = ['image/', 'audio/', 'video/', 'application/', 'font/', 'model/'];

// Electron >= 44 lists native clipboard formats as
// `electron application/osclipboard;format="NAME"` next to the MIME types.
const RAW_FORMAT = /^electron application\/osclipboard;\s*format="?([^"]*)"?$/;

function splitFormats(formats) {
  const mime = [];
  const raw = [];
  for (const format of Array.isArray(formats) ? formats : []) {
    if (typeof format !== 'string') continue;
    const value = format.trim().toLowerCase();
    const match = RAW_FORMAT.exec(value);
    if (match) raw.push(match[1]);
    else if (value) mime.push(value);
  }
  return { mime, raw };
}

/**
 * Decide whether clipboard content may be read as text.
 * Returns { kind: 'plain' | 'html' | null, reason }.
 */
function classifyFormats(formats, { allowHtmlFallback = false } = {}) {
  const { mime, raw } = splitFormats(formats);

  if (mime.length === 0) return { kind: null, reason: 'empty' };
  if ([...mime, ...raw].some((f) => FILE_FORMATS.has(f))) return { kind: null, reason: 'files' };

  const hasPlain = mime.some((f) => f === 'text/plain' || f.startsWith('text/plain;'));
  if (hasPlain) return { kind: 'plain', reason: 'text/plain' };

  const hasHtml = mime.some((f) => f === 'text/html' || f.startsWith('text/html;'));
  if (hasHtml && allowHtmlFallback) return { kind: 'html', reason: 'text/html' };
  if (hasHtml) return { kind: null, reason: 'html-disabled' };

  if (mime.some((f) => NON_TEXT_PREFIXES.some((p) => f.startsWith(p)))) {
    return { kind: null, reason: 'non-text' };
  }
  return { kind: null, reason: 'unsupported' };
}

module.exports = { classifyFormats, FILE_FORMATS };
