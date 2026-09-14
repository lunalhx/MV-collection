import { applyClickLedger, mergeClickCounts, normalizeClickCounts, totalClicks } from './clicks.js';

const DB_NAME = 'poster-bookmarks';
const DB_VERSION = 4;
const BOOKMARKS = 'bookmarks';
const CATEGORIES = 'categories';
const CREATORS = 'creators';
const IMAGE_ASSETS = 'image-assets';
const META = 'meta';
const STAGED_BOOKMARKS = 'staged-bookmarks';
const STAGED_CATEGORIES = 'staged-categories';
const STAGED_CREATORS = 'staged-creators';
const STAGED_IMAGE_ASSETS = 'staged-image-assets';

export const DEFAULT_CATEGORIES = [
  { id: 'movies', name: '电影', createdAt: 1, sortOrder: 0 },
  { id: 'series', name: '剧集', createdAt: 2, sortOrder: 1 },
  { id: 'anime', name: '动漫', createdAt: 3, sortOrder: 2 },
  { id: 'websites', name: '网站', createdAt: 4, sortOrder: 3 },
  { id: 'uncategorized', name: '未分类', createdAt: 5, sortOrder: 4, system: true }
];

let databasePromise;

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('数据库事务已取消'));
  });
}

export function openDatabase() {
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(BOOKMARKS)) {
        const bookmarkStore = db.createObjectStore(BOOKMARKS, { keyPath: 'id' });
        bookmarkStore.createIndex('createdAt', 'createdAt');
        bookmarkStore.createIndex('category', 'category');
      }
      if (!db.objectStoreNames.contains(CATEGORIES)) {
        const categoryStore = db.createObjectStore(CATEGORIES, { keyPath: 'id' });
        DEFAULT_CATEGORIES.forEach((category) => categoryStore.put(category));
      }
      if (!db.objectStoreNames.contains(CREATORS)) {
        const creatorStore = db.createObjectStore(CREATORS, { keyPath: 'id' });
        creatorStore.createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains(IMAGE_ASSETS)) {
        const imageStore = db.createObjectStore(IMAGE_ASSETS, { keyPath: 'id' });
        imageStore.createIndex('groupId', 'groupId');
        imageStore.createIndex('hash', 'hash');
      }
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(STAGED_BOOKMARKS)) db.createObjectStore(STAGED_BOOKMARKS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STAGED_CATEGORIES)) db.createObjectStore(STAGED_CATEGORIES, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STAGED_CREATORS)) db.createObjectStore(STAGED_CREATORS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STAGED_IMAGE_ASSETS)) db.createObjectStore(STAGED_IMAGE_ASSETS, { keyPath: 'id' });
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('请关闭其他打开的收藏页面后重试'));
  });

  return databasePromise;
}

async function getAll(storeName) {
  const db = await openDatabase();
  const transaction = db.transaction(storeName, 'readonly');
  const result = await requestToPromise(transaction.objectStore(storeName).getAll());
  await transactionDone(transaction);
  return result;
}

function lightweightBookmark(bookmark) {
  const legacyImages = [bookmark.image, ...(bookmark.gallery || [])].filter((image) => image instanceof Blob);
  const copy = { ...bookmark, image: null, gallery: [] };
  copy.imageIds = Array.isArray(bookmark.imageIds) ? bookmark.imageIds : [];
  copy.legacyImageCount = copy.imageIds.length ? 0 : legacyImages.length;
  copy.imageCount = copy.imageIds.length || copy.legacyImageCount;
  copy.clickCounts = normalizeClickCounts(copy);
  copy.clickCount = totalClicks(copy.clickCounts);
  return copy;
}

export async function getBookmarks() {
  const db = await openDatabase();
  const transaction = db.transaction(BOOKMARKS, 'readonly');
  const store = transaction.objectStore(BOOKMARKS);
  const bookmarks = [];
  await new Promise((resolve, reject) => {
    const request = store.openCursor();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return resolve();
      bookmarks.push(lightweightBookmark(cursor.value));
      cursor.continue();
    };
  });
  await transactionDone(transaction);
  return bookmarks.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getCategories() {
  return (await getAll(CATEGORIES)).sort((a, b) => {
    const firstOrder = Number.isFinite(a.sortOrder) ? a.sortOrder : (a.createdAt || 0);
    const secondOrder = Number.isFinite(b.sortOrder) ? b.sortOrder : (b.createdAt || 0);
    return firstOrder - secondOrder || (a.createdAt || 0) - (b.createdAt || 0);
  });
}

export async function getCreators() {
  return (await getAll(CREATORS)).sort((a, b) => b.createdAt - a.createdAt);
}

export async function getBookmark(id) {
  const db = await openDatabase();
  const transaction = db.transaction(BOOKMARKS, 'readonly');
  const result = await requestToPromise(transaction.objectStore(BOOKMARKS).get(id));
  await transactionDone(transaction);
  return result;
}

export async function saveBookmark(bookmark) {
  const db = await openDatabase();
  const transaction = db.transaction(BOOKMARKS, 'readwrite');
  transaction.objectStore(BOOKMARKS).put(bookmark);
  await transactionDone(transaction);
  return bookmark;
}

export async function getBookmarkImageBlobs(bookmarkOrId, rendition = 'display') {
  const bookmark = typeof bookmarkOrId === 'string' ? await getBookmark(bookmarkOrId) : bookmarkOrId;
  if (!bookmark) return [];
  if (!Array.isArray(bookmark.imageIds) || !bookmark.imageIds.length) {
    return [bookmark.image, ...(bookmark.gallery || [])].filter((image) => image instanceof Blob);
  }
  const db = await openDatabase();
  const transaction = db.transaction(IMAGE_ASSETS, 'readonly');
  const store = transaction.objectStore(IMAGE_ASSETS);
  const requests = bookmark.imageIds.map((groupId) => ({
    preferred: store.get(`${groupId}:${rendition}`),
    display: rendition === 'display' ? null : store.get(`${groupId}:display`)
  }));
  const blobs = await Promise.all(requests.map(async ({ preferred, display }) => {
    const asset = await requestToPromise(preferred);
    const fallback = display ? await requestToPromise(display) : null;
    return asset?.blob instanceof Blob ? asset.blob : fallback?.blob instanceof Blob ? fallback.blob : null;
  }));
  await transactionDone(transaction);
  return blobs.filter(Boolean);
}

export async function getImageBlob(reference, rendition = 'display') {
  if (reference.startsWith('legacy:')) {
    const [, bookmarkId, rawIndex] = reference.split(':');
    const bookmark = await getBookmark(bookmarkId);
    return [bookmark?.image, ...(bookmark?.gallery || [])].filter((image) => image instanceof Blob)[Number(rawIndex)] || null;
  }
  const db = await openDatabase();
  const transaction = db.transaction(IMAGE_ASSETS, 'readonly');
  const store = transaction.objectStore(IMAGE_ASSETS);
  const asset = await requestToPromise(store.get(`${reference}:${rendition}`));
  const fallback = asset || (rendition === 'display' ? null : await requestToPromise(store.get(`${reference}:display`)));
  await transactionDone(transaction);
  return fallback?.blob instanceof Blob ? fallback.blob : null;
}

export async function getImageGroup(groupId) {
  const db = await openDatabase();
  const transaction = db.transaction(IMAGE_ASSETS, 'readonly');
  const store = transaction.objectStore(IMAGE_ASSETS);
  const displayRequest = store.get(`${groupId}:display`);
  const thumbnailRequest = store.get(`${groupId}:thumbnail`);
  const [display, thumbnail] = await Promise.all([requestToPromise(displayRequest), requestToPromise(thumbnailRequest)]);
  await transactionDone(transaction);
  return display?.blob instanceof Blob ? { groupId, display, thumbnail: thumbnail || display } : null;
}

export async function savePreparedImage(prepared) {
  const db = await openDatabase();
  const transaction = db.transaction(IMAGE_ASSETS, 'readwrite');
  const store = transaction.objectStore(IMAGE_ASSETS);
  const existing = await requestToPromise(store.index('hash').get(prepared.hash));
  if (existing?.groupId) {
    await transactionDone(transaction);
    return existing.groupId;
  }
  const groupId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const now = Date.now();
  store.put({ id: `${groupId}:display`, groupId, kind: 'display', hash: prepared.hash, blob: prepared.display, width: prepared.width, height: prepared.height, bytes: prepared.display.size, createdAt: now });
  store.put({ id: `${groupId}:thumbnail`, groupId, kind: 'thumbnail', hash: null, blob: prepared.thumbnail, width: prepared.thumbnailWidth, height: prepared.thumbnailHeight, bytes: prepared.thumbnail.size, createdAt: now });
  await transactionDone(transaction);
  return groupId;
}

export async function verifyImageGroup(groupId) {
  const group = await getImageGroup(groupId);
  if (!group?.display?.blob || group.display.blob.size < 24) throw new Error('写入后无法读回显示图');
  if (!group.thumbnail?.blob || group.thumbnail.blob.size < 16) throw new Error('写入后无法读回缩略图');
  return group;
}

export async function cleanupImageGroups(groupIds = []) {
  const candidates = [...new Set(groupIds.filter(Boolean))];
  if (!candidates.length) return;
  const db = await openDatabase();
  const readTransaction = db.transaction(BOOKMARKS, 'readonly');
  const referenced = new Set();
  await new Promise((resolve, reject) => {
    const request = readTransaction.objectStore(BOOKMARKS).openCursor();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return resolve();
      (cursor.value.imageIds || []).forEach((groupId) => referenced.add(groupId));
      cursor.continue();
    };
  });
  await transactionDone(readTransaction);
  const transaction = db.transaction(IMAGE_ASSETS, 'readwrite');
  const store = transaction.objectStore(IMAGE_ASSETS);
  candidates.filter((groupId) => !referenced.has(groupId)).forEach((groupId) => {
    store.delete(`${groupId}:display`);
    store.delete(`${groupId}:thumbnail`);
  });
  await transactionDone(transaction);
}

export async function migrateLegacyBookmark(id, imageIds) {
  const db = await openDatabase();
  const transaction = db.transaction(BOOKMARKS, 'readwrite');
  const store = transaction.objectStore(BOOKMARKS);
  const bookmark = await requestToPromise(store.get(id));
  if (bookmark && (!bookmark.imageIds || !bookmark.imageIds.length)) {
    store.put({ ...bookmark, image: null, gallery: [], imageIds, assetVersion: 1, updatedAt: bookmark.updatedAt || Date.now() });
  }
  await transactionDone(transaction);
}

export async function getLegacyBookmark() {
  const samples = await getLegacySamples(1);
  return samples[0] || null;
}

export async function getLegacySamples(limit = 12) {
  const db = await openDatabase();
  const transaction = db.transaction(BOOKMARKS, 'readonly');
  const store = transaction.objectStore(BOOKMARKS);
  const samples = [];
  await new Promise((resolve, reject) => {
    const request = store.openCursor();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || samples.length >= limit) return resolve();
      const value = cursor.value;
      const hasLegacy = !value.imageIds?.length && [value.image, ...(value.gallery || [])].some((image) => image instanceof Blob);
      if (hasLegacy) samples.push(value);
      cursor.continue();
    };
  });
  await transactionDone(transaction);
  return samples;
}

function metadataBytes(record) {
  const { image, gallery, avatar, blob, ...rest } = record;
  try {
    return JSON.stringify(rest).length;
  } catch {
    return 256;
  }
}

export async function getAssetStats() {
  const db = await openDatabase();
  const transaction = db.transaction([BOOKMARKS, IMAGE_ASSETS, CREATORS, CATEGORIES], 'readonly');
  const bookmarkStatsPromise = new Promise((resolve, reject) => {
    let legacyCount = 0;
    let legacyBytes = 0;
    let textBytes = 0;
    const request = transaction.objectStore(BOOKMARKS).openCursor();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return resolve({ legacyCount, legacyBytes, textBytes });
      const bookmark = cursor.value;
      textBytes += metadataBytes(bookmark);
      const legacyImages = !bookmark.imageIds?.length ? [bookmark.image, ...(bookmark.gallery || [])].filter((image) => image instanceof Blob) : [];
      if (legacyImages.length) {
        legacyCount += 1;
        legacyBytes += legacyImages.reduce((total, image) => total + image.size, 0);
      }
      cursor.continue();
    };
  });
  const assetBytesPromise = new Promise((resolve, reject) => {
    const bytes = { display: 0, thumbnail: 0 };
    const request = transaction.objectStore(IMAGE_ASSETS).openCursor();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return resolve(bytes);
      const asset = cursor.value;
      const size = Number.isFinite(asset.bytes) ? asset.bytes : asset.blob instanceof Blob ? asset.blob.size : 0;
      if (asset.kind in bytes) bytes[asset.kind] += size;
      cursor.continue();
    };
  });
  const extraTextPromise = Promise.all([
    requestToPromise(transaction.objectStore(CATEGORIES).getAll()),
    requestToPromise(transaction.objectStore(CREATORS).getAll())
  ]).then(([categories, creators]) => categories.reduce((total, category) => total + metadataBytes(category), 0)
    + creators.reduce((total, creator) => total + metadataBytes(creator) + (creator.avatar instanceof Blob ? creator.avatar.size : 0), 0));
  const [bookmarkCount, assetCount, bookmarkStats, assetBytes, extraText] = await Promise.all([
    requestToPromise(transaction.objectStore(BOOKMARKS).count()),
    requestToPromise(transaction.objectStore(IMAGE_ASSETS).count()),
    bookmarkStatsPromise,
    assetBytesPromise,
    extraTextPromise
  ]);
  await transactionDone(transaction);
  return {
    bookmarkCount,
    imageCount: Math.floor(assetCount / 2),
    legacyCount: bookmarkStats.legacyCount,
    legacyBytes: bookmarkStats.legacyBytes,
    displayBytes: assetBytes.display,
    thumbnailBytes: assetBytes.thumbnail,
    textBytes: bookmarkStats.textBytes + extraText
  };
}

export async function getDeviceId() {
  const existing = await getMeta('deviceId');
  if (existing) return existing;
  const deviceId = crypto.randomUUID ? crypto.randomUUID() : `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await setMeta('deviceId', deviceId);
  return deviceId;
}

async function collectClickLedger(store) {
  const ledger = {};
  await new Promise((resolve, reject) => {
    const request = store.openCursor();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return resolve();
      const bookmark = cursor.value;
      ledger[bookmark.id] = {
        clickCounts: normalizeClickCounts(bookmark),
        lastClickedAt: bookmark.lastClickedAt || 0
      };
      cursor.continue();
    };
  });
  return ledger;
}

function applyLedgerToStore(store, localLedger, incomingLedger = {}) {
  return new Promise((resolve, reject) => {
    const request = store.openCursor();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return resolve();
      const bookmark = cursor.value;
      const incoming = mergeClickCounts(
        incomingLedger[bookmark.id]?.clickCounts,
        normalizeClickCounts(bookmark)
      );
      const updated = applyClickLedger(bookmark, {
        clickCounts: mergeClickCounts(localLedger[bookmark.id]?.clickCounts, incoming),
        lastClickedAt: Math.max(localLedger[bookmark.id]?.lastClickedAt || 0, incomingLedger[bookmark.id]?.lastClickedAt || 0, bookmark.lastClickedAt || 0)
      });
      cursor.update(updated);
      cursor.continue();
    };
  });
}

export async function getMeta(key) {
  const db = await openDatabase();
  const transaction = db.transaction(META, 'readonly');
  const record = await requestToPromise(transaction.objectStore(META).get(key));
  await transactionDone(transaction);
  return record?.value;
}

export async function setMeta(key, value) {
  const db = await openDatabase();
  const transaction = db.transaction(META, 'readwrite');
  transaction.objectStore(META).put({ key, value });
  await transactionDone(transaction);
}

export async function clearStagedSnapshot() {
  const db = await openDatabase();
  const stores = [STAGED_BOOKMARKS, STAGED_CATEGORIES, STAGED_CREATORS, STAGED_IMAGE_ASSETS, META];
  const transaction = db.transaction(stores, 'readwrite');
  [STAGED_BOOKMARKS, STAGED_CATEGORIES, STAGED_CREATORS, STAGED_IMAGE_ASSETS].forEach((name) => transaction.objectStore(name).clear());
  transaction.objectStore(META).delete('stagedClickCounts');
  await transactionDone(transaction);
}

export async function stageSnapshotPart({ bookmarks = [], categories = [], creators = [], imageAssets = [], clickCounts }) {
  const db = await openDatabase();
  const stores = [STAGED_BOOKMARKS, STAGED_CATEGORIES, STAGED_CREATORS, STAGED_IMAGE_ASSETS, META];
  const transaction = db.transaction(stores, 'readwrite');
  const bookmarkStore = transaction.objectStore(STAGED_BOOKMARKS);
  const categoryStore = transaction.objectStore(STAGED_CATEGORIES);
  const creatorStore = transaction.objectStore(STAGED_CREATORS);
  const imageStore = transaction.objectStore(STAGED_IMAGE_ASSETS);
  bookmarks.forEach((record) => bookmarkStore.put(record));
  categories.forEach((record) => categoryStore.put(record));
  creators.forEach((record) => creatorStore.put(record));
  imageAssets.forEach((record) => imageStore.put(record));
  if (clickCounts && typeof clickCounts === 'object') {
    const existing = await requestToPromise(transaction.objectStore(META).get('stagedClickCounts'));
    const merged = { ...(existing?.value || {}) };
    Object.entries(clickCounts).forEach(([id, payload]) => {
      merged[id] = {
        clickCounts: mergeClickCounts(merged[id]?.clickCounts, payload?.clickCounts),
        lastClickedAt: Math.max(merged[id]?.lastClickedAt || 0, payload?.lastClickedAt || 0)
      };
    });
    transaction.objectStore(META).put({ key: 'stagedClickCounts', value: merged });
  }
  await transactionDone(transaction);
}

export async function getStagedSnapshotStats() {
  const db = await openDatabase();
  const stores = [STAGED_BOOKMARKS, STAGED_CATEGORIES, STAGED_CREATORS, STAGED_IMAGE_ASSETS];
  const transaction = db.transaction(stores, 'readonly');
  const [bookmarkCount, categoryCount, creatorCount, assetCount] = await Promise.all(stores.map((name) => requestToPromise(transaction.objectStore(name).count())));
  await transactionDone(transaction);
  return { bookmarkCount, categoryCount, creatorCount, imageCount: Math.floor(assetCount / 2) };
}

function copyStore(transaction, sourceName, destinationName) {
  return new Promise((resolve, reject) => {
    const source = transaction.objectStore(sourceName);
    const destination = transaction.objectStore(destinationName);
    const request = source.openCursor();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return resolve();
      destination.put(cursor.value);
      cursor.continue();
    };
  });
}

export async function mergeStagedSnapshot(snapshotMeta) {
  const db = await openDatabase();
  const stores = [BOOKMARKS, CATEGORIES, CREATORS, IMAGE_ASSETS, META, STAGED_BOOKMARKS, STAGED_CATEGORIES, STAGED_CREATORS, STAGED_IMAGE_ASSETS];
  const transaction = db.transaction(stores, 'readwrite');
  const localLedger = await collectClickLedger(transaction.objectStore(BOOKMARKS));
  const incomingLedger = (await requestToPromise(transaction.objectStore(META).get('stagedClickCounts')))?.value || {};
  await Promise.all([
    copyStore(transaction, STAGED_BOOKMARKS, BOOKMARKS),
    copyStore(transaction, STAGED_CATEGORIES, CATEGORIES),
    copyStore(transaction, STAGED_CREATORS, CREATORS),
    copyStore(transaction, STAGED_IMAGE_ASSETS, IMAGE_ASSETS)
  ]);
  await applyLedgerToStore(transaction.objectStore(BOOKMARKS), localLedger, incomingLedger);
  transaction.objectStore(META).put({ key: 'lastMerge', value: snapshotMeta });
  transaction.objectStore(META).delete('stagedClickCounts');
  [STAGED_BOOKMARKS, STAGED_CATEGORIES, STAGED_CREATORS, STAGED_IMAGE_ASSETS].forEach((name) => transaction.objectStore(name).clear());
  await transactionDone(transaction);
}

export async function activateStagedSnapshot(snapshotMeta) {
  const db = await openDatabase();
  const stores = [BOOKMARKS, CATEGORIES, CREATORS, IMAGE_ASSETS, META, STAGED_BOOKMARKS, STAGED_CATEGORIES, STAGED_CREATORS, STAGED_IMAGE_ASSETS];
  const transaction = db.transaction(stores, 'readwrite');
  const localLedger = await collectClickLedger(transaction.objectStore(BOOKMARKS));
  const incomingLedger = (await requestToPromise(transaction.objectStore(META).get('stagedClickCounts')))?.value || {};
  [BOOKMARKS, CATEGORIES, CREATORS, IMAGE_ASSETS].forEach((name) => transaction.objectStore(name).clear());
  await Promise.all([
    copyStore(transaction, STAGED_BOOKMARKS, BOOKMARKS),
    copyStore(transaction, STAGED_CATEGORIES, CATEGORIES),
    copyStore(transaction, STAGED_CREATORS, CREATORS),
    copyStore(transaction, STAGED_IMAGE_ASSETS, IMAGE_ASSETS)
  ]);
  await applyLedgerToStore(transaction.objectStore(BOOKMARKS), localLedger, incomingLedger);
  transaction.objectStore(META).put({ key: 'lastRestore', value: snapshotMeta });
  transaction.objectStore(META).delete('stagedClickCounts');
  [STAGED_BOOKMARKS, STAGED_CATEGORIES, STAGED_CREATORS, STAGED_IMAGE_ASSETS].forEach((name) => transaction.objectStore(name).clear());
  await transactionDone(transaction);
}

export async function recordBookmarkOpen(id) {
  const deviceId = await getDeviceId();
  const db = await openDatabase();
  const transaction = db.transaction(BOOKMARKS, 'readwrite');
  const store = transaction.objectStore(BOOKMARKS);
  const bookmark = await requestToPromise(store.get(id));
  if (!bookmark) {
    await transactionDone(transaction);
    return null;
  }
  const clickCounts = normalizeClickCounts(bookmark);
  clickCounts[deviceId] = (clickCounts[deviceId] || 0) + 1;
  const updated = {
    ...bookmark,
    clickCounts,
    clickCount: totalClicks(clickCounts),
    lastClickedAt: Date.now()
  };
  store.put(updated);
  await transactionDone(transaction);
  return { clickCount: updated.clickCount, lastClickedAt: updated.lastClickedAt, clickCounts: updated.clickCounts };
}

export async function deleteBookmark(id) {
  const db = await openDatabase();
  const transaction = db.transaction(BOOKMARKS, 'readwrite');
  const store = transaction.objectStore(BOOKMARKS);
  const bookmark = await requestToPromise(store.get(id));
  store.delete(id);
  await transactionDone(transaction);
  await cleanupImageGroups(bookmark?.imageIds || []);
}

export async function saveCreator(creator) {
  const db = await openDatabase();
  const transaction = db.transaction(CREATORS, 'readwrite');
  transaction.objectStore(CREATORS).put(creator);
  await transactionDone(transaction);
  return creator;
}

export async function deleteCreator(id) {
  const db = await openDatabase();
  const transaction = db.transaction([CREATORS, BOOKMARKS], 'readwrite');
  transaction.objectStore(CREATORS).delete(id);
  const bookmarkStore = transaction.objectStore(BOOKMARKS);
  await new Promise((resolve, reject) => {
    const request = bookmarkStore.openCursor();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return resolve();
      if (cursor.value.creatorId === id) cursor.update({ ...cursor.value, creatorId: null, updatedAt: Date.now() });
      cursor.continue();
    };
  });
  await transactionDone(transaction);
}

export async function saveCategory(category) {
  const db = await openDatabase();
  const transaction = db.transaction(CATEGORIES, 'readwrite');
  transaction.objectStore(CATEGORIES).put(category);
  await transactionDone(transaction);
  return category;
}

export async function saveCategoryOrder(orderedIds) {
  const db = await openDatabase();
  const transaction = db.transaction(CATEGORIES, 'readwrite');
  const store = transaction.objectStore(CATEGORIES);
  const categories = await requestToPromise(store.getAll());
  const categoryMap = new Map(categories.map((category) => [category.id, category]));
  const seen = new Set();
  const orderedCategories = [];

  orderedIds.forEach((id) => {
    const category = categoryMap.get(id);
    if (!category || seen.has(id)) return;
    seen.add(id);
    orderedCategories.push(category);
  });
  categories.forEach((category) => {
    if (!seen.has(category.id)) orderedCategories.push(category);
  });
  orderedCategories.forEach((category, sortOrder) => store.put({ ...category, sortOrder }));
  await transactionDone(transaction);
}

export async function renameCategory(id, name) {
  const db = await openDatabase();
  const transaction = db.transaction(CATEGORIES, 'readwrite');
  const store = transaction.objectStore(CATEGORIES);
  const category = await requestToPromise(store.get(id));
  if (!category) throw new Error('找不到这个分类');
  store.put({ ...category, name });
  await transactionDone(transaction);
}

export async function removeCategory(id) {
  if (id === 'uncategorized') throw new Error('未分类不能删除');
  const db = await openDatabase();
  const transaction = db.transaction([CATEGORIES, BOOKMARKS], 'readwrite');
  transaction.objectStore(CATEGORIES).delete(id);
  const bookmarkStore = transaction.objectStore(BOOKMARKS);
  await new Promise((resolve, reject) => {
    const request = bookmarkStore.openCursor();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return resolve();
      if (cursor.value.category === id) cursor.update({ ...cursor.value, category: 'uncategorized', updatedAt: Date.now() });
      cursor.continue();
    };
  });
  await transactionDone(transaction);
}

export async function importRecords(bookmarks, categories, creators = []) {
  const db = await openDatabase();
  const transaction = db.transaction([CATEGORIES, BOOKMARKS, CREATORS], 'readwrite');
  const categoryStore = transaction.objectStore(CATEGORIES);
  const bookmarkStore = transaction.objectStore(BOOKMARKS);
  const creatorStore = transaction.objectStore(CREATORS);
  const existingCategories = await requestToPromise(categoryStore.getAll());
  const importedIds = new Set(categories.map((category) => category.id));
  const localCategories = existingCategories
    .filter((category) => !importedIds.has(category.id))
    .sort((first, second) => {
      const firstOrder = Number.isFinite(first.sortOrder) ? first.sortOrder : (first.createdAt || 0);
      const secondOrder = Number.isFinite(second.sortOrder) ? second.sortOrder : (second.createdAt || 0);
      return firstOrder - secondOrder;
    });
  [...categories, ...localCategories].forEach((category, sortOrder) => categoryStore.put({ ...category, sortOrder }));
  bookmarks.forEach((bookmark) => bookmarkStore.put(bookmark));
  creators.forEach((creator) => creatorStore.put(creator));
  await transactionDone(transaction);
}
