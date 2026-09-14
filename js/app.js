import {
  deleteBookmark,
  deleteCreator,
  getBookmark,
  getBookmarks,
  getCategories,
  getCreators,
  importRecords,
  openDatabase,
  recordBookmarkOpen,
  removeCategory,
  renameCategory,
  saveBookmark,
  saveCategory,
  saveCategoryOrder,
  saveCreator
} from './db.js?v=20260913-2';
import { createBackup, downloadBackup, parseBackup } from './backup.js?v=20260913-2';
import {
  ASPECT_RATIOS,
  getBookmarkImages,
  isCreatorWorksCategory,
  positionMenu,
  renderCategoryManager,
  renderCategoryOptions,
  renderContent,
  renderCreatorOptions,
  renderNavigation,
  sortBookmarks
} from './ui.js?v=20260913-6';

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
  importInput: document.querySelector('#importInput'),
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
  editingImages: [],
  previewUrl: null,
  editingCreatorAvatar: null,
  creatorPreviewUrl: null
};
let categoryOrderSave = Promise.resolve();
let categoryOrderVersion = 0;

dom.sortSelect.value = state.sortMode;

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
    dom.fileName.textContent = '将使用文字网址卡片';
    setPreview(null);
    return;
  }
  const selectedFile = dom.imageInput.files[0];
  setPreview(selectedFile || state.editingImages[0] || null);
  if (selectedFile) dom.fileName.textContent = dom.imageInput.files.length === 1 ? selectedFile.name : `已选择 ${dom.imageInput.files.length} 张图片`;
  else if (state.editingImages.length) dom.fileName.textContent = `保留当前 ${state.editingImages.length} 张图片`;
  else dom.fileName.textContent = 'JPG、PNG、WEBP';
}

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(blob);
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('无法读取这张图片')); };
    image.src = url;
  });
}

// Isolated so the size/quality policy can be adjusted without touching form logic.
async function optimizeImage(file, maxDimension = 1500, quality = 0.9) {
  const image = await loadImage(file);
  const largestSide = Math.max(image.naturalWidth, image.naturalHeight);
  if (largestSide <= maxDimension) return file;
  const scale = maxDimension / largestSide;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.naturalWidth * scale);
  canvas.height = Math.round(image.naturalHeight * scale);
  canvas.getContext('2d', { alpha: file.type === 'image/png' }).drawImage(image, 0, 0, canvas.width, canvas.height);
  const outputType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, outputType, quality));
  return blob || file;
}

async function optimizeImages(files) {
  const images = [];
  for (const file of files) images.push(await optimizeImage(file));
  return images;
}

function countsByCategory() {
  const counts = new Map();
  state.bookmarks.forEach((bookmark) => counts.set(bookmark.category, (counts.get(bookmark.category) || 0) + 1));
  return counts;
}

function renderCategoryOrdering(includeContent = false) {
  renderNavigation(dom.categoryNav, state.categories, state.activeView);
  renderCategoryOptions(dom.categoryInput, state.categories, dom.categoryInput.value);
  renderCategoryManager(dom.categoryManager, state.categories, countsByCategory());
  if (includeContent && state.activeView === 'home' && !state.query.trim()) {
    renderContent(dom.content, state.bookmarks, state.categories, state.creators, state.activeView, state.query, state.sortMode);
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
  renderContent(dom.content, state.bookmarks, state.categories, state.creators, state.activeView, state.query, state.sortMode);
  renderCategoryOptions(dom.categoryInput, state.categories, dom.categoryInput.value);
  renderCreatorOptions(dom.creatorInput, state.creators, dom.creatorInput.value);
  renderCategoryManager(dom.categoryManager, state.categories, countsByCategory());
  const creatorWorkCount = activeCreator ? state.bookmarks.filter((bookmark) => bookmark.creatorId === activeCreator.id).length : 0;
  dom.count.textContent = state.activeView === 'creators' ? `${state.creators.length} 位博主` : isCreatorDetail ? `${creatorWorkCount} 个作品` : `${state.bookmarks.length} 个收藏`;
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
  state.editingImages = getBookmarkImages(bookmark);
  setPreview(state.editingImages[0]);
  dom.noImageInput.checked = bookmark.category === 'websites' && state.editingImages.length === 0;
  syncNoImageOption();
  dom.fileName.textContent = replaceImage ? '请选择新的图片组' : `保留当前 ${state.editingImages.length} 张图片`;
  if (dom.noImageInput.checked) dom.fileName.textContent = '将使用文字网址卡片';
  openDialog(dom.bookmarkDialog);
}

async function saveForm(event) {
  event.preventDefault();
  dom.formError.textContent = '';
  dom.saveButton.disabled = true;
  try {
    const existing = dom.bookmarkId.value ? await getBookmark(dom.bookmarkId.value) : null;
    const withoutImage = dom.categoryInput.value === 'websites' && dom.noImageInput.checked;
    const selectedFiles = [...dom.imageInput.files];
    const images = withoutImage ? [] : (selectedFiles.length ? await optimizeImages(selectedFiles) : state.editingImages);
    if (!images.length && !withoutImage) throw new Error('请至少选择一张图片；网站分类可以选择“无需图片”');
    const now = Date.now();
    await saveBookmark({
      ...(existing || {}),
      id: existing?.id || makeId(),
      title: dom.titleInput.value.trim(),
      url: safeUrl(dom.urlInput.value.trim()),
      image: images[0] || null,
      gallery: images.slice(1),
      category: dom.categoryInput.value || 'uncategorized',
      creatorId: dom.creatorInput.value || null,
      aspectRatio: dom.aspectRatioInput.value || '3:2',
      createdAt: existing?.createdAt || now,
      updatedAt: now
    });
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
    const avatar = selectedAvatar ? await optimizeImage(selectedAvatar) : state.editingCreatorAvatar;
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

async function exportCollection() {
  if (!state.bookmarks.length && !state.creators.length) {
    toast('还没有可导出的收藏');
    return;
  }
  dom.exportButton.disabled = true;
  try {
    downloadBackup(await createBackup(state.bookmarks, state.categories, state.creators));
    toast('备份已导出');
  } catch (error) {
    toast(error.message || '导出失败');
  } finally {
    dom.exportButton.disabled = false;
  }
}

async function importCollection(file) {
  if (!file) return;
  try {
    const records = await parseBackup(file);
    records.bookmarks.forEach((bookmark) => { bookmark.url = safeUrl(bookmark.url); });
    records.creators.forEach((creator) => {
      if (creator.homepageUrl) creator.homepageUrl = safeUrl(creator.homepageUrl);
    });
    await importRecords(records.bookmarks, records.categories, records.creators);
    await refresh();
    toast(`已恢复 ${records.bookmarks.length} 个收藏、${records.creators.length} 位博主`);
  } catch (error) {
    toast(error.message || '导入失败');
  } finally {
    dom.importInput.value = '';
  }
}

function handlePrimaryAdd() {
  if (state.activeView === 'creators') showCreatorDialog();
  else if (state.activeView.startsWith('creator:')) showAddDialog(state.activeView.slice(8));
  else showAddDialog();
}

dom.addButton.addEventListener('click', handlePrimaryAdd);
dom.heroAddButton.addEventListener('click', () => showAddDialog());
dom.settingsButton.addEventListener('click', () => { render(); openDialog(dom.settingsDialog); });
dom.bookmarkForm.addEventListener('submit', saveForm);
dom.creatorForm.addEventListener('submit', saveCreatorForm);
dom.categoryForm.addEventListener('submit', addCategory);
dom.exportButton.addEventListener('click', exportCollection);
dom.importInput.addEventListener('change', () => importCollection(dom.importInput.files[0]));
dom.imageInput.addEventListener('change', () => {
  const files = [...dom.imageInput.files];
  if (!files.length) return;
  dom.fileName.textContent = files.length === 1 ? files[0].name : `已选择 ${files.length} 张图片`;
  setPreview(files[0]);
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
dom.search.addEventListener('input', () => { state.query = dom.search.value; render(); });
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
