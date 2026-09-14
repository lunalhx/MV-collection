const DB_NAME = 'poster-bookmarks';
const DB_VERSION = 2;
const BOOKMARKS = 'bookmarks';
const CATEGORIES = 'categories';
const CREATORS = 'creators';

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

export async function getBookmarks() {
  return (await getAll(BOOKMARKS)).sort((a, b) => b.createdAt - a.createdAt);
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

export async function recordBookmarkOpen(id) {
  const db = await openDatabase();
  const transaction = db.transaction(BOOKMARKS, 'readwrite');
  const store = transaction.objectStore(BOOKMARKS);
  const bookmark = await requestToPromise(store.get(id));
  if (!bookmark) {
    await transactionDone(transaction);
    return null;
  }
  const updated = {
    ...bookmark,
    clickCount: (bookmark.clickCount || 0) + 1,
    lastClickedAt: Date.now()
  };
  store.put(updated);
  await transactionDone(transaction);
  return { clickCount: updated.clickCount, lastClickedAt: updated.lastClickedAt };
}

export async function deleteBookmark(id) {
  const db = await openDatabase();
  const transaction = db.transaction(BOOKMARKS, 'readwrite');
  transaction.objectStore(BOOKMARKS).delete(id);
  await transactionDone(transaction);
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
  const bookmarks = await requestToPromise(bookmarkStore.getAll());
  bookmarks.filter((bookmark) => bookmark.creatorId === id).forEach((bookmark) => {
    bookmarkStore.put({ ...bookmark, creatorId: null, updatedAt: Date.now() });
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
  const bookmarks = await requestToPromise(transaction.objectStore(BOOKMARKS).getAll());
  const bookmarkStore = transaction.objectStore(BOOKMARKS);
  bookmarks.filter((bookmark) => bookmark.category === id).forEach((bookmark) => {
    bookmarkStore.put({ ...bookmark, category: 'uncategorized', updatedAt: Date.now() });
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
