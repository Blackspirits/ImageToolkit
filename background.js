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
const OUTPUT_FORMATS = new Set(['png', 'jpeg', 'webp', 'avif']);
const MAX_FETCH_BYTES = 40 * 1024 * 1024; // base64 must fit in one extension message
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

chrome.runtime.onInstalled.addListener(async () => {
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

  let instructions = {};
  if (id.startsWith('save-as-')) {
    const fmt = id.replace('save-as-', '');
    instructions = { format: fmt === 'jpg' ? 'jpeg' : fmt };
  } else if (id === 'resize-1080') {
    instructions = { format: 'jpeg', resizeWidth: 1080 };
  }

  await processAndSave(imageUrl, instructions, settings);
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === 'capture-area') startCapture(tab?.id).catch(() => {});
});

// ---------- Message Handler ----------
// Content scripts run inside the page's renderer, so they may only trigger the
// few actions they actually need. Everything else is reserved for extension pages.
const EXTENSION_ORIGIN = chrome.runtime.getURL('');
const CONTENT_SCRIPT_ACTIONS = new Set(['captureSelection', 'newImagesDetected']);

function isExtensionPage(sender) {
  return sender?.id === chrome.runtime.id && (sender.url || '').startsWith(EXTENSION_ORIGIN);
}

// Handlers return a value or a promise; the result is sent back to the caller.
const handlers = {
  getSettings: () => getSettings(),

  processAndSave: (msg) => processAndSave(msg.imageUrl, msg.instructions, null),

  processAndReturnData: (msg) => {
    const instructions = sanitizeInstructions(msg.instructions);
    return instructions.passthrough ? fetchOriginal(msg.imageUrl) : processImage(msg.imageUrl, instructions);
  },

  fetchAsDataUrl: async (msg) => {
    const blob = await fetchImageBlob(msg.imageUrl);
    return { dataUrl: await blobToDataUrl(blob) };
  },

  downloadBlob: (msg) => {
    const url = typeof msg.dataUrl === 'string' ? msg.dataUrl : '';
    const isAllowedUrl = url.startsWith('blob:') || /^data:(image\/[a-z0-9.+-]+|application\/zip);/i.test(url);
    if (!isAllowedUrl) return { error: 'Unsupported download URL' };
    const filename = ITK.sanitizeFilename(msg.filename || 'download', true) || 'download';
    return triggerDownload(url, filename, msg.saveAs !== false).then(() => ({ success: true }));
  },

  collectImages: (msg) => collectImages(msg.tabId),
  highlightImages: (msg) => {
    if (Number.isInteger(msg.tabId)) {
      chrome.tabs.sendMessage(msg.tabId, { action: 'highlightImages', urls: msg.urls || [] }).catch(() => {});
    }
    return { success: true };
  },

  startCapture: (msg) => startCapture(msg.tabId, msg.delay),
  captureVisible: (msg) => captureVisible(msg.tabId),
  openEditor: (msg) => openEditor(msg.imageUrl).then(() => ({ success: true })),

  copyDataUrlToClipboard: (msg) => offscreenRequest({ action: 'offscreen-copy', imageDataUrl: msg.dataUrl }, 15000),
  copyTextToClipboard: (msg) => offscreenRequest({ action: 'offscreen-copy-text', text: String(msg.text || '') }, 15000),

  probeImageSizes: (msg) => probeImageSizes(msg.urls || []),
  probeImageTypes: (msg) => probeImageTypes(msg.urls || []),

  // ----- From content scripts -----
  captureSelection: (msg, sender) => captureSelection(sender.tab, msg.rect),
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

  let images = await requestImages(tabId);
  if (images) return { images };

  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['lib/core.js', 'content.js'] });
  } catch {
    return { images: [], error: 'restricted' };
  }

  images = await requestImages(tabId);
  return { images: images || [] };
}

function requestImages(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { action: 'getImages' }, (images) => {
      resolve(chrome.runtime.lastError ? null : (images || []));
    });
  });
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
async function fetchImageBlob(imageUrl) {
  if (!ITK.isAllowedImageSrc(String(imageUrl || ''))) throw new Error('Unsupported image URL');

  let response;
  try {
    // Cookies help with images behind a login; retry without them on network errors.
    response = await fetch(imageUrl, { credentials: 'include' });
  } catch {
    response = await fetch(imageUrl);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const declared = ITK.parseSizeFromHeaders(response.headers);
  if (declared > MAX_FETCH_BYTES) throw new Error(`Image too large (${ITK.formatBytes(declared)})`);

  const blob = await response.blob();
  if (!blob.size) throw new Error('Empty response');
  if (blob.size > MAX_FETCH_BYTES) throw new Error(`Image too large (${ITK.formatBytes(blob.size)})`);
  return blob;
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
  const isGenericMime = !mime || mime === 'application/octet-stream';
  const format = ITK.sniffImageType(head)
    || ITK.mimeToType(mime)
    || (isGenericMime ? ITK.extensionToType(imageUrl) : null);
  if (!format) throw new Error('Unsupported image type');

  return { dataUrl: await blobToDataUrl(blob), originalSize: blob.size, newSize: blob.size, format };
}

// ---------- Processing ----------
function toBoundedInt(value) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= 1 && n <= ITK.MAX_SIDE ? n : undefined;
}

// Messages are untrusted input: keep only known fields with sane values.
function sanitizeInstructions(raw) {
  const ins = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  if (ins.passthrough) out.passthrough = true;
  const format = ins.format === 'jpg' ? 'jpeg' : ins.format;
  out.format = OUTPUT_FORMATS.has(format) ? format : 'png';
  if (ins.quality != null) out.quality = Math.min(1, Math.max(0.1, Number(ins.quality) || 0.85));
  for (const key of ['width', 'height', 'resizeWidth', 'cropWidth', 'cropHeight']) {
    const value = toBoundedInt(ins[key]);
    if (value) out[key] = value;
  }
  if (ins.fitMode) out.fitMode = true;
  if (typeof ins.saveAs === 'boolean') out.saveAs = ins.saveAs;
  if (ins.silent) out.silent = true;
  if (/^#[0-9a-f]{6}$/i.test(ins.jpgBackground || '')) out.jpgBackground = ins.jpgBackground;
  for (const key of ['subfolder', 'filenamePattern', 'filenamePrefix']) {
    if (typeof ins[key] === 'string') out[key] = ins[key].slice(0, 120);
  }
  return out;
}

async function processImage(imageUrl, instructions) {
  const blob = await fetchImageBlob(imageUrl);
  const dataUrl = await blobToDataUrl(blob);
  const result = await offscreenRequest({ action: 'offscreen-process', imageDataUrl: dataUrl, instructions });
  return { ...result, originalSize: blob.size };
}

async function processAndSave(imageUrl, rawInstructions, settings) {
  const instructions = sanitizeInstructions(rawInstructions);
  try {
    if (!settings) settings = await loadSettingsAndLocale();
    if (instructions.quality == null) instructions.quality = settings.defaultQuality / 100;
    if (!instructions.jpgBackground) instructions.jpgBackground = settings.jpgBackground || '#FFFFFF';
    for (const key of ['subfolder', 'filenamePattern', 'filenamePrefix']) {
      if (instructions[key] == null) instructions[key] = settings[key];
    }

    const result = instructions.passthrough
      ? await fetchOriginal(imageUrl)
      : await processImage(imageUrl, instructions);
    // Name the file after the format actually produced (e.g. AVIF falls back to WebP).
    const filename = ITK.buildFilename(imageUrl, { ...instructions, format: result.format });

    // Batch downloads pass saveAs: false so they never open one dialog per image.
    await triggerDownload(result.dataUrl, filename, instructions.saveAs ?? settings.saveAs);

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
function triggerDownload(url, filename, saveAs = true) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download({ url, filename, saveAs, conflictAction: 'uniquify' }, (downloadId) => {
      const error = chrome.runtime.lastError;
      if (!downloadId) {
        // Closing the Save As dialog is not an error worth reporting.
        if (error && !/cancel/i.test(error.message)) {
          reject(new Error(error.message));
          return;
        }
      }
      resolve(downloadId);
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

async function captureSelection(tab, rect) {
  if (tab?.windowId == null || !rect) return { error: 'noTab' };
  try {
    const dataUrl = await captureTab(tab.windowId);
    const cropped = await offscreenRequest({ action: 'offscreen-crop', dataUrl, rect }, 15000)
      .then((r) => r.dataUrl || dataUrl)
      .catch(() => dataUrl);
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
async function openEditor(imageUrl) {
  if (!imageUrl) return;
  const key = await handoff.put(imageUrl);
  await chrome.windows.create({ url: `resize.html?key=${encodeURIComponent(key)}`, ...EDITOR_WINDOW, focused: true });
}

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
const PROBE_BODY_CAP = 25 * 1024 * 1024;
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
  await ITK.mapLimit(probeableUrls(urls, PROBE_SIZE_LIMIT), 6, async (url) => {
    if (!sizeProbeCache.has(url)) rememberProbe(sizeProbeCache, url, await probeRemoteSize(url));
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

async function probeRemoteSize(url) {
  for (const init of [{ method: 'HEAD' }, { headers: { Range: 'bytes=0-0' } }]) {
    try {
      const size = ITK.parseSizeFromHeaders((await fetchHeaders(url, init)).headers);
      if (size > 0) return size;
    } catch {}
  }
  return countBodyBytes(url, PROBE_BODY_CAP, 8000);
}

// Last resort for servers that send no length: stream and count, with a byte and time cap.
async function countBodyBytes(url, cap, timeoutMs) {
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
      if (total > cap) return 0;
    }
  } catch {
    return 0;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
