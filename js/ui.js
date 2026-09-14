const objectUrls = new Set();
const slideshows = [];
let slideshowTimer;
let slideshowObserver;
export const ASPECT_RATIOS = {
  '3:2': '3 / 2',
  '2:3': '3 / 2',
  '3:4': '3 / 4',
  '1:1': '1 / 1',
  '16:9': '16 / 9'
};

function clearObjectUrls() {
  clearInterval(slideshowTimer);
  slideshowTimer = undefined;
  slideshowObserver?.disconnect();
  slideshowObserver = undefined;
  slideshows.length = 0;
  objectUrls.forEach((url) => URL.revokeObjectURL(url));
  objectUrls.clear();
}

function loadDeferredSlides(frame) {
  frame.querySelectorAll('img[data-slide-src]').forEach((image) => {
    image.loading = 'eager';
    image.src = image.dataset.slideSrc;
    delete image.dataset.slideSrc;
  });
}

function observeDeferredSlides(frame) {
  if (!('IntersectionObserver' in window)) {
    loadDeferredSlides(frame);
    return;
  }
  slideshowObserver ||= new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      loadDeferredSlides(entry.target);
      slideshowObserver.unobserve(entry.target);
    });
  }, { rootMargin: '240px 0px' });
  slideshowObserver.observe(frame);
}

export function getBookmarkImages(bookmark) {
  return [bookmark.image, ...(bookmark.gallery || [])].filter((image) => image instanceof Blob);
}

function startSlideshows() {
  if (!slideshows.length || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  slideshowTimer = setInterval(() => {
    if (document.hidden) return;
    slideshows.forEach((slideshow) => {
      let nextIndex = -1;
      for (let offset = 1; offset <= slideshow.images.length; offset += 1) {
        const candidate = (slideshow.index + offset) % slideshow.images.length;
        if (slideshow.loaded[candidate] && !slideshow.failed[candidate]) {
          nextIndex = candidate;
          break;
        }
      }
      if (nextIndex >= 0) setActiveSlide(slideshow, nextIndex);
    });
  }, 5000);
}

function setActiveSlide(slideshow, index) {
  if (!slideshow.loaded[index] || slideshow.failed[index]) return;
  slideshow.images[slideshow.index]?.classList.remove('is-active');
  slideshow.images[index].classList.add('is-active');
  slideshow.index = index;
  slideshow.counter.textContent = `${index + 1}/${slideshow.images.length}`;
}

function activateFirstLoaded(slideshow) {
  const firstLoaded = slideshow.loaded.findIndex((isLoaded, index) => isLoaded && !slideshow.failed[index]);
  if (firstLoaded >= 0) setActiveSlide(slideshow, firstLoaded);
}

function markImageFailed(image, slideshow, index) {
  image.classList.add('is-broken');
  image.classList.remove('is-active', 'is-loaded');
  if (!slideshow) return;
  slideshow.failed[index] = true;
  if (slideshow.index === index) activateFirstLoaded(slideshow);
}

function markImageLoaded(image, slideshow, index) {
  if (!image.naturalWidth) return;
  image.classList.add('is-loaded');
  if (!slideshow) return;
  slideshow.loaded[index] = true;
  if (!slideshow.loaded[slideshow.index] || slideshow.failed[slideshow.index]) activateFirstLoaded(slideshow);
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function websitePlaceholder(url) {
  let hostname = 'WEBSITE';
  try {
    hostname = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    // Saved URLs are validated elsewhere; keep a neutral fallback for old imports.
  }
  const placeholder = element('div', 'website-placeholder');
  placeholder.append(
    element('span', 'website-placeholder-mark', hostname.charAt(0).toUpperCase() || 'W'),
    element('p', 'website-placeholder-host', hostname)
  );
  return placeholder;
}

function creatorPortrait(creator, className = 'creator-portrait') {
  const portrait = element('div', className);
  if (creator.avatar instanceof Blob) {
    const image = new Image();
    const imageUrl = URL.createObjectURL(creator.avatar);
    objectUrls.add(imageUrl);
    image.alt = `${creator.name} 头像`;
    image.src = imageUrl;
    portrait.append(image);
  } else {
    portrait.append(element('span', 'creator-initial', creator.name.trim().charAt(0).toUpperCase() || 'M'));
  }
  return portrait;
}

function posterCard(bookmark, categoryName) {
  const card = element('article', 'poster-card');
  card.dataset.id = bookmark.id;
  card.dataset.ratio = bookmark.aspectRatio === '2:3' ? '3:2' : (bookmark.aspectRatio || '3:2');
  const link = element('a', 'poster-link');
  link.href = bookmark.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.setAttribute('aria-label', `打开 ${bookmark.title}`);

  const frame = element('div', 'poster-frame');
  frame.style.setProperty('--poster-ratio', ASPECT_RATIOS[bookmark.aspectRatio] || ASPECT_RATIOS['3:2']);
  const blobs = getBookmarkImages(bookmark);
  let slideshow;
  const images = blobs.map((blob, index) => {
    const image = new Image();
    const imageUrl = URL.createObjectURL(blob);
    objectUrls.add(imageUrl);
    image.alt = index === 0 ? `${bookmark.title} 图片` : '';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.classList.toggle('is-active', index === 0);
    image.addEventListener('load', () => markImageLoaded(image, slideshow, index), { once: true });
    image.addEventListener('error', () => {
      markImageFailed(image, slideshow, index);
    }, { once: true });
    if (index > 0) image.setAttribute('aria-hidden', 'true');
    if (index === 0) {
      image.src = imageUrl;
      if (image.complete && image.naturalWidth > 0) markImageLoaded(image, slideshow, index);
    } else {
      image.dataset.slideSrc = imageUrl;
    }
    return image;
  });
  if (!images.length) {
    card.classList.add('website-text-card');
    frame.append(websitePlaceholder(bookmark.url));
  } else if (images.length > 1) {
    frame.classList.add('has-slides');
    const counter = element('span', 'slide-count', `1/${images.length}`);
    frame.append(...images, counter);
    slideshow = { images, counter, index: 0, loaded: images.map((image) => image.complete && image.naturalWidth > 0), failed: images.map((image) => image.classList.contains('is-broken')) };
    slideshows.push(slideshow);
    activateFirstLoaded(slideshow);
    observeDeferredSlides(frame);
  } else {
    frame.append(...images);
  }
  link.append(frame);

  const meta = element('div', 'poster-meta');
  const opens = bookmark.clickCount ? ` · 打开 ${bookmark.clickCount} 次` : '';
  meta.append(element('h3', 'poster-title', bookmark.title), element('p', 'poster-category', `${categoryName}${opens}`));
  link.append(meta);

  const menuButton = element('button', 'card-menu-button', '⋯');
  menuButton.type = 'button';
  menuButton.dataset.menuFor = bookmark.id;
  menuButton.setAttribute('aria-label', `${bookmark.title} 的更多操作`);
  card.append(link, menuButton);
  return card;
}

function section(title, bookmarks, categoryMap, isGrid = false, gridClass = '') {
  const wrapper = element('section', 'section');
  const heading = element('div', 'section-head');
  heading.append(element('h2', '', title), element('p', '', `${bookmarks.length} ITEMS`));
  const collection = element('div', `${isGrid ? 'poster-grid' : 'poster-row'}${gridClass ? ` ${gridClass}` : ''}`);
  bookmarks.forEach((bookmark) => collection.append(posterCard(bookmark, categoryMap.get(bookmark.category) || '未分类')));
  wrapper.append(heading, collection);
  return wrapper;
}

function creatorCard(creator, workCount) {
  const card = element('article', 'creator-card');
  const open = element('button', 'creator-card-main');
  open.type = 'button';
  open.dataset.openCreator = creator.id;
  open.setAttribute('aria-label', `查看 ${creator.name} 的作品`);
  const copy = element('span', 'creator-card-copy');
  copy.append(
    element('span', 'creator-card-kicker', `${workCount} WORKS`),
    element('strong', 'creator-card-name', creator.name),
    element('span', 'creator-card-bio', creator.bio || '还没有简介')
  );
  open.append(creatorPortrait(creator), copy, element('span', 'creator-card-arrow', '↗'));

  const actions = element('div', 'creator-card-actions');
  const edit = element('button', 'creator-action-button', '编辑');
  edit.type = 'button';
  edit.dataset.editCreator = creator.id;
  const remove = element('button', 'creator-action-button danger', '删除');
  remove.type = 'button';
  remove.dataset.deleteCreator = creator.id;
  actions.append(edit, remove);
  card.append(open, actions);
  return card;
}

function creatorEmptyState() {
  const wrapper = element('section', 'empty-state creator-empty-state');
  const inner = element('div', 'empty-inner');
  inner.append(
    element('span', 'empty-mark', '人'),
    element('h2', '', '建立你的博主档案库'),
    element('p', '', '先添加博主，再把每一条收藏作为独立作品归到 TA 的名下。')
  );
  const button = element('button', 'button button-primary', '＋ 添加第一个博主');
  button.type = 'button';
  button.dataset.addCreator = 'true';
  inner.append(button);
  wrapper.append(inner);
  return wrapper;
}

function renderCreators(container, creators, bookmarks, normalizedQuery) {
  const visible = creators.filter((creator) => !normalizedQuery || `${creator.name} ${creator.bio || ''}`.toLocaleLowerCase('zh-CN').includes(normalizedQuery));
  if (!visible.length) {
    if (!creators.length) container.append(creatorEmptyState());
    else container.append(emptyState(true));
    return;
  }
  const grid = element('section', 'creator-grid');
  visible.forEach((creator) => {
    const workCount = bookmarks.filter((bookmark) => bookmark.creatorId === creator.id).length;
    grid.append(creatorCard(creator, workCount));
  });
  container.append(grid);
}

function renderCreatorDetail(container, creator, bookmarks, categoryMap, normalizedQuery, sortMode) {
  const hero = element('section', 'creator-profile');
  const copy = element('div', 'creator-profile-copy');
  const back = element('button', 'creator-back', '‹ 全部博主');
  back.type = 'button';
  back.dataset.backCreators = 'true';
  copy.append(back, element('p', 'eyebrow', 'CREATOR ARCHIVE'), element('h1', '', creator.name));
  if (creator.bio) copy.append(element('p', 'creator-profile-bio', creator.bio));
  const actions = element('div', 'creator-profile-actions');
  const addWork = element('button', 'button button-primary', '＋ 添加作品');
  addWork.type = 'button';
  addWork.dataset.addWork = creator.id;
  const edit = element('button', 'button button-quiet', '编辑资料');
  edit.type = 'button';
  edit.dataset.editCreator = creator.id;
  actions.append(addWork, edit);
  if (creator.homepageUrl) {
    const homepage = element('a', 'button button-quiet', '打开主页 ↗');
    homepage.href = creator.homepageUrl;
    homepage.target = '_blank';
    homepage.rel = 'noopener noreferrer';
    actions.append(homepage);
  }
  copy.append(actions);
  hero.append(creatorPortrait(creator, 'creator-profile-portrait'), copy);
  container.append(hero);

  const works = sortBookmarks(bookmarks.filter((bookmark) => {
    if (bookmark.creatorId !== creator.id) return false;
    const categoryName = categoryMap.get(bookmark.category) || '';
    return !normalizedQuery || `${bookmark.title} ${categoryName}`.toLocaleLowerCase('zh-CN').includes(normalizedQuery);
  }), sortMode);
  if (works.length) container.append(section('全部作品', works, categoryMap, true, categoryGridClass()));
  else {
    const empty = element('section', 'creator-works-empty');
    empty.append(element('p', '', normalizedQuery ? '没有找到相符的作品。' : '这个博主还没有作品。'));
    if (!normalizedQuery) {
      const button = element('button', 'button button-quiet', '添加第一件作品');
      button.type = 'button';
      button.dataset.addWork = creator.id;
      empty.append(button);
    }
    container.append(empty);
  }
  startSlideshows();
}

export function categoryGridClass() {
  return 'category-grid';
}

export function viewGridClass(activeView) {
  if (activeView === 'websites') return 'category-grid website-grid';
  return categoryGridClass();
}

function emptyState(isSearch) {
  const wrapper = element('section', 'empty-state');
  const inner = element('div', 'empty-inner');
  inner.append(element('div', 'empty-mark', isSearch ? '⌕' : '＋'));
  inner.append(element('h2', '', isSearch ? '没有找到相符的收藏' : '你的私人片库，从第一张海报开始'));
  inner.append(element('p', '', isSearch ? '换一个标题或分类关键词试试。' : '选择一张本地图片，再把它连到任何值得重访的网页。所有内容只留在你的浏览器里。'));
  if (!isSearch) {
    const button = element('button', 'button button-primary', '＋ 添加第一个收藏');
    button.type = 'button';
    button.dataset.emptyAdd = 'true';
    inner.append(button);
  }
  wrapper.append(inner);
  return wrapper;
}

export function isCreatorWorksCategory(category) {
  return category?.name?.trim() === '博主作品';
}

export function renderNavigation(container, categories, activeView) {
  container.replaceChildren();
  [{ id: 'home', name: '首页' }, { id: 'all', name: '全部收藏' }, { id: 'creators', name: '博主' }, ...categories.filter((item) => !item.system && !isCreatorWorksCategory(item))].forEach((item) => {
    const isActive = activeView === item.id || (item.id === 'creators' && activeView.startsWith('creator:'));
    const button = element('button', `nav-link${isActive ? ' is-active' : ''}`, item.name);
    button.type = 'button';
    button.dataset.view = item.id;
    container.append(button);
  });
}

export function sortBookmarks(bookmarks, sortMode = 'createdAt') {
  return [...bookmarks].sort((first, second) => {
    if (sortMode === 'clickCount') {
      const countDifference = (second.clickCount || 0) - (first.clickCount || 0);
      if (countDifference) return countDifference;
    }
    return second.createdAt - first.createdAt;
  });
}

export function bookmarkMatchesView(bookmark, activeView, categoryName = '') {
  if (activeView === 'home') return bookmark.category !== 'websites';
  if (activeView === 'all') return bookmark.category !== 'websites' && categoryName.trim() !== '女优';
  return bookmark.category === activeView;
}

export function renderContent(container, bookmarks, categories, creators, activeView, query, sortMode = 'createdAt') {
  clearObjectUrls();
  container.replaceChildren();
  const categoryMap = new Map(categories.map((category) => [category.id, category.name]));
  const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN');
  if (activeView === 'creators') {
    renderCreators(container, creators, bookmarks, normalizedQuery);
    return;
  }
  if (activeView.startsWith('creator:')) {
    const creator = creators.find((item) => item.id === activeView.slice(8));
    if (creator) renderCreatorDetail(container, creator, bookmarks, categoryMap, normalizedQuery, sortMode);
    else container.append(creatorEmptyState());
    return;
  }
  const sorted = sortBookmarks(bookmarks, sortMode);
  const visible = sorted.filter((bookmark) => {
    const categoryName = categoryMap.get(bookmark.category) || '';
    const matchesQuery = !normalizedQuery || `${bookmark.title} ${categoryName}`.toLocaleLowerCase('zh-CN').includes(normalizedQuery);
    const matchesView = bookmarkMatchesView(bookmark, activeView, categoryName);
    return matchesQuery && matchesView;
  });

  if (!visible.length) {
    container.append(emptyState(Boolean(normalizedQuery) || !['home', 'all'].includes(activeView)));
    return;
  }
  if (normalizedQuery || activeView === 'all' || !['home', 'all'].includes(activeView)) {
    const title = normalizedQuery ? '搜索结果' : activeView === 'all' ? '全部收藏' : categoryMap.get(activeView);
    const gridClass = viewGridClass(activeView);
    container.append(section(title, visible, categoryMap, true, gridClass));
    startSlideshows();
    return;
  }

  const primaryItems = sortMode === 'clickCount' ? visible : visible.slice(0, 12);
  container.append(section(sortMode === 'clickCount' ? '最常打开' : '最近添加', primaryItems, categoryMap));
  categories.forEach((category) => {
    if (isCreatorWorksCategory(category)) return;
    const items = visible.filter((bookmark) => bookmark.category === category.id);
    if (items.length) container.append(section(category.name, items, categoryMap));
  });
  startSlideshows();
}

export function renderCategoryOptions(select, categories, selectedId) {
  select.replaceChildren();
  categories.forEach((category) => {
    const option = element('option', '', category.name);
    option.value = category.id;
    option.selected = category.id === selectedId;
    select.append(option);
  });
}

export function renderCreatorOptions(select, creators, selectedId = '') {
  select.replaceChildren();
  const unassigned = element('option', '', '不关联博主');
  unassigned.value = '';
  select.append(unassigned);
  creators.forEach((creator) => {
    const option = element('option', '', creator.name);
    option.value = creator.id;
    option.selected = creator.id === selectedId;
    select.append(option);
  });
}

export function renderCategoryManager(container, categories, bookmarkCounts) {
  container.replaceChildren();
  container.setAttribute('role', 'list');
  categories.forEach((category, index) => {
    const row = element('div', 'category-item');
    row.dataset.categoryId = category.id;
    row.setAttribute('role', 'listitem');
    row.setAttribute('aria-posinset', String(index + 1));
    row.setAttribute('aria-setsize', String(categories.length));

    const handle = element('button', 'category-drag-handle');
    handle.type = 'button';
    handle.dataset.categoryDragHandle = category.id;
    handle.setAttribute('aria-label', `拖动“${category.name}”调整顺序，也可按上下方向键移动`);
    handle.title = '拖动排序';
    handle.innerHTML = '<svg viewBox="0 0 12 18" aria-hidden="true"><circle cx="3" cy="3" r="1.2"></circle><circle cx="9" cy="3" r="1.2"></circle><circle cx="3" cy="9" r="1.2"></circle><circle cx="9" cy="9" r="1.2"></circle><circle cx="3" cy="15" r="1.2"></circle><circle cx="9" cy="15" r="1.2"></circle></svg>';

    const name = element('span', 'category-name', `${category.name} · ${bookmarkCounts.get(category.id) || 0}`);
    const orderControls = element('span', 'category-order-controls');
    const moveUp = element('button', 'mini-button move-button', '↑');
    moveUp.type = 'button';
    moveUp.disabled = index === 0;
    moveUp.dataset.moveCategory = category.id;
    moveUp.dataset.moveDirection = '-1';
    moveUp.setAttribute('aria-label', `上移“${category.name}”`);
    const moveDown = element('button', 'mini-button move-button', '↓');
    moveDown.type = 'button';
    moveDown.disabled = index === categories.length - 1;
    moveDown.dataset.moveCategory = category.id;
    moveDown.dataset.moveDirection = '1';
    moveDown.setAttribute('aria-label', `下移“${category.name}”`);
    orderControls.append(moveUp, moveDown);

    const actions = element('span', 'category-actions');
    if (category.system) {
      actions.append(element('span', 'category-system-label', '系统分类'));
    } else {
      const rename = element('button', 'mini-button', '重命名');
      rename.type = 'button';
      rename.dataset.renameCategory = category.id;
      const remove = element('button', 'mini-button danger', '删除');
      remove.type = 'button';
      remove.dataset.deleteCategory = category.id;
      actions.append(rename, remove);
    }
    if (isCreatorWorksCategory(category)) {
      actions.append(element('span', 'category-system-label', '侧栏隐藏'));
    }
    row.append(handle, name, orderControls, actions);
    container.append(row);
  });
}

export function positionMenu(menu, button, bookmarkId) {
  menu.innerHTML = `
    <button type="button" role="menuitem" data-action="edit">编辑</button>
    <button type="button" role="menuitem" data-action="replace-image">更换图片</button>
    <button type="button" role="menuitem" data-action="copy">复制链接</button>
    <hr>
    <button type="button" role="menuitem" class="danger" data-action="delete">删除</button>`;
  menu.dataset.bookmarkId = bookmarkId;
  menu.hidden = false;
  const rect = button.getBoundingClientRect();
  const menuWidth = menu.getBoundingClientRect().width;
  const left = Math.min(window.innerWidth - menuWidth - 10, Math.max(10, rect.right - menuWidth));
  const estimatedHeight = 175;
  const top = rect.bottom + estimatedHeight > window.innerHeight ? rect.top - estimatedHeight - 4 : rect.bottom + 4;
  menu.style.left = `${left}px`;
  menu.style.top = `${Math.max(8, top)}px`;
  menu.querySelector('button')?.focus();
}
