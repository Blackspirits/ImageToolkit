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
const EDITOR_WINDOW = { type: 'popup', width: 1440, height: 920 };

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
  MENU_FORMATS.forEach((fmt) => {
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

// Keep runtime-only Chrome settings in sync whenever the service worker wakes up.
async function initializeExtensionRuntime() {
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

  const imageUrl = info.srcUrl;
  if (!imageUrl) {
    notify(t('errorNoImage'), { error: true });
    return;
  }

  if (id === 'custom-resize') { openEditor(imageUrl); return; }
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

  processAndSave: (msg) => processAndSave(msg.imageUrl, msg.instructions, null),

  processAndReturnData: (msg) => {
    const instructions = ITK.sanitizeInstructions(msg.instructions);
    return instructions.passthrough ? fetchOriginal(msg.imageUrl) : processImage(msg.imageUrl, instructions);
  },

  // Keyed by the calling document, so one window never cancels another's analysis.
  analyzeFormats: (msg, sender) => analyzeFormats(msg.imageUrl, analysisKey(sender)),
  cancelAnalysis: (msg, sender) => { analysisControllers.get(analysisKey(sender))?.abort(); return { success: true }; },

  // `maxBytes` lets previews and metadata ask for less than a full-size download.
  fetchAsDataUrl: async (msg) => {
    const maxBytes = Math.min(MAX_FETCH_BYTES, Math.max(1, Number(msg.maxBytes) || MAX_FETCH_BYTES));
    const blob = await fetchImageBlob(msg.imageUrl, { maxBytes });
    return { dataUrl: await blobToDataUrl(blob), size: blob.size };
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
  autoScroll: (msg) => autoScroll(msg.tabId),
  stopAutoScroll: (msg) => stopAutoScroll(msg.tabId),

  startCapture: (msg) => startCapture(msg.tabId, msg.delay),
  captureVisible: (msg) => captureVisible(msg.tabId),
  openEditor: (msg) => openEditor(msg.imageUrl).then(() => ({ success: true })),

  copyDataUrlToClipboard: (msg) => offscreenRequest({ action: 'offscreen-copy', imageDataUrl: msg.dataUrl }, 15000),
  copyTextToClipboard: (msg) => offscreenRequest({ action: 'offscreen-copy-text', text: String(msg.text || '') }, 15000),

  probeImageSizes: (msg) => probeImageSizes(msg.urls || []),
  probeImageTypes: (msg) => probeImageTypes(msg.urls || []),

  // ----- From content scripts -----
  captureSelection: (msg, sender) => captureSelection(sender.tab, msg.rect),
  autoScrollProgress: (msg, sender) => {
    const pct = Math.max(0, Math.min(100, Math.round(Number(msg.pct) || 0)));
    chrome.runtime.sendMessage({ action: 'autoScrollProgressUpdate', tabId: sender.tab?.id, pct }).catch(() => {});
  },
  newImagesDetected: (msg, sender) => {
    chrome.runtime.sendMessage({ action: 'newImagesAvailable', tabId: sender.tab?.id, count: msg.count || 0 }).catch(() => {});
  },
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { action } = message || {};

  if (action === 'offscreen-response') {
    if (isExtensionPage(sender)) settleOffscreenRequest(message);
    return false;
  }

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
async function collectImages(tabId) {
  if (!Number.isInteger(tabId)) return { images: [], error: 'noTab' };

  let result = await requestImages(tabId);
  if (result) return result;

  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['lib/core.js', 'content.js'] });
  } catch {
    return { images: [], error: 'restricted' };
  }

  return (await requestImages(tabId)) || { images: [] };
}

function requestImages(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { action: 'getImages' }, (response) => {
      if (chrome.runtime.lastError || !response) { resolve(null); return; }
      // { images, truncated } — a bare array is accepted for scanners injected by older builds.
      const images = Array.isArray(response) ? response : (Array.isArray(response.images) ? response.images : []);
      resolve({ images, truncated: !!response.truncated });
    });
  });
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
    return injection?.result || { images: [], error: 'failed' };
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
      const overflow = getComputedStyle(el).overflowY;
      if (overflow !== 'auto' && overflow !== 'scroll') continue;
      const area = el.clientWidth * el.clientHeight;
      if (area > bestArea) { best = el; bestArea = area; }
    }
    if (best) scroller = best;
  }
  const isPage = scroller === page;
  const viewHeight = () => (isPage ? innerHeight : scroller.clientHeight);
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
    await frame();
    await sleep(220);
    take();
    const pct = Math.round((100 * top()) / Math.max(1, scroller.scrollHeight - viewHeight()));
    chrome.runtime.sendMessage({ action: 'autoScrollProgress', pct }).catch(() => {});
  }
  scrollTo(startY, startX);
  return { images: [...found.values()], truncated, steps, stopped, timedOut: Date.now() >= deadline };
}

// ---------- Offscreen Document ----------
let offscreenCreating = null;
const pendingRequests = new Map();
let requestIdCounter = 0;

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

async function offscreenRequest(payload, timeoutMs = 30000) {
  await ensureOffscreen();
  const id = ++requestIdCounter;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`Processing timed out (${Math.round(timeoutMs / 1000)}s)`));
    }, timeoutMs);
    pendingRequests.set(id, { resolve, reject, timeout });
    chrome.runtime.sendMessage({ ...payload, id }).catch((err) => {
      // The offscreen document answers with a separate message, so a closed port is expected.
      if (!/Receiving end does not exist/i.test(err?.message || '')) return;
      clearTimeout(timeout);
      pendingRequests.delete(id);
      reject(err);
    });
  });
}

function settleOffscreenRequest(message) {
  const pending = pendingRequests.get(message.id);
  if (!pending) return;
  clearTimeout(pending.timeout);
  pendingRequests.delete(message.id);
  if (message.error) {
    pending.reject(new Error(message.error));
  } else {
    const { action, id, ...result } = message;
    pending.resolve(result);
  }
}

// ---------- Fetching ----------
function tooLarge(bytes) {
  return new Error(`Image too large (${bytes > 0 ? ITK.formatBytes(bytes) : `> ${ITK.formatBytes(MAX_FETCH_BYTES)}`})`);
}

async function fetchImageBlob(imageUrl, { signal, maxBytes = MAX_FETCH_BYTES } = {}) {
  if (!ITK.isFetchableImageSrc(String(imageUrl || ''))) throw new Error('Unsupported image URL');

  let response;
  try {
    // Cookies help with images behind a login; retry without them on network errors.
    response = await fetch(imageUrl, { credentials: 'include', signal });
  } catch (err) {
    if (signal?.aborted) throw err;
    response = await fetch(imageUrl, { signal });
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const declared = ITK.parseSizeFromHeaders(response.headers);
  if (declared > maxBytes) {
    response.body?.cancel().catch(() => {});
    throw tooLarge(declared);
  }

  const blob = await readBodyCapped(response, maxBytes);
  if (!blob.size) throw new Error('Empty response');
  return blob;
}

// Reads the body chunk by chunk and stops as soon as it passes the cap, so a server
// that sends no Content-Length can never push more than `cap` bytes into memory.
async function readBodyCapped(response, cap) {
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
// blob: URLs served by the offscreen document, per download, released once it ends. If the
// service worker restarts in between, the offscreen document's own timer releases them.
const offscreenObjectUrls = new Map();

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
  offscreenObjectUrls.set(downloadId, url);
  return { success: true, downloadId };
}

chrome.downloads.onChanged.addListener((delta) => {
  const url = offscreenObjectUrls.get(delta.id);
  if (!url || !['complete', 'interrupted'].includes(delta.state?.current)) return;
  offscreenObjectUrls.delete(delta.id);
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

  const inject = () => chrome.scripting.executeScript({ target, files: ['capture.js'] }).catch(() => {});
  const delay = Math.min(10, Math.max(0, Number(delaySeconds) || 0));
  if (delay > 0) {
    sleep(delay * 1000).then(inject);
  } else {
    await inject();
  }
  return { success: true };
}

function captureTab(windowId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, (dataUrl) => {
      const error = chrome.runtime.lastError;
      if (error || !dataUrl) reject(new Error(error?.message || 'Capture failed'));
      else resolve(dataUrl);
    });
  });
}

// The rectangle comes from a content script: only finite, positive sizes are accepted.
function validCaptureRect(rect) {
  const values = [rect?.x, rect?.y, rect?.width, rect?.height].map(Number);
  if (!values.every(Number.isFinite)) return null;
  const [x, y, width, height] = values;
  return width >= 1 && height >= 1 && x >= 0 && y >= 0 ? { x, y, width, height } : null;
}

async function captureSelection(tab, rawRect) {
  if (tab?.windowId == null) return { error: 'noTab' };
  try {
    const rect = validCaptureRect(rawRect);
    if (!rect) throw new Error('Invalid selection');
    const dataUrl = await captureTab(tab.windowId);
    // Never fall back to the whole screenshot: the user asked for one area only.
    const { dataUrl: cropped } = await offscreenRequest({ action: 'offscreen-crop', dataUrl, rect }, 15000);
    if (!cropped || !cropped.startsWith('data:image/')) throw new Error('Crop failed');
    await openEditor(cropped);
    return { success: true };
  } catch (err) {
    await loadSettingsAndLocale();
    notify(`${t('errorCaptureFailed')}: ${err.message}`, { error: true });
    return { error: err.message };
  }
}

async function captureVisible(tabId) {
  if (!Number.isInteger(tabId)) return { error: 'noTab' };
  try {
    const tab = await chrome.tabs.get(tabId);
    await openEditor(await captureTab(tab.windowId));
    return { success: true };
  } catch {
    await loadSettingsAndLocale();
    notify(t('errorRestrictedPage'), { error: true });
    return { error: 'restricted' };
  }
}

// ---------- Editor Window ----------
// The handed-off image (a screenshot can be private) only lives as long as its editor
// window, reloads included. The window → key map is in session storage so it survives a
// service worker restart; the 30-minute prune stays as a safety net.
const editorKeyName = (windowId) => `editor:${windowId}`;

async function openEditor(imageUrl) {
  if (!imageUrl) return;
  const key = await handoff.put(imageUrl);
  const win = await chrome.windows.create({ url: `resize.html?key=${encodeURIComponent(key)}`, ...EDITOR_WINDOW, focused: true });
  if (win?.id != null) await chrome.storage.session.set({ [editorKeyName(win.id)]: key }).catch(() => {});
}

chrome.windows.onRemoved.addListener(async (windowId) => {
  const name = editorKeyName(windowId);
  const { [name]: key } = await chrome.storage.session.get(name).catch(() => ({}));
  if (!key) return;
  await chrome.storage.session.remove(name).catch(() => {});
  await handoff.remove(key).catch(() => {});
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

// Resolves once headers arrive; the body is never read.
async function fetchHeaders(url, init, timeoutMs = 4000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { cache: 'force-cache', ...init, signal: controller.signal });
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
    const response = await fetch(url, { cache: 'force-cache', signal: controller.signal });
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
