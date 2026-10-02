'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { measureSkew, removeSkew } = require('../src/core/bounds-skew');

test('skew measured after show is removed before saving', () => {
  const requested = { x: 200, y: 150, width: 600, height: 450 };
  const reported = { x: 199, y: 149, width: 608, height: 458 };
  const skew = measureSkew(requested, reported);
  assert.deepEqual(removeSkew(reported, skew), requested);
  const resized = removeSkew({ x: 299, y: 249, width: 650, height: 487 }, skew);
  assert.deepEqual(resized, { x: 300, y: 250, width: 641, height: 478 });
});

test('large differences (WM placement, clamping) are not treated as skew', () => {
  const skew = measureSkew({ x: 0, y: 0, width: 520, height: 420 }, { x: 700, y: 400, width: 800, height: 420 });
  assert.deepEqual(skew, { dx: 0, dy: 0, sx: 1, sy: 1 });
});

test('missing requested position yields no position skew', () => {
  const skew = measureSkew({ width: 520, height: 420 }, { x: 703, y: 407, width: 528, height: 427 });
  assert.equal(skew.dx, 0);
  assert.equal(skew.dy, 0);
  assert.deepEqual(removeSkew({ x: 10, y: 20, width: 528, height: 427 }, skew), { x: 10, y: 20, width: 520, height: 420 });
});
