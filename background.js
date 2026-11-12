// ============================================================
// ImageToolkit – Background Service Worker
// Context menus · Commands · Message routing · Offscreen management · Downloads
// ============================================================

'use strict';

importScripts('lib/core.js', 'lib/i18n.js', 'lib/handoff.js');

const { i18n, handoff } = ITK;
const t = i18n.t;

// ---------- Constants ----------
const MENU_FORMATS = ['png', 'jpg', 'webp', 'avif'];
const MAX_FETCH_BYTES = ITK.MAX_IMAGE_BYTES;

const DEFAULT_SETTINGS = {
  defaultQuality: 85,
  defaultFormat: 'webp',
  saveAs: true,
  jpgBackground: '#FFFFFF',
  resizeBehavior: 'crop',
  showNotification: true,
  theme: 'auto',
  locale: 'auto',
  openAsSidePanel: true,
  enableGoogleLens: false,
  subfolder: '',
  filenamePattern: 'original',
  filenamePrefix: 'img_',
  filenameTemplate: '{name}',
  convertOnDl: 'none',
  zipDefault: false,
};

// ---------- Settings ----------
async function getSettings() {
  const { settings } = await chrome.storage.sync.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

async function loadSettingsAndLocale() {
  const settings = await getSettings();
  await i18n.load(settings.locale);
  return settings;
}

// ---------- Context Menus ----------
async function buildContextMenus() {
  const settings = await loadSettingsAndLocale();
  await chrome.contextMenus.removeAll();

  const add = (props) => chrome.contextMenus.create(props, () => void chrome.runtime.lastError);
  const image = { contexts: ['image'] };

  add({ id: 'imagetoolkit-parent', title: t('menuParent'), ...image });
  const formats = await ITK.encodableFormats();
  MENU_FORMATS.filter((fmt) => formats.has(fmt === 'jpg' ? 'jpeg' : fmt)).forEach((fmt) => {
    add({ id: `save-as-${fmt}`, title: t('menuSaveAs', [fmt.toUpperCase()]), parentId: 'imagetoolkit-parent', ...image });
  });
  add({ id: 'sep-1', type: 'separator', parentId: 'imagetoolkit-parent', ...image });
  add({ id: 'copy-to-clipboard', title: t('menuCopyClipboard'), parentId: 'imagetoolkit-parent', ...image });
  add({ id: 'sep-2', type: 'separator', parentId: 'imagetoolkit-parent', ...image });
  add({ id: 'resize-1080', title: t('menuResize1080'), parentId: 'imagetoolkit-parent', ...image });
  add({ id: 'custom-resize', title: t('menuCustomResize'), parentId: 'imagetoolkit-parent', ...image });
  if (settings.enableGoogleLens) {
    add({ id: 'sep-3', type: 'separator', parentId: 'imagetoolkit-parent', ...image });
    add({ id: 'google-lens', title: t('titleSearchSimilar'), parentId: 'imagetoolkit-parent', ...image });
  }

  // Right-click on the toolbar icon
  add({ id: 'action-capture-area', title: t('titleCapture'), contexts: ['action'] });
  add({ id: 'action-capture-visible', title: t('captureVisible'), contexts: ['action'] });
  add({ id: 'action-capture-full', title: t('captureFullPage'), contexts: ['action'] });
}

// 2.3.5 and earlier passed the image to the editor through chrome.storage.local and only
// removed it once the editor loaded it; IndexedDB handoff replaced that. Safe to run repeatedly.
function cleanupLegacyStorage() {
  return chrome.storage.local.remove('_resizeImageUrl').catch(() => {});
}

chrome.runtime.onInstalled.addListener(async () => {
  await cleanupLegacyStorage();
  const { settings } = await chrome.storage.sync.get('settings');
  if (!settings) await chrome.storage.sync.set({ settings: DEFAULT_SETTINGS });
  await buildContextMenus();
  applySidePanelBehavior(await getSettings());
});

// Images the extension's own pages show by themselves (thumbnails, previews, size probes) load
// without cookies, and cannot set any: Chrome would otherwise send the user's cookies with them,
// SameSite=Lax ones included. Actions the user asks for (save, copy, edit) use fetch(), which
// this rule does not touch, so images behind a login keep working there.
const NO_COOKIE_RULE_ID = 1;
function addNoCookieRule() {
  return chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [NO_COOKIE_RULE_ID],
    addRules: [{
      id: NO_COOKIE_RULE_ID,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [{ header: 'cookie', operation: 'remove' }],
        responseHeaders: [{ header: 'set-cookie', operation: 'remove' }],
      },
      condition: { initiatorDomains: [chrome.runtime.id], resourceTypes: ['image'] },
    }],
  });
}

// Resolves to true once the rule is in place (tried twice), false if Chrome refused it. Pages
// that show remote images ask for it first ('imagesReady') and, without it, load nothing
// directly: every thumbnail then goes through the cookie-less fetch instead.
let noCookieRule = null;
function installNoCookieRule() {
  noCookieRule ??= addNoCookieRule()
    .catch(() => addNoCookieRule())
    .then(() => true, (err) => {
      console.error('ImageToolkit: the no-cookie rule for thumbnails could not be installed', err);
      noCookieRule = null; // asked again next time
      return false;
    });
  return noCookieRule;
}

// Keep runtime-only Chrome settings in sync whenever the service worker wakes up.
async function initializeExtensionRuntime() {
  installNoCookieRule();
  const settings = await loadSettingsAndLocale();
  applySidePanelBehavior(settings);
  handoff.prune().catch(() => {});
  cleanupLegacyStorage();
}

initializeExtensionRuntime().catch(() => {});
chrome.runtime.onStartup.addListener(() => {
  initializeExtensionRuntime().catch(() => {});
});

function applySidePanelBehavior(settings) {
  const openAsPanel = settings.openAsSidePanel !== false;
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: openAsPanel }).catch(() => {});
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'sync' || !changes.settings?.newValue) return;
  const next = changes.settings.newValue;
  const prev = changes.settings.oldValue || {};
  applySidePanelBehavior(next);

  const localeChanged = (prev.locale || 'auto') !== (next.locale || 'auto');
  const lensChanged = !!prev.enableGoogleLens !== !!next.enableGoogleLens;
  if (localeChanged || lensChanged) buildContextMenus().catch(() => {});
});

// ---------- Context Menu Click Handler ----------
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const settings = await loadSettingsAndLocale();
  const id = String(info.menuItemId);

  if (id === 'action-capture-area') { startCapture(tab?.id).catch(() => {}); return; }
  if (id === 'action-capture-visible') { captureVisible(tab?.id).catch(() => {}); return; }
  if (id === 'action-capture-full') { captureFullPage(tab?.id).catch(() => {}); return; }

  const imageUrl = info.srcUrl;
  if (!imageUrl) {
    notify(t('errorNoImage'), { error: true });
    return;
  }

  if (id === 'custom-resize') { openEditor(imageUrl, { site: hostOf(tab?.url), title: tab?.title || '', opener: tab }); return; }
  if (id === 'google-lens') { openGoogleLens(imageUrl, tab); return; }
  if (id === 'copy-to-clipboard') { await copyImageUrl(imageUrl, tab?.id, settings); return; }

  // The page the image was saved from, for {site} and {title} in filename templates.
  let pageHost = '';
  try { pageHost = new URL(tab?.url || '').hostname; } catch {}
  let instructions = {};
  if (id.startsWith('save-as-')) {
    const fmt = id.replace('save-as-', '');
    instructions = { format: fmt === 'jpg' ? 'jpeg' : fmt };
  } else if (id === 'resize-1080') {
    instructions = { format: 'jpeg', resizeWidth: 1080 };
  }

  await processAndSave(imageUrl, { ...instructions, pageHost, pageTitle: tab?.title || '' }, settings);
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === 'capture-area') startCapture(tab?.id).catch(() => {});
  if (command === 'capture-full-page') captureFullPage(tab?.id).catch(() => {});
});

// ---------- Message Handler ----------
// Content scripts run inside the page's renderer, so they may only trigger the
// few actions they actually need. Everything else is reserved for extension pages.
const EXTENSION_ORIGIN = chrome.runtime.getURL('');
const CONTENT_SCRIPT_ACTIONS = new Set(['captureSelection', 'newImagesDetected', 'autoScrollProgress']);

function isExtensionPage(sender) {
  return ITK.isExtensionSender(sender, chrome.runtime.id, EXTENSION_ORIGIN);
}

// Handlers return a value or a promise; the result is sent back to the caller.
const handlers = {
  getSettings: () => getSettings(),
  imagesReady: async () => ({ ok: await installNoCookieRule() }),

  processAndSave: (msg) => processAndSave(msg.imageUrl, msg.instructions, null),

  processAndReturnData: (msg) => {
    const instructions = ITK.sanitizeInstructions(msg.instructions);
    return instructions.passthrough ? fetchOriginal(msg.imageUrl) : processImage(msg.imageUrl, instructions);
  },

  // Keyed by the calling document, so one window never cancels another's analysis.
  analyzeFormats: (msg, sender) => analyzeFormats(msg.imageUrl, analysisKey(sender)),
  cancelAnalysis: (msg, sender) => { analysisControllers.get(analysisKey(sender))?.abort(); return { success: true }; },

  // `maxBytes` lets previews and metadata ask for less than a full-size download.
  // `automatic` (previews, dimensions): no cookies and a shorter time limit.
  // A failure also says how many bytes were received, so the panel's preview budget is charged
  // for what was really downloaded, not refunded.
  fetchAsDataUrl: async (msg) => {
    const maxBytes = Math.min(MAX_FETCH_BYTES, Math.max(1, Number(msg.maxBytes) || MAX_FETCH_BYTES));
    try {
      const blob = await fetchImageBlob(msg.imageUrl, msg.automatic ? { maxBytes, cookies: false, totalMs: 20000 } : { maxBytes });
      return { dataUrl: await blobToDataUrl(blob), size: blob.size };
    } catch (err) {
      return { error: err.message, bytesRead: Number.isFinite(err.bytesRead) ? err.bytesRead : null };
    }
  },

  downloadBlob: (msg) => {
    const url = typeof msg.dataUrl === 'string' ? msg.dataUrl : '';
    if (!/^data:(image\/[a-z0-9.+-]+|application\/zip);/i.test(url)) return { error: 'Unsupported download URL' };
    const filename = ITK.sanitizeFilename(msg.filename || 'download', true) || 'download';
    return triggerDownload(url, filename, msg.saveAs !== false).then((id) => (id == null ? { cancelled: true } : { success: true, downloadId: id }));
  },

  // Files too large for one message: the page parked them in the handoff store.
  downloadHandoff: (msg) => downloadHandoff(String(msg.key || ''), msg.filename, msg.saveAs !== false),

  collectImages: (msg) => collectImages(msg.tabId),
  collectWindowImages: (msg) => collectWindowImages(msg.windowId, msg.extra),
  autoScroll: (msg) => autoScroll(msg.tabId),
  stopAutoScroll: (msg) => stopAutoScroll(msg.tabId),

  startCapture: (msg) => startCapture(msg.tabId, msg.delay),
  captureVisible: (msg) => captureVisible(msg.tabId, msg.delay),
  captureFullPage: (msg) => captureFullPage(msg.tabId),
  // Esc in the panel (where the focus is after clicking its button) stops a full-page capture.
  cancelFullPage: () => { fullPageCancelled = true; return { success: true }; },
  openEditor: (msg) => openEditor(msg.imageUrl, { site: msg.site, title: msg.title }).then(() => ({ success: true })),

  copyDataUrlToClipboard: (msg) => offscreenRequest({ action: 'offscreen-copy', imageDataUrl: msg.dataUrl }, 15000),
  copyTextToClipboard: (msg) => offscreenRequest({ action: 'offscreen-copy-text', text: String(msg.text || '') }, 15000),

  probeImageSizes: (msg) => probeImageSizes(msg.urls || []),
  probeImageTypes: (msg) => probeImageTypes(msg.urls || []),

  // ----- From content scripts -----
  captureSelection: (msg, sender) => captureSelection(sender.tab, msg.rect, sender.frameId),
  autoScrollProgress: (msg, sender) => {
    const pct = Math.max(0, Math.min(100, Math.round(Number(msg.pct) || 0)));
    chrome.runtime.sendMessage({ action: 'autoScrollProgressUpdate', tabId: sender.tab?.id, pct }).catch(() => {});
  },
  newImagesDetected: (msg, sender) => {
    chrome.runtime.sendMessage({ action: 'newImagesAvailable', tabId: sender.tab?.id, windowId: sender.tab?.windowId, count: msg.count || 0 }).catch(() => {});
  },
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { action } = message || {};

  const handler = Object.prototype.hasOwnProperty.call(handlers, action) ? handlers[action] : null;
  if (!handler) return false;
  if (!isExtensionPage(sender) && !CONTENT_SCRIPT_ACTIONS.has(action)) return false;

  Promise.resolve()
    .then(() => handler(message, sender))
    .then((result) => sendResponse(result ?? { success: true }))
    .catch((err) => sendResponse({ error: err?.message || String(err) }));
  return true;
});

// ---------- Image Scanner ----------
// Every frame of the tab is scanned (iframes included), each with the scanner injected once.
// The page's own frame comes first; the merged list keeps the scan's overall budget.
const SCANNER_FILES = ['lib/core.js', 'content.js'];

async function collectImages(tabId) {
  if (!Number.isInteger(tabId)) return { images: [], error: 'noTab' };

  let probes;
  try {
    probes = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: () => !!globalThis.__imagetoolkitScan });
  } catch {
    // The page itself cannot be scripted (browser pages, the Web Store…).
    return { images: [], error: 'restricted' };
  }
  const missing = probes.filter((p) => p.result !== true).map((p) => p.frameId);
  if (missing.length) {
    await chrome.scripting.executeScript({ target: { tabId, frameIds: missing }, files: SCANNER_FILES })
      .catch(() => chrome.scripting.executeScript({ target: { tabId }, files: SCANNER_FILES }).catch(() => {}));
  }

  const scans = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => globalThis.__imagetoolkitScan?.() ?? null,
  }).catch(() => []);
  scans.sort((a, b) => (a.frameId === 0 ? -1 : b.frameId === 0 ? 1 : a.frameId - b.frameId));
  return mergeScans(scans.map((s) => s.result).filter(Boolean));
}

// Every web page open in one window, a few tabs at a time. Each image keeps its tab and that
// page's site and title (for the tab filter and for {site}/{title} in file names). Browser
// pages and tabs Chrome has put to sleep are skipped and counted.
// `extra` ({ tabId, images }): what auto-scroll gathered in one tab, kept even when a feed has
// since unloaded it from the page (a fresh scan alone would only see what is left).
async function collectWindowImages(windowId, extra = null) {
  if (!Number.isInteger(windowId)) return { images: [], error: 'noTab' };
  const extraImages = Number.isInteger(extra?.tabId) && Array.isArray(extra.images)
    ? extra.images.filter((img) => typeof img?.src === 'string').slice(0, ITK.SCAN_MAX_ITEMS)
    : [];
  const tabs = await chrome.tabs.query({ windowId });
  const targets = tabs.filter((tab) => /^https?:/i.test(tab.url || '') && !tab.discarded);
  let skipped = tabs.length - targets.length;
  const scans = [];
  await ITK.mapLimit(targets, 3, async (tab) => {
    let result = await collectImages(tab.id);
    if (result.error) { skipped++; return; }
    if (extraImages.length && tab.id === extra.tabId) result = mergeScans([result, { images: extraImages }]);
    let pageHost = '';
    try { pageHost = new URL(tab.url).hostname; } catch {}
    const pageTitle = String(tab.title || '').slice(0, 120);
    scans.push({ index: tab.index, truncated: result.truncated, images: result.images.map((img) => ({ ...img, tabId: tab.id, pageHost, pageTitle })) });
  });
  scans.sort((a, b) => a.index - b.index);
  return { ...mergeScans(scans), tabs: scans.length, skipped };
}

// Union by URL across frames (or auto-scroll snapshots), within the scan's size budget.
function mergeScans(scans) {
  const found = new Map();
  let chars = 0, truncated = false;
  for (const scan of scans) {
    if (scan.truncated) truncated = true;
    for (const img of scan.images || []) {
      // From several tabs, an image remembers every page it is on (tab filter, file names).
      const page = img.tabId != null ? { tabId: img.tabId, pageHost: img.pageHost || '', pageTitle: img.pageTitle || '' } : null;
      const seen = found.get(img.src);
      if (seen) {
        if (!(seen.width > 0) && img.width > 0) Object.assign(seen, { width: img.width, height: img.height });
        if (!seen.fileSize && img.fileSize) seen.fileSize = img.fileSize;
        if (page && seen.pages && !seen.pages.some((p) => p.tabId === page.tabId)) seen.pages.push(page);
        continue;
      }
      const cost = String(img.src).length + String(img.alt || '').length;
      if (found.size >= ITK.SCAN_MAX_ITEMS || chars + cost > ITK.SCAN_MAX_TOTAL_CHARS) { truncated = true; continue; }
      chars += cost;
      found.set(img.src, page ? { ...img, pages: [page] } : img);
    }
  }
  return { images: [...found.values()], truncated };
}

// ---------- Auto-scroll ----------
// Scrolls the page to its end so lazy and infinite-scroll images load, collecting images at
// every step (lists that unload what leaves the screen still count), then returns to where
// the reader was. Bounded in time and steps; the panel can stop it at any moment.
const AUTOSCROLL_BUDGET_MS = 25000;

async function autoScroll(tabId) {
  if (!Number.isInteger(tabId)) return { images: [], error: 'noTab' };
  const scanner = await collectImages(tabId); // injects the scanner if needed
  if (scanner.error) return scanner;
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: autoScrollPage,
      args: [AUTOSCROLL_BUDGET_MS, ITK.SCAN_MAX_ITEMS, ITK.SCAN_MAX_TOTAL_CHARS],
    });
    const page = injection?.result;
    if (!page || page.error) return { images: [], error: page?.error || 'failed' };
    // Frames loaded on the way (and the page's final state) join what the scroll collected.
    const frames = await collectImages(tabId);
    const merged = mergeScans([page, scanner, frames]);
    return { ...page, images: merged.images, truncated: page.truncated || merged.truncated };
  } catch {
    return { images: [], error: 'restricted' };
  }
}

async function stopAutoScroll(tabId) {
  if (!Number.isInteger(tabId)) return { error: 'noTab' };
  await chrome.scripting.executeScript({ target: { tabId }, func: () => { window.__imagetoolkitStopScroll = true; } }).catch(() => {});
  return { success: true };
}

// Runs inside the page (isolated world, next to content.js). Must be self-contained.
async function autoScrollPage(budgetMs, maxItems, maxChars) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
  // One run per page: a second panel on the same tab must not scroll it at the same time.
  if (window.__imagetoolkitScrolling) return { images: [], error: 'busy' };
  window.__imagetoolkitScrolling = true;
  try {
  window.__imagetoolkitStopScroll = false;

  // Lazy images and frames load at once when asked to, wherever they are on the page.
  document.querySelectorAll('img[loading="lazy"], iframe[loading="lazy"]').forEach((el) => { el.loading = 'eager'; });

  // The element that really scrolls: the page, or in app-like layouts the largest scrolling box.
  const page = document.scrollingElement || document.documentElement;
  let scroller = page;
  if (page.scrollHeight <= innerHeight + 4) {
    let best = null, bestArea = 0, checked = 0;
    for (const el of document.querySelectorAll('body *')) {
      if (++checked > 8000) break;
      if (el.scrollHeight - el.clientHeight < 200) continue;
      const style = getComputedStyle(el);
      if (style.overflowY !== 'auto' && style.overflowY !== 'scroll') continue;
      // Only an area the user can see: hidden or off-screen panels are never chosen.
      if (style.visibility !== 'visible' || el.checkVisibility?.({ opacityProperty: true }) === false) continue;
      const r = el.getBoundingClientRect();
      const seenW = Math.min(innerWidth, r.right) - Math.max(0, r.left), seenH = Math.min(innerHeight, r.bottom) - Math.max(0, r.top);
      if (seenW < 100 || seenH < 100) continue;
      const area = seenW * seenH;
      if (area > bestArea) { best = el; bestArea = area; }
    }
    if (best) scroller = best;
  }
  const isPage = scroller === page;
  // The height really shown: clientHeight leaves out a horizontal scrollbar (classic scrollbars
  // on Windows take 15–17 px); innerHeight would stop that much short of the bottom, where an
  // infinite feed waits to load more.
  const viewHeight = () => scroller.clientHeight;
  const top = () => (isPage ? scrollY : scroller.scrollTop);
  const scrollTo = (y, x) => (isPage ? window : scroller).scrollTo({ top: y, left: x, behavior: 'instant' });
  const startY = top(), startX = isPage ? scrollX : scroller.scrollLeft;

  const found = new Map();
  let chars = 0, truncated = false;
  const take = () => {
    const snapshot = globalThis.__imagetoolkitScan?.();
    if (!snapshot) return;
    if (snapshot.truncated) truncated = true;
    for (const img of snapshot.images) {
      const seen = found.get(img.src);
      if (seen) {
        if (!seen.width && img.width) Object.assign(seen, { width: img.width, height: img.height });
        continue;
      }
      const cost = img.src.length + (img.alt || '').length;
      if (found.size >= maxItems || chars + cost > maxChars) { truncated = true; continue; }
      chars += cost;
      found.set(img.src, img);
    }
  };

  const deadline = Date.now() + budgetMs;
  let steps = 0, quietAtBottom = 0, stopped = false;
  take();
  while (Date.now() < deadline && steps < 300) {
    if (window.__imagetoolkitStopScroll) { stopped = true; break; }
    const max = scroller.scrollHeight - viewHeight();
    if (top() >= max - 2) {
      // At the bottom: give infinite scroll two chances to append more before calling it done.
      await sleep(700);
      take();
      if (scroller.scrollHeight - viewHeight() > max + 2) { quietAtBottom = 0; continue; }
      if (++quietAtBottom >= 2) break;
      continue;
    }
    scrollTo(Math.min(max, top() + Math.round(viewHeight() * 0.85)), isPage ? scrollX : scroller.scrollLeft);
    steps++;
    await Promise.race([frame(), sleep(120)]); // no frames in a hidden tab
    await sleep(220);
    take();
    const pct = Math.round((100 * top()) / Math.max(1, scroller.scrollHeight - viewHeight()));
    chrome.runtime.sendMessage({ action: 'autoScrollProgress', pct }).catch(() => {});
  }
  scrollTo(startY, startX);
  return { images: [...found.values()], truncated, steps, stopped, timedOut: Date.now() >= deadline };
  } finally {
    window.__imagetoolkitScrolling = false;
  }
}

// ---------- Offscreen Document ----------
let offscreenCreating = null;

async function ensureOffscreen() {
  try {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [chrome.runtime.getURL('offscreen.html')],
    });
    if (contexts.length > 0) return;
  } catch {
    // getContexts not available in older Chrome
  }

  if (!offscreenCreating) {
    offscreenCreating = chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: [chrome.offscreen.Reason.BLOBS, chrome.offscreen.Reason.CLIPBOARD],
      justification: 'Canvas-based image conversion and clipboard fallback',
    }).catch((err) => {
      if (!err.message?.includes('Only a single offscreen')) throw err;
    });
  }

  try {
    await offscreenCreating;
  } finally {
    // Reset even on failure, otherwise every later call awaits the same rejected promise.
    offscreenCreating = null;
  }
}

// The offscreen document answers on the request's own channel. A stale answer from before a
// service worker restart cannot reach a newer request: its channel is gone with the old worker.
async function offscreenRequest(payload, timeoutMs = 30000) {
  await ensureOffscreen();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Processing timed out (${Math.round(timeoutMs / 1000)}s)`)), timeoutMs);
  });
  try {
    const response = await Promise.race([chrome.runtime.sendMessage(payload), timeout]);
    if (!response) throw new Error('No answer from the offscreen document');
    if (response.error) throw new Error(response.error);
    return response;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Fetching ----------
function tooLarge(bytes) {
  return new Error(`Image too large (${bytes > 0 ? ITK.formatBytes(bytes) : `> ${ITK.formatBytes(MAX_FETCH_BYTES)}`})`);
}

// A download may take this long in all, and may go this long without receiving a byte.
const FETCH_TOTAL_MS = 90000;
const FETCH_IDLE_MS = 20000;

// `cookies`: true only for what the user asked for (save, copy, edit one image): images behind
// a login then still work. Automatic fetches (previews, dimensions) never send cookies.
async function fetchImageBlob(imageUrl, { signal, maxBytes = MAX_FETCH_BYTES, cookies = true, totalMs = FETCH_TOTAL_MS } = {}) {
  if (!ITK.isFetchableImageSrc(String(imageUrl || ''))) throw new Error('Unsupported image URL');

  const controller = new AbortController();
  const stop = () => controller.abort();
  if (signal?.aborted) stop();
  signal?.addEventListener('abort', stop, { once: true });
  let timedOut = false;
  const expire = () => { timedOut = true; stop(); };
  const total = setTimeout(expire, totalMs);
  let idle;
  let bytesRead = 0;
  const alive = (bytes = 0) => { bytesRead += bytes; clearTimeout(idle); idle = setTimeout(expire, FETCH_IDLE_MS); };
  alive();
  try {
    let response;
    try {
      // With cookies first; retried without them on network errors.
      response = await fetch(imageUrl, { credentials: cookies ? 'include' : 'omit', signal: controller.signal });
    } catch (err) {
      if (controller.signal.aborted || !cookies) throw err;
      response = await fetch(imageUrl, { credentials: 'omit', signal: controller.signal });
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    // Automatic fetches stop at once on a web page or other text (a link that only looked like
    // an image): nothing of it is downloaded. Actions the user asks for sniff the bytes instead.
    if (!cookies && /^(text\/|application\/(json|xml|xhtml))/i.test(response.headers.get('content-type') || '')) {
      response.body?.cancel().catch(() => {});
      throw new Error('Not an image');
    }

    const declared = ITK.parseSizeFromHeaders(response.headers);
    if (declared > maxBytes) {
      response.body?.cancel().catch(() => {});
      throw tooLarge(declared);
    }

    const blob = await readBodyCapped(response, maxBytes, alive);
    if (!blob.size) throw new Error('Empty response');
    return blob;
  } catch (err) {
    const failure = timedOut ? new Error('Download timed out') : err;
    failure.bytesRead = bytesRead; // what this attempt really downloaded
    throw failure;
  } finally {
    clearTimeout(total);
    clearTimeout(idle);
    signal?.removeEventListener('abort', stop);
  }
}

// Reads the body chunk by chunk and stops as soon as it passes the cap, so a server
// that sends no Content-Length can never push more than `cap` bytes into memory.
// `onChunk(bytes)` is called for every chunk received (idle timer and byte count).
async function readBodyCapped(response, cap, onChunk = () => {}) {
  const type = (response.headers.get('content-type') || '').split(';')[0].trim();
  if (!response.body) {
    const blob = await response.blob();
    if (blob.size > cap) throw tooLarge(blob.size);
    return blob;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    onChunk(value.byteLength);
    total += value.byteLength;
    if (total > cap) {
      reader.cancel().catch(() => {});
      throw tooLarge(0);
    }
    chunks.push(value);
  }
  return new Blob(chunks, { type });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to read blob'));
    reader.readAsDataURL(blob);
  });
}

// "Original" downloads must keep the exact bytes (GIF animation, SVG vectors, JPEG quality),
// so they bypass the canvas pipeline and take the extension from the real content type.
async function fetchOriginal(imageUrl) {
  const blob = await fetchImageBlob(imageUrl);
  const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  const mime = (blob.type || '').split(';')[0].trim().toLowerCase();
  // Content first (servers mislabel files), then the declared type, then the URL's
  // extension — except for HTML, which is an error or login page, never an image.
  const format = ITK.sniffImageType(head)
    || (ITK.looksLikeSvg(await blob.slice(0, 2048).text()) ? 'svg' : null)
    || ITK.mimeToType(mime)
    || (mime !== 'text/html' ? ITK.extensionToType(imageUrl) : null);
  if (!format) throw new Error('Unsupported image type');

  return { dataUrl: await blobToDataUrl(blob), originalSize: blob.size, newSize: blob.size, format };
}

// ---------- Processing ----------
async function processImage(imageUrl, instructions) {
  const blob = await fetchImageBlob(imageUrl);
  const dataUrl = await blobToDataUrl(blob);
  const result = await offscreenRequest({ action: 'offscreen-process', imageDataUrl: dataUrl, instructions });
  return { ...result, originalSize: blob.size };
}

// Format Advisor: one download and one decode, then every format is encoded from
// the same bitmap. A newer request from the same document aborts the older download.
const analysisControllers = new Map();
const analysisKey = (sender) => sender.documentId || sender.url || 'default';

async function analyzeFormats(imageUrl, contextKey) {
  analysisControllers.get(contextKey)?.abort();
  const controller = new AbortController();
  analysisControllers.set(contextKey, controller);
  try {
    const blob = await fetchImageBlob(imageUrl, { signal: controller.signal });
    if (controller.signal.aborted) return { superseded: true };
    const dataUrl = await blobToDataUrl(blob);
    const result = await offscreenRequest({ action: 'offscreen-analyze', imageDataUrl: dataUrl, formats: ['png', 'jpeg', 'webp'], quality: 0.85 });
    if (controller.signal.aborted) return { superseded: true };
    return { ...result, originalSize: blob.size };
  } catch (err) {
    if (controller.signal.aborted) return { superseded: true };
    throw err;
  } finally {
    if (analysisControllers.get(contextKey) === controller) analysisControllers.delete(contextKey);
  }
}

async function processAndSave(imageUrl, rawInstructions, settings) {
  let instructions = { silent: !!rawInstructions?.silent };
  try {
    instructions = ITK.sanitizeInstructions(rawInstructions);
    if (!settings) settings = await loadSettingsAndLocale();
    if (instructions.quality == null) instructions.quality = settings.defaultQuality / 100;
    if (!instructions.jpgBackground) instructions.jpgBackground = settings.jpgBackground || '#FFFFFF';
    for (const key of ['subfolder', 'filenamePattern', 'filenamePrefix', 'filenameTemplate']) {
      if (instructions[key] == null) instructions[key] = settings[key];
    }

    const result = instructions.passthrough
      ? await fetchOriginal(imageUrl)
      : await processImage(imageUrl, instructions);
    // Name the file after the format actually produced (e.g. AVIF falls back to WebP).
    const filename = ITK.buildFilename(imageUrl, {
      ...instructions,
      format: result.format,
      knownWidth: result.width || instructions.knownWidth,
      knownHeight: result.height || instructions.knownHeight,
    });

    // Batch downloads pass saveAs: false so they never open one dialog per image.
    const downloadId = await triggerDownload(result.dataUrl, filename, instructions.saveAs ?? settings.saveAs);
    if (downloadId == null) return { cancelled: true, filename };

    if (settings.showNotification && !instructions.silent) {
      showSaveNotification(result.originalSize, result.newSize, result.format);
    }

    const { dataUrl, ...meta } = result;
    return { success: true, filename, ...meta };
  } catch (err) {
    if (!instructions.silent) notify(`${t('errorSaveFailed')}: ${err.message}`, { error: true });
    return { error: err.message };
  }
}

// ---------- Clipboard ----------
// Clipboard writes need a focused document. The offscreen document never has focus,
// so the image is written from the page the user just right-clicked; the offscreen
// document is only a last resort.
async function copyImageUrl(imageUrl, tabId, settings) {
  try {
    const result = await processImage(imageUrl, { format: 'png' });
    await writeImageToClipboard(result.dataUrl, tabId);
    if (settings.showNotification) notify(t('notifCopied'));
    return { success: true };
  } catch (err) {
    notify(`${t('errorCopyFailed')}: ${err.message}`, { error: true });
    return { error: err.message };
  }
}

async function writeImageToClipboard(pngDataUrl, tabId) {
  if (Number.isInteger(tabId)) {
    try {
      const [injection] = await chrome.scripting.executeScript({
        target: { tabId },
        func: pagePngToClipboard,
        args: [pngDataUrl.slice(pngDataUrl.indexOf(',') + 1)],
      });
      if (injection?.result?.ok) return;
    } catch {
      // Restricted page: fall through to the offscreen document.
    }
  }
  await offscreenRequest({ action: 'offscreen-copy', imageDataUrl: pngDataUrl }, 15000);
}

// Runs inside the page (isolated world). Must be self-contained.
async function pagePngToClipboard(base64) {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'image/png' });
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ---------- Downloads ----------
// blob: URLs served by the offscreen document, per download, released once it ends. The map
// lives in session storage, so a service worker restarted during a long download (or a Save As
// dialog left open) still releases the URL; the offscreen document's own timer is the backstop.
const objectUrlKey = (downloadId) => `blobdl:${downloadId}`;

function releaseObjectUrl(url) {
  offscreenRequest({ action: 'offscreen-revoke', url }, 5000).catch(() => {});
}

async function downloadHandoff(key, rawFilename, saveAs) {
  const filename = ITK.sanitizeFilename(rawFilename || 'download', true) || 'download';
  const { url } = await offscreenRequest({ action: 'offscreen-object-url', key });
  let downloadId;
  try {
    downloadId = await triggerDownload(url, filename, saveAs);
  } catch (err) {
    releaseObjectUrl(url);
    throw err;
  }
  if (downloadId == null) {
    releaseObjectUrl(url);
    return { cancelled: true };
  }
  await chrome.storage.session.set({ [objectUrlKey(downloadId)]: url }).catch(() => {});
  return { success: true, downloadId };
}

chrome.downloads.onChanged.addListener(async (delta) => {
  if (!['complete', 'interrupted'].includes(delta.state?.current)) return;
  const name = objectUrlKey(delta.id);
  const { [name]: url } = await chrome.storage.session.get(name).catch(() => ({}));
  if (!url) return;
  await chrome.storage.session.remove(name).catch(() => {});
  releaseObjectUrl(url);
});

// Resolves with the download id once Chrome has accepted the download, or with null
// when the user closed the Save As dialog. Anything else is an error.
function triggerDownload(url, filename, saveAs = true) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download({ url, filename, saveAs, conflictAction: 'uniquify' }, (downloadId) => {
      const error = chrome.runtime.lastError;
      if (Number.isInteger(downloadId) && !error) {
        resolve(downloadId);
      } else if (error && /cancel/i.test(error.message)) {
        resolve(null);
      } else {
        reject(new Error(error?.message || 'Download failed'));
      }
    });
  });
}

// ---------- Capture ----------
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startCapture(tabId, delaySeconds = 0) {
  if (!Number.isInteger(tabId)) return { error: 'noTab' };
  await loadSettingsAndLocale();
  const target = { tabId };
  try {
    // Also tells us early whether the page can be scripted at all (chrome://, Web Store…).
    await chrome.scripting.executeScript({ target, func: (hint) => { window.__imagetoolkit_hint = hint; }, args: [t('captureHint')] });
  } catch {
    notify(t('errorRestrictedPage'), { error: true });
    return { error: 'restricted' };
  }

  // The caller gets its answer before the delay, so the popup can close and show the page.
  // The delay is capped at 10 s, well inside the 30 s a service worker may sit idle.
  const inject = () => chrome.scripting.executeScript({ target, files: ['capture.js'] }).catch(() => {});
  const delay = captureDelay(delaySeconds);
  if (delay > 0) {
    countdown(tabId, delay).then(inject);
  } else {
    await inject();
  }
  return { success: true };
}

// A capture delay (0–10 s) counts down on the toolbar icon, so the user knows when it fires.
const captureDelay = (seconds) => Math.min(10, Math.max(0, Math.round(Number(seconds) || 0)));
async function countdown(tabId, seconds) {
  for (let left = seconds; left > 0; left--) {
    chrome.action.setBadgeText({ tabId, text: String(left) }).catch(() => {});
    await sleep(1000);
  }
  chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
}

// Chrome allows two captureVisibleTab calls per second for the whole extension. Every capture
// (area, visible, full page) reserves its slot before waiting, so concurrent callers queue up
// instead of waking together; a call refused for that quota is tried once more, in the queue.
const CAPTURE_INTERVAL_MS = 550;
let lastCaptureAt = 0;

async function captureTab(windowId, retry = true) {
  const now = Date.now();
  const slot = Math.max(now, lastCaptureAt + CAPTURE_INTERVAL_MS);
  lastCaptureAt = slot;
  if (slot > now) await sleep(slot - now);
  try {
    return await withTimeout(new Promise((resolve, reject) => {
      chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, (dataUrl) => {
        const error = chrome.runtime.lastError;
        if (error || !dataUrl) reject(new Error(error?.message || 'Capture failed'));
        else resolve(dataUrl);
      });
    }), 10000, 'Screenshot');
  } catch (err) {
    if (!retry || !/MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/.test(err.message)) throw err;
    lastCaptureAt = Math.max(lastCaptureAt, Date.now() + CAPTURE_INTERVAL_MS);
    return captureTab(windowId, false);
  }
}

// The rectangle comes from a content script: only finite, positive sizes are accepted.
function validCaptureRect(rect) {
  const values = [rect?.x, rect?.y, rect?.width, rect?.height].map(Number);
  if (!values.every(Number.isFinite)) return null;
  const [x, y, width, height] = values;
  return width >= 1 && height >= 1 && x >= 0 && y >= 0 ? { x, y, width, height } : null;
}

// captureVisibleTab shoots whatever tab is at the front of the window: the one that asked must
// still be there when the screenshot is taken.
// watchTab() remembers any switch away, navigation (a reload of the same URL included) or close
// for the whole capture, even if the tab is back in front by the time the next check runs.
function watchTab(tabId, windowId) {
  const watch = { changed: false };
  const onActivated = (info) => { if (info.windowId === windowId && info.tabId !== tabId) watch.changed = true; };
  const onUpdated = (id, info) => { if (id === tabId && (info.status === 'loading' || info.url)) watch.changed = true; };
  const onGone = (id) => { if (id === tabId) watch.changed = true; };
  const onReplaced = (added, removed) => { if (removed === tabId) watch.changed = true; };
  chrome.tabs.onActivated.addListener(onActivated);
  chrome.tabs.onUpdated.addListener(onUpdated);
  chrome.tabs.onRemoved.addListener(onGone);
  chrome.tabs.onReplaced.addListener(onReplaced);
  watch.stop = () => {
    chrome.tabs.onActivated.removeListener(onActivated);
    chrome.tabs.onUpdated.removeListener(onUpdated);
    chrome.tabs.onRemoved.removeListener(onGone);
    chrome.tabs.onReplaced.removeListener(onReplaced);
  };
  return watch;
}

async function isFrontTab(tabId, windowId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  return Boolean(tab?.active && tab.windowId === windowId);
}

async function captureSelection(tab, rawRect, frameId = 0) {
  if (tab?.windowId == null || !Number.isInteger(tab.id)) return { error: 'noTab' };
  // The overlay only ever runs in the top document of the tab.
  if (frameId !== 0) return { error: 'Invalid sender' };
  const watch = watchTab(tab.id, tab.windowId);
  try {
    const rect = validCaptureRect(rawRect);
    if (!rect) throw new Error('Invalid selection');
    if (!(await isFrontTab(tab.id, tab.windowId))) throw tabChanged();
    const dataUrl = await captureTab(tab.windowId);
    if (watch.changed || !(await isFrontTab(tab.id, tab.windowId)) || watch.changed) throw tabChanged();
    // Never fall back to the whole screenshot: the user asked for one area only.
    const { dataUrl: cropped } = await offscreenRequest({ action: 'offscreen-crop', dataUrl, rect }, 15000);
    if (!cropped || !cropped.startsWith('data:image/')) throw new Error('Crop failed');
    await openViewer(cropped, { site: hostOf(tab.url), title: tab.title || '', opener: tab });
    return { success: true };
  } catch (err) {
    await loadSettingsAndLocale();
    notify(err.tabChanged ? t('captureTabChanged') : `${t('errorCaptureFailed')}: ${err.message}`, { error: true });
    return { error: err.tabChanged ? 'tabChanged' : err.message };
  } finally {
    watch.stop();
  }
}

async function captureVisible(tabId, delaySeconds = 0) {
  if (!Number.isInteger(tabId)) return { error: 'noTab' };
  let watch = null;
  try {
    // The delay leaves time to open a menu or hover something before the screenshot.
    const delay = captureDelay(delaySeconds);
    if (delay > 0) await countdown(tabId, delay);
    let tab = await chrome.tabs.get(tabId);
    if (!tab.active) {
      tab = await chrome.tabs.update(tabId, { active: true });
      await sleep(150);
    }
    watch = watchTab(tabId, tab.windowId);
    const dataUrl = await captureTab(tab.windowId);
    if (watch.changed || !(await isFrontTab(tabId, tab.windowId)) || watch.changed) throw tabChanged();
    await openViewer(dataUrl, { site: hostOf(tab.url), title: tab.title || '', opener: tab });
    return { success: true };
  } catch (err) {
    await loadSettingsAndLocale();
    notify(err.tabChanged ? t('captureTabChanged') : t('errorRestrictedPage'), { error: true });
    return { error: err.tabChanged ? 'tabChanged' : 'restricted' };
  } finally {
    watch?.stop();
  }
}

// ---------- Full-page capture ----------
// Scrolls the page (or, in app-like layouts, its main scrolling area) one screen at a time,
// captures each screen and stitches them in the offscreen document, which hands the result to
// the editor through IndexedDB (no base64).
// - Sticky elements flow as ordinary content; fixed overlays appear in the first slice only.
// - A capture belongs to one tab: if another tab comes to the front or the page navigates, it stops.
// - Every step has a time limit, the whole capture a deadline, and a page that stops scrolling
//   ends it, so it can never hang. The page also restores itself if this worker dies midway.
const FULLPAGE_MAX_HEIGHT = 16384;   // device pixels; taller pages are scaled down (to 50%), then cut
const FULLPAGE_DEADLINE_MS = 120000;
const FULLPAGE_STEP_MS = 15000;
let fullPageBusy = false;
let fullPageCancelled = false;

function withTimeout(promise, ms, what) {
  let timer;
  const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} timed out`)), ms); });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

const tabChanged = () => Object.assign(new Error('tab changed'), { tabChanged: true });

async function captureFullPage(tabId) {
  if (!Number.isInteger(tabId)) return { error: 'noTab' };
  if (fullPageBusy) return { error: 'busy' };
  fullPageBusy = true;
  fullPageCancelled = false;
  const deadline = Date.now() + FULLPAGE_DEADLINE_MS;
  // Every step after the first goes to the document the capture started in, and to no other
  // (a reload, even of the same URL, is another document: the step fails and the capture stops).
  let documentId = null;
  const run = (func, args = []) => withTimeout(
    chrome.scripting.executeScript({ target: documentId ? { tabId, documentIds: [documentId] } : { tabId }, func, args })
      .then(([r]) => { documentId ??= r?.documentId ?? null; return r?.result; }), FULLPAGE_STEP_MS, 'Page step');
  let session = null;
  let prepared = false;
  let watch = null;
  try {
    let tab = await chrome.tabs.get(tabId);
    // Only the active tab of a window can be captured.
    if (!tab.active) tab = await chrome.tabs.update(tabId, { active: true });
    const startUrl = tab.url;
    watch = watchTab(tabId, tab.windowId);
    const page = await run(fullPagePrepare).catch(() => null);
    if (!page) throw Object.assign(new Error('restricted'), { restricted: true });
    prepared = true;
    if (!(page.width >= 1 && page.height >= 1 && page.scrollHeight >= 1)) throw new Error('Nothing visible to capture');

    // Checked right before and right after every screenshot, so no slice of another page
    // (another tab brought to the front, or this one navigating) ever gets into the result.
    const sameTab = async () => {
      if (watch.changed) return false;
      const now = await chrome.tabs.get(tabId).catch(() => null);
      return !watch.changed && !!now && now.active && now.windowId === tab.windowId && now.url === startUrl;
    };
    const shoot = async (y, hideFloating) => {
      if (fullPageCancelled) return null;
      const at = await run(fullPageScroll, [y, hideFloating]);
      if (!at || at.cancelled || fullPageCancelled) return null;
      if (!(await sameTab())) throw tabChanged();
      const dataUrl = await captureTab(tab.windowId);
      if (!(await sameTab())) throw tabChanged();
      return { at, dataUrl };
    };

    // The first screenshot gives the real pixel scale and visible height: with page zoom or an
    // emulated viewport they differ from devicePixelRatio and clientHeight, and trusting those
    // would leave gaps between slices.
    const first = await shoot(0, false);
    if (!first) return { cancelled: true };
    const size = await offscreenRequest({ action: 'image-size', dataUrl: first.dataUrl }, 15000);
    const px = size.width / page.innerWidth;                         // device pixels per CSS pixel
    const viewHeight = Math.max(1, Math.min(page.height, Math.floor(size.height / px) - page.top));
    const fullWidth = Math.round(page.width * px);
    const fullHeight = Math.round(page.scrollHeight * px);
    // Within one side's limit and the editor's area limit (100 MP): scaled down to 50% at most,
    // then cut.
    const scale = Math.max(0.5, Math.min(1, FULLPAGE_MAX_HEIGHT / fullHeight, Math.sqrt(ITK.MAX_AREA / (fullWidth * fullHeight))));
    const width = Math.max(1, Math.round(fullWidth * scale));
    const maxHeight = Math.min(FULLPAGE_MAX_HEIGHT, Math.floor(ITK.MAX_AREA / width));
    const height = Math.max(1, Math.min(maxHeight, Math.round(fullHeight * scale)));
    const cut = Math.round(fullHeight * scale) > maxHeight;
    session = (await offscreenRequest({ action: 'fullpage-begin', width, height }, 15000)).session;
    const crop = { x: Math.round(page.left * px), y: Math.round(page.top * px), width: fullWidth, height: Math.round(viewHeight * px) };

    const maxSlices = Math.ceil(page.scrollHeight / viewHeight) + 2;
    // The image only ever holds what was captured without a gap, from the first slice down:
    // chats and virtual lists (Discord, Slack…) that jump while scrolling end the capture at
    // the jump, and the result is trimmed to what was really taken.
    const origin = first.at.y; // a page that will not go to the top starts lower
    let slice = first;
    let incomplete = origin > 1;
    let finished = false;
    let coveredTo = origin;
    let grewTo = page.scrollHeight;
    // Where the slice drawn last ends on the canvas. With a fractional pixel scale (Windows at
    // 125%, page zoom) scroll positions round to device pixels, and a slice can land a pixel or
    // two below the previous one: it is joined to it, never leaving an empty line between them.
    let drawnTo = 0;
    for (let i = 0; i < maxSlices; i++) {
      let y = Math.round((slice.at.y - origin) * px * scale);
      if (y > drawnTo && y - drawnTo <= 2) y = drawnTo;
      await offscreenRequest({ action: 'fullpage-draw', session, dataUrl: slice.dataUrl, crop, y, scale }, 15000);
      drawnTo = Math.max(drawnTo, y + Math.round(crop.height * scale));
      grewTo = Math.max(grewTo, slice.at.scrollHeight || 0);
      const bottom = slice.at.y + viewHeight;
      coveredTo = Math.max(coveredTo, bottom);
      // Done at the end of the page, or where a very tall capture is cut.
      if (bottom >= page.scrollHeight || (bottom - origin) * px * scale >= height) { finished = true; break; }
      if (Date.now() > deadline) break;
      chrome.action.setBadgeText({ tabId, text: `${Math.min(99, Math.round(((i + 1) / (maxSlices - 2)) * 100))}%` }).catch(() => {});
      const next = await shoot(bottom, true);
      if (!next) return { cancelled: true };
      // A page that refuses to scroll further (scripts resetting it, snap points), or that jumped
      // past the next screen, ends here.
      if (next.at.y <= slice.at.y || next.at.y > bottom + 1) break;
      slice = next;
    }
    if (!finished) incomplete = true;
    const grew = grewTo > page.scrollHeight + 4;
    const usedHeight = Math.max(1, Math.min(height, Math.round((coveredTo - origin) * px * scale)));

    const { key } = await offscreenRequest({ action: 'fullpage-end', session, height: usedHeight }, 60000);
    session = null;
    await run(fullPageRestore).catch(() => {});
    prepared = false;
    await openHandoffPage('view.html', key, { site: hostOf(startUrl), title: tab.title || '', opener: tab, capture: true });
    if (cut || incomplete || grew) {
      await loadSettingsAndLocale();
      notify(cut ? t('fullPageCut', [String(Math.round(height / px / scale))]) : t('fullPageIncomplete'));
    }
    return { success: true, width, height: usedHeight, truncated: cut || incomplete || grew };
  } catch (err) {
    await loadSettingsAndLocale();
    const message = err.restricted ? t('errorRestrictedPage') : err.tabChanged ? t('captureTabChanged') : `${t('errorCaptureFailed')}: ${err.message}`;
    notify(message, { error: true });
    return { error: err.restricted ? 'restricted' : err.tabChanged ? 'tabChanged' : err.message };
  } finally {
    if (session) offscreenRequest({ action: 'fullpage-cancel', session }, 5000).catch(() => {});
    if (prepared) await run(fullPageRestore).catch(() => {});
    watch?.stop();
    chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
    fullPageBusy = false;
  }
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return ''; }
}

// The three functions below run inside the page (isolated world). Each must be self-contained.
async function fullPagePrepare() {
  // A capture abandoned by a worker that stopped midway: put that page back first.
  window.__imagetoolkitFullPageRestore?.();

  const root = document.scrollingElement || document.documentElement;
  // What really scrolls: the page, or in app-like layouts (mail, chat, docs) the largest
  // scrolling area, which is then captured on its own.
  let box = null;
  if (root.scrollHeight <= innerHeight + 4) {
    let bestArea = 0, checked = 0;
    for (const el of document.querySelectorAll('body *')) {
      if (++checked > 8000) break;
      if (el.scrollHeight - el.clientHeight < 200) continue;
      const style = getComputedStyle(el);
      if (style.overflowY !== 'auto' && style.overflowY !== 'scroll') continue;
      // Only an area the user can see: hidden or off-screen panels are never chosen.
      if (style.visibility !== 'visible' || el.checkVisibility?.({ opacityProperty: true }) === false) continue;
      const r = el.getBoundingClientRect();
      const seenW = Math.min(innerWidth, r.right) - Math.max(0, r.left), seenH = Math.min(innerHeight, r.bottom) - Math.max(0, r.top);
      if (seenW < 100 || seenH < 100 || r.top < -1 || r.left < -1) continue; // starts on screen
      const area = seenW * seenH;
      if (area > bestArea) { box = el; bestArea = area; }
    }
  }

  const style = document.createElement('style');
  style.id = 'imagetoolkit-fullpage-style';
  // Instant scrolling; nothing animated in while a slice is taken.
  style.textContent = 'html,body{scroll-behavior:auto!important}*,*::before,*::after{scroll-behavior:auto!important;transition:none!important;animation-play-state:paused!important;caret-color:transparent!important}';
  (document.head || document.documentElement).appendChild(style);

  const state = {
    box, cancelled: false, changed: [], timer: null,
    x: box ? box.scrollLeft : scrollX, y: box ? box.scrollTop : scrollY,
  };
  const onKey = (e) => { if (e.key === 'Escape') state.cancelled = true; };
  const restore = () => {
    clearTimeout(state.timer);
    style.remove();
    removeEventListener('keydown', onKey, true);
    removeEventListener('pagehide', restore);
    for (const [el, property, value, priority] of state.changed.reverse()) {
      if (value) el.style.setProperty(property, value, priority);
      else el.style.removeProperty(property);
    }
    (box || window).scrollTo({ top: state.y, left: state.x, behavior: 'instant' });
    if (window.__imagetoolkitFullPage === state) {
      delete window.__imagetoolkitFullPage;
      delete window.__imagetoolkitFullPageRestore;
    }
  };
  // Nobody may be left to call restore (the service worker can stop): every step re-arms this.
  state.arm = () => { clearTimeout(state.timer); state.timer = setTimeout(restore, 30000); };
  state.arm();
  window.__imagetoolkitFullPage = state;
  window.__imagetoolkitFullPageRestore = restore;
  addEventListener('keydown', onKey, true);
  // A reload or navigation midway: the page goes back to where the user was before it leaves,
  // so the browser does not reopen it where the capture had scrolled to.
  addEventListener('pagehide', restore);

  // Sticky headers and sidebars become ordinary content: each appears once, where it belongs,
  // instead of following every slice (hiding them would lose what they contain).
  for (const el of document.querySelectorAll('body *')) {
    if (getComputedStyle(el).position !== 'sticky') continue;
    state.changed.push([el, 'position', el.style.getPropertyValue('position'), el.style.getPropertyPriority('position')]);
    el.style.setProperty('position', 'static', 'important');
  }

  // Lazy images load now; give them (up to 1.5 s) to arrive, so the height measured is final.
  document.querySelectorAll('img[loading="lazy"]').forEach((img) => { img.loading = 'eager'; });
  const pending = [...document.images].filter((img) => !img.complete);
  if (pending.length) {
    // One signal removes every listener, whether the images arrived or the wait ran out.
    const listening = new AbortController();
    try {
      await Promise.race([
        Promise.all(pending.map((img) => new Promise((resolve) => {
          img.addEventListener('load', resolve, { signal: listening.signal });
          img.addEventListener('error', resolve, { signal: listening.signal });
        }))),
        new Promise((resolve) => setTimeout(resolve, 1500)),
      ]);
    } finally {
      listening.abort();
    }
  }

  if (box) {
    const rect = box.getBoundingClientRect();
    const left = Math.max(0, rect.left + box.clientLeft), top = Math.max(0, rect.top + box.clientTop);
    return { innerWidth, left, top, width: Math.min(box.clientWidth, innerWidth - left), height: Math.min(box.clientHeight, innerHeight - top), scrollHeight: box.scrollHeight };
  }
  return {
    innerWidth,                      // CSS width the screenshot covers (scrollbar included)
    left: 0, top: 0,
    width: root.clientWidth,         // without the vertical scrollbar
    height: root.clientHeight,       // without a horizontal scrollbar
    scrollHeight: Math.max(root.scrollHeight, document.body?.scrollHeight || 0),
  };
}

async function fullPageScroll(y, hideFloating) {
  const state = window.__imagetoolkitFullPage;
  if (!state || state.cancelled) return { cancelled: true };
  state.arm();
  if (hideFloating && !state.floatingHidden) {
    // Fixed overlays (headers, chat buttons, cookie bars) were in the first slice; not again.
    // An app shell that holds the scrolling area itself is fixed too: it stays.
    state.floatingHidden = true;
    for (const el of document.querySelectorAll('body *')) {
      if (getComputedStyle(el).position !== 'fixed' || (state.box && el.contains(state.box))) continue;
      state.changed.push([el, 'visibility', el.style.getPropertyValue('visibility'), el.style.getPropertyPriority('visibility')]);
      el.style.setProperty('visibility', 'hidden', 'important');
    }
  }
  const scroller = state.box || window;
  scroller.scrollTo({ top: y, left: state.box ? state.box.scrollLeft : scrollX, behavior: 'instant' });
  // Two frames so the new position is painted; frames never come in a hidden tab, hence the cap.
  await Promise.race([new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))), new Promise((r) => setTimeout(r, 120))]);
  await new Promise((r) => setTimeout(r, 150)); // lazy images and late layout
  const root = document.scrollingElement || document.documentElement;
  return {
    y: state.box ? state.box.scrollTop : scrollY,
    scrollHeight: state.box ? state.box.scrollHeight : root.scrollHeight,
    cancelled: state.cancelled,
  };
}

function fullPageRestore() {
  window.__imagetoolkitFullPageRestore?.();
}

// ---------- Editor and capture viewer ----------
// Both open in a tab next to the page they came from. The handed-off image (a screenshot can be
// private) lives as long as that tab shows one of these two pages, reloads and viewer → editor
// included: closing the tab, or leaving for any other page, deletes it. The tab → key map is in
// session storage so it survives a service worker restart; a 12-hour expiry stays as a safety net.
const handoffTabName = (tabId) => `handoff-tab:${tabId}`;
const HANDOFF_PAGES = ['resize.html', 'view.html'].map((page) => chrome.runtime.getURL(page));

// meta (optional): { site, title } of the page the image came from (filename templates),
// opener: the tab to open next to, capture: true for screenshots.
async function openEditor(imageUrl, meta) {
  if (!imageUrl) return;
  await openHandoffPage('resize.html', await handoff.put(imageUrl, { maxAge: handoff.EDITOR_MAX_AGE_MS }), meta);
}

// Screenshots first open in the viewer: the whole capture at full width, ready to save or copy,
// with Crop and Annotate one click away.
async function openViewer(imageUrl, meta) {
  if (!imageUrl) return;
  await openHandoffPage('view.html', await handoff.put(imageUrl, { maxAge: handoff.EDITOR_MAX_AGE_MS }), { ...meta, capture: true });
}

async function openHandoffPage(page, key, meta = {}) {
  const params = new URLSearchParams({ key });
  if (meta.site) params.set('site', String(meta.site).slice(0, 253));
  if (meta.title) params.set('title', String(meta.title).slice(0, 200));
  if (meta.capture) params.set('capture', '1');
  const url = `${page}?${params}`;
  let near = meta.opener;
  if (!near) [near] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
  let tab = null;
  if (Number.isInteger(near?.id) && near.id >= 0) {
    tab = await chrome.tabs.create({ url, active: true, windowId: near.windowId, index: near.index + 1, openerTabId: near.id }).catch(() => null);
  }
  tab ??= await chrome.tabs.create({ url, active: true }); // e.g. the opener sits in a popup window
  if (tab?.id != null) await chrome.storage.session.set({ [handoffTabName(tab.id)]: key }).catch(() => {});
  if (tab?.windowId != null) chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
}

async function forgetTabHandoff(tabId) {
  const name = handoffTabName(tabId);
  const { [name]: key } = await chrome.storage.session.get(name).catch(() => ({}));
  if (!key) return;
  await chrome.storage.session.remove(name).catch(() => {});
  await handoff.remove(key).catch(() => {});
}

chrome.tabs.onRemoved.addListener((tabId) => { forgetTabHandoff(tabId); });
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.url && !HANDOFF_PAGES.some((page) => info.url.startsWith(page))) forgetTabHandoff(tabId);
});

function openGoogleLens(imageUrl, tab) {
  if (!/^https?:/i.test(imageUrl)) {
    notify(t('googleLensNeedsUrl'), { error: true });
    return;
  }
  chrome.tabs.create({
    url: `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(imageUrl)}`,
    index: tab ? tab.index + 1 : undefined,
    active: true,
  });
}

// ---------- Notifications ----------
function notify(message, { error = false } = {}) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: t('extShortName'),
    message: String(message),
    priority: error ? 2 : 0,
  });
}

function showSaveNotification(originalSize, newSize, format) {
  const reduction = originalSize > 0 ? Math.round((1 - newSize / originalSize) * 100) : 0;
  const sizeInfo = `${ITK.formatBytes(originalSize)} → ${ITK.formatBytes(newSize)}`;
  const reductionInfo = reduction > 0 ? ` (${reduction}% ${t('smaller')})` : '';

  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: t('notifSavedAs', [ITK.formatLabel(format || 'png')]),
    message: `${sizeInfo}${reductionInfo}`,
    priority: 0,
  });
}

// ---------- Type & Size Probing ----------
const PROBE_TYPE_LIMIT = 30;
const PROBE_SIZE_LIMIT = 100;
const PROBE_CACHE_MAX = 500;
// Metadata only: when a server sends no length, count at most this much of one body, and at
// most PROBE_BODY_BUDGET across all images of one request. Past either, the size stays unknown.
const PROBE_BODY_CAP = 2 * 1024 * 1024;
const PROBE_BODY_BUDGET = 8 * 1024 * 1024;
const typeProbeCache = new Map();
const sizeProbeCache = new Map();

function rememberProbe(cache, url, value) {
  if (!url || !value) return;
  cache.set(url, value);
  if (cache.size > PROBE_CACHE_MAX) cache.delete(cache.keys().next().value);
}

function probeableUrls(urls, limit) {
  return [...new Set((urls || []).filter((u) => typeof u === 'string' && /^https?:/i.test(u)))].slice(0, limit);
}

async function probeImageTypes(urls) {
  const out = {};
  await ITK.mapLimit(probeableUrls(urls, PROBE_TYPE_LIMIT), 6, async (url) => {
    if (!typeProbeCache.has(url)) rememberProbe(typeProbeCache, url, await probeType(url));
    if (typeProbeCache.has(url)) out[url] = typeProbeCache.get(url);
  });
  return out;
}

async function probeImageSizes(urls) {
  const out = {};
  const budget = { bytes: PROBE_BODY_BUDGET };
  await ITK.mapLimit(probeableUrls(urls, PROBE_SIZE_LIMIT), 6, async (url) => {
    if (!sizeProbeCache.has(url)) rememberProbe(sizeProbeCache, url, await probeRemoteSize(url, budget));
    if (sizeProbeCache.has(url)) out[url] = sizeProbeCache.get(url);
  });
  return out;
}

// Resolves once headers arrive; the body is never read. Like every automatic request (size and
// type probes), it carries no cookies: Chrome would otherwise send them, SameSite=Lax included.
async function fetchHeaders(url, init, timeoutMs = 4000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { cache: 'force-cache', ...init, credentials: 'omit', signal: controller.signal });
    if (!response.ok && response.status !== 206) throw new Error(`HTTP ${response.status}`);
    return response;
  } finally {
    clearTimeout(timer);
    controller.abort(); // drop any body we did not read
  }
}

async function probeType(url) {
  for (const init of [{ method: 'HEAD' }, { headers: { Range: 'bytes=0-0' } }]) {
    try {
      const response = await fetchHeaders(url, init);
      const type = ITK.mimeToType(response.headers.get('content-type'));
      if (type) return type;
    } catch {}
  }
  return null;
}

async function probeRemoteSize(url, budget) {
  for (const init of [{ method: 'HEAD' }, { headers: { Range: 'bytes=0-0' } }]) {
    try {
      const size = ITK.parseSizeFromHeaders((await fetchHeaders(url, init)).headers);
      if (size > 0) return size;
    } catch {}
  }
  if (budget.bytes <= 0) return 0;
  return countBodyBytes(url, PROBE_BODY_CAP, 8000, budget);
}

// Last resort for servers that send no length: stream and count, with a byte and time cap.
async function countBodyBytes(url, cap, timeoutMs, budget) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { cache: 'force-cache', credentials: 'omit', signal: controller.signal });
    if (!response.ok || !response.body) return 0;
    const declared = ITK.parseSizeFromHeaders(response.headers);
    if (declared > 0) return declared;
    const reader = response.body.getReader();
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return total;
      total += value.byteLength;
      budget.bytes -= value.byteLength;
      if (total > cap || budget.bytes < 0) return 0;
    }
  } catch {
    return 0;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
