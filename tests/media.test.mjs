import assert from 'node:assert/strict';
import test from 'node:test';
import { IMAGE_POLICY, chooseDisplayFormat, scaledDimensions, shouldUseLossless } from '../js/media.js';

test('display images preserve smaller originals and cap the largest edge', () => {
  assert.deepEqual(scaledDimensions(1200, 800, IMAGE_POLICY.displayMaxEdge), { width: 1200, height: 800 });
  assert.deepEqual(scaledDimensions(4000, 3000, IMAGE_POLICY.displayMaxEdge), { width: 1800, height: 1350 });
});

test('thumbnail sizing preserves portrait aspect ratio', () => {
  assert.deepEqual(scaledDimensions(1200, 1800, IMAGE_POLICY.thumbnailMaxEdge), { width: 320, height: 480 });
});

test('GIF display images keep the original animated file', () => {
  const format = chooseDisplayFormat({ type: 'image/gif' });
  assert.equal(format.keepOriginal, true);
  assert.equal(format.mime, 'image/gif');
});

test('screenshots and QR images use lossless PNG instead of WebP', () => {
  assert.equal(shouldUseLossless({ type: 'image/png' }, { lossless: true }), true);
  assert.equal(shouldUseLossless({ type: 'image/png', name: 'invoice-qrcode.png' }), true);
  assert.equal(shouldUseLossless({ type: 'image/png', name: 'poster.png' }), false);
  const format = chooseDisplayFormat({ type: 'image/png' }, { lossless: true });
  assert.equal(format.mime, 'image/png');
  assert.equal(format.lossless, true);
  assert.equal(format.keepOriginal, false);
});

test('ordinary photos still use WebP 0.90', () => {
  const format = chooseDisplayFormat({ type: 'image/jpeg' });
  assert.equal(format.mime, 'image/webp');
  assert.equal(format.quality, 0.9);
});
