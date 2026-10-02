import type { WindowBounds } from './settings-schema';

// Under fractional display scaling on X11, Chromium can report window bounds
// slightly different from the ones it was asked to apply, so saving the
// reported bounds makes the window creep on every restart. The skew is
// measured once after the window is first shown and removed before saving.

const MAX_POSITION_SKEW = 16;
const MAX_SIZE_RATIO_SKEW = 0.05;

export interface BoundsSkew {
  dx: number;
  dy: number;
  sx: number;
  sy: number;
}

export type RequestedBounds = Partial<Pick<WindowBounds, 'x' | 'y'>> & Pick<WindowBounds, 'width' | 'height'>;

export const NO_SKEW: Readonly<BoundsSkew> = Object.freeze({ dx: 0, dy: 0, sx: 1, sy: 1 });

function offset(actual: number, requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) return 0;
  const delta = actual - requested;
  return Math.abs(delta) <= MAX_POSITION_SKEW ? delta : 0;
}

function ratio(actual: number, requested: number): number {
  if (!Number.isFinite(requested) || requested <= 0) return 1;
  const r = actual / requested;
  return Math.abs(r - 1) <= MAX_SIZE_RATIO_SKEW ? r : 1;
}

export function measureSkew(requested: RequestedBounds, actual: WindowBounds): BoundsSkew {
  return {
    dx: offset(actual.x, requested.x),
    dy: offset(actual.y, requested.y),
    sx: ratio(actual.width, requested.width),
    sy: ratio(actual.height, requested.height),
  };
}

export function removeSkew(actual: WindowBounds, skew: BoundsSkew = NO_SKEW): WindowBounds {
  return {
    x: Math.round(actual.x - skew.dx),
    y: Math.round(actual.y - skew.dy),
    width: Math.round(actual.width / skew.sx),
    height: Math.round(actual.height / skew.sy),
  };
}
