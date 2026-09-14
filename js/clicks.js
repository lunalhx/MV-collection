export const SHARED_CLICK_DEVICE = 'shared';

export function normalizeClickCounts(bookmark = {}) {
  if (bookmark.clickCounts && typeof bookmark.clickCounts === 'object' && !Array.isArray(bookmark.clickCounts)) {
    const counts = {};
    Object.entries(bookmark.clickCounts).forEach(([deviceId, value]) => {
      const count = Number(value) || 0;
      if (count > 0) counts[deviceId] = count;
    });
    if (Object.keys(counts).length) return counts;
  }
  const total = Number(bookmark.clickCount) || 0;
  return total > 0 ? { [SHARED_CLICK_DEVICE]: total } : {};
}

export function totalClicks(clickCounts = {}) {
  return Object.values(clickCounts).reduce((sum, value) => sum + (Number(value) || 0), 0);
}

export function mergeClickCounts(local, incoming) {
  const merged = { ...normalizeClickCounts({ clickCounts: local }) };
  Object.entries(normalizeClickCounts({ clickCounts: incoming })).forEach(([deviceId, count]) => {
    merged[deviceId] = Math.max(Number(merged[deviceId]) || 0, count);
  });
  return merged;
}

export function serializeClickLedger(bookmarks = []) {
  const ledger = {};
  bookmarks.forEach((bookmark) => {
    if (!bookmark?.id) return;
    const clickCounts = normalizeClickCounts(bookmark);
    ledger[bookmark.id] = {
      clickCounts,
      clickCount: totalClicks(clickCounts),
      lastClickedAt: bookmark.lastClickedAt || 0
    };
  });
  return ledger;
}

export function applyClickLedger(bookmark, incoming) {
  const clickCounts = mergeClickCounts(normalizeClickCounts(bookmark), incoming?.clickCounts);
  return {
    ...bookmark,
    clickCounts,
    clickCount: totalClicks(clickCounts),
    lastClickedAt: Math.max(bookmark.lastClickedAt || 0, incoming?.lastClickedAt || 0)
  };
}
