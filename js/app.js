import {
  deleteBookmark,
  deleteCreator,
  cleanupImageGroups,
  activateStagedSnapshot,
  clearStagedSnapshot,
  getAssetStats,
  getBookmark,
  getBookmarkImageBlobs,
  getBookmarks,
  getCategories,
  getCreators,
  getImageBlob,
  getImageGroup,
  getLegacyBookmark,
  getLegacySamples,
  getMeta,
  getStagedSnapshotStats,
  mergeStagedSnapshot,
  migrateLegacyBookmark,
  openDatabase,
  recordBookmarkOpen,
  removeCategory,
  renameCategory,
  saveBookmark,
  saveCategory,
  saveCategoryOrder,
  saveCreator,
  savePreparedImage,
  stageSnapshotPart,
  setMeta,
  verifyImageGroup
} from './db.js?v=20260914-4';
import { inspectBackupFiles, parseBackup, parseBackupPart, parseDataPart, unpackImagePart, exportVolumeBackup, selectDeltaRecords } from './backup.js?v=20260914-5';
import { serializeClickLedger } from './clicks.js?v=20260914-1';
import { IMAGE_POLICY, prepareImage } from './media.js?v=20260914-2';
import {
  ASPECT_RATIOS,
  bookmarksForView,
  categoryIconKey,
  isCreatorWorksCategory,
  positionMenu,
  renderCategoryManager,
  renderCategoryOptions,
  renderContent,
  renderCreatorOptions,
  renderNavigation,
  navigationIcon,
  setImageBlobLoader,
  sortBookmarks
} from './ui.js?v=20260917-1';

const dom = {
  content: document.querySelector('#content'),
  categoryNav: document.querySelector('#categoryNav'),
  count: document.querySelector('#collectionCount'),
  sortSelect: document.querySelector('#sortSelect'),
  collectionTitle: document.querySelector('#collectionTitle'),
  search: document.querySelector('#searchInput'),
  addButton: document.querySelector('#addButton'),
  addButtonLabel: document.querySelector('#addButtonLabel'),
  heroAddButton: document.querySelector('[data-hero-add]'),
  settingsButton: document.querySelector('#settingsButton'),
  mobileCategoriesButton: document.querySelector('#mobileCategoriesButton'),
  mobileCategoryDialog: document.querySelector('#mobileCategoryDialog'),
  mobileCategoryList: document.querySelector('#mobileCategoryList'),
  bookmarkDialog: document.querySelector('#bookmarkDialog'),
  settingsDialog: document.querySelector('#settingsDialog'),
  bookmarkForm: document.querySelector('#bookmarkForm'),
  bookmarkId: document.querySelector('#bookmarkId'),
  titleInput: document.querySelector('#titleInput'),
  urlInput: document.querySelector('#urlInput'),
  categoryInput: document.querySelector('#categoryInput'),
  creatorInput: document.querySelector('#creatorInput'),
  noImageField: document.querySelector('#noImageField'),
  noImageInput: document.querySelector('#noImageInput'),
  aspectRatioInput: document.querySelector('#aspectRatioInput'),
  imageInput: document.querySelector('#imageInput'),
  imageField: document.querySelector('#imageField'),
  imageOrder: document.querySelector('#imageOrder'),
  imageOrderList: document.querySelector('#imageOrderList'),
  imagePreview: document.querySelector('#imagePreview'),
  previewRatioLabel: document.querySelector('#previewRatioLabel'),
  fileName: document.querySelector('#fileName'),
  formError: document.querySelector('#formError'),
  saveButton: document.querySelector('#saveButton'),
  bookmarkDialogTitle: document.querySelector('#bookmarkDialogTitle'),
  creatorDialog: document.querySelector('#creatorDialog'),
  creatorForm: document.querySelector('#creatorForm'),
  creatorDialogTitle: document.querySelector('#creatorDialogTitle'),
  creatorId: document.querySelector('#creatorId'),
  creatorNameInput: document.querySelector('#creatorNameInput'),
  creatorUrlInput: document.querySelector('#creatorUrlInput'),
  creatorBioInput: document.querySelector('#creatorBioInput'),
  creatorAvatarInput: document.querySelector('#creatorAvatarInput'),
  creatorAvatarPreview: document.querySelector('#creatorAvatarPreview'),
  creatorAvatarInitial: document.querySelector('#creatorAvatarInitial'),
  creatorAvatarFileName: document.querySelector('#creatorAvatarFileName'),
  creatorFormError: document.querySelector('#creatorFormError'),
  saveCreatorButton: document.querySelector('#saveCreatorButton'),
  categoryManager: document.querySelector('#categoryManager'),
  categoryForm: document.querySelector('#categoryForm'),
  newCategoryInput: document.querySelector('#newCategoryInput'),
  exportButton: document.querySelector('#exportButton'),
  exportDeltaButton: document.querySelector('#exportDeltaButton'),
  importInput: document.querySelector('#importInput'),
  importDeltaInput: document.querySelector('#importDeltaInput'),
  backupProgress: document.querySelector('#backupProgress'),
  storageMeterBar: document.querySelector('#storageMeterBar'),
  storageSummary: document.querySelector('#storageSummary'),
  persistenceSummary: document.querySelector('#persistenceSummary'),
  migrationStatus: document.querySelector('#migrationStatus'),
  persistStorageButton: document.querySelector('#persistStorageButton'),
  migrateImagesButton: document.querySelector('#migrateImagesButton'),
  storageBreakdown: document.querySelector('#storageBreakdown'),
  backupStatus: document.querySelector('#backupStatus'),
  qualityPreview: document.querySelector('#qualityPreview'),
  qualityPreviewGrid: document.querySelector('#qualityPreviewGrid'),
  confirmMigrationButton: document.querySelector('#confirmMigrationButton'),
  cancelPreviewButton: document.querySelector('#cancelPreviewButton'),
  losslessInput: document.querySelector('#losslessInput'),
  menu: document.querySelector('#cardMenu'),
  toast: document.querySelector('#toast')
};

function readSortPreference() {
  try {
    return localStorage.getItem('poster-bookmarks-sort') === 'clickCount' ? 'clickCount' : 'createdAt';
  } catch {
    return 'createdAt';
  }
}

function viewFromLocation() {
  const hash = window.location.hash.slice(1);
  if (hash === 'all' || hash === 'creators') return hash;
  if (hash.startsWith('creator/')) return `creator:${decodeURIComponent(hash.slice(8))}`;
  if (hash.startsWith('category/')) return decodeURIComponent(hash.slice(9));
  return 'home';
}

const state = {
  bookmarks: [],
  categories: [],
  creators: [],
  activeView: viewFromLocation(),
  query: '',
  sortMode: readSortPreference(),
  renderLimit: 60,
  editingImages: [],
  editingImageIds: [],
  selectedImages: [],
  selectedImageUrls: [],
  previewUrl: null,
  editingCreatorAvatar: null,
  creatorPreviewUrl: null
};
let categoryOrderSave = Promise.resolve();
let categoryOrderVersion = 0;

dom.sortSelect.value = state.sortMode;
setImageBlobLoader(getImageBlob);

function makeId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function navigate(view, { replace = false } = {}) {
  const hash = view === 'home' ? '#home'
    : view === 'all' || view === 'creators' ? `#${view}`
      : view.startsWith('creator:') ? `#creator/${encodeURIComponent(view.slice(8))}`
        : `#category/${encodeURIComponent(view)}`;
  history[replace ? 'replaceState' : 'pushState']({ view }, '', hash);
  state.activeView = view;
  state.query = '';
  state.renderLimit = 60;
  dom.search.value = '';
  render();
  document.querySelector('#mainContent').focus({ preventScroll: true });
}

function openDialog(dialog) {
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function closeDialog(dialog) {
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

let toastTimer;
function toast(message) {
  clearTimeout(toastTimer);
  dom.toast.textContent = message;
  dom.toast.classList.add('is-visible');
  toastTimer = setTimeout(() => dom.toast.classList.remove('is-visible'), 2600);
}

function safeUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('请输入完整的网址，例如 https://example.com');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('网址必须以 http:// 或 https:// 开头');
  return url.href;
}

function setPreview(blob) {
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = blob ? URL.createObjectURL(blob) : null;
  dom.imagePreview.style.backgroundImage = state.previewUrl ? `url("${state.previewUrl}")` : '';
  dom.imagePreview.classList.toggle('has-image', Boolean(blob));
}

function clearSelectedImages() {
  state.selectedImageUrls.forEach((url) => URL.revokeObjectURL(url));
  state.selectedImageUrls = [];
  state.selectedImages = [];
}

function formImages() {
  return state.selectedImages.length ? state.selectedImages : state.editingImages;
}

function updateImageOrder() {
  const images = formImages();
  dom.imageOrder.hidden = images.length < 2;
  dom.imageOrderList.replaceChildren();
  if (images.length < 2) return;
  images.forEach((image, index) => {
    const item = document.createElement('li');
    item.className = 'image-order-item';
    item.draggable = true;
    item.dataset.index = index;
    const preview = document.createElement('img');
    preview.src = state.selectedImages.length ? state.selectedImageUrls[index] : URL.createObjectURL(image);
    preview.alt = `第 ${index + 1} 张图片`;
    if (!state.selectedImages.length) preview.addEventListener('load', () => URL.revokeObjectURL(preview.src), { once: true });
    const position = document.createElement('b');
    position.className = 'image-order-position';
    position.textContent = index + 1;
    const controls = document.createElement('div');
    controls.className = 'image-order-controls';
    controls.innerHTML = `<button type="button" data-image-move="previous" aria-label="将第 ${index + 1} 张图片前移" ${index === 0 ? 'disabled' : ''}>←</button><button type="button" data-image-move="next" aria-label="将第 ${index + 1} 张图片后移" ${index === images.length - 1 ? 'disabled' : ''}>→</button>`;
    item.append(preview, position, controls);
    dom.imageOrderList.append(item);
  });
}

function moveFormImage(from, to) {
  const images = state.selectedImages.length ? state.selectedImages : state.editingImages;
  if (from === to || from < 0 || to < 0 || from >= images.length || to >= images.length) return;
  const [image] = images.splice(from, 1);
  images.splice(to, 0, image);
  if (state.selectedImages.length) {
    const [url] = state.selectedImageUrls.splice(from, 1);
    state.selectedImageUrls.splice(to, 0, url);
  } else {
    const [id] = state.editingImageIds.splice(from, 1);
    state.editingImageIds.splice(to, 0, id);
  }
  setPreview(images[0]);
  updateImageOrder();
}

function setCreatorPreview(blob, name = '') {
  if (state.creatorPreviewUrl) URL.revokeObjectURL(state.creatorPreviewUrl);
  state.creatorPreviewUrl = blob ? URL.createObjectURL(blob) : null;
  dom.creatorAvatarPreview.style.backgroundImage = state.creatorPreviewUrl ? `url("${state.creatorPreviewUrl}")` : '';
  dom.creatorAvatarPreview.classList.toggle('has-image', Boolean(blob));
  dom.creatorAvatarInitial.textContent = name.trim().charAt(0).toUpperCase() || 'M';
}

function updatePreviewRatio() {
  const selected = ASPECT_RATIOS[dom.aspectRatioInput.value] ? dom.aspectRatioInput.value : '3:2';
  dom.imagePreview.style.setProperty('--preview-ratio', ASPECT_RATIOS[selected]);
  dom.previewRatioLabel.textContent = selected;
}

function syncNoImageOption() {
  const isWebsite = dom.categoryInput.value === 'websites';
  dom.noImageField.hidden = !isWebsite;
  if (!isWebsite) dom.noImageInput.checked = false;
  const withoutImage = isWebsite && dom.noImageInput.checked;
  dom.imageInput.disabled = withoutImage;
  dom.imageField.classList.toggle('is-disabled', withoutImage);
  if (withoutImage) {
    dom.imageInput.value = '';
    clearSelectedImages();
    dom.fileName.textContent = '将使用文字网址卡片';
    setPreview(null);
    updateImageOrder();
    return;
  }
  const selectedFile = state.selectedImages[0];
  setPreview(selectedFile || state.editingImages[0] || null);
  if (selectedFile) dom.fileName.textContent = state.selectedImages.length === 1 ? selectedFile.name : `已选择 ${state.selectedImages.length} 张图片`;
  else if (state.editingImages.length) dom.fileName.textContent = `保留当前 ${state.editingImages.length} 张图片`;
  else dom.fileName.textContent = 'JPG、PNG、WEBP';
  updateImageOrder();
}

async function storeImageAssets(blobs, options = {}) {
  const imageIds = [];
  for (let index = 0; index < blobs.length; index += 1) {
    const groupId = await savePreparedImage(await prepareImage(blobs[index], IMAGE_POLICY, options));
    await verifyImageGroup(groupId);
    imageIds.push(groupId);
    if ((index + 1) % 3 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return imageIds;
}

function formatBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 100 * 1024 * 1024 ? 1 : 0)} MB`;
}

function backupRecordText(record, fallbackDate) {
  const value = record || fallbackDate;
  if (!value) return '';
  const exportedAt = value.exportedAt || value;
  const source = value.sourceDevice ? ` · 来源 ${value.sourceDevice}` : '';
  const date = new Date(exportedAt);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.toLocaleString('zh-CN')}${source}`;
}

async function refreshStorageStatus() {
  const [estimate, persisted, stats, lastBackup, lastBackupAt, lastRestore, lastMerge] = await Promise.all([
    navigator.storage?.estimate?.() || {},
    navigator.storage?.persisted?.() || false,
    getAssetStats(),
    getMeta('lastBackup'),
    getMeta('lastBackupAt'),
    getMeta('lastRestore'),
    getMeta('lastMerge')
  ]);
  const measured = (stats.textBytes || 0) + (stats.displayBytes || 0) + (stats.thumbnailBytes || 0) + (stats.legacyBytes || 0);
  const usage = Math.max(estimate.usage || 0, measured);
  const quota = estimate.quota || 0;
  const percentage = quota ? Math.min(100, usage / quota * 100) : 0;
  dom.storageMeterBar.style.width = `${percentage}%`;
  dom.storageMeterBar.parentElement.classList.toggle('is-warning', percentage >= 70 && percentage < 85);
  dom.storageMeterBar.parentElement.classList.toggle('is-danger', percentage >= 85);
  dom.storageSummary.textContent = `资料约 ${formatBytes(measured)} · ${stats.bookmarkCount} 个收藏 · ${stats.imageCount} 组优化图片${quota ? ` · 浏览器估算上限约 ${formatBytes(quota)}` : ''}`;
  const parts = [
    `文字 ${formatBytes(stats.textBytes || 0)}`,
    stats.imageCount ? `显示图 ${formatBytes(stats.displayBytes)}` : null,
    stats.imageCount ? `缩略图 ${formatBytes(stats.thumbnailBytes)}` : null,
    stats.legacyCount ? `待优化 PNG ${formatBytes(stats.legacyBytes)}` : null
  ].filter(Boolean);
  dom.storageBreakdown.textContent = parts.join(' · ');
  const capacityWarning = percentage >= 85 ? '存储使用率已超过 85%，请尽快导出并清理。' : percentage >= 70 ? '存储使用率已超过 70%，建议准备新备份。' : '';
  dom.persistenceSummary.textContent = `${capacityWarning}${capacityWarning ? ' ' : ''}${persisted ? '浏览器已授予持久存储保护。' : '当前为浏览器尽力保存模式，请继续保留硬盘备份。'}`;
  const backupText = backupRecordText(lastBackup, lastBackupAt);
  const restoreText = backupRecordText(lastRestore);
  const mergeText = backupRecordText(lastMerge);
  const backupBits = [
    backupText ? `最近备份：${backupText}` : '',
    restoreText ? `最近完整恢复：${restoreText}` : '',
    mergeText ? `最近合并变更：${mergeText}` : ''
  ].filter(Boolean);
  dom.backupStatus.textContent = backupBits.join('。') || '还没有记录完整备份。';
  if (!migrationRunning && (!dom.qualityPreview || dom.qualityPreview.hidden) && !dom.migrationStatus.dataset.locked) {
    const progress = await getMeta('imageMigrationProgress');
    dom.migrationStatus.textContent = stats.legacyCount
      ? (progress?.done ? `旧图片优化可继续，还剩 ${stats.legacyCount} 个收藏。` : `还有 ${stats.legacyCount} 个收藏使用旧版 PNG。`)
      : '';
  }
  dom.persistStorageButton.hidden = persisted || !navigator.storage?.persist;
  dom.migrateImagesButton.hidden = stats.legacyCount === 0;
  dom.migrateImagesButton.textContent = stats.legacyCount ? `优化旧图片（${stats.legacyCount}）` : '旧图片已优化';
}

async function requestPersistentStorage() {
  const granted = await navigator.storage?.persist?.();
  await refreshStorageStatus();
  toast(granted ? '已获得持久存储保护' : '浏览器暂未授予持久存储，请保持定期备份');
}

let migrationRunning = false;
const previewUrls = [];

function revokePreviewUrls() {
  previewUrls.forEach((url) => URL.revokeObjectURL(url));
  previewUrls.length = 0;
}

function previewFigure(blob, caption) {
  const figure = document.createElement('figure');
  const image = new Image();
  const url = URL.createObjectURL(blob);
  previewUrls.push(url);
  image.src = url;
  image.alt = caption;
  const label = document.createElement('figcaption');
  label.textContent = caption;
  figure.append(image, label);
  return figure;
}

async function showQualityPreview() {
  revokePreviewUrls();
  dom.qualityPreviewGrid.replaceChildren();
  dom.qualityPreview.hidden = false;
  dom.migrationStatus.dataset.locked = 'true';
  dom.migrationStatus.textContent = '正在生成画质对比…';
  const samples = await getLegacySamples(12);
  if (!samples.length) {
    hideQualityPreview();
    throw new Error('没有找到可对比的旧图片');
  }
  for (const bookmark of samples) {
    const blob = [bookmark.image, ...(bookmark.gallery || [])].find((image) => image instanceof Blob);
    if (!blob) continue;
    const [q90, q85] = await Promise.all([
      prepareImage(blob, IMAGE_POLICY),
      prepareImage(blob, { ...IMAGE_POLICY, displayQuality: 0.85 })
    ]);
    const item = document.createElement('div');
    item.className = 'quality-preview-item';
    const title = document.createElement('strong');
    title.textContent = bookmark.title;
    const images = document.createElement('div');
    images.className = 'quality-preview-images';
    images.append(
      previewFigure(blob, '原图'),
      previewFigure(q90.display, 'WebP 0.90'),
      previewFigure(q85.display, 'WebP 0.85')
    );
    item.append(title, images);
    dom.qualityPreviewGrid.append(item);
  }
  dom.migrationStatus.textContent = `已抽出 ${dom.qualityPreviewGrid.children.length} 张样本。确认画质后开始批量优化。`;
}

function hideQualityPreview() {
  revokePreviewUrls();
  if (dom.qualityPreview) {
    dom.qualityPreview.hidden = true;
    dom.qualityPreviewGrid.replaceChildren();
  }
  delete dom.migrationStatus.dataset.locked;
}

async function runLegacyMigration() {
  if (migrationRunning) return;
  migrationRunning = true;
  dom.migrateImagesButton.disabled = true;
  dom.confirmMigrationButton.disabled = true;
  hideQualityPreview();
  let migrated = 0;
  try {
    let bookmark = await getLegacyBookmark();
    while (bookmark) {
      const blobs = [bookmark.image, ...(bookmark.gallery || [])].filter((image) => image instanceof Blob);
      dom.migrationStatus.dataset.locked = 'true';
      dom.migrationStatus.textContent = `正在优化“${bookmark.title}”的 ${blobs.length} 张图片…`;
      const imageIds = await storeImageAssets(blobs);
      await migrateLegacyBookmark(bookmark.id, imageIds);
      migrated += 1;
      await setMeta('imageMigrationProgress', { done: migrated, updatedAt: new Date().toISOString() });
      await new Promise((resolve) => setTimeout(resolve, 0));
      bookmark = await getLegacyBookmark();
    }
    await setMeta('imageMigrationCompletedAt', new Date().toISOString());
    await setMeta('imageMigrationProgress', { done: migrated, remaining: 0, updatedAt: new Date().toISOString() });
    delete dom.migrationStatus.dataset.locked;
    dom.migrationStatus.textContent = `已安全优化 ${migrated} 个旧收藏。`;
    await refresh();
    await refreshStorageStatus();
    toast('旧图片优化完成');
  } catch (error) {
    dom.migrationStatus.dataset.locked = 'true';
    dom.migrationStatus.textContent = `优化已暂停：${error.message || '未知错误'}。已完成的部分会保留，下次可以继续。`;
  } finally {
    migrationRunning = false;
    dom.migrateImagesButton.disabled = false;
    if (dom.confirmMigrationButton) dom.confirmMigrationButton.disabled = false;
  }
}

async function migrateLegacyLibrary() {
  if (migrationRunning) return;
  const previewed = await getMeta('imageMigrationPreviewedAt');
  if (!previewed) {
    if (!confirm('开始前会先抽出最多 12 张旧图，对比原图、WebP 0.90 和 0.85。\n\n请确认已经保留旧版完整备份，是否继续？')) return;
    try {
      await showQualityPreview();
    } catch (error) {
      toast(error.message || '无法生成画质对比');
    }
    return;
  }
  if (!confirm('旧图片会分批转换为高质量 WebP，并在读回校验后移除浏览器中的 PNG 副本。\n\n已完成的部分会保留，关闭页面后可以继续。是否开始？')) return;
  await runLegacyMigration();
}

function countsByCategory() {
  const counts = new Map();
  state.bookmarks.forEach((bookmark) => counts.set(bookmark.category, (counts.get(bookmark.category) || 0) + 1));
  return counts;
}

function renderMobileCategoryList() {
  const counts = countsByCategory();
  dom.mobileCategoryList.replaceChildren();
  state.categories.filter((category) => !category.system && !isCreatorWorksCategory(category)).forEach((category) => {
    const button = document.createElement('button');
    button.className = `mobile-category-option${state.activeView === category.id ? ' is-active' : ''}`;
    button.type = 'button';
    button.dataset.view = category.id;
    if (state.activeView === category.id) button.setAttribute('aria-current', 'page');

    const mark = document.createElement('span');
    mark.className = 'mobile-category-mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.append(navigationIcon(categoryIconKey(category)));

    const copy = document.createElement('span');
    copy.className = 'mobile-category-copy';
    const name = document.createElement('strong');
    name.textContent = category.name;
    const count = document.createElement('small');
    count.textContent = `${counts.get(category.id) || 0} 个收藏`;
    copy.append(name, count);

    const arrow = document.createElement('span');
    arrow.className = 'mobile-category-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '›';
    button.append(mark, copy, arrow);
    dom.mobileCategoryList.append(button);
  });
  dom.mobileCategoriesButton.classList.toggle('is-active', state.categories.some((category) => category.id === state.activeView));
}

function renderCategoryOrdering(includeContent = false) {
  renderNavigation(dom.categoryNav, state.categories, state.activeView);
  renderMobileCategoryList();
  renderCategoryOptions(dom.categoryInput, state.categories, dom.categoryInput.value);
  renderCategoryManager(dom.categoryManager, state.categories, countsByCategory());
  if (includeContent && state.activeView === 'home' && !state.query.trim()) {
    renderContent(dom.content, state.bookmarks, state.categories, state.creators, state.activeView, state.query, state.sortMode, state.renderLimit);
  }
}

function updateRenderedClickCount(bookmark) {
  const categoryName = state.categories.find((category) => category.id === bookmark.category)?.name || '未分类';
  const subtitle = `${categoryName} · 打开 ${bookmark.clickCount} 次`;
  document.querySelectorAll('.poster-card').forEach((card) => {
    if (card.dataset.id === bookmark.id) card.querySelector('.poster-category').textContent = subtitle;
  });
}

function reorderRenderedCards() {
  const positions = new Map(sortBookmarks(state.bookmarks, 'clickCount').map((bookmark, index) => [bookmark.id, index]));
  document.querySelectorAll('.poster-row, .poster-grid').forEach((collection) => {
    const cards = [...collection.children].filter((child) => child.classList.contains('poster-card'));
    cards.sort((first, second) => positions.get(first.dataset.id) - positions.get(second.dataset.id));
    collection.append(...cards);
  });
}

function render() {
  const isHomeView = state.activeView === 'home' && !state.query.trim();
  const creatorId = state.activeView.startsWith('creator:') ? state.activeView.slice(8) : '';
  const activeCreator = state.creators.find((creator) => creator.id === creatorId);
  const isCreatorDetail = Boolean(activeCreator);
  document.body.classList.toggle('is-home-view', isHomeView);
  document.body.classList.toggle('is-creator-detail', isCreatorDetail);
  renderNavigation(dom.categoryNav, state.categories, state.activeView);
  renderMobileCategoryList();
  renderContent(dom.content, state.bookmarks, state.categories, state.creators, state.activeView, state.query, state.sortMode, state.renderLimit);
  renderCategoryOptions(dom.categoryInput, state.categories, dom.categoryInput.value);
  renderCreatorOptions(dom.creatorInput, state.creators, dom.creatorInput.value);
  renderCategoryManager(dom.categoryManager, state.categories, countsByCategory());
  const visibleBookmarkCount = bookmarksForView(state.bookmarks, state.categories, state.activeView, state.query).length;
  dom.count.textContent = state.activeView === 'creators' ? `${state.creators.length} 位博主` : isCreatorDetail ? `${visibleBookmarkCount} 个作品` : `${visibleBookmarkCount} 个收藏`;
  const activeCategory = state.categories.find((category) => category.id === state.activeView);
  const title = state.query ? '搜索结果' : activeCreator?.name || (state.activeView === 'creators' ? '博主' : activeCategory?.name || (state.activeView === 'all' ? '全部收藏' : state.sortMode === 'clickCount' ? '最常打开' : '最近添加'));
  dom.collectionTitle.innerHTML = `${title} <span aria-hidden="true">›</span>`;
  dom.sortSelect.closest('.sort-control').hidden = state.activeView === 'creators' || isCreatorDetail;
  dom.addButtonLabel.textContent = state.activeView === 'creators' ? '添加博主' : isCreatorDetail ? '添加作品' : '添加';
}

async function refresh() {
  [state.bookmarks, state.categories, state.creators] = await Promise.all([getBookmarks(), getCategories(), getCreators()]);
  const creatorViewExists = state.activeView === 'creators' || (state.activeView.startsWith('creator:') && state.creators.some((creator) => creator.id === state.activeView.slice(8)));
  if (state.categories.some((category) => category.id === state.activeView && isCreatorWorksCategory(category))) {
    state.activeView = 'creators';
    history.replaceState({ view: 'creators' }, '', '#creators');
  } else if (!['home', 'all'].includes(state.activeView) && !creatorViewExists && !state.categories.some((category) => category.id === state.activeView)) {
    state.activeView = 'home';
    history.replaceState({ view: 'home' }, '', '#home');
  }
  render();
}

function defaultCategoryId(forCreator = false) {
  if (forCreator) {
    const creatorWorks = state.categories.find(isCreatorWorksCategory);
    if (creatorWorks) return creatorWorks.id;
  }
  return state.categories.find((category) => !category.system)?.id || 'uncategorized';
}

function resetBookmarkForm(creatorId = '') {
  dom.bookmarkForm.reset();
  dom.bookmarkId.value = '';
  dom.bookmarkDialogTitle.textContent = '添加收藏';
  dom.formError.textContent = '';
  dom.fileName.textContent = 'JPG、PNG、WEBP';
  state.editingImages = [];
  state.editingImageIds = [];
  clearSelectedImages();
  if (dom.losslessInput) dom.losslessInput.checked = false;
  setPreview(null);
  dom.aspectRatioInput.selectedIndex = 0;
  dom.aspectRatioInput.value = '3:2';
  updatePreviewRatio();
  renderCategoryOptions(dom.categoryInput, state.categories, defaultCategoryId(Boolean(creatorId)));
  renderCreatorOptions(dom.creatorInput, state.creators, creatorId);
  syncNoImageOption();
}

function showAddDialog(creatorId = '') {
  resetBookmarkForm(creatorId);
  openDialog(dom.bookmarkDialog);
  setTimeout(() => dom.titleInput.focus(), 0);
}

async function showEditDialog(id, replaceImage = false) {
  const bookmark = await getBookmark(id);
  if (!bookmark) return;
  resetBookmarkForm();
  dom.bookmarkId.value = bookmark.id;
  dom.bookmarkDialogTitle.textContent = '编辑收藏';
  dom.titleInput.value = bookmark.title;
  dom.urlInput.value = bookmark.url;
  renderCategoryOptions(dom.categoryInput, state.categories, bookmark.category);
  renderCreatorOptions(dom.creatorInput, state.creators, bookmark.creatorId || '');
  dom.aspectRatioInput.value = ['3:2', '3:4'].includes(bookmark.aspectRatio) ? bookmark.aspectRatio : '3:2';
  updatePreviewRatio();
  state.editingImageIds = bookmark.imageIds || [];
  state.editingImages = await getBookmarkImageBlobs(bookmark);
  setPreview(state.editingImages[0]);
  dom.noImageInput.checked = bookmark.category === 'websites' && state.editingImages.length === 0;
  syncNoImageOption();
  dom.fileName.textContent = replaceImage ? '请选择新的图片组' : `保留当前 ${state.editingImages.length} 张图片`;
  if (dom.noImageInput.checked) dom.fileName.textContent = '将使用文字网址卡片';
  updateImageOrder();
  openDialog(dom.bookmarkDialog);
}

async function saveForm(event) {
  event.preventDefault();
  dom.formError.textContent = '';
  dom.saveButton.disabled = true;
  try {
    const existing = dom.bookmarkId.value ? await getBookmark(dom.bookmarkId.value) : null;
    const withoutImage = dom.categoryInput.value === 'websites' && dom.noImageInput.checked;
    const selectedFiles = state.selectedImages;
    let imageIds = withoutImage ? [] : state.editingImageIds;
    if (!withoutImage && selectedFiles.length) imageIds = await storeImageAssets(selectedFiles, { lossless: dom.losslessInput?.checked, name: selectedFiles[0].name });
    else if (!withoutImage && !imageIds.length && state.editingImages.length) imageIds = await storeImageAssets(state.editingImages);
    if (!imageIds.length && !withoutImage) throw new Error('请至少选择一张图片；网站分类可以选择“无需图片”');
    const now = Date.now();
    await saveBookmark({
      ...(existing || {}),
      id: existing?.id || makeId(),
      title: dom.titleInput.value.trim(),
      url: safeUrl(dom.urlInput.value.trim()),
      image: null,
      gallery: [],
      imageIds,
      assetVersion: 1,
      category: dom.categoryInput.value || 'uncategorized',
      creatorId: dom.creatorInput.value || null,
      aspectRatio: dom.aspectRatioInput.value || '3:2',
      createdAt: existing?.createdAt || now,
      updatedAt: now
    });
    if (existing?.imageIds?.length && existing.imageIds.some((id) => !imageIds.includes(id))) await cleanupImageGroups(existing.imageIds);
    closeDialog(dom.bookmarkDialog);
    await refresh();
    toast(existing ? '收藏已更新' : '已加入收藏');
  } catch (error) {
    dom.formError.textContent = error.message || '保存失败，请重试';
  } finally {
    dom.saveButton.disabled = false;
  }
}

function resetCreatorForm() {
  dom.creatorForm.reset();
  dom.creatorId.value = '';
  dom.creatorDialogTitle.textContent = '添加博主';
  dom.creatorFormError.textContent = '';
  dom.creatorAvatarFileName.textContent = 'JPG、PNG、WEBP';
  state.editingCreatorAvatar = null;
  setCreatorPreview(null, '');
}

function showCreatorDialog(id = '') {
  resetCreatorForm();
  const creator = state.creators.find((item) => item.id === id);
  if (creator) {
    dom.creatorId.value = creator.id;
    dom.creatorDialogTitle.textContent = '编辑博主';
    dom.creatorNameInput.value = creator.name;
    dom.creatorUrlInput.value = creator.homepageUrl || '';
    dom.creatorBioInput.value = creator.bio || '';
    state.editingCreatorAvatar = creator.avatar || null;
    setCreatorPreview(state.editingCreatorAvatar, creator.name);
    dom.creatorAvatarFileName.textContent = state.editingCreatorAvatar ? '保留当前图片' : 'JPG、PNG、WEBP';
  }
  openDialog(dom.creatorDialog);
  setTimeout(() => dom.creatorNameInput.focus(), 0);
}

async function saveCreatorForm(event) {
  event.preventDefault();
  dom.creatorFormError.textContent = '';
  dom.saveCreatorButton.disabled = true;
  try {
    const existing = state.creators.find((creator) => creator.id === dom.creatorId.value);
    const selectedAvatar = dom.creatorAvatarInput.files[0];
    const avatar = selectedAvatar
      ? (await prepareImage(selectedAvatar, { ...IMAGE_POLICY, displayMaxEdge: 800, displayQuality: 0.88 })).display
      : state.editingCreatorAvatar;
    const homepageValue = dom.creatorUrlInput.value.trim();
    const now = Date.now();
    const creator = {
      ...(existing || {}),
      id: existing?.id || makeId(),
      name: dom.creatorNameInput.value.trim(),
      homepageUrl: homepageValue ? safeUrl(homepageValue) : '',
      bio: dom.creatorBioInput.value.trim(),
      avatar: avatar || null,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
    await saveCreator(creator);
    closeDialog(dom.creatorDialog);
    await refresh();
    navigate(`creator:${creator.id}`, { replace: existing && state.activeView === `creator:${creator.id}` });
    toast(existing ? '博主资料已更新' : '博主已添加');
  } catch (error) {
    dom.creatorFormError.textContent = error.message || '保存失败，请重试';
  } finally {
    dom.saveCreatorButton.disabled = false;
  }
}

async function removeCreator(id) {
  const creator = state.creators.find((item) => item.id === id);
  if (!creator || !confirm(`删除博主“${creator.name}”？\n\n作品不会删除，只会解除与该博主的关联。`)) return;
  await deleteCreator(id);
  await refresh();
  navigate('creators', { replace: state.activeView === `creator:${id}` });
  toast('博主已删除，作品已保留');
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Safari can expose Clipboard API on a LAN HTTP origin but reject writes.
    }
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

async function handleMenuAction(action, id) {
  dom.menu.hidden = true;
  const bookmark = state.bookmarks.find((item) => item.id === id);
  if (!bookmark) return;
  if (action === 'edit') await showEditDialog(id);
  if (action === 'replace-image') await showEditDialog(id, true);
  if (action === 'copy') {
    await copyText(bookmark.url);
    toast('链接已复制');
  }
  if (action === 'delete' && confirm(`删除“${bookmark.title}”？\n\n这个操作只会删除本地收藏。`)) {
    await deleteBookmark(id);
    await refresh();
    toast('收藏已删除');
  }
}

async function addCategory(event) {
  event.preventDefault();
  const name = dom.newCategoryInput.value.trim();
  if (!name) return;
  if (state.categories.some((category) => category.name.toLocaleLowerCase('zh-CN') === name.toLocaleLowerCase('zh-CN'))) {
    toast('这个分类已经存在');
    return;
  }
  const lastOrder = state.categories.reduce((highest, category) => {
    const order = Number.isFinite(category.sortOrder) ? category.sortOrder : (category.createdAt || 0);
    return Math.max(highest, order);
  }, -1);
  await saveCategory({ id: makeId(), name, createdAt: Date.now(), sortOrder: lastOrder + 1 });
  dom.categoryForm.reset();
  await refresh();
  toast('分类已添加');
}

async function persistCategoryOrder(orderedIds, movedId) {
  const version = ++categoryOrderVersion;
  const categoryMap = new Map(state.categories.map((category) => [category.id, category]));
  const seen = new Set();
  state.categories = orderedIds
    .map((id) => {
      const category = categoryMap.get(id);
      if (category) seen.add(id);
      return category;
    })
    .filter(Boolean)
    .concat(state.categories.filter((category) => !seen.has(category.id)))
    .map((category, sortOrder) => ({ ...category, sortOrder }));
  const movedCategory = categoryMap.get(movedId);
  const movedPosition = state.categories.findIndex((category) => category.id === movedId) + 1;
  renderCategoryOrdering();
  if (movedId) dom.categoryManager.querySelector(`[data-category-drag-handle="${CSS.escape(movedId)}"]`)?.focus();

  const save = categoryOrderSave.catch(() => {}).then(() => saveCategoryOrder(orderedIds));
  categoryOrderSave = save;
  try {
    await save;
    if (version !== categoryOrderVersion) return;
    renderCategoryOrdering(true);
    const message = movedCategory && movedPosition
      ? `“${movedCategory.name}”已移至第 ${movedPosition} 位`
      : '分类顺序已保存';
    toast(message);
    if (movedId) dom.categoryManager.querySelector(`[data-category-drag-handle="${CSS.escape(movedId)}"]`)?.focus();
  } catch (error) {
    if (version === categoryOrderVersion) {
      try {
        const categories = await getCategories();
        if (version === categoryOrderVersion) {
          state.categories = categories;
          renderCategoryOrdering(true);
        }
      } catch {
        // Preserve the original save error for the user-facing message.
      }
    }
    throw error;
  }
}

async function moveCategory(id, offset) {
  const currentIndex = state.categories.findIndex((category) => category.id === id);
  const nextIndex = currentIndex + offset;
  if (currentIndex < 0 || nextIndex < 0 || nextIndex >= state.categories.length) return;
  const orderedIds = state.categories.map((category) => category.id);
  const [movedId] = orderedIds.splice(currentIndex, 1);
  orderedIds.splice(nextIndex, 0, movedId);
  await persistCategoryOrder(orderedIds, id);
}

async function handleCategoryAction(target) {
  const renameId = target.dataset.renameCategory;
  const deleteId = target.dataset.deleteCategory;
  const moveId = target.dataset.moveCategory;
  if (moveId) {
    await moveCategory(moveId, Number(target.dataset.moveDirection));
    return;
  }
  if (renameId) {
    const category = state.categories.find((item) => item.id === renameId);
    const name = prompt('新的分类名称', category.name)?.trim();
    if (!name || name === category.name) return;
    if (state.categories.some((item) => item.id !== renameId && item.name.toLocaleLowerCase('zh-CN') === name.toLocaleLowerCase('zh-CN'))) {
      toast('这个分类名称已经存在');
      return;
    }
    await renameCategory(renameId, name);
    await refresh();
    toast('分类已重命名');
  }
  if (deleteId) {
    const category = state.categories.find((item) => item.id === deleteId);
    if (!confirm(`删除分类“${category.name}”？\n\n其中的收藏会移到“未分类”。`)) return;
    await removeCategory(deleteId);
    await refresh();
    toast('分类已删除，收藏已移到未分类');
  }
}

async function updateCategoryIcon(id, icon) {
  const category = state.categories.find((item) => item.id === id);
  if (!category) return;
  const updated = { ...category };
  if (icon) updated.icon = icon;
  else delete updated.icon;
  await saveCategory(updated);
  await refresh();
  toast(icon ? '分类图标已更新' : '已恢复自动匹配图标');
}

async function loadImageGroups(bookmark) {
  if (!bookmark.imageIds?.length) return [];
  const groups = await Promise.all(bookmark.imageIds.map(getImageGroup));
  return groups.filter(Boolean);
}

function deviceLabel() {
  const platform = navigator.platform || '';
  const agent = navigator.userAgent || '';
  if (/iPhone/i.test(agent)) return 'iPhone';
  if (/iPad/i.test(agent) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'iPad';
  return /Mac/i.test(platform) ? 'Mac 主库' : '本地设备';
}

function setBackupButtonsDisabled(disabled) {
  dom.exportButton.disabled = disabled;
  if (dom.exportDeltaButton) dom.exportDeltaButton.disabled = disabled;
}

async function exportCollection({ delta = false } = {}) {
  if (!state.bookmarks.length && !state.creators.length) {
    toast('还没有可导出的收藏');
    return;
  }
  setBackupButtonsDisabled(true);
  try {
    const stats = await getAssetStats();
    if (stats.legacyCount) throw new Error(`请先完成 ${stats.legacyCount} 个旧收藏的图片优化，再导出备份`);
    let bookmarks = state.bookmarks;
    let categories = state.categories;
    let creators = state.creators;
    let since;
    if (delta) {
      const lastBackup = await getMeta('lastBackup');
      since = lastBackup?.exportedAt || await getMeta('lastBackupAt');
      const selected = selectDeltaRecords({ bookmarks, categories, creators, since });
      bookmarks = selected.bookmarks;
      categories = selected.categories;
      creators = selected.creators;
    }
    const manifest = await exportVolumeBackup({
      bookmarks,
      categories,
      creators,
      allBookmarks: state.bookmarks,
      loadImageGroups,
      sourceDevice: deviceLabel(),
      packaging: delta ? 'delta' : 'volume',
      since,
      onProgress: ({ phase, current, total }) => {
        if (phase === 'complete') dom.backupProgress.textContent = delta
          ? `已导出 ${bookmarks.length} 条变更，共 ${total} 个图片分卷。`
          : `已导出 ${total} 个图片分卷、数据文件、校验文件和清单。`;
        else if (phase === 'data') dom.backupProgress.textContent = '正在写入收藏数据…';
        else dom.backupProgress.textContent = `正在生成第 ${current} 个图片分卷…`;
      }
    });
    await setMeta('lastBackup', { exportedAt: manifest.exportedAt, sourceDevice: manifest.sourceDevice, backupId: manifest.backupId, fileCount: manifest.files.length, packaging: manifest.packaging });
    await setMeta('lastBackupAt', manifest.exportedAt);
    await refreshStorageStatus();
    toast(delta
      ? (manifest.bookmarkCount ? `变更已导出，共 ${manifest.bookmarkCount} 个收藏` : '打开次数等变更已导出')
      : `备份已导出，共 ${manifest.imagePartCount} 个图片分卷`);
  } catch (error) {
    toast(error.message || '导出失败');
  } finally {
    setBackupButtonsDisabled(false);
  }
}

function preparedAssetRecords(prepared, groupId) {
  const now = Date.now();
  return [
    { id: `${groupId}:display`, groupId, kind: 'display', hash: prepared.hash, blob: prepared.display, width: prepared.width, height: prepared.height, createdAt: now },
    { id: `${groupId}:thumbnail`, groupId, kind: 'thumbnail', hash: null, blob: prepared.thumbnail, width: prepared.thumbnailWidth, height: prepared.thumbnailHeight, createdAt: now }
  ];
}

async function stageLegacyRecords(records) {
  await stageSnapshotPart({ categories: records.categories, creators: records.creators });
  for (let index = 0; index < records.bookmarks.length; index += 1) {
    const bookmark = records.bookmarks[index];
    const blobs = [bookmark.image, ...(bookmark.gallery || [])].filter((image) => image instanceof Blob);
    const imageIds = [];
    const imageAssets = [];
    for (const blob of blobs) {
      const groupId = makeId();
      imageIds.push(groupId);
      imageAssets.push(...preparedAssetRecords(await prepareImage(blob), groupId));
    }
    const { image, gallery, ...metadata } = bookmark;
    await stageSnapshotPart({ bookmarks: [{ ...metadata, imageIds, assetVersion: 1 }], imageAssets });
    bookmark.image = null;
    bookmark.gallery = [];
    dom.backupProgress.textContent = `正在转换旧备份 ${index + 1}/${records.bookmarks.length}…`;
  }
}

async function importCollection(files) {
  const selectedFiles = [...(files || [])];
  if (!selectedFiles.length) return;
  let inspected;
  try {
    dom.backupProgress.textContent = '正在识别备份格式…';
    inspected = await inspectBackupFiles(selectedFiles);
  } catch (error) {
    if (selectedFiles.length === 1 && !/manifest|checksums|\.mvpart$/i.test(selectedFiles[0].name)) inspected = { kind: 'legacy', files: selectedFiles };
    else {
      dom.backupProgress.textContent = `恢复失败：${error.message}`;
      toast(error.message);
      resetImportInputs();
      return;
    }
  }
  const isDelta = inspected.kind === 'delta';
  const source = inspected.manifest;
  const details = source
    ? `来源：${source.sourceDevice || '未知设备'}\n导出时间：${new Date(source.exportedAt).toLocaleString('zh-CN')}\n收藏数量：${source.bookmarkCount}\n图片组数：${source.imageCount ?? '未知'}\n文件数量：${(source.files || []).length || inspected.orderedFiles?.length || selectedFiles.length}`
    : `旧版单文件：${selectedFiles[0].name}${selectedFiles[0].size > 80 * 1024 * 1024 ? '\n这是超大 JSON，建议只在 Mac 上恢复。' : ''}`;
  const promptText = isDelta
    ? `这是变更包，会把其中的收藏合并到这台设备，不会删除其他现有收藏。\n\n${details}\n\n是否继续？`
    : `完整恢复会使用所选备份替换这台设备上的全部收藏。\n\n${details}\n\n只有所有文件验证并写入成功后才会切换，是否继续？`;
  if (!confirm(promptText)) {
    resetImportInputs();
    return;
  }
  setBackupButtonsDisabled(true);
  try {
    await clearStagedSnapshot();
    let restoreMeta;
    if (inspected.kind === 'legacy') {
      if (selectedFiles[0].size > 80 * 1024 * 1024 && !confirm('超大旧版 JSON 会占用较多内存。导入期间请勿离开页面，是否继续？')) {
        await clearStagedSnapshot().catch(() => {});
        return;
      }
      dom.backupProgress.textContent = '正在读取旧版备份…';
      const records = await parseBackup(selectedFiles[0]);
      records.bookmarks.forEach((bookmark) => { bookmark.url = safeUrl(bookmark.url); });
      records.creators.forEach((creator) => { if (creator.homepageUrl) creator.homepageUrl = safeUrl(creator.homepageUrl); });
      await stageLegacyRecords(records);
      await stageSnapshotPart({ clickCounts: serializeClickLedger(records.bookmarks) });
      restoreMeta = { backupId: `legacy-${Date.now()}`, exportedAt: new Date().toISOString(), sourceDevice: '旧版 JSON', bookmarkCount: records.bookmarks.length, categoryCount: records.categories.length, creatorCount: records.creators.length, imageCount: records.bookmarks.reduce((total, bookmark) => total + (bookmark.imageIds?.length || 0), 0) };
    } else if (inspected.kind === 'v3') {
      const { manifest, orderedFiles } = inspected;
      for (let index = 0; index < orderedFiles.length; index += 1) {
        dom.backupProgress.textContent = `正在暂存第 ${index + 1}/${orderedFiles.length} 个分卷…`;
        const part = await parseBackupPart(orderedFiles[index], manifest);
        part.bookmarks.forEach((bookmark) => { bookmark.url = safeUrl(bookmark.url); });
        part.creators.forEach((creator) => { if (creator.homepageUrl) creator.homepageUrl = safeUrl(creator.homepageUrl); });
        await stageSnapshotPart({ ...part, clickCounts: serializeClickLedger(part.bookmarks) });
      }
      restoreMeta = manifest;
    } else {
      const { manifest, dataFiles, imageFiles } = inspected;
      for (let index = 0; index < dataFiles.length; index += 1) {
        dom.backupProgress.textContent = `正在暂存数据分卷 ${index + 1}/${dataFiles.length}…`;
        const part = await parseDataPart(dataFiles[index], manifest);
        part.bookmarks.forEach((bookmark) => { bookmark.url = safeUrl(bookmark.url); });
        part.creators.forEach((creator) => { if (creator.homepageUrl) creator.homepageUrl = safeUrl(creator.homepageUrl); });
        await stageSnapshotPart(part);
      }
      for (let index = 0; index < imageFiles.length; index += 1) {
        dom.backupProgress.textContent = `正在暂存图片分卷 ${index + 1}/${imageFiles.length}…`;
        const part = await unpackImagePart(imageFiles[index], manifest);
        await stageSnapshotPart({ imageAssets: part.imageAssets });
      }
      restoreMeta = manifest;
    }
    const stagedStats = await getStagedSnapshotStats();
    for (const key of ['bookmarkCount', 'categoryCount', 'creatorCount']) {
      if (Number.isFinite(restoreMeta[key]) && stagedStats[key] !== restoreMeta[key]) throw new Error(`暂存资料数量校验失败：${key}`);
    }
    if (Number.isFinite(restoreMeta.imageCount) && restoreMeta.version !== 3 && stagedStats.imageCount !== restoreMeta.imageCount) {
      throw new Error('暂存资料数量校验失败：imageCount');
    }
    if (isDelta) {
      dom.backupProgress.textContent = '正在合并已验证的变更…';
      await mergeStagedSnapshot(restoreMeta);
      await refresh();
      await refreshStorageStatus();
      dom.backupProgress.textContent = `已合并 ${restoreMeta.bookmarkCount || 0} 个收藏变更。`;
      toast('变更已合并，本机其他收藏未删除');
    } else {
      dom.backupProgress.textContent = '正在切换到已验证的资料库…';
      await activateStagedSnapshot(restoreMeta);
      await refresh();
      await refreshStorageStatus();
      dom.backupProgress.textContent = `恢复完成：${restoreMeta.bookmarkCount || state.bookmarks.length} 个收藏。`;
      toast('完整恢复成功');
    }
  } catch (error) {
    await clearStagedSnapshot().catch(() => {});
    dom.backupProgress.textContent = `恢复失败：${error.message || '未知错误'}。原资料库未切换。`;
    toast(error.message || '恢复失败，原资料库未改变');
  } finally {
    setBackupButtonsDisabled(false);
    resetImportInputs();
  }
}

function resetImportInputs() {
  if (dom.importInput) dom.importInput.value = '';
  if (dom.importDeltaInput) dom.importDeltaInput.value = '';
}

function handlePrimaryAdd() {
  if (state.activeView === 'creators') showCreatorDialog();
  else if (state.activeView.startsWith('creator:')) showAddDialog(state.activeView.slice(8));
  else showAddDialog();
}

dom.addButton.addEventListener('click', handlePrimaryAdd);
dom.heroAddButton.addEventListener('click', () => showAddDialog());
dom.mobileCategoriesButton.addEventListener('click', () => { renderMobileCategoryList(); openDialog(dom.mobileCategoryDialog); });
dom.mobileCategoryList.addEventListener('click', (event) => {
  const view = event.target.closest('[data-view]')?.dataset.view;
  if (!view) return;
  closeDialog(dom.mobileCategoryDialog);
  navigate(view);
});
dom.settingsButton.addEventListener('click', () => {
  render();
  openDialog(dom.settingsDialog);
  refreshStorageStatus().catch((error) => { dom.storageSummary.textContent = error.message || '无法读取存储状态'; });
});
dom.persistStorageButton.addEventListener('click', () => requestPersistentStorage().catch((error) => toast(error.message)));
dom.migrateImagesButton.addEventListener('click', migrateLegacyLibrary);
dom.confirmMigrationButton?.addEventListener('click', async () => {
  await setMeta('imageMigrationPreviewedAt', new Date().toISOString());
  await runLegacyMigration();
});
dom.cancelPreviewButton?.addEventListener('click', () => {
  hideQualityPreview();
  refreshStorageStatus().catch(() => {});
});
dom.bookmarkForm.addEventListener('submit', saveForm);
dom.creatorForm.addEventListener('submit', saveCreatorForm);
dom.categoryForm.addEventListener('submit', addCategory);
dom.exportButton.addEventListener('click', () => exportCollection());
dom.exportDeltaButton?.addEventListener('click', () => exportCollection({ delta: true }));
dom.importInput.addEventListener('change', () => importCollection(dom.importInput.files));
dom.importDeltaInput?.addEventListener('change', () => importCollection(dom.importDeltaInput.files));
dom.imageInput.addEventListener('change', () => {
  const files = [...dom.imageInput.files];
  if (!files.length) return;
  clearSelectedImages();
  state.selectedImages = files;
  state.selectedImageUrls = files.map((file) => URL.createObjectURL(file));
  dom.fileName.textContent = files.length === 1 ? files[0].name : `已选择 ${files.length} 张图片`;
  setPreview(files[0]);
  updateImageOrder();
});
dom.imageOrderList.addEventListener('click', (event) => {
  const direction = event.target.closest('[data-image-move]')?.dataset.imageMove;
  const item = event.target.closest('.image-order-item');
  if (!direction || !item) return;
  const from = Number(item.dataset.index);
  moveFormImage(from, direction === 'previous' ? from - 1 : from + 1);
});
let draggedImageIndex = null;
dom.imageOrderList.addEventListener('dragstart', (event) => {
  const item = event.target.closest('.image-order-item');
  if (!item) return;
  draggedImageIndex = Number(item.dataset.index);
  item.classList.add('is-dragging');
  event.dataTransfer.effectAllowed = 'move';
});
dom.imageOrderList.addEventListener('dragover', (event) => {
  if (draggedImageIndex === null) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
});
dom.imageOrderList.addEventListener('drop', (event) => {
  const item = event.target.closest('.image-order-item');
  if (!item || draggedImageIndex === null) return;
  event.preventDefault();
  moveFormImage(draggedImageIndex, Number(item.dataset.index));
  draggedImageIndex = null;
});
dom.imageOrderList.addEventListener('dragend', () => {
  draggedImageIndex = null;
  dom.imageOrderList.querySelectorAll('.is-dragging').forEach((item) => item.classList.remove('is-dragging'));
});
dom.creatorAvatarInput.addEventListener('change', () => {
  const file = dom.creatorAvatarInput.files[0];
  if (!file) return;
  dom.creatorAvatarFileName.textContent = file.name;
  setCreatorPreview(file, dom.creatorNameInput.value);
});
dom.creatorNameInput.addEventListener('input', () => {
  if (!state.creatorPreviewUrl) dom.creatorAvatarInitial.textContent = dom.creatorNameInput.value.trim().charAt(0).toUpperCase() || 'M';
});
dom.categoryInput.addEventListener('change', syncNoImageOption);
dom.noImageInput.addEventListener('change', syncNoImageOption);
dom.aspectRatioInput.addEventListener('change', updatePreviewRatio);
dom.search.addEventListener('input', () => { state.query = dom.search.value; state.renderLimit = 60; render(); });
dom.sortSelect.addEventListener('change', () => {
  state.sortMode = dom.sortSelect.value;
  try {
    localStorage.setItem('poster-bookmarks-sort', state.sortMode);
  } catch {
    // Sorting still works for this session if storage is unavailable.
  }
  render();
});
dom.categoryNav.addEventListener('click', (event) => {
  const view = event.target.closest('[data-view]')?.dataset.view;
  if (!view) return;
  navigate(view);
});
dom.content.addEventListener('click', (event) => {
  if (event.target.closest('[data-load-more]')) {
    state.renderLimit += 60;
    render();
    return;
  }
  const openCreatorId = event.target.closest('[data-open-creator]')?.dataset.openCreator;
  if (openCreatorId) return navigate(`creator:${openCreatorId}`);
  const editCreatorId = event.target.closest('[data-edit-creator]')?.dataset.editCreator;
  if (editCreatorId) return showCreatorDialog(editCreatorId);
  const deleteCreatorId = event.target.closest('[data-delete-creator]')?.dataset.deleteCreator;
  if (deleteCreatorId) return removeCreator(deleteCreatorId).catch((error) => toast(error.message));
  if (event.target.closest('[data-add-creator]')) return showCreatorDialog();
  const addWorkCreatorId = event.target.closest('[data-add-work]')?.dataset.addWork;
  if (addWorkCreatorId) return showAddDialog(addWorkCreatorId);
  if (event.target.closest('[data-back-creators]')) return navigate('creators');
  if (event.target.closest('[data-empty-add]')) return showAddDialog();
  const button = event.target.closest('[data-menu-for]');
  if (button) {
    event.preventDefault();
    event.stopPropagation();
    positionMenu(dom.menu, button, button.dataset.menuFor);
    return;
  }
  const link = event.target.closest('.poster-card')?.querySelector('.poster-link');
  if (!link) return;
  const id = link.closest('.poster-card')?.dataset.id;
  if (!id) return;
  recordBookmarkOpen(id).then((clickStats) => {
    if (!clickStats) return;
    const index = state.bookmarks.findIndex((bookmark) => bookmark.id === id);
    if (index < 0) return;
    state.bookmarks[index] = { ...state.bookmarks[index], ...clickStats };
    updateRenderedClickCount(state.bookmarks[index]);
    if (state.sortMode === 'clickCount') reorderRenderedCards();
  }).catch((error) => console.error('记录点击次数失败', error));
});
dom.menu.addEventListener('click', (event) => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action) handleMenuAction(action, dom.menu.dataset.bookmarkId).catch((error) => toast(error.message));
});
dom.categoryManager.addEventListener('click', (event) => handleCategoryAction(event.target).catch((error) => toast(error.message)));
dom.categoryManager.addEventListener('change', (event) => {
  const select = event.target.closest('[data-category-icon]');
  if (select) updateCategoryIcon(select.dataset.categoryIcon, select.value).catch((error) => toast(error.message));
});
let categoryPointerDrag = null;
let categoryAutoScrollFrame = null;
let categoryAutoScrollSpeed = 0;

function stopCategoryAutoScroll() {
  if (categoryAutoScrollFrame) cancelAnimationFrame(categoryAutoScrollFrame);
  categoryAutoScrollFrame = null;
  categoryAutoScrollSpeed = 0;
}

function updateCategoryAutoScroll(pointerY) {
  const scrollContainer = dom.categoryManager.closest('.modal-card');
  const bounds = scrollContainer.getBoundingClientRect();
  categoryAutoScrollSpeed = pointerY < bounds.top + 48 ? -8 : pointerY > bounds.bottom - 48 ? 8 : 0;
  if (!categoryAutoScrollSpeed) {
    stopCategoryAutoScroll();
    return;
  }
  if (categoryAutoScrollFrame) return;
  const scroll = () => {
    if (!categoryPointerDrag || !categoryAutoScrollSpeed) {
      categoryAutoScrollFrame = null;
      return;
    }
    scrollContainer.scrollTop += categoryAutoScrollSpeed;
    categoryAutoScrollFrame = requestAnimationFrame(scroll);
  };
  categoryAutoScrollFrame = requestAnimationFrame(scroll);
}

function positionDraggedCategory(pointerX, pointerY) {
  if (!categoryPointerDrag) return;
  const target = document.elementFromPoint(pointerX, pointerY)?.closest('.category-item');
  if (!target || target === categoryPointerDrag.row || !dom.categoryManager.contains(target)) return;
  const bounds = target.getBoundingClientRect();
  const insertBefore = pointerY < bounds.top + bounds.height / 2;
  dom.categoryManager.insertBefore(categoryPointerDrag.row, insertBefore ? target : target.nextElementSibling);
}

dom.categoryManager.addEventListener('pointerdown', (event) => {
  const handle = event.target.closest('[data-category-drag-handle]');
  if (!handle || event.button !== 0) return;
  const row = handle.closest('[data-category-id]');
  if (!row) return;
  categoryPointerDrag = { handle, row, pointerId: event.pointerId, startY: event.clientY, moved: false };
  handle.setPointerCapture(event.pointerId);
});
dom.categoryManager.addEventListener('pointermove', (event) => {
  if (!categoryPointerDrag || event.pointerId !== categoryPointerDrag.pointerId) return;
  if (!categoryPointerDrag.moved && Math.abs(event.clientY - categoryPointerDrag.startY) < 5) return;
  event.preventDefault();
  if (!categoryPointerDrag.moved) {
    categoryPointerDrag.moved = true;
    categoryPointerDrag.row.classList.add('is-dragging');
    dom.categoryManager.classList.add('is-sorting');
  }
  updateCategoryAutoScroll(event.clientY);
  positionDraggedCategory(event.clientX, event.clientY);
});
dom.categoryManager.addEventListener('pointerup', (event) => {
  if (!categoryPointerDrag || event.pointerId !== categoryPointerDrag.pointerId) return;
  if (categoryPointerDrag.moved) positionDraggedCategory(event.clientX, event.clientY);
  const { handle, moved } = categoryPointerDrag;
  categoryPointerDrag = null;
  stopCategoryAutoScroll();
  if (!moved) return;
  event.preventDefault();
  handle.releasePointerCapture(event.pointerId);
  dom.categoryManager.classList.remove('is-sorting');
  dom.categoryManager.querySelector('.category-item.is-dragging')?.classList.remove('is-dragging');
  const orderedIds = [...dom.categoryManager.querySelectorAll('[data-category-id]')].map((row) => row.dataset.categoryId);
  persistCategoryOrder(orderedIds, handle.dataset.categoryDragHandle)
    .catch((error) => toast(error.message || '无法保存分类顺序'));
});
dom.categoryManager.addEventListener('pointercancel', () => {
  if (!categoryPointerDrag) return;
  categoryPointerDrag = null;
  stopCategoryAutoScroll();
  dom.categoryManager.classList.remove('is-sorting');
  renderCategoryManager(dom.categoryManager, state.categories, countsByCategory());
});
dom.categoryManager.addEventListener('keydown', (event) => {
  const handle = event.target.closest('[data-category-drag-handle]');
  if (!handle || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
  event.preventDefault();
  const offset = event.key === 'ArrowUp' ? -1 : 1;
  moveCategory(handle.dataset.categoryDragHandle, offset).catch((error) => toast(error.message));
});
document.addEventListener('click', (event) => {
  if (!dom.menu.hidden && !event.target.closest('#cardMenu') && !event.target.closest('[data-menu-for]')) dom.menu.hidden = true;
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') dom.menu.hidden = true;
});
document.querySelectorAll('[data-close-dialog]').forEach((button) => {
  button.addEventListener('click', () => closeDialog(document.querySelector(`#${button.dataset.closeDialog}`)));
});
document.querySelectorAll('dialog').forEach((dialog) => {
  dialog.addEventListener('click', (event) => { if (event.target === dialog) closeDialog(dialog); });
});
document.querySelector('.brand').addEventListener('click', (event) => {
  event.preventDefault();
  navigate('home');
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
window.addEventListener('popstate', () => {
  state.activeView = viewFromLocation();
  state.query = '';
  dom.search.value = '';
  render();
});

try {
  await openDatabase();
  await refresh();
} catch (error) {
  console.error(error);
  dom.content.replaceChildren();
  const message = document.createElement('section');
  message.className = 'empty-state';
  message.textContent = '无法打开本地数据库。请确认没有使用无痕模式，并允许此网站保存数据。';
  dom.content.append(message);
}
