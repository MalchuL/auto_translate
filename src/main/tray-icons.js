'use strict';

const { nativeImage } = require('electron');

const COLORS = {
  active: [46, 160, 67],
  loading: [219, 154, 4],
  paused: [140, 140, 140],
  error: [218, 54, 51],
};

// Draws a filled disc with a white "T" glyph into a BGRA bitmap.
function drawIcon(size, [r, g, b]) {
  const buffer = Buffer.alloc(size * size * 4);
  const center = (size - 1) / 2;
  const radius = size / 2 - 0.5;
  const bar = Math.max(1, Math.round(size * 0.14));
  const top = Math.round(size * 0.27);
  const left = Math.round(size * 0.27);
  const right = size - left;
  const stemLeft = Math.round(center - bar / 2 + 0.5);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const distance = Math.hypot(x - center, y - center);
      const coverage = Math.max(0, Math.min(1, radius - distance + 0.5));
      if (coverage === 0) continue;
      const inTopBar = y >= top && y < top + bar && x >= left && x < right;
      const inStem = x >= stemLeft && x < stemLeft + bar && y >= top && y < size - top;
      const glyph = inTopBar || inStem;
      const i = (y * size + x) * 4;
      buffer[i] = glyph ? 255 : b;
      buffer[i + 1] = glyph ? 255 : g;
      buffer[i + 2] = glyph ? 255 : r;
      buffer[i + 3] = Math.round(coverage * 255);
    }
  }
  return buffer;
}

const cache = new Map();

function trayIcon(state) {
  const key = COLORS[state] ? state : 'active';
  if (!cache.has(key)) {
    const image = nativeImage.createFromBitmap(drawIcon(16, COLORS[key]), { width: 16, height: 16, scaleFactor: 1 });
    image.addRepresentation({ scaleFactor: 2, width: 32, height: 32, buffer: drawIcon(32, COLORS[key]) });
    cache.set(key, image);
  }
  return cache.get(key);
}

function appIcon() {
  return nativeImage.createFromBitmap(drawIcon(128, COLORS.active), { width: 128, height: 128 });
}

module.exports = { trayIcon, appIcon, drawIcon };
