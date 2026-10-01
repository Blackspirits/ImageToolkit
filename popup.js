// ============================================================
// ImageToolkit – Popup & Side Panel UI
// Requires lib/core.js, lib/i18n.js and lib/jszip.min.js.
// ============================================================

'use strict';

const { i18n, ui } = ITK;
const { icon, el, debounce, toast, flashError, withBusy, send, call, blobToDataUrl } = ui;
const t = i18n.t;

// The same page is the action popup and the side panel; each gets its own layout.
const VIEW_MODE = new URLSearchParams(location.search).get('mode') === 'sidepanel' ? 'sidepanel' : 'popup';
document.body.classList.add(VIEW_MODE);

const $ = (id) => document.getElementById(id);
const UI_KEY = 'imagetoolkit-ui';

const state = {
  settings: {},
  tabId: null,
  windowId: null,
  host: '',
  images: [],
  filtered: [],
  selected: new Set(),
  lastClickedSrc: '',
  hideDups: false,
  layout: '2col',
  sort: 'pixels',
  previewSrc: '',
  newImages: 0,
  checker: 'auto',
  tool: { src: '', name: '', ratio: 0, size: 0 },
  cards: new Map(),
};

function readUiState() {
  try { return JSON.parse(localStorage.getItem(UI_KEY)) || {}; } catch { return {}; }
}

function writeUiState(patch) {
  try { localStorage.setItem(UI_KEY, JSON.stringify({ ...readUiState(), ...patch })); } catch {}
}

function sizeSummary(result) {
  const { originalSize, newSize } = result || {};
  if (!(originalSize > 0 && newSize > 0) || originalSize === newSize) return '';
  const pct = Math.round((1 - newSize / originalSize) * 100);
  return ` · ${ITK.formatBytes(originalSize)} → ${ITK.formatBytes(newSize)}${pct > 0 ? ` (−${pct}%)` : ''}`;
}

// ---------- Settings ----------
async function loadSettings() {
  state.settings = (await send({ action: 'getSettings' })) || {};
  return state.settings;
}

// Writes are chained so two quick changes never read the same old value and overwrite
// each other; each write merges into what is stored so keys not shown here survive.
let settingsWrite = Promise.resolve();

function saveSettings(patch) {
  Object.assign(state.settings, patch);
  settingsWrite = settingsWrite.catch(() => {}).then(async () => {
    const { settings } = await chrome.storage.sync.get('settings');
    await chrome.storage.sync.set({ settings: { ...(settings || {}), ...patch } });
  });
  return settingsWrite;
}

// ---------- Theme ----------
function applyTheme(theme = 'auto') {
  ui.applyTheme($('app'), theme);
  $('theme-icon').setAttribute('href', theme === 'auto' ? '#i-contrast' : theme === 'dark' ? '#i-moon' : '#i-sun');
  setSegmented($('setting-theme'), theme);
}

// ---------- Segmented controls ----------
function setSegmented(group, value) {
  group?.querySelectorAll('.seg').forEach((seg) => {
    const on = seg.dataset.value === value;
    seg.classList.toggle('active', on);
    seg.setAttribute('aria-checked', String(on));
  });
}

function onSegmented(group, handler) {
  group.addEventListener('click', (e) => {
    const seg = e.target.closest('.seg');
    if (!seg || !group.contains(seg)) return;
    setSegmented(group, seg.dataset.value);
    handler(seg.dataset.value);
  });
}

function segmentedValue(group) {
  return group.querySelector('.seg.active')?.dataset.value;
}

// ============================================================
// Init
// ============================================================
function localize() {
  i18n.apply();
  if (/Mac|iPhone|iPad/.test(navigator.platform)) $('drop-hint').textContent = t('pasteHint').replace(/Ctrl\+/g, '⌘');
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await i18n.load(state.settings.locale);
  localize();
  applyTheme(state.settings.theme);
  ui.followSystemTheme($('app'), () => applyTheme('auto'));

  initHeader();
  initTabs();
  initImages();
  initTools();
  initSettings();
  initPreview();
  initActionBar();
  initKeyboard();
  initPaste();
  showAbout();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.tabId = tab?.id ?? null;
  state.windowId = tab?.windowId ?? null;
  setHost(tab?.url);
  scan();

  chrome.runtime.onMessage.addListener(onRuntimeMessage);
  if (VIEW_MODE === 'sidepanel') watchTabs();
});

function onRuntimeMessage(msg) {
  if (msg?.action !== 'newImagesAvailable' || msg.tabId !== state.tabId || !(msg.count > 0)) return;
  state.newImages += msg.count;
  $('new-images-text').textContent = `+${state.newImages} ${t('newImagesDetected')}`;
  $('new-images-banner').hidden = false;
}

// The side panel stays open across tabs: follow the active tab and page loads.
function watchTabs() {
  const rescan = debounce(() => scan(), 350);
  chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
    if (state.windowId != null && windowId !== state.windowId) return;
    state.tabId = tabId;
    chrome.tabs.get(tabId).then((tab) => setHost(tab.url)).catch(() => setHost(''));
    rescan();
  });
  chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (tabId !== state.tabId) return;
    if (info.url) setHost(info.url);
    if (info.status === 'complete') { setHost(tab?.url); rescan(); }
  });
}

function setHost(url) {
  try { state.host = url ? new URL(url).hostname : ''; } catch { state.host = ''; }
  $('scan-host').textContent = state.host ? `· ${state.host}` : '';
}

// ============================================================
// Header
// ============================================================
function initHeader() {
  $('btn-theme').addEventListener('click', () => {
    const order = ['auto', 'light', 'dark'];
    const next = order[(order.indexOf($('app').dataset.theme || 'auto') + 1) % order.length];
    applyTheme(next);
    saveSettings({ theme: next });
  });

  $('btn-capture').addEventListener('click', async () => {
    const delay = parseInt($('capture-delay').value, 10) || 0;
    const res = await send({ action: 'startCapture', tabId: state.tabId, delay });
    if (res?.error) { toast(t('errorRestrictedPage'), 'error'); return; }
    if (delay > 0) toast(`${t('titleCapture')} · ${delay}s`, 'info');
    // The action popup would sit on top of the page; get out of the way.
    if (VIEW_MODE === 'popup') window.close();
  });

  $('btn-capture-visible').addEventListener('click', async () => {
    const res = await send({ action: 'captureVisible', tabId: state.tabId });
    if (res?.error) toast(t('errorRestrictedPage'), 'error');
  });
}

// ============================================================
// Tabs
// ============================================================
// WAI-ARIA tabs pattern: one tab in the Tab order, arrows/Home/End move between tabs.
function initTabs() {
  const tabs = [...document.querySelectorAll('.tab')];
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    tab.addEventListener('keydown', (e) => {
      const rtl = document.documentElement.dir === 'rtl';
      const i = tabs.indexOf(tab);
      const target = {
        ArrowRight: tabs[(i + (rtl ? -1 : 1) + tabs.length) % tabs.length],
        ArrowLeft: tabs[(i + (rtl ? 1 : -1) + tabs.length) % tabs.length],
        Home: tabs[0],
        End: tabs[tabs.length - 1],
      }[e.key];
      if (!target) return;
      e.preventDefault();
      switchTab(target.dataset.tab);
      target.focus();
    });
  });
  switchTab(activeTab() || 'images');
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach((tab) => {
    const on = tab.dataset.tab === name;
    tab.classList.toggle('active', on);
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
  });
  document.querySelectorAll('.view').forEach((view) => view.classList.toggle('active', view.id === `tab-${name}`));
  updateActionBar();
}

function activeTab() {
  return document.querySelector('.tab.active')?.dataset.tab;
}

// ============================================================
// Images: scan, filter, render
// ============================================================
let scanToken = 0;

function initImages() {
  const ui = readUiState();
  setLayout(ui.layout || '2col', false);
  setChecker(ui.checker || 'auto', false);
  setFiltersOpen(!!ui.filtersOpen);

  ['filter-type', 'filter-layout', 'filter-domain'].forEach((id) => $(id).addEventListener('change', applyFilters));
  $('filter-size').addEventListener('change', () => {
    $('atleast-row').hidden = $('filter-size').value !== 'atleast';
    applyFilters();
  });
  $('sort-order').addEventListener('change', (e) => { state.sort = e.target.value; applyFilters(); });
  $('filter-url').addEventListener('input', debounce(applyFilters, 150));
  $('atleast-w').addEventListener('input', debounce(applyFilters, 250));
  $('atleast-h').addEventListener('input', debounce(applyFilters, 250));
  if (state.settings.savedAtLeastW) $('atleast-w').value = state.settings.savedAtLeastW;
  if (state.settings.savedAtLeastH) $('atleast-h').value = state.settings.savedAtLeastH;

  $('btn-save-size').addEventListener('click', async () => {
    await saveSettings({
      savedAtLeastW: parseInt($('atleast-w').value, 10) || 0,
      savedAtLeastH: parseInt($('atleast-h').value, 10) || 0,
    });
    toast(t('notifSaved'));
  });

  $('btn-filters').addEventListener('click', () => setFiltersOpen($('filters-panel').hidden));
  $('btn-reset-filters').addEventListener('click', resetFilters);
  $('btn-refresh').addEventListener('click', () => scan());
  $('btn-retry').addEventListener('click', () => scan());
  $('new-images-banner').addEventListener('click', () => scan({ keepSelection: true }));

  $('btn-hide-dupes').addEventListener('click', () => {
    state.hideDups = !state.hideDups;
    $('btn-hide-dupes').setAttribute('aria-pressed', String(state.hideDups));
    applyFilters();
  });

  $('btn-select-all').addEventListener('click', toggleSelectAll);

  $('btn-checker').addEventListener('click', () => {
    const order = ['auto', 'light', 'dark'];
    setChecker(order[(order.indexOf(state.checker) + 1) % order.length]);
  });

  document.querySelectorAll('[data-layout]').forEach((btn) => btn.addEventListener('click', () => setLayout(btn.dataset.layout)));

  const grid = $('image-grid');
  grid.addEventListener('click', onGridClick);
  grid.addEventListener('keydown', onGridKeydown);
}

function setFiltersOpen(open) {
  $('filters-panel').hidden = !open;
  $('btn-filters').setAttribute('aria-expanded', String(open));
  writeUiState({ filtersOpen: open });
}

function resetFilters() {
  ['filter-type', 'filter-size', 'filter-layout', 'filter-domain'].forEach((id) => { $(id).value = 'all'; });
  $('filter-url').value = '';
  $('atleast-row').hidden = true;
  state.hideDups = false;
  $('btn-hide-dupes').setAttribute('aria-pressed', 'false');
  applyFilters();
}

function setLayout(layout, persist = true) {
  state.layout = ['2col', 'compact', 'list'].includes(layout) ? layout : '2col';
  document.querySelectorAll('[data-layout]').forEach((btn) => {
    const on = btn.dataset.layout === state.layout;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  });
  const grid = $('image-grid');
  grid.classList.remove('grid-2col', 'grid-compact', 'grid-list');
  grid.classList.add(`grid-${state.layout}`);
  if (persist) writeUiState({ layout: state.layout });
}

// Black icons vanish on the dark checkerboard and white ones on the light one: let the viewer switch.
function setChecker(mode, persist = true) {
  state.checker = ['light', 'dark'].includes(mode) ? mode : 'auto';
  const app = document.querySelector('.app');
  if (state.checker === 'auto') delete app.dataset.checker;
  else app.dataset.checker = state.checker;
  const label = t('titleTransparency', [t({ auto: 'themeAuto', light: 'themeLight', dark: 'themeDark' }[state.checker])]);
  const btn = $('btn-checker');
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.setAttribute('aria-pressed', String(state.checker !== 'auto'));
  if (persist) writeUiState({ checker: state.checker });
}

function showSkeleton() {
  const skeleton = $('grid-loading');
  skeleton.replaceChildren(...Array.from({ length: 4 }, () =>
    el('div', { class: 'skeleton' }, [el('div', { class: 'skeleton-thumb' }), el('div', { class: 'skeleton-line' }), el('div', { class: 'skeleton-line' })])));
  skeleton.hidden = false;
  $('image-grid').hidden = true;
  $('grid-empty').hidden = true;
}

async function scan({ keepSelection = false } = {}) {
  const token = ++scanToken;
  showSkeleton();
  $('new-images-banner').hidden = true;
  state.newImages = 0;

  const res = await send({ action: 'collectImages', tabId: state.tabId });
  if (token !== scanToken) return;
  if (!keepSelection) state.selected.clear();
  setImages(res?.images || [], res?.error);
}

function setImages(list, error) {
  const seen = new Set();
  state.images = list.map((img, index) => {
    const key = ITK.dedupeKey(img.src);
    const isDuplicate = seen.has(key);
    seen.add(key);
    const item = {
      src: img.src,
      alt: img.alt || '',
      width: img.width || 0,
      height: img.height || 0,
      fileSize: img.fileSize || 0,
      type: ITK.detectType(img.src),
      name: ITK.displayName(img.src),
      domain: ITK.domainOf(img.src),
      isDuplicate,
      index,
      thumb: '',
    };
    updateDerived(item);
    return item;
  });
  for (const src of [...state.selected]) if (!state.images.some((i) => i.src === src)) state.selected.delete(src);

  state.cards.clear();
  $('image-grid').replaceChildren();
  $('grid-loading').hidden = true;
  $('tab-count').textContent = state.images.length ? String(state.images.length) : '';
  $('dup-count').textContent = String(state.images.filter((i) => i.isDuplicate).length);

  if (!state.images.length) {
    $('image-grid').hidden = true;
    $('grid-empty').hidden = false;
    $('empty-title').textContent = error === 'restricted' ? t('errorRestrictedPage') : t('noImagesFound');
    $('empty-hint').hidden = error === 'restricted';
    updateSelectionUI();
    return;
  }

  $('grid-empty').hidden = true;
  $('image-grid').hidden = false;
  populateDomains();
  applyFilters({ animate: true });
  probeTypes();
  probeFileSizes();
  probeMissingDimensions();
}

function updateDerived(img) {
  const w = img.width || 0, h = img.height || 0;
  img.pixels = w * h;
  img.shape = 'square';
  if (w && h) {
    if (w >= 1.2 * h) img.shape = 'wide';
    else if (h >= 1.2 * w) img.shape = 'tall';
  }
}

function populateDomains() {
  const select = $('filter-domain');
  const current = select.value;
  const counts = new Map();
  state.images.forEach((img) => counts.set(img.domain, (counts.get(img.domain) || 0) + 1));
  const options = [el('option', { value: 'all', text: t('filterAny') })];
  [...counts.entries()].sort((a, b) => b[1] - a[1]).forEach(([domain, n]) => {
    const label = domain.length > 26 ? domain.slice(0, 24) + '…' : domain;
    options.push(el('option', { value: domain, text: `${label} (${n})` }));
  });
  select.replaceChildren(...options);
  select.value = counts.has(current) ? current : 'all';
}

function activeFilterCount() {
  let n = 0;
  for (const id of ['filter-type', 'filter-size', 'filter-layout', 'filter-domain']) if ($(id).value !== 'all') n++;
  return n;
}

function matchesFilters(img) {
  const type = $('filter-type').value;
  const size = $('filter-size').value;
  const shape = $('filter-layout').value;
  const domain = $('filter-domain').value;
  const query = $('filter-url').value.trim().toLowerCase();

  if (state.hideDups && img.isDuplicate) return false;
  if (type !== 'all') {
    if (type === 'other' ? ITK.KNOWN_TYPES.includes(img.type) : img.type !== type) return false;
  }
  if (size !== 'all') {
    const dim = Math.max(img.width || 0, img.height || 0);
    if (size === 'small' && dim >= 200) return false;
    if (size === 'medium' && (dim < 200 || dim >= 500)) return false;
    if (size === 'large' && (dim < 500 || dim >= 1200)) return false;
    if (size === 'xlarge' && dim < 1200) return false;
    if (size === 'atleast') {
      const minW = parseInt($('atleast-w').value, 10) || 0;
      const minH = parseInt($('atleast-h').value, 10) || 0;
      if (minW > 0 && (img.width || 0) < minW) return false;
      if (minH > 0 && (img.height || 0) < minH) return false;
    }
  }
  if (shape !== 'all' && img.shape !== shape) return false;
  if (domain !== 'all' && img.domain !== domain) return false;
  if (query && !img.src.toLowerCase().includes(query) && !img.name.toLowerCase().includes(query) && !img.alt.toLowerCase().includes(query)) return false;
  return true;
}

function applyFilters({ animate = false } = {}) {
  state.filtered = state.images.filter(matchesFilters);
  if (state.sort === 'pixels') state.filtered.sort((a, b) => b.pixels - a.pixels || a.index - b.index);
  else state.filtered.sort((a, b) => a.index - b.index);
  $('filters-dot').hidden = activeFilterCount() === 0;
  renderGrid(animate);
  updateSelectionUI();
  if (!$('preview-modal').hidden) refreshPreviewMeta();
}

const queueRefresh = debounce(() => applyFilters(), 150);

// Cards are created once per image and reused, so thumbnails never reload or flicker.
function renderGrid(animate) {
  const grid = $('image-grid');
  grid.classList.toggle('grid-animate', animate);
  const nodes = state.filtered.map((img) => {
    let card = state.cards.get(img.src);
    if (!card) {
      card = createCard(img);
      state.cards.set(img.src, card);
    }
    updateCard(card, img);
    return card;
  });
  grid.replaceChildren(...nodes);
  if (animate) nodes.slice(0, 24).forEach((node, i) => { node.style.animationDelay = `${i * 18}ms`; });
}

function createCard(img) {
  const pic = el('img', { alt: img.alt || '', loading: 'lazy', decoding: 'async', draggable: 'false' });
  pic.addEventListener('load', () => {
    if ((!img.width || !img.height) && pic.naturalWidth && pic.naturalHeight) {
      img.width = pic.naturalWidth;
      img.height = pic.naturalHeight;
      updateDerived(img);
      queueRefresh();
    }
  });
  pic.addEventListener('error', () => thumbFallback(img, pic), { once: true });
  pic.src = img.src;

  const thumb = el('div', { class: 'gthumb' }, pic);
  const check = el('button', { class: 'gcheck', 'data-act': 'select', tabindex: '-1', role: 'checkbox', 'aria-checked': 'false', 'aria-label': img.name }, icon('check'));
  const badges = el('div', { class: 'gbadges' });

  const acts = el('div', { class: 'gacts' }, [
    el('button', { class: 'gact', 'data-act': 'copy', title: t('copyImage'), 'aria-label': t('copyImage') }, icon('copy')),
    el('button', { class: 'gact', 'data-act': 'download', title: t('titleDownloadAs'), 'aria-label': t('titleDownloadAs') }, icon('download')),
    el('button', { class: 'gact gact-extra', 'data-act': 'open', title: t('titleOpenTab'), 'aria-label': t('titleOpenTab') }, icon('external')),
    el('button', { class: 'gact gact-extra', 'data-act': 'lens', title: t('titleSearchSimilar'), 'aria-label': t('titleSearchSimilar') }, icon('lens')),
  ]);

  const info = el('div', { class: 'ginfo' }, [el('div', { class: 'gname' }), el('div', { class: 'gmeta' })]);
  return el('div', { class: 'gcard', role: 'listitem', tabindex: '0', 'data-src': img.src }, [thumb, check, badges, acts, info]);
}

function updateCard(card, img) {
  const selected = state.selected.has(img.src);
  card.classList.toggle('selected', selected);
  card.classList.toggle('is-dup', img.isDuplicate);
  card.querySelector('.gcheck').setAttribute('aria-checked', String(selected));
  card.querySelector('[data-act="lens"]').hidden = !state.settings.enableGoogleLens || img.src.startsWith('data:');

  const name = card.querySelector('.gname');
  name.textContent = img.name;
  name.title = img.src;

  const badges = [el('span', { class: 'gbadge', text: img.type === 'other' ? '?' : img.type.toUpperCase() })];
  if (img.isDuplicate) badges.push(el('span', { class: 'gbadge gbadge-dup', text: 'DUP' }));
  card.querySelector('.gbadges').replaceChildren(...badges);

  const meta = [el('span', { class: 'gmeta-type', text: img.type === 'other' ? '?' : img.type.toUpperCase() }), el('span', { class: 'sep' })];
  meta.push(img.width && img.height ? el('span', { text: `${img.width} × ${img.height}` }) : el('span', { class: 'pending' }));
  meta.push(el('span', { class: 'sep' }));
  meta.push(img.fileSize > 0 ? el('span', { text: ITK.formatBytes(img.fileSize) }) : el('span', { class: 'pending' }));
  card.querySelector('.gmeta').replaceChildren(...meta);
  card.setAttribute('aria-label', `${img.name} ${img.width && img.height ? `${img.width}×${img.height}` : ''}`.trim());
}

// Hotlink-protected images fail inside the extension page; fetch them through the
// service worker (with the site's cookies), a few at a time and at most once per URL.
// Thumbnails and dimension probing share the same result.
const viaExtension = new Map();
const viaExtensionQueue = [];
let viaExtensionActive = 0;

function fetchViaExtension(src) {
  if (src.startsWith('data:')) return Promise.resolve(src);
  if (!viaExtension.has(src)) {
    viaExtension.set(src, new Promise((resolve) => {
      viaExtensionQueue.push({ src, resolve });
      pumpViaExtension();
    }));
  }
  return viaExtension.get(src);
}

function pumpViaExtension() {
  while (viaExtensionActive < 4 && viaExtensionQueue.length) {
    const { src, resolve } = viaExtensionQueue.shift();
    viaExtensionActive++;
    send({ action: 'fetchAsDataUrl', imageUrl: src })
      .then((res) => resolve(res?.dataUrl || null), () => resolve(null))
      .finally(() => { viaExtensionActive--; pumpViaExtension(); });
  }
}

async function thumbFallback(img, pic) {
  const dataUrl = img.src.startsWith('data:') ? null : await fetchViaExtension(img.src);
  if (!dataUrl) { markBroken(pic); return; }
  img.thumb = dataUrl;
  pic.addEventListener('error', () => markBroken(pic), { once: true });
  pic.src = dataUrl;
}

// Direct load first; hotlink-protected images fall back to the extension fetch.
async function loadDimensionsWithFallback(img) {
  const direct = await loadDimensions(img.thumb || img.src).catch(() => null);
  if (direct?.width > 0) return direct;
  const dataUrl = await fetchViaExtension(img.src);
  if (!dataUrl) return null;
  img.thumb = dataUrl;
  return loadDimensions(dataUrl).catch(() => null);
}

function markBroken(pic) {
  const thumb = pic.parentElement;
  pic.remove();
  thumb?.classList.add('gthumb-broken');
  thumb?.replaceChildren(icon('image', 'i'));
}

// ---------- Grid interaction ----------
function onGridClick(e) {
  const card = e.target.closest('.gcard');
  if (!card) return;
  const img = state.images.find((i) => i.src === card.dataset.src);
  if (!img) return;
  const action = e.target.closest('[data-act]')?.dataset.act;

  if (action === 'select' || e.ctrlKey || e.metaKey || e.shiftKey) {
    e.stopPropagation();
    selectFromClick(img, e.shiftKey);
    return;
  }
  if (action === 'copy') { copyImage(img.src); return; }
  if (action === 'download') { openDownloadMenu(e.target.closest('[data-act]'), img); return; }
  if (action === 'open') { chrome.tabs.create({ url: img.src, active: false }); return; }
  if (action === 'lens') { openLens(img.src); return; }
  openPreview(img.src);
}

// The range anchor is the image itself, so filtering or re-sorting never turns an old
// position into a different image.
function selectFromClick(img, range) {
  const index = state.filtered.indexOf(img);
  const anchor = state.filtered.findIndex((i) => i.src === state.lastClickedSrc);
  if (range && anchor >= 0 && index >= 0) {
    const [from, to] = [Math.min(anchor, index), Math.max(anchor, index)];
    state.filtered.slice(from, to + 1).forEach((i) => state.selected.add(i.src));
  } else if (state.selected.has(img.src)) {
    state.selected.delete(img.src);
  } else {
    state.selected.add(img.src);
  }
  state.lastClickedSrc = img.src;
  updateSelectionUI();
}

function onGridKeydown(e) {
  const card = e.target.closest('.gcard');
  if (!card || e.target !== card) return;
  const cards = [...$('image-grid').children];
  const index = cards.indexOf(card);
  const img = state.images.find((i) => i.src === card.dataset.src);

  if (e.key === 'Enter') { e.preventDefault(); openPreview(img.src); return; }
  if (e.key === ' ') { e.preventDefault(); selectFromClick(img, e.shiftKey); return; }

  const columns = Math.max(1, cards.filter((c) => c.offsetTop === cards[0].offsetTop).length);
  const rtl = document.documentElement.dir === 'rtl';
  const moves = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1, ArrowDown: columns, ArrowUp: -columns, Home: -index, End: cards.length - 1 - index };
  if (e.key in moves) {
    e.preventDefault();
    const next = cards[Math.max(0, Math.min(cards.length - 1, index + moves[e.key]))];
    next?.focus();
    next?.scrollIntoView({ block: 'nearest' });
  }
}

// ---------- Selection ----------
function toggleSelectAll() {
  const allSelected = state.filtered.length > 0 && state.filtered.every((i) => state.selected.has(i.src));
  state.filtered.forEach((i) => (allSelected ? state.selected.delete(i.src) : state.selected.add(i.src)));
  updateSelectionUI();
}

function updateSelectionUI() {
  for (const [src, card] of state.cards) {
    const on = state.selected.has(src);
    card.classList.toggle('selected', on);
    card.querySelector('.gcheck')?.setAttribute('aria-checked', String(on));
  }
  const n = state.selected.size;
  const allSelected = state.filtered.length > 0 && state.filtered.every((i) => state.selected.has(i.src));
  $('image-grid').classList.toggle('has-selection', n > 0);
  $('btn-select-all').setAttribute('aria-pressed', String(allSelected));
  $('btn-select-all').setAttribute('aria-label', t('titleSelectAll'));
  $('btn-select-all').title = t('titleSelectAll');
  const shown = state.filtered.length, total = state.images.length;
  $('grid-count').textContent = t('imagesFound', [String(shown)]) + (shown < total ? ` / ${total}` : '');
  $('action-bar-count').textContent = String(n);
  updateActionBar();
  syncHighlights();
}

const syncHighlights = debounce(() => {
  if (state.tabId != null) send({ action: 'highlightImages', tabId: state.tabId, urls: [...state.selected] });
}, 120);

// ---------- Download menu ----------
let openMenu = null;

function closeMenu() {
  openMenu?.remove();
  openMenu = null;
}

function openDownloadMenu(anchor, img) {
  closeMenu();
  const typeLabel = img.type === 'other' ? '?' : img.type.toUpperCase();
  const items = [['original', t('originalFormat'), typeLabel], ['png', 'PNG'], ['jpeg', 'JPG'], ['webp', 'WebP'], ['avif', 'AVIF']];
  const menu = el('div', { class: 'menu', role: 'menu' }, items.map(([value, label, hint]) =>
    el('button', { class: 'menu-item', role: 'menuitem', onclick: () => { closeMenu(); downloadOne(img, value); } },
      [el('span', { text: label }), hint ? el('small', { text: hint }) : null])));
  document.body.append(menu);
  const rect = anchor.getBoundingClientRect();
  const width = menu.offsetWidth, height = menu.offsetHeight;
  const left = Math.min(window.innerWidth - width - 8, Math.max(8, rect.right - width));
  const top = rect.bottom + height + 6 < window.innerHeight ? rect.bottom + 6 : rect.top - height - 6;
  Object.assign(menu.style, { left: `${left}px`, top: `${Math.max(8, top)}px` });
  openMenu = menu;
  menu.querySelector('.menu-item')?.focus();
}

document.addEventListener('pointerdown', (e) => { if (openMenu && !openMenu.contains(e.target)) closeMenu(); });

// ============================================================
// Downloads
// ============================================================
function buildInstructions(format) {
  const s = state.settings;
  let fmt = format;
  // "Convert on download" only applies when the user asked for the original format.
  if (fmt === 'original' && s.convertOnDl && s.convertOnDl !== 'none') fmt = s.convertOnDl;
  // "Original" keeps the exact bytes; the background picks the extension from the real content type.
  const ins = fmt === 'original' ? { passthrough: true } : { format: fmt === 'jpg' ? 'jpeg' : fmt, quality: s.defaultQuality / 100 };
  ins.silent = true;
  return ins;
}

async function downloadOne(img, format) {
  try {
    const r = await call({ action: 'processAndSave', imageUrl: img.src, instructions: buildInstructions(format) });
    if (r.cancelled) return;
    toast(t('notifSavedAs', [ITK.formatLabel(r.format)]) + sizeSummary(r));
  } catch (err) {
    toast(`${t('errorSaveFailed')}: ${err.message}`, 'error');
  }
}

// ============================================================
// Clipboard & external actions
// ============================================================
function dataUrlToBlob(dataUrl) {
  return fetch(dataUrl).then((r) => r.blob());
}

// This page has focus, so it can write to the clipboard directly. Passing a promise to
// ClipboardItem keeps the user gesture valid while the PNG is being produced.
async function copyImage(src) {
  const png = call({ action: 'processAndReturnData', imageUrl: src, instructions: { format: 'png' } })
    .then((r) => dataUrlToBlob(r.dataUrl));
  png.catch(() => {});
  try {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    } catch {
      const blob = await png; // surfaces processing errors
      await call({ action: 'copyDataUrlToClipboard', dataUrl: await blobToDataUrl(blob) });
    }
    toast(t('notifCopied'));
  } catch (err) {
    toast(`${t('errorCopyFailed')}: ${err.message}`, 'error');
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    await call({ action: 'copyTextToClipboard', text });
  }
}

function openLens(src) {
  if (!state.settings.enableGoogleLens) { toast(t('googleLensDisabled'), 'info'); return; }
  if (!/^https?:/i.test(src)) { toast(t('googleLensNeedsUrl'), 'info'); return; }
  chrome.tabs.create({ url: `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(src)}`, active: true });
}

function openEditor(src) {
  send({ action: 'openEditor', imageUrl: src });
}

// ============================================================
// Action bar & batch
// ============================================================
function initActionBar() {
  $('action-download').addEventListener('click', () => batchDownload(!!state.settings.zipDefault));
  $('action-zip').addEventListener('click', () => batchDownload(true));
  $('action-clear').addEventListener('click', () => { state.selected.clear(); updateSelectionUI(); });
  $('action-copy-urls').addEventListener('click', async () => {
    const urls = [...state.selected].filter((u) => !u.startsWith('data:'));
    try {
      await copyText(urls.join('\n'));
      toast(t('urlsCopied', [String(urls.length)]));
    } catch (err) {
      toast(`${t('errorCopyFailed')}: ${err.message}`, 'error');
    }
  });
}

function updateActionBar() {
  const show = state.selected.size > 0 && activeTab() === 'images';
  $('action-bar').hidden = !show && $('batch-progress').hidden;
  $('app').classList.toggle('has-action-bar', !$('action-bar').hidden);
}

let batchRunning = false;

async function batchDownload(zip) {
  const items = state.images.filter((i) => state.selected.has(i.src));
  if (!items.length || batchRunning) return;
  batchRunning = true;

  const format = $('action-format').value;
  const progress = $('batch-progress'), fill = $('progress-fill'), label = $('progress-text'), count = $('progress-count');
  progress.hidden = false;
  fill.className = 'progress-fill';
  fill.style.width = '0%';
  const buttons = [$('action-download'), $('action-zip')];
  buttons.forEach((b) => { b.disabled = true; });

  const files = [];
  let failed = 0;
  for (let i = 0; i < items.length; i++) {
    count.textContent = `${i + 1}/${items.length}`;
    label.textContent = zip ? t('preparingZip') : t('processing');
    const ins = buildInstructions(format);
    // One file per image: never open a Save As dialog or a notification for each one.
    ins.saveAs = false;
    try {
      const r = await call({ action: zip ? 'processAndReturnData' : 'processAndSave', imageUrl: items[i].src, instructions: ins });
      if (zip) files.push({ name: zipEntryName(items[i].src, r.format, i), dataUrl: r.dataUrl });
    } catch {
      failed++;
    }
    fill.style.width = `${Math.round(((i + 1) / items.length) * 100)}%`;
  }

  if (zip && files.length) {
    label.textContent = t('creatingZip');
    let result = null;
    try { result = await downloadZip(files); } catch { failed = items.length; }
    // Closing the Save As dialog is a choice, not a failure: end quietly, nothing saved.
    if (result?.cancelled) {
      buttons.forEach((b) => { b.disabled = false; });
      batchRunning = false;
      progress.hidden = true;
      updateActionBar();
      return;
    }
  }

  const ok = items.length - failed;
  fill.classList.add(failed ? 'partial' : 'done');
  label.textContent = t('batchResult', [String(ok), String(items.length)]);
  toast(t('batchResult', [String(ok), String(items.length)]), failed ? 'error' : 'success');
  buttons.forEach((b) => { b.disabled = false; });
  batchRunning = false;
  setTimeout(() => { progress.hidden = true; updateActionBar(); }, 2200);
}

function zipEntryName(url, format, i) {
  let base = 'image';
  try {
    base = decodeURIComponent(new URL(url).pathname.split('/').pop() || '').replace(/\.[^.]+$/, '') || 'image';
  } catch {}
  base = ITK.sanitizeFilename(base).replace(/\s+/g, '_').slice(0, 40) || 'image';
  return `${String(i + 1).padStart(3, '0')}_${base}.${ITK.extensionFor(format)}`;
}

async function downloadZip(files) {
  const zip = new JSZip();
  for (const f of files) zip.file(f.name, f.dataUrl.slice(f.dataUrl.indexOf(',') + 1), { base64: true });
  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/zip' });
  const filename = `imagetoolkit-${Date.now()}.zip`;
  // A data URL outlives this page (the popup may close while Save As is open), but
  // extension messages are capped at 64 MB, so very large archives use a blob URL.
  if (blob.size < 48 * 1024 * 1024) {
    return call({ action: 'downloadBlob', dataUrl: await blobToDataUrl(blob), filename, saveAs: true });
  }
  const url = URL.createObjectURL(blob);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return call({ action: 'downloadBlob', dataUrl: url, filename, saveAs: true });
}

// ============================================================
// Preview
// ============================================================
let previewReturnFocus = null;
// Everything behind the dialog; made inert while it is open.
const BACKGROUND_REGIONS = ['.header', '.tabs', '.views', '#action-bar'];

function initPreview() {
  $('preview-backdrop').addEventListener('click', closePreview);
  $('preview-close').addEventListener('click', closePreview);
  $('preview-prev').addEventListener('click', () => stepPreview(-1));
  $('preview-next').addEventListener('click', () => stepPreview(1));
  // Actions resolve the image when clicked, by identity, so a re-sort underneath the
  // dialog can never redirect them to another image.
  const withImage = (fn) => () => { const img = currentPreview(); if (img) fn(img); };
  $('preview-download').addEventListener('click', withImage((img) => withBusy($('preview-download'), () => downloadOne(img, $('preview-format').value))));
  $('preview-copy').addEventListener('click', withImage((img) => copyImage(img.src)));
  $('preview-resize').addEventListener('click', withImage((img) => { openEditor(img.src); closePreview(); }));
  $('preview-open').addEventListener('click', withImage((img) => chrome.tabs.create({ url: img.src, active: false })));
  $('preview-lens').addEventListener('click', withImage((img) => openLens(img.src)));
  $('preview-modal').addEventListener('keydown', trapFocus);
}

function currentPreview() {
  return state.previewSrc ? state.images.find((i) => i.src === state.previewSrc) : null;
}

function openPreview(src) {
  const img = state.images.find((i) => i.src === src);
  if (!img) return;
  if ($('preview-modal').hidden) previewReturnFocus = document.activeElement;
  state.previewSrc = src;
  const stage = $('preview-img');
  stage.src = img.thumb || img.src;
  stage.alt = img.alt || img.name;
  $('preview-filename').textContent = img.name;
  $('preview-filename').title = img.src;
  $('preview-lens').hidden = !state.settings.enableGoogleLens || img.src.startsWith('data:');
  refreshPreviewMeta();
  if ($('preview-modal').hidden) {
    $('preview-modal').hidden = false;
    BACKGROUND_REGIONS.forEach((sel) => document.querySelector(sel)?.setAttribute('inert', ''));
    $('preview-close').focus();
  }
}

// Position and metadata follow the image through filtering, sorting and late probes.
function refreshPreviewMeta() {
  const img = currentPreview();
  if (!img) return;
  const index = state.filtered.findIndex((i) => i.src === img.src);
  const meta = [img.type === 'other' ? '' : img.type.toUpperCase()];
  if (img.width && img.height) meta.push(`${img.width} × ${img.height}`);
  if (img.fileSize > 0) meta.push(ITK.formatBytes(img.fileSize));
  if (index >= 0) meta.push(`${index + 1}/${state.filtered.length}`);
  $('preview-meta').textContent = meta.filter(Boolean).join(' · ');
  $('preview-prev').disabled = index <= 0;
  $('preview-next').disabled = index < 0 || index >= state.filtered.length - 1;
}

function stepPreview(delta) {
  const index = state.filtered.findIndex((i) => i.src === state.previewSrc);
  const next = state.filtered[index + delta];
  if (index >= 0 && next) openPreview(next.src);
}

function closePreview() {
  if ($('preview-modal').hidden) return;
  $('preview-modal').hidden = true;
  BACKGROUND_REGIONS.forEach((sel) => document.querySelector(sel)?.removeAttribute('inert'));
  state.previewSrc = '';
  previewReturnFocus?.focus?.();
}

// Keep Tab and Shift+Tab inside the dialog.
function trapFocus(e) {
  if (e.key !== 'Tab') return;
  const focusable = [...$('preview-modal').querySelectorAll('button, select, [tabindex]:not([tabindex="-1"])')]
    .filter((node) => !node.disabled && !node.hidden && node.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0], last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

// ============================================================
// Keyboard
// ============================================================
function isTyping(target) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

function initKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (openMenu) { closeMenu(); return; }
      if (!$('preview-modal').hidden) { closePreview(); return; }
      if (state.selected.size && !isTyping(e.target)) { state.selected.clear(); updateSelectionUI(); }
      return;
    }
    if (!$('preview-modal').hidden) {
      const rtl = document.documentElement.dir === 'rtl';
      if (e.key === 'ArrowRight') { e.preventDefault(); stepPreview(rtl ? -1 : 1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); stepPreview(rtl ? 1 : -1); }
      return;
    }
    if (isTyping(e.target)) return;
    if (e.key === '/' && activeTab() === 'images') { e.preventDefault(); $('filter-url').focus(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && activeTab() === 'images') { e.preventDefault(); toggleSelectAll(); }
  });
}

// ============================================================
// Tools
// ============================================================
let advisorToken = 0;
// Every new source bumps this; async steps of an older source stop touching the UI.
let toolToken = 0;
let toolReader = null;

function initPaste() {
  document.addEventListener('paste', (e) => {
    const items = [...(e.clipboardData?.items || [])];
    const file = items.find((i) => i.kind === 'file' && i.type.startsWith('image/'))?.getAsFile();
    if (file) {
      e.preventDefault();
      switchTab('tools');
      loadToolFile(file);
      return;
    }
    if (isTyping(e.target)) return;
    const text = e.clipboardData?.getData('text/plain')?.trim();
    if (text && /^https?:\/\//i.test(text)) {
      e.preventDefault();
      switchTab('tools');
      setToolSource(text, ITK.displayName(text));
    }
  });
}

function initTools() {
  const dropZone = $('drop-zone'), fileInput = $('file-input'), urlInput = $('tool-url-input');

  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'));
    if (file) { loadToolFile(file); return; }
    // Images dragged from a web page arrive as a URL.
    const url = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || '').split('\n')[0].trim();
    if (/^https?:\/\//i.test(url)) setToolSource(url, ITK.displayName(url));
  });
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) loadToolFile(fileInput.files[0]); fileInput.value = ''; });

  const loadFromInput = () => {
    const url = urlInput.value.trim();
    if (!url || url === state.tool.src) return;
    if (/^https?:\/\//i.test(url)) setToolSource(url, ITK.displayName(url));
    else flashError(urlInput);
  };
  urlInput.addEventListener('change', loadFromInput);
  urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadFromInput(); });

  $('tool-preview-clear').addEventListener('click', clearToolSource);

  setSegmented($('convert-format'), state.settings.defaultFormat || 'webp');
  onSegmented($('convert-format'), () => {});
  $('btn-convert-url').addEventListener('click', () => convertTool());

  const w = $('resize-url-w'), h = $('resize-url-h'), lock = $('resize-url-lock');
  w.addEventListener('input', () => { if (isLocked() && state.tool.ratio) h.value = Math.round((parseInt(w.value, 10) || 0) / state.tool.ratio) || ''; });
  h.addEventListener('input', () => { if (isLocked() && state.tool.ratio) w.value = Math.round((parseInt(h.value, 10) || 0) * state.tool.ratio) || ''; });
  lock.addEventListener('click', () => {
    const locked = !isLocked();
    lock.classList.toggle('active', locked);
    lock.setAttribute('aria-pressed', String(locked));
    lock.querySelector('use').setAttribute('href', locked ? '#i-lock' : '#i-unlock');
    $('resize-mode-row').hidden = locked;
    if (locked && state.tool.ratio && w.value) h.value = Math.round(parseInt(w.value, 10) / state.tool.ratio);
  });
  $('resize-mode').value = state.settings.resizeBehavior || 'crop';
  $('btn-resize-url').addEventListener('click', () => resizeTool());
  $('btn-open-crop').addEventListener('click', () => {
    if (!state.tool.src) { flashError(urlInput); return; }
    openEditor(state.tool.src);
  });
}

function isLocked() {
  return $('resize-url-lock').getAttribute('aria-pressed') === 'true';
}

function loadToolFile(file) {
  // Checked before reading: base64 would inflate it by a third in memory.
  if (file.size > ITK.MAX_IMAGE_BYTES) {
    toast(t('errorTooLarge', [ITK.formatBytes(ITK.MAX_IMAGE_BYTES)]), 'error');
    return;
  }
  const token = ++toolToken;
  toolReader?.abort();
  const reader = new FileReader();
  toolReader = reader;
  reader.onload = () => { if (token === toolToken) setToolSource(reader.result, file.name, file.size); };
  reader.readAsDataURL(file);
}

function clearToolSource() {
  advisorToken++;
  toolToken++;
  toolReader?.abort();
  state.tool = { src: '', name: '', ratio: 0, size: 0 };
  $('tool-preview').hidden = true;
  $('tool-url-input').value = '';
  $('resize-url-w').value = '';
  $('resize-url-h').value = '';
  $('format-advisor').hidden = true;
}

function loadDimensions(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const timer = setTimeout(() => { img.src = ''; reject(new Error('Timeout')); }, 10000);
    img.onload = () => { clearTimeout(timer); resolve({ width: img.naturalWidth, height: img.naturalHeight }); };
    img.onerror = () => { clearTimeout(timer); reject(new Error('Failed to load image')); };
    img.src = src;
  });
}

async function setToolSource(src, name, size = 0) {
  const token = ++toolToken;
  if (!src.startsWith('data:')) toolReader?.abort();
  const stale = () => token !== toolToken;
  state.tool = { src, name, ratio: 0, size };
  $('tool-url-input').value = src.startsWith('data:') ? '' : src;
  $('tool-preview-img').src = src;
  $('tool-preview-name').textContent = name;
  $('tool-preview-info').textContent = '…';
  $('tool-preview').hidden = false;

  let dims = await loadDimensions(src).catch(() => null);
  if (stale()) return;
  if (!dims && !src.startsWith('data:')) {
    const dataUrl = await fetchViaExtension(src);
    if (stale()) return;
    if (dataUrl) {
      $('tool-preview-img').src = dataUrl;
      dims = await loadDimensions(dataUrl).catch(() => null);
      if (stale()) return;
    }
  }

  if (!size && !src.startsWith('data:')) {
    const sizes = await send({ action: 'probeImageSizes', urls: [src] });
    if (stale()) return;
    size = sizes?.[src] || 0;
    state.tool.size = size;
  }

  const meta = [];
  if (dims?.width) {
    state.tool.ratio = dims.width / dims.height;
    $('resize-url-w').value = dims.width;
    $('resize-url-h').value = dims.height;
    meta.push(`${dims.width} × ${dims.height}`);
  }
  if (size > 0) meta.push(ITK.formatBytes(size));
  $('tool-preview-info').textContent = meta.join(' · ') || '—';
  runAdvisor(src);
}

async function convertTool() {
  if (!state.tool.src) { flashError($('tool-url-input')); return; }
  const format = segmentedValue($('convert-format')) || 'webp';
  await withBusy($('btn-convert-url'), async () => {
    try {
      const r = await call({ action: 'processAndSave', imageUrl: state.tool.src, instructions: { format, quality: state.settings.defaultQuality / 100, silent: true } });
      if (r.cancelled) return;
      toast(t('notifSavedAs', [ITK.formatLabel(r.format)]) + sizeSummary(r));
    } catch (err) {
      toast(`${t('errorSaveFailed')}: ${err.message}`, 'error');
    }
  });
}

async function resizeTool() {
  if (!state.tool.src) { flashError($('tool-url-input')); return; }
  const width = parseInt($('resize-url-w').value, 10);
  const height = parseInt($('resize-url-h').value, 10);
  if (!(width >= 1)) { flashError($('resize-url-w')); return; }

  const ins = { format: state.settings.defaultFormat || 'webp', quality: state.settings.defaultQuality / 100, silent: true };
  if (!isLocked() && height >= 1) {
    Object.assign(ins, { cropWidth: width, cropHeight: height, fitMode: $('resize-mode').value === 'fit' });
  } else {
    ins.width = width;
  }

  await withBusy($('btn-resize-url'), async () => {
    try {
      const r = await call({ action: 'processAndSave', imageUrl: state.tool.src, instructions: ins });
      if (r.cancelled) return;
      toast(t('notifSavedAs', [ITK.formatLabel(r.format)]) + ` · ${r.width} × ${r.height}`);
    } catch (err) {
      toast(`${t('errorSaveFailed')}: ${err.message}`, 'error');
    }
  });
}

async function runAdvisor(src) {
  const token = ++advisorToken;
  const card = $('format-advisor'), rec = $('advisor-recommendation'), bars = $('advisor-sizes');
  card.hidden = false;
  rec.textContent = t('analyzing');
  bars.replaceChildren();

  // One download and one decode in the background; stale answers are dropped here.
  const analysis = await send({ action: 'analyzeFormats', imageUrl: src });
  if (token !== advisorToken) return;
  if (analysis?.superseded) { card.hidden = true; return; }
  if (!analysis?.results?.length || analysis.error) { card.hidden = true; return; }
  const results = analysis.results.map((r) => ({ label: ITK.formatLabel(r.format), size: r.size, format: r.format }));

  // Formats that keep transparency when the image has it.
  const hasAlpha = !!analysis.hasAlpha;
  const candidates = hasAlpha ? results.filter((r) => r.format !== 'jpeg') : results;
  const best = candidates.reduce((a, b) => (b.size < a.size ? b : a));
  rec.textContent = hasAlpha
    ? t('advisorAlpha')
    : ITK.fillTokens(t('advisorSmallest'), { format: best.label, size: ITK.formatBytes(best.size) });

  const rows = state.tool.size > 0 ? [{ label: t('originalFormat'), size: state.tool.size }, ...results] : results;
  const max = Math.max(...rows.map((r) => r.size));
  bars.replaceChildren(...rows.map((r) => el('div', { class: 'bar' + (r === best ? ' bar-best' : '') }, [
    el('strong', { text: r.label }),
    el('div', { class: 'bar-track' }, el('div', { class: 'bar-fill', style: `width:${Math.max(3, (r.size / max) * 100)}%` })),
    el('span', { text: ITK.formatBytes(r.size) }),
  ])));
  const pick = results.find((r) => r === best);
  if (pick) setSegmented($('convert-format'), pick.format);
}

// ============================================================
// Settings
// ============================================================
function initSettings() {
  const s = state.settings;
  const quality = $('setting-quality');
  const paintQuality = () => {
    $('quality-value').textContent = `${quality.value}%`;
    quality.style.setProperty('--pct', `${((quality.value - quality.min) / (quality.max - quality.min)) * 100}%`);
  };
  quality.value = s.defaultQuality ?? 85;
  paintQuality();
  quality.addEventListener('input', paintQuality);
  quality.addEventListener('change', () => saveSettings({ defaultQuality: parseInt(quality.value, 10) }));

  setSegmented($('setting-default-format'), s.defaultFormat || 'webp');
  onSegmented($('setting-default-format'), (value) => {
    saveSettings({ defaultFormat: value });
    setSegmented($('convert-format'), value);
  });

  onSegmented($('setting-theme'), (value) => { applyTheme(value); saveSettings({ theme: value }); });

  const bind = (id, key, read, write) => {
    const node = $(id);
    write(node, s[key]);
    node.addEventListener('change', () => saveSettings({ [key]: read(node) }));
  };
  const asChecked = [(n) => n.checked, (n, v) => { n.checked = !!v; }];
  const asValue = (fallback) => [(n) => n.value, (n, v) => { n.value = v ?? fallback; }];

  bind('setting-resize-behavior', 'resizeBehavior', ...asValue('crop'));
  bind('setting-open-sidepanel', 'openAsSidePanel', ...asChecked);
  bind('setting-show-notif', 'showNotification', ...asChecked);
  bind('setting-google-lens', 'enableGoogleLens', ...asChecked);
  bind('setting-save-as', 'saveAs', ...asChecked);
  bind('setting-zip-default', 'zipDefault', ...asChecked);
  bind('setting-subfolder', 'subfolder', ...asValue(''));
  bind('setting-filename', 'filenamePattern', ...asValue('original'));
  bind('setting-prefix', 'filenamePrefix', ...asValue('img_'));
  bind('setting-convert-dl', 'convertOnDl', ...asValue('none'));

  const prefixRow = () => { $('custom-prefix-row').hidden = $('setting-filename').value !== 'custom'; };
  prefixRow();
  $('setting-filename').addEventListener('change', prefixRow);
  $('setting-resize-behavior').addEventListener('change', () => { $('resize-mode').value = $('setting-resize-behavior').value; });
  $('setting-google-lens').addEventListener('change', () => { state.settings.enableGoogleLens = $('setting-google-lens').checked; renderGrid(false); });

  const language = $('setting-language');
  language.value = s.locale || 'auto';
  language.addEventListener('change', async () => {
    await saveSettings({ locale: language.value });
    await i18n.load(language.value);
    localize();
    state.cards.clear();
    populateDomains();
    applyFilters();
  });
}

function showAbout() {
  $('version-text').textContent = `v${chrome.runtime.getManifest().version}`;
  chrome.commands?.getAll?.().then((commands) => {
    const shortcut = commands.find((c) => c.name === 'capture-area')?.shortcut;
    if (shortcut) {
      $('shortcut-key').textContent = shortcut;
      $('shortcut-row').hidden = false;
    }
  }).catch(() => {});
}

// ============================================================
// Probing (types, sizes, dimensions)
// ============================================================
async function probeTypes() {
  const unknown = state.images.filter((i) => i.type === 'other' && /^https?:/i.test(i.src)).slice(0, 30);
  if (!unknown.length) return;
  const types = await send({ action: 'probeImageTypes', urls: unknown.map((i) => i.src) });
  if (!types || typeof types !== 'object') return;
  let changed = false;
  for (const img of unknown) {
    if (types[img.src]) { img.type = types[img.src]; changed = true; }
  }
  if (changed) queueRefresh();
}

async function probeFileSizes() {
  const missing = state.images.filter((i) => !i.fileSize && /^https?:/i.test(i.src)).slice(0, 100);
  if (!missing.length) return;
  const sizes = await send({ action: 'probeImageSizes', urls: missing.map((i) => i.src) });
  if (!sizes || typeof sizes !== 'object') return;
  let changed = false;
  for (const img of missing) {
    if (sizes[img.src] > 0) { img.fileSize = sizes[img.src]; changed = true; }
  }
  if (changed) queueRefresh();
}

async function probeMissingDimensions() {
  const pending = state.images.filter((i) => !(i.width > 0 && i.height > 0)).slice(0, 160);
  if (!pending.length) return;
  let changed = false;
  await ITK.mapLimit(pending, 8, async (img) => {
    // Without this fallback, hotlink-protected images keep 0×0 and vanish from size filters.
    const dims = await loadDimensionsWithFallback(img);
    if (dims?.width > 0 && dims?.height > 0) {
      img.width = dims.width;
      img.height = dims.height;
      updateDerived(img);
      changed = true;
    }
  });
  if (changed) queueRefresh();
}
