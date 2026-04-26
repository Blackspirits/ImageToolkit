// ============================================================
// ImageToolkit – Side Panel UI (final)
// ============================================================
'use strict';
let customMessages = null; // Custom locale override

function _(k, s) {
  // Custom locale override takes priority
  if (customMessages && customMessages[k]) {
    let msg = customMessages[k].message || k;
    // Handle placeholders like $COUNT$, $FORMAT$
    if (s && Array.isArray(s)) {
      s.forEach((val, i) => {
        msg = msg.replace(new RegExp(`\\$${i + 1}`, 'g'), val);
        // Also replace named placeholders
        const ph = customMessages[k].placeholders;
        if (ph) {
          for (const [name, def] of Object.entries(ph)) {
            if (def.content === `$${i + 1}`) {
              msg = msg.replace(new RegExp(`\\$${name.toUpperCase()}\\$`, 'gi'), val);
            }
          }
        }
      });
    }
    return msg;
  }
  return chrome.i18n.getMessage(k, s) || k;
}

async function loadCustomLocale(locale) {
  if (!locale || locale === 'auto') { customMessages = null; return; }
  try {
    const resp = await fetch(chrome.runtime.getURL(`_locales/${locale}/messages.json`));
    if (resp.ok) customMessages = await resp.json();
  } catch { customMessages = null; }
}

document.addEventListener('DOMContentLoaded', async () => {
  // Load custom locale before anything else
  const s = await getSettings();
  if (s.locale && s.locale !== 'auto') await loadCustomLocale(s.locale);

  localizeUI(); initTheme(); initTabs(); initUrlConvert(); initResizeUrl();
  initSettings(); initImageGrid(); initPreviewModal();
  initActionBar(); scanPageImages(); showVersion();

  // Listen for new images from content script MutationObserver
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'newImagesAvailable' && msg.count > 0) {
      const banner = $('new-images-banner');
      const text = $('new-images-text');
      if (banner && text) {
        text.textContent = `+${msg.count} ${_('newImagesDetected')}`;
        banner.style.display = 'flex';
      }
    }
  });

  $('btn-rescan')?.addEventListener('click', () => {
    $('new-images-banner').style.display = 'none';
    scanPageImages();
  });
});

function localizeUI() {
  document.querySelectorAll('[data-i18n]').forEach(e => { const m = _(e.dataset.i18n); if (m !== e.dataset.i18n) e.textContent = m; });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(e => { const m = _(e.dataset.i18nPlaceholder); if (m !== e.dataset.i18nPlaceholder) e.placeholder = m; });
  document.querySelectorAll('[data-i18n-title]').forEach(e => { const m = _(e.dataset.i18nTitle); if (m !== e.dataset.i18nTitle) e.title = m; });
}
function showVersion() { const e = document.getElementById('version-text'); if (e) e.textContent = `v${chrome.runtime.getManifest().version}`; }

// ===== Theme =====
function initTheme() {
  getSettings().then(s => applyTheme(s.theme || 'auto'));
  document.getElementById('btn-theme').addEventListener('click', () => {
    const isDark = document.getElementById('app').classList.contains('dark');
    const next = isDark ? 'light' : 'dark';
    applyTheme(next);
    const sel = document.getElementById('setting-theme'); if (sel) sel.value = next;
    getSettings().then(s => { chrome.storage.sync.set({ settings: { ...s, theme: next } }); });
  });
}
function applyTheme(theme) {
  const app = document.getElementById('app'); app.dataset.theme = theme;
  if (theme === 'auto') { const d = matchMedia('(prefers-color-scheme:dark)').matches; app.classList.toggle('dark', d); app.classList.toggle('light', !d); }
  else { app.classList.toggle('dark', theme === 'dark'); app.classList.toggle('light', theme === 'light'); }
  const moonSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>';
  const sunSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>';
  document.getElementById('btn-theme').innerHTML = app.classList.contains('dark') ? moonSvg : sunSvg;
}

// ===== Tabs =====
function initTabs() { document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab))); }
function switchTab(n) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.querySelector(`.tab[data-tab="${n}"]`)?.classList.add('active');
  document.getElementById(`tab-${n}`)?.classList.add('active');
  updateActionBar();
}

// ===== Scanner =====
let pageImages = [];
function scanPageImages() {
  chrome.runtime.sendMessage({ action: 'collectImages' }, imgs => {
    pageImages = imgs || [];
    buildImageGrid(pageImages);
  });
}

// ===== Grid state =====
let allGrid = [], filtered = [];
const selected = new Set();
let hideDups = false, layout = '2col', sort = 'pixels';
const TP = new Set(['w','h','width','height','size','format','quality','q','fit','crop','resize','auto','dpr','fm','fl','cs']);

function initImageGrid() {
  ['filter-type','filter-size','filter-layout','filter-domain'].forEach(id => $(id)?.addEventListener('change', applyFilters));
  $('filter-url')?.addEventListener('input', debounce(applyFilters, 250));
  $('sort-order')?.addEventListener('change', e => { sort = e.target.value; applyFilters(); });
  $('btn-refresh')?.addEventListener('click', () => { selected.clear(); scanPageImages(); });
  $('btn-retry')?.addEventListener('click', () => { selected.clear(); scanPageImages(); });

  // Size filter: show/hide "at least" row
  $('filter-size')?.addEventListener('change', () => {
    const show = $('filter-size').value === 'atleast';
    $('atleast-row').style.display = show ? 'flex' : 'none';
    applyFilters();
  });
  $('atleast-w')?.addEventListener('input', debounce(applyFilters, 300));
  $('atleast-h')?.addEventListener('input', debounce(applyFilters, 300));

  // Save size selection to storage
  $('btn-save-size')?.addEventListener('click', () => {
    const w = parseInt($('atleast-w')?.value, 10) || 0;
    const h = parseInt($('atleast-h')?.value, 10) || 0;
    chrome.storage.sync.get(['settings'], r => {
      const s = r.settings || {};
      s.savedAtLeastW = w;
      s.savedAtLeastH = h;
      chrome.storage.sync.set({ settings: s }, () => toast('✅ ' + _('notifSaved')));
    });
  });

  // Restore saved at-least values
  getSettings().then(s => {
    if (s.savedAtLeastW) $('atleast-w').value = s.savedAtLeastW;
    if (s.savedAtLeastH) $('atleast-h').value = s.savedAtLeastH;
  });

  $('btn-hide-dupes')?.addEventListener('click', () => {
    hideDups = !hideDups; $('btn-hide-dupes').classList.toggle('active', hideDups); applyFilters();
  });
  $('btn-layout')?.addEventListener('click', () => {
    const modes = ['2col','1col','compact'];
    const layoutSvgs = [
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><rect x="3" y="3" width="18" height="8" rx="1"/><rect x="3" y="14" width="18" height="8" rx="1"/></svg>',
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><rect x="3" y="3" width="4" height="4" rx="1"/><rect x="10" y="3" width="4" height="4" rx="1"/><rect x="17" y="3" width="4" height="4" rx="1"/><rect x="3" y="10" width="4" height="4" rx="1"/><rect x="10" y="10" width="4" height="4" rx="1"/><rect x="17" y="10" width="4" height="4" rx="1"/><rect x="3" y="17" width="4" height="4" rx="1"/><rect x="10" y="17" width="4" height="4" rx="1"/><rect x="17" y="17" width="4" height="4" rx="1"/></svg>',
    ];
    const i = (modes.indexOf(layout) + 1) % 3; layout = modes[i];
    $('image-grid').className = `grid grid-${layout}`;
    $('btn-layout').innerHTML = layoutSvgs[i];
  });
  $('btn-select-all')?.addEventListener('click', () => {
    const all = filtered.length > 0 && filtered.every(i => selected.has(i.src));
    filtered.forEach(i => { if (all) selected.delete(i.src); else selected.add(i.src); });
    document.querySelectorAll('.gcard').forEach(c => {
      const ch = c.querySelector('.gcheck'); if (ch) ch.checked = !all;
      c.classList.toggle('selected', !all);
    });
    const uncheckSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="3"/></svg>';
    const checkSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 12l2 2 4-4"/></svg>';
    $('btn-select-all').innerHTML = all ? uncheckSvg : checkSvg;
    updateActionBar();
    syncHighlights();
  });

  // Capture area screenshot (with optional delay)
  $('btn-capture')?.addEventListener('click', () => {
    const delay = parseInt($('capture-delay')?.value || '0', 10) * 1000;
    if (delay > 0) {
      toast(`⏱ ${delay / 1000}s...`);
      setTimeout(() => chrome.runtime.sendMessage({ action: 'startCapture' }), delay);
    } else {
      chrome.runtime.sendMessage({ action: 'startCapture' });
    }
  });

  document.addEventListener('click', () => document.querySelectorAll('.gdl-menu.show').forEach(m => m.classList.remove('show')));
}

function buildImageGrid(imgs) {
  const seen = new Map();
  allGrid = imgs.map((img, i) => {
    const type = detectType(img.src), domain = extractDomain(img.src);
    const nk = normUrl(img.src), isDup = seen.has(nk); if (!isDup) seen.set(nk, i);
    const w = img.width || 0, h = img.height || 0;
    let ly = 'square'; if (w && h) { if (w >= 1.2 * h) ly = 'wide'; else if (h >= 1.2 * w) ly = 'tall'; }
    return { ...img, type, filename: extractFn(img.src), domain, isDuplicate: isDup, layout: ly, pixels: w * h, index: i, fileSize: img.fileSize || 0 };
  });
  $('grid-loading').style.display = 'none';
  if (!allGrid.length) { $('grid-empty').style.display = 'flex'; $('image-grid').innerHTML = ''; updateCount(0, 0); populateDomains([]); return; }
  $('grid-empty').style.display = 'none';
  populateDomains(allGrid); applyFilters(); probeTypes(); probeFileSizes(); probeMissingDimensions();
}

function updateDerivedMeta(img) {
  const w = img.width || 0, h = img.height || 0;
  img.pixels = w * h;
  img.layout = 'square';
  if (w && h) {
    if (w >= 1.2 * h) img.layout = 'wide';
    else if (h >= 1.2 * w) img.layout = 'tall';
  }
}


function applyFilters() {
  const tf = v('filter-type'), sf = v('filter-size'), lf = v('filter-layout'), df = v('filter-domain');
  const uf = ($('filter-url')?.value || '').trim().toLowerCase();
  filtered = allGrid.filter(img => {
    if (hideDups && img.isDuplicate) return false;
    if (tf !== 'all') { if (tf === 'other') { if (['jpg','png','webp','gif','svg','avif','bmp','tiff','ico'].includes(img.type)) return false; } else if (img.type !== tf) return false; }
    const dim = Math.max(img.width || 0, img.height || 0);
    if (sf !== 'all') {
      if (sf === 'small' && dim >= 200) return false;
      if (sf === 'medium' && (dim < 200 || dim >= 500)) return false;
      if (sf === 'large' && (dim < 500 || dim >= 1200)) return false;
      if (sf === 'xlarge' && dim < 1200) return false;
      if (sf === 'atleast') {
        const minW = parseInt($('atleast-w')?.value, 10) || 0;
        const minH = parseInt($('atleast-h')?.value, 10) || 0;
        const iw = img.width || 0, ih = img.height || 0;
        if (minW > 0 && iw < minW) return false;
        if (minH > 0 && ih < minH) return false;
      }
    }
    if (lf !== 'all' && img.layout !== lf) return false;
    if (df !== 'all' && img.domain !== df) return false;
    if (uf && !img.src.toLowerCase().includes(uf) && !img.filename.toLowerCase().includes(uf)) return false;
    return true;
  });
  if (sort === 'pixels') filtered.sort((a, b) => b.pixels - a.pixels);
  else filtered.sort((a, b) => a.index - b.index);
  renderGrid(); updateCount(filtered.length, allGrid.length); updateActionBar();
}

function renderGrid() {
  const grid = $('image-grid'); grid.innerHTML = '';
  const frag = document.createDocumentFragment();
  filtered.forEach(img => {
    const card = document.createElement('div');
    card.className = 'gcard' + (selected.has(img.src) ? ' selected' : '') + (img.isDuplicate ? ' is-dup' : '');

    const thumb = document.createElement('div'); thumb.className = 'gthumb';
    const pic = document.createElement('img'); pic.loading = 'lazy'; pic.src = img.src;
    pic.addEventListener('load', () => {
      const nw = pic.naturalWidth || 0, nh = pic.naturalHeight || 0;
      if ((!img.width || !img.height) && nw && nh) {
        img.width = nw; img.height = nh; updateDerivedMeta(img); queueGridRefresh();
      }
    });
    pic.addEventListener('error', () => { pic.style.display = 'none'; thumb.textContent = '⚠️'; thumb.style.color = 'var(--overlay0)'; });
    thumb.appendChild(pic);

    const info = document.createElement('div'); info.className = 'ginfo';
    const r1 = document.createElement('div'); r1.className = 'grow1';
    const chk = document.createElement('input'); chk.type = 'checkbox'; chk.className = 'gcheck';
    chk.checked = selected.has(img.src);
    chk.addEventListener('click', e => { e.stopPropagation(); toggleSel(img.src, chk.checked, card); });
    r1.appendChild(chk);
    r1.appendChild(mkTag((img.type || '?').toUpperCase()));
    r1.appendChild(mkTag(img.width && img.height ? `${img.width}×${img.height}` : '…×…', img.width && img.height ? '' : 'tag-pending'));
    r1.appendChild(mkTag(img.fileSize > 0 ? fmtBytes(img.fileSize) : '…', img.fileSize > 0 ? '' : 'tag-pending'));
    if (img.isDuplicate) r1.appendChild(mkTag('DUP', 'tag-dup'));
    // Action buttons
    const acts = document.createElement('div'); acts.className = 'gacts';
    const bTab = document.createElement('button'); bTab.className = 'gact'; bTab.title = _('titleOpenTab');
    bTab.innerHTML = iconOpen();
    bTab.addEventListener('click', e => { e.stopPropagation(); chrome.tabs.create({ url: img.src, active: false }); });
    const dlW = document.createElement('div'); dlW.className = 'gdl-wrap';
    const bDl = document.createElement('button'); bDl.className = 'gact'; bDl.title = _('titleDownloadAs');
    bDl.innerHTML = iconDownload();
    const dlM = document.createElement('div'); dlM.className = 'gdl-menu';
    ['original','png','jpeg','webp'].forEach(f => {
      const o = document.createElement('div'); o.className = 'gdl-opt';
      o.textContent = f === 'original' ? `${_('originalFormat')} (${(img.type || '?').toUpperCase()})` : f.toUpperCase();
      o.addEventListener('click', e => { e.stopPropagation(); dlM.classList.remove('show'); dlOne(img, f); });
      dlM.appendChild(o);
    });
    bDl.addEventListener('click', e => { e.stopPropagation(); document.querySelectorAll('.gdl-menu.show').forEach(m => m.classList.remove('show')); dlM.classList.toggle('show'); });
    dlW.append(bDl, dlM);
    // Google Lens button
    const bLens = document.createElement('button'); bLens.className = 'gact'; bLens.title = _('titleSearchSimilar');
    bLens.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>';
    bLens.addEventListener('click', e => { e.stopPropagation(); if (!img.src.startsWith('data:')) chrome.tabs.create({ url: `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(img.src)}`, active: false }); else toast('⚠️ Lens needs a URL'); });
    acts.append(bTab, dlW, bLens); r1.appendChild(acts);

    const fn = document.createElement('div'); fn.className = 'gfname'; fn.textContent = img.filename; fn.title = img.filename;
    const url = document.createElement('div'); url.className = 'gurl'; url.textContent = img.src;
    url.addEventListener('click', async e => {
      e.stopPropagation();
      try {
        const r = await xmsg({ action: 'copyTextToClipboard', text: img.src });
        if (r?.error) throw new Error(r.error);
        toast('✅ ' + _('notifCopied'));
      } catch (err) {
        toast(`❌ ${err.message}`);
      }
    });

    info.append(r1, fn, url);
    card.addEventListener('click', () => openPreview(img));
    card.append(thumb, info); frag.appendChild(card);
  });
  grid.appendChild(frag);
}
function mkTag(txt, cls) { const s = document.createElement('span'); s.className = 'tag' + (cls ? ' ' + cls : ''); s.textContent = txt; return s; }

async function dlOne(img, fmt) {
  const s = await getSettings();
  // Apply convert-on-download if set and format is 'original'
  if (fmt === 'original' && s.convertOnDl && s.convertOnDl !== 'none') fmt = s.convertOnDl;
  const ins = buildIns(fmt, img, s); ins.jpgBackground = '#FFFFFF';
  // Pass download options
  ins.subfolder = s.subfolder || '';
  ins.filenamePattern = s.filenamePattern || 'original';
  ins.filenamePrefix = s.filenamePrefix || 'img_';
  const r = await xmsg({ action: 'processAndSave', imageUrl: img.src, instructions: ins });
  toast(r?.error ? `❌ ${r.error}` : '✅ ' + _('notifSavedAs', [(fmt === 'original' ? img.type : fmt).toUpperCase()]));
}

function updateCount(n, total) {
  $('grid-count').textContent = _('imagesFound', [String(n)]) + (n < total ? ` (${total})` : '');
}

// ===== Domains / Probing =====
function populateDomains(imgs) {
  const sel = $('filter-domain'), cur = sel.value, c = new Map();
  imgs.forEach(i => { const d = i.domain || '?'; c.set(d, (c.get(d) || 0) + 1); });
  sel.innerHTML = ''; const all = document.createElement('option'); all.value = 'all'; all.textContent = _('filterAll'); sel.appendChild(all);
  [...c.entries()].sort((a, b) => b[1] - a[1]).forEach(([d, n]) => {
    const o = document.createElement('option'); o.value = d; o.textContent = `${d.length > 20 ? d.substring(0, 18) + '…' : d} (${n})`; sel.appendChild(o);
  });
  if (cur !== 'all' && c.has(cur)) sel.value = cur;
}
async function probeTypes() {
  const unk = allGrid.filter(i => i.type === 'other').slice(0, 30); if (!unk.length) return;
  try { const m = await xmsg({ action: 'probeImageTypes', urls: unk.map(i => i.src) }); if (!m || typeof m !== 'object') return; let ch = false; allGrid.forEach(i => { if (m[i.src] && i.type === 'other') { i.type = m[i.src]; ch = true; } }); if (ch) applyFilters(); } catch {}
}

let gridRefreshTimer = null;
function queueGridRefresh() {
  clearTimeout(gridRefreshTimer);
  gridRefreshTimer = setTimeout(() => applyFilters(), 120);
}

async function probeFileSizes() {
  const missing = allGrid.filter(i => !i.fileSize).map(i => i.src);
  if (!missing.length) return;
  try {
    const m = await xmsg({ action: 'probeImageSizes', urls: missing });
    if (!m || typeof m !== 'object') return;
    let changed = false;
    allGrid.forEach(i => {
      if (!i.fileSize && m[i.src]) {
        i.fileSize = m[i.src];
        changed = true;
      }
    });
    if (changed) queueGridRefresh();
  } catch {}
}


async function probeMissingDimensions() {
  const pending = allGrid.filter(i => !(i.width > 0 && i.height > 0)).slice(0, 160);
  if (!pending.length) return;
  let changed = false;
  await mapLimit(pending, 8, async (img) => {
    try {
      const dims = await loadNaturalDimensions(img.src);
      if (dims.width > 0 && dims.height > 0) {
        img.width = dims.width;
        img.height = dims.height;
        updateDerivedMeta(img);
        changed = true;
      }
    } catch {}
  });
  if (changed) queueGridRefresh();
}

async function loadNaturalDimensions(src) {
  const direct = await loadDimsFromUrl(src).catch(() => null);
  if (direct?.width > 0 && direct?.height > 0) return direct;

  const fetched = await xmsg({ action: 'fetchAsDataUrl', imageUrl: src }).catch(() => null);
  if (fetched?.dataUrl) {
    const viaDataUrl = await loadDimsFromUrl(fetched.dataUrl).catch(() => null);
    if (viaDataUrl?.width > 0 && viaDataUrl?.height > 0) return viaDataUrl;
  }

  throw new Error('Image metadata failed');
}

function loadDimsFromUrl(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    const timeout = setTimeout(() => { img.src = ''; reject(new Error('Timeout')); }, 8000);
    img.onload = () => { clearTimeout(timeout); resolve({ width: img.naturalWidth || 0, height: img.naturalHeight || 0 }); };
    img.onerror = () => { clearTimeout(timeout); reject(new Error('Image metadata failed')); };
    img.src = src;
  });
}

async function mapLimit(items, limit, worker) {
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index++];
      await worker(current);
    }
  });
  await Promise.all(runners);
}

function iconOpen() {
  return `<svg class="gact-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M14 5h5v5"/><path d="M10 14 19 5"/><path d="M19 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4"/></svg>`;
}

function iconDownload() {
  return `<svg class="gact-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 4v10"/><path d="m8 10 4 4 4-4"/><path d="M5 19h14"/></svg>`;
}

// ===== Selection =====
function toggleSel(src, on, card) {
  if (on) { selected.add(src); card.classList.add('selected'); }
  else { selected.delete(src); card.classList.remove('selected'); }
  updateActionBar();
  syncHighlights();
}

// Send selected image URLs to content script for page highlighting
function syncHighlights() {
  chrome.runtime.sendMessage({ action: 'highlightImages', urls: [...selected] });
}

// ===== Action Bar =====
function initActionBar() {
  $('action-download')?.addEventListener('click', async () => {
    const s = await getSettings();
    batchDl(!!s.zipDefault);
  });
  $('action-zip')?.addEventListener('click', () => batchDl(true));
}
function updateActionBar() {
  const bar = $('action-bar'), n = selected.size;
  bar.style.display = (n > 0 && document.querySelector('.tab.active')?.dataset.tab === 'images') ? 'flex' : 'none';
  $('action-bar-count').textContent = String(n);
}
async function batchDl(zip) {
  const sel = allGrid.filter(i => selected.has(i.src)); if (!sel.length) return;
  const fmt = v('action-format'), pE = $('batch-progress'), pT = $('progress-text'), pC = $('progress-count'), pF = $('progress-fill');
  pE.style.display = 'block'; pF.style.width = '0%'; pF.classList.remove('prog-done');
  const s = await getSettings(), zips = [];
  for (let i = 0; i < sel.length; i++) {
    pC.textContent = `${i + 1}/${sel.length}`; pF.style.width = `${Math.round(((i + 1) / sel.length) * 100)}%`;
    pT.textContent = zip ? _('preparingZip') : `${_('processing')} ${i + 1}...`;
    try {
      let f = fmt;
      if (f === 'original' && s.convertOnDl && s.convertOnDl !== 'none') f = s.convertOnDl;
      const ins = buildIns(f, sel[i], s);
      ins.subfolder = s.subfolder || '';
      ins.filenamePattern = s.filenamePattern || 'original';
      ins.filenamePrefix = s.filenamePrefix || 'img_';
      if (zip) { const r = await xmsg({ action: 'processAndReturnData', imageUrl: sel[i].src, instructions: ins }); if (r && !r.error) zips.push({ name: zipNm(sel[i].src, ins, i), dataUrl: r.dataUrl }); }
      else await xmsg({ action: 'processAndSave', imageUrl: sel[i].src, instructions: ins });
    } catch {}
    await sleep(80);
  }
  if (zip && zips.length) { pT.textContent = _('creatingZip'); await mkZip(zips); }
  pT.textContent = '✅'; pF.style.width = '100%'; pF.classList.add('prog-done');
  setTimeout(() => { pE.style.display = 'none'; pF.classList.remove('prog-done'); }, 2500);
}
function buildIns(fmt, img, s) { if (fmt === 'original') return { format: img.type === 'jpg' ? 'jpeg' : (img.type || 'png'), quality: s.defaultQuality / 100 }; return { format: fmt === 'jpg' ? 'jpeg' : fmt, quality: s.defaultQuality / 100 }; }

// ===== Preview =====
let pvImg = null;
function initPreviewModal() {
  $('preview-backdrop')?.addEventListener('click', closePv);
  $('preview-close')?.addEventListener('click', closePv);
  $('preview-download')?.addEventListener('click', pvDl);
  $('preview-copy')?.addEventListener('click', pvCopy);
  $('preview-resize')?.addEventListener('click', pvRsz);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closePv(); });
}
function openPreview(img) {
  pvImg = img; $('preview-img').src = img.src;
  $('preview-filename').textContent = img.filename; $('preview-filename').title = img.src;
  let dt = (img.width && img.height) ? `${img.width} × ${img.height}` : '—';
  if (img.fileSize > 0) dt += ` · ${fmtBytes(img.fileSize)}`;
  $('preview-dimensions').textContent = dt;
  $('preview-type').textContent = (img.type || '?').toUpperCase();
  $('preview-modal').style.display = 'flex';
}
function closePv() { $('preview-modal').style.display = 'none'; pvImg = null; }
async function pvDl() { if (!pvImg) return; const s = await getSettings(), ins = buildIns(v('preview-format'), pvImg, s); ins.jpgBackground = '#FFFFFF'; const b = $('preview-download'); b.disabled = true; xmsg({ action: 'processAndSave', imageUrl: pvImg.src, instructions: ins }).then(r => { b.disabled = false; toast(r?.error ? `❌ ${r.error}` : '✅ ' + _('notifSavedAs', [''])); }); }
async function pvCopy() {
  if (!pvImg) return;
  try {
    await copyImageFromSource(pvImg.src);
    toast('✅ ' + _('notifCopied'));
  } catch (err) {
    toast(`❌ ${err.message}`);
  }
}
function pvRsz() { if (!pvImg) return; chrome.runtime.sendMessage({ action: 'openCustomResize', imageUrl: pvImg.src }); closePv(); }

// ===== Convert =====
// ===== Tools — Unified Image Source =====
let toolSrc = ''; // URL or data URL
let toolRatio = 0;

function initUrlConvert() {
  const dropZone = $('drop-zone'), fileInput = $('file-input'), urlInput = $('tool-url-input');
  const preview = $('tool-preview'), pvImg = $('tool-preview-img'), pvInfo = $('tool-preview-info'), pvClear = $('tool-preview-clear');
  const fmt = $('url-format-select');
  const wI = $('resize-url-w'), hI = $('resize-url-h'), lock = $('resize-url-lock');

  // Drop zone click → file input
  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.classList.remove('drag-over'); if (e.dataTransfer.files.length) loadFile(e.dataTransfer.files[0]); });
  fileInput.addEventListener('change', () => { if (fileInput.files.length) loadFile(fileInput.files[0]); });

  // URL input
  urlInput.addEventListener('change', () => { const u = urlInput.value.trim(); if (u && isUrl(u)) loadUrl(u); });
  urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') { const u = urlInput.value.trim(); if (u && isUrl(u)) loadUrl(u); } });
  urlInput.addEventListener('input', debounce(() => { const u = urlInput.value.trim(); if (u && isUrl(u)) runAdvisor(u); else $('format-advisor').style.display = 'none'; }, 500));

  // Clear
  pvClear.addEventListener('click', () => { toolSrc = ''; toolRatio = 0; preview.style.display = 'none'; urlInput.value = ''; wI.value = ''; hI.value = ''; $('format-advisor').style.display = 'none'; });

  function loadFile(file) {
    const reader = new FileReader();
    reader.onload = () => { setSource(reader.result, file.name); };
    reader.readAsDataURL(file);
  }
  function loadUrl(url) { setSource(url, extractFn(url)); }
  async function setSource(src, name) {
    toolSrc = src; urlInput.value = src.startsWith('data:') ? '' : src;
    pvImg.src = src; pvInfo.textContent = name; preview.style.display = 'flex';
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = async () => {
      toolRatio = img.naturalWidth / img.naturalHeight;
      wI.value = img.naturalWidth; hI.value = img.naturalHeight;
      const meta = [`${img.naturalWidth}×${img.naturalHeight}`];
      try {
        if (src.startsWith('data:')) {
          const size = (await fetch(src).then(r => r.blob())).size || 0;
          if (size > 0) meta.push(fmtBytes(size));
        } else {
          const map = await xmsg({ action: 'probeImageSizes', urls: [src] });
          if (map && map[src] > 0) meta.push(fmtBytes(map[src]));
          runAdvisor(src);
        }
      } catch {}
      pvInfo.textContent = `${name} — ${meta.join(' · ')}`;
    };
    img.src = src;
  }

  // Convert
  $('btn-convert-url')?.addEventListener('click', () => cvtTool('save'));

  // Resize
  wI.addEventListener('input', () => { if (lock.checked && toolRatio) hI.value = Math.round(parseInt(wI.value, 10) / toolRatio) || ''; });
  hI.addEventListener('input', () => { if (lock.checked && toolRatio) wI.value = Math.round(parseInt(hI.value, 10) * toolRatio) || ''; });
  $('btn-resize-url')?.addEventListener('click', resizeTool);

  // Open crop tool
  $('btn-open-crop')?.addEventListener('click', () => {
    if (!toolSrc) { toast('❌ ' + _('errorNoImage')); return; }
    chrome.runtime.sendMessage({ action: 'openCustomResize', imageUrl: toolSrc });
  });
}


async function cvtTool(mode) {
  const src = toolSrc || $('tool-url-input')?.value.trim();
  if (!src) {
    $('tool-url-input')?.classList.add('input-error');
    setTimeout(() => $('tool-url-input')?.classList.remove('input-error'), 1500);
    return;
  }
  const fmt = $('url-format-select');
  const btn = $('btn-convert-url');
  btn.disabled = true;
  const orig = btn.innerHTML;
  btn.textContent = _('processing') + '…';
  const s = await getSettings();
  const ins = { format: fmt.value, quality: s.defaultQuality / 100, jpgBackground: '#FFFFFF' };

  try {
    const r = await xmsg({ action: 'processAndSave', imageUrl: src, instructions: ins });
    if (r?.error) throw new Error(r.error);
    toast('✅ ' + _('notifSavedAs', [fmt.value.toUpperCase()]));
  } catch (err) {
    toast(`❌ ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
  }
}

async function resizeTool() {

  const src = toolSrc || $('tool-url-input')?.value.trim();
  if (!src) { $('tool-url-input')?.classList.add('input-error'); setTimeout(() => $('tool-url-input')?.classList.remove('input-error'), 1500); return; }
  const w = parseInt($('resize-url-w').value, 10), lock = $('resize-url-lock');
  if (!w || w < 1) { $('resize-url-w').classList.add('input-error'); setTimeout(() => $('resize-url-w').classList.remove('input-error'), 1500); return; }
  const btn = $('btn-resize-url'); btn.disabled = true; const orig = btn.innerHTML; btn.textContent = _('processing') + '…';
  try { const s = await getSettings(); const r = await xmsg({ action: 'processAndSave', imageUrl: src, instructions: { format: s.defaultFormat || 'webp', quality: s.defaultQuality / 100, width: w, height: lock.checked ? null : (parseInt($('resize-url-h').value, 10) || null), jpgBackground: '#FFFFFF' } });
  btn.disabled = false; btn.innerHTML = orig; toast(r?.error ? `❌ ${r.error}` : '✅ ' + _('notifSavedAs', [''])); } catch (e) { btn.disabled = false; btn.innerHTML = orig; toast(`❌ ${e.message}`); }
}

function initResizeUrl() {} // Merged into initUrlConvert

async function runAdvisor(url) {
  const a = $('format-advisor'), rec = $('advisor-recommendation'), gr = $('advisor-sizes');
  a.style.display = 'block'; rec.textContent = _('analyzing'); gr.innerHTML = '';
  try { const res = []; for (const f of ['png','jpeg','webp']) { const r = await xmsg({ action: 'processAndReturnData', imageUrl: url, instructions: { format: f, quality: 0.85 } }); if (r && !r.error) res.push({ format: f === 'jpeg' ? 'JPG' : f.toUpperCase(), size: r.newSize, hasAlpha: r.hasAlpha }); }
  if (!res.length) { a.style.display = 'none'; return; } res.sort((a, b) => a.size - b.size); const sm = res[0];
  rec.textContent = res.some(r => r.hasAlpha) ? _('advisorAlpha') : _('advisorSmallest').replace('{format}', sm.format).replace('{size}', fmtBytes(sm.size));
  gr.innerHTML = res.map(r => `<div class="advisor-item${r === sm ? ' advisor-best' : ''}"><strong>${r.format}</strong><span>${fmtBytes(r.size)}</span></div>`).join('');
  } catch { a.style.display = 'none'; }
}

// ===== Settings =====
function initSettings() {
  const qr = $('setting-quality'), qv = $('quality-value'), df = $('setting-default-format'), rb = $('setting-resize-behavior');
  const sa = $('setting-save-as'), sn = $('setting-show-notif'), sp = $('setting-open-sidepanel'), ts = $('setting-theme');
  const lg = $('setting-language');
  // Download options
  const sf = $('setting-subfolder'), fn = $('setting-filename'), px = $('setting-prefix'), cd = $('setting-convert-dl'), zd = $('setting-zip-default');
  const pxRow = $('custom-prefix-row');

  getSettings().then(s => {
    qr.value = s.defaultQuality; qv.textContent = s.defaultQuality + '%';
    df.value = s.defaultFormat || 'webp'; rb.value = s.resizeBehavior || 'crop';
    sa.checked = s.saveAs !== false; sn.checked = s.showNotification !== false;
    sp.checked = s.openAsSidePanel !== false; ts.value = s.theme || 'auto';
    if (lg) lg.value = s.locale || 'auto';
    // Download options
    if (sf) sf.value = s.subfolder || '';
    if (fn) { fn.value = s.filenamePattern || 'original'; pxRow.style.display = fn.value === 'custom' ? '' : 'none'; }
    if (px) px.value = s.filenamePrefix || 'img_';
    if (cd) cd.value = s.convertOnDl || 'none';
    if (zd) zd.checked = !!s.zipDefault;
  });

  qr.addEventListener('input', () => { qv.textContent = qr.value + '%'; });
  ts.addEventListener('change', () => applyTheme(ts.value));
  if (fn) fn.addEventListener('change', () => { pxRow.style.display = fn.value === 'custom' ? '' : 'none'; });
  if (lg) lg.addEventListener('change', async () => {
    await loadCustomLocale(lg.value);
    localizeUI();
  });

  const save = () => chrome.storage.sync.set({ settings: {
    defaultQuality: parseInt(qr.value, 10), defaultFormat: df.value, resizeBehavior: rb.value,
    saveAs: sa.checked, showNotification: sn.checked, openAsSidePanel: sp.checked, theme: ts.value,
    locale: lg?.value || 'auto',
    jpgBackground: '#FFFFFF', enableSocialPresets: true,
    subfolder: sf?.value || '', filenamePattern: fn?.value || 'original',
    filenamePrefix: px?.value || 'img_', convertOnDl: cd?.value || 'none', zipDefault: zd?.checked || false,
  }});
  [qr, df, rb, sa, sn, sp, ts, lg, sf, fn, px, cd, zd].filter(Boolean).forEach(el => el.addEventListener('change', save));
}


async function copyImageFromSource(src) {
  if (src.startsWith('data:')) {
    const r = await xmsg({ action: 'copyDataUrlToClipboard', dataUrl: src });
    if (r?.error) throw new Error(r.error);
    return true;
  }
  const r = await xmsg({ action: 'copyToClipboard', imageUrl: src });
  if (r?.error) throw new Error(r.error);
  return true;
}

// ===== ZIP =====
function zipNm(url, ins, i) { let b = 'image'; try { b = new URL(url).pathname.split('/').pop().split('?')[0]; b = b.replace(/\.[^.]+$/, '') || 'image'; b = b.replace(/[^a-zA-Z0-9_\-]/g, '_').substring(0, 40); } catch {} return `${String(i + 1).padStart(3, '0')}_${b}.${ins.format === 'jpeg' ? 'jpg' : ins.format || 'png'}`; }
async function mkZip(files) { if (typeof JSZip === 'undefined') return; const z = new JSZip(); for (const f of files) z.file(f.name, f.dataUrl.split(',')[1], { base64: true }); const b = await z.generateAsync({ type: 'blob' }); const u = URL.createObjectURL(b); chrome.runtime.sendMessage({ action: 'downloadBlob', dataUrl: u, filename: `imagetoolkit-${Date.now()}.zip`, saveAs: true }); setTimeout(() => URL.revokeObjectURL(u), 10000); }

// ===== Utility =====
function $(id) { return document.getElementById(id); }
function v(id) { return $(id)?.value || 'all'; }
function detectType(u) {
  // Handle data: URLs
  if (u.startsWith('data:image/')) {
    const mime = u.substring(11, u.indexOf(';')).toLowerCase();
    const m = { 'svg+xml':'svg','jpeg':'jpg','png':'png','webp':'webp','gif':'gif','avif':'avif','bmp':'bmp' };
    return m[mime] || 'other';
  }
  try { const e = new URL(u).pathname.toLowerCase().split('.').pop().split('?')[0]; const m = { jpg:'jpg',jpeg:'jpg',jpe:'jpg',png:'png',webp:'webp',gif:'gif',svg:'svg',avif:'avif',bmp:'bmp',tiff:'tiff',tif:'tiff',ico:'ico' }; return m[e] || 'other'; } catch { return 'other'; }
}
function extractFn(u) {
  if (u.startsWith('data:image/')) {
    const mime = u.substring(11, u.indexOf(';')).replace('+xml', '');
    return `inline.${mime}`;
  }
  try { let n = decodeURIComponent(new URL(u).pathname.split('/').pop().split('?')[0]); if (!n || n === '/') return 'image'; if (n.length > 35) n = n.substring(0, 32) + '…'; return n; } catch { return 'image'; }
}
function extractDomain(u) {
  if (u.startsWith('data:')) return 'data:';
  try { return new URL(u).hostname; } catch { return '?'; }
}
function normUrl(u) { try { const p = new URL(u); const k = []; p.searchParams.sort(); for (const [key, val] of p.searchParams) { if (TP.has(key.toLowerCase())) k.push(`${key}=${val}`); } return (p.hostname + p.pathname + (k.length ? '?' + k.join('&') : '')).replace(/\/+$/, '').toLowerCase(); } catch { return u; } }
function getSettings() { return new Promise(r => chrome.runtime.sendMessage({ action: 'getSettings' }, s => r(s || {}))); }
function xmsg(m) { return new Promise(r => chrome.runtime.sendMessage(m, res => r(res))); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function isUrl(s) { try { return /^https?:/.test(new URL(s).protocol); } catch { return false; } }
function fmtBytes(b) { if (!b || b < 0) return '0 B'; if (b < 1024) return b + ' B'; if (b < 1048576) return (b / 1024).toFixed(1) + ' KB'; return (b / 1048576).toFixed(2) + ' MB'; }
function toast(m) { let t = document.querySelector('.toast'); if (!t) { t = document.createElement('div'); t.className = 'toast'; (document.getElementById('app') || document.body).appendChild(t); } t.textContent = m; t.classList.add('toast-visible'); setTimeout(() => t.classList.remove('toast-visible'), 2500); }
