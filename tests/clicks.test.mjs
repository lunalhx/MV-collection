import assert from 'node:assert/strict';
import test from 'node:test';
import { applyClickLedger, mergeClickCounts, normalizeClickCounts, totalClicks } from '../js/clicks.js';

test('old total click counts become a shared value so two devices do not double-count history', () => {
  assert.deepEqual(normalizeClickCounts({ clickCount: 10 }), { shared: 10 });
  const merged = mergeClickCounts(
    normalizeClickCounts({ clickCount: 10 }),
    normalizeClickCounts({ clickCount: 10 })
  );
  assert.deepEqual(merged, { shared: 10 });
  assert.equal(totalClicks(merged), 10);
});

test('later opens on each device add on top of the shared history', () => {
  const merged = mergeClickCounts(
    { shared: 10, mac: 3 },
    { shared: 10, iphone: 5 }
  );
  assert.deepEqual(merged, { shared: 10, mac: 3, iphone: 5 });
  assert.equal(totalClicks(merged), 18);
});

test('applying a ledger keeps the higher per-device count', () => {
  const updated = applyClickLedger(
    { id: 'a', clickCounts: { shared: 4, phone: 2 }, lastClickedAt: 10 },
    { clickCounts: { shared: 4, mac: 9 }, lastClickedAt: 20 }
  );
  assert.equal(updated.clickCount, 15);
  assert.equal(updated.lastClickedAt, 20);
  assert.deepEqual(updated.clickCounts, { shared: 4, phone: 2, mac: 9 });
});
