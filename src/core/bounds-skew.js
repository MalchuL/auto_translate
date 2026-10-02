'use strict';

// Under fractional display scaling on X11, Chromium can report window bounds
// slightly different from the ones it was asked to apply, so saving the
// reported bounds makes the window creep on every restart. The skew is
// measured once after the window is first shown and removed before saving.

const MAX_POSITION_SKEW = 16;
const MAX_SIZE_RATIO_SKEW = 0.05;

const NO_SKEW = Object.freeze({ dx: 0, dy: 0, sx: 1, sy: 1 });

function offset(actual, requested) {
  if (!Number.isFinite(requested)) return 0;
  const delta = actual - requested;
  return Math.abs(delta) <= MAX_POSITION_SKEW ? delta : 0;
}

function ratio(actual, requested) {
  if (!Number.isFinite(requested) || requested <= 0) return 1;
  const r = actual / requested;
  return Math.abs(r - 1) <= MAX_SIZE_RATIO_SKEW ? r : 1;
}

function measureSkew(requested, actual) {
  return {
    dx: offset(actual.x, requested.x),
    dy: offset(actual.y, requested.y),
    sx: ratio(actual.width, requested.width),
    sy: ratio(actual.height, requested.height),
  };
}

function removeSkew(actual, skew = NO_SKEW) {
  return {
    x: Math.round(actual.x - skew.dx),
    y: Math.round(actual.y - skew.dy),
    width: Math.round(actual.width / skew.sx),
    height: Math.round(actual.height / skew.sy),
  };
}

module.exports = { measureSkew, removeSkew, NO_SKEW };
