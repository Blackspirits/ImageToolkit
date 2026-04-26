// ============================================================
// ImageToolkit – Background Service Worker
// Context menus · Message routing · Offscreen management · Downloads
// ============================================================

'use strict';

// ---------- i18n Helper ----------
const i18n = (key, substitutions) => {
  try {
    return chrome.i18n.getMessage(key, substitutions) || key;
  } catch {
    return key;
  }
};

// ---------- Constants ----------
const FORMATS = ['png', 'jpg', 'webp', 'avif'];

const SOCIAL_PRESETS = {
  'instagram-post':  { label: 'Instagram Post',    w: 1080, h: 1080 },
  'instagram-story': { label: 'Instagram Story',   w: 1080, h: 1920 },
  'tiktok':          { label: 'TikTok 9:16',       w: 1080, h: 1920 },
  'youtube-thumb':   { label: 'YouTube Thumbnail',  w: 1280, h: 720  },
  'twitter-post':    { label: 'X/Twitter Post',    w: 1200, h: 675  },
  'linkedin-banner': { label: 'LinkedIn Banner',   w: 1584, h: 396  },
  'wallpaper-hd':    { label: 'Wallpaper 1920×1080', w: 1920, h: 1080 },
};

const DEFAULT_SETTINGS = {
  defaultQuality: 85,
  defaultFormat: 'webp',
  saveAs: true,
  jpgBackground: '#FFFFFF',
  resizeBehavior: 'crop',
  showNotification: true,
  enableSocialPresets: true,
  theme: 'auto',
  openAsSidePanel: true,
};

// ---------- Context Menu Setup ----------
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    // Parent menu
    chrome.contextMenus.create({
      id: 'imagetoolkit-parent',
      title: i18n('menuParent'),
      contexts: ['image'],
    });

    // Format items
    FORMATS.forEach((fmt) => {
      chrome.contextMenus.create({
        id: `save-as-${fmt}`,
        title: i18n('menuSaveAs', [fmt.toUpperCase()]),
        parentId: 'imagetoolkit-parent',
        contexts: ['image'],
      });
    });

    // Separator
    chrome.contextMenus.create({
      id: 'sep-1',
      type: 'separator',
      parentId: 'imagetoolkit-parent',
      contexts: ['image'],
    });

    // Copy to clipboard
    chrome.contextMenus.create({
      id: 'copy-to-clipboard',
      title: i18n('menuCopyClipboard'),
      parentId: 'imagetoolkit-parent',
      contexts: ['image'],
    });

    // Separator
    chrome.contextMenus.create({
      id: 'sep-2',
      type: 'separator',
      parentId: 'imagetoolkit-parent',
      contexts: ['image'],
    });

    // Resize presets
    chrome.contextMenus.create({
      id: 'resize-1080',
      title: i18n('menuResize1080'),
      parentId: 'imagetoolkit-parent',
      contexts: ['image'],
    });

    chrome.contextMenus.create({
      id: 'custom-resize',
      title: i18n('menuCustomResize'),
      parentId: 'imagetoolkit-parent',
      contexts: ['image'],
    });
  });

  // Initialize default settings and side panel behavior
  chrome.storage.sync.get(['settings'], (result) => {
    if (!result.settings) {
      chrome.storage.sync.set({ settings: DEFAULT_SETTINGS });
    }
    applySidePanelBehavior(result.settings || DEFAULT_SETTINGS);
  });
});

// ---------- Side Panel Behavior ----------
function applySidePanelBehavior(settings) {
  // Default to true (side panel) — only disable if explicitly set to false
  const openAsPanel = settings.openAsSidePanel !== false;
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: openAsPanel }).catch(() => {});
}

// Listen for settings changes
chrome.storage.onChanged.addListener((changes) => {
  if (changes.settings?.newValue) applySidePanelBehavior(changes.settings.newValue);
});

// ---------- Context Menu Click Handler ----------
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const imageUrl = info.srcUrl;
  if (!imageUrl) {
    notify(i18n('errorNoImage'));
    return;
  }

  // Custom resize opens a separate window
  if (info.menuItemId === 'custom-resize') {
    openCustomResizeWindow(imageUrl);
    return;
  }

  // Copy to clipboard
  if (info.menuItemId === 'copy-to-clipboard') {
    await processAndCopy(imageUrl, tab);
    return;
  }

  const settings = await getSettings();
  let instructions = {};

  if (info.menuItemId.startsWith('save-as-')) {
    const fmt = info.menuItemId.replace('save-as-', '');
    instructions = {
      format: fmt === 'jpg' ? 'jpeg' : fmt,
      quality: settings.defaultQuality / 100,
    };
  } else if (info.menuItemId === 'resize-1080') {
    instructions = {
      format: 'jpeg',
      quality: settings.defaultQuality / 100,
      resizeWidth: 1080,
    };
  } else if (info.menuItemId.startsWith('social-')) {
    const presetKey = info.menuItemId.replace('social-', '');
    const preset = SOCIAL_PRESETS[presetKey];
    if (!preset) return;
    instructions = {
      format: 'jpeg',
      quality: settings.defaultQuality / 100,
      cropWidth: preset.w,
      cropHeight: preset.h,
    };
  }

  await processAndSave(imageUrl, instructions, settings);
});

// ---------- Message Handler ----------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { action } = message;

  if (action === 'processAndSave') {
    processAndSave(message.imageUrl, message.instructions, null)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (action === 'processAndReturnData') {
    processImage(message.imageUrl, message.instructions)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  // Fetch image and return as data URL (for crop tool CORS bypass)
  if (action === 'fetchAsDataUrl') {
    (async () => {
      try {
        // Try with credentials first (some servers need cookies)
        let resp;
        try {
          resp = await fetch(message.imageUrl, { credentials: 'include' });
        } catch {
          // Fallback without credentials
          resp = await fetch(message.imageUrl);
        }
        if (!resp.ok) { sendResponse({ error: `HTTP ${resp.status}` }); return; }
        const blob = await resp.blob();
        if (blob.size === 0) { sendResponse({ error: 'Empty response' }); return; }
        const reader = new FileReader();
        reader.onloadend = () => sendResponse({ dataUrl: reader.result });
        reader.onerror = () => sendResponse({ error: 'Failed to read image' });
        reader.readAsDataURL(blob);
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  if (action === 'getSettings') {
    getSettings().then((s) => sendResponse(s));
    return true;
  }

  if (action === 'downloadBlob') {
    triggerDownload(message.dataUrl, message.filename, message.saveAs);
    sendResponse({ success: true });
    return false;
  }

  if (action === 'collectImages') {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) { sendResponse([]); return; }

        // Try sending message first (content script may already be injected)
        let images = await trySendMessage(tab.id);
        if (images) { sendResponse(images); return; }

        // Inject content script and retry
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js'],
        }).catch(() => {});

        if (chrome.runtime.lastError) { sendResponse([]); return; }

        // Small delay to let content script initialize
        await new Promise((r) => setTimeout(r, 100));

        images = await trySendMessage(tab.id);
        sendResponse(images || []);
      } catch {
        sendResponse([]);
      }
    })();
    return true;
  }

  // ===== Capture: inject selection overlay =====
  if (action === 'startCapture') {
    chrome.tabs.query({ active: true, currentWindow: true }, async ([tab]) => {
      if (!tab?.id) { sendResponse({ error: 'No tab' }); return; }
      // Resolve hint string respecting locale override
      const settings = await getSettings();
      let hint = i18n('captureHint');
      if (settings.locale && settings.locale !== 'auto') {
        try {
          const resp = await fetch(chrome.runtime.getURL(`_locales/${settings.locale}/messages.json`));
          if (resp.ok) {
            const msgs = await resp.json();
            if (msgs.captureHint?.message) hint = msgs.captureHint.message;
          }
        } catch {}
      }
      // Inject hint variable, then capture script
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (h) => { window.__imagetoolkit_hint = h; },
        args: [hint],
      }).catch(() => {});
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['capture.js'],
      }, () => sendResponse({ success: true }));
    });
    return true;
  }

  // ===== Capture: screenshot + crop from selection =====
  if (action === 'captureSelection') {
    const rect = message.rect;
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (!tab?.id) return;
      chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
        if (!dataUrl) return;
        // Crop via offscreen
        cropScreenshot(dataUrl, rect).then((cropped) => {
          // Open in resize tool for further editing
          chrome.storage.local.set({ _resizeImageUrl: cropped }, () => {
            chrome.windows.create({
              url: 'resize.html',
              type: 'popup', width: 900, height: 720, focused: true,
            });
          });
        });
      });
    });
    return false;
  }

  // ===== Highlight images on page =====
  if (action === 'highlightImages') {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (!tab?.id) return;
      chrome.tabs.sendMessage(tab.id, {
        action: 'highlightImages',
        urls: message.urls || [],
      }).catch(() => {});
    });
    sendResponse({ success: true });
    return false;
  }

  // ===== New images detected by content script observer =====
  if (action === 'newImagesDetected') {
    // Relay to popup/side panel if open
    chrome.runtime.sendMessage({
      action: 'newImagesAvailable',
      count: message.count || 0,
    }).catch(() => {}); // popup may not be open
    return false;
  }

  if (action === 'openCustomResize') {
    openCustomResizeWindow(message.imageUrl);
    sendResponse({ success: true });
    return false;
  }

  if (action === 'copyToClipboard') {
    processAndCopy(message.imageUrl, null)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (action === 'copyDataUrlToClipboard') {
    copyDataUrlToClipboard(message.dataUrl)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (action === 'copyTextToClipboard') {
    copyTextToClipboard(message.text || '')
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (action === 'probeImageSizes') {
    probeImageSizes(message.urls || [])
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({}));
    return true;
  }

  // Probe image types via HEAD requests (no CORS in service worker)
  if (action === 'probeImageTypes') {
    probeImageTypes(message.urls || [])
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({}));
    return true;
  }

  // Offscreen response
  if (action === 'offscreen-response' && message.id) {
    const pending = pendingRequests.get(message.id);
    if (pending) {
      clearTimeout(pending.timeout);
      pendingRequests.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error));
      } else if (message.copied) {
        pending.resolve({ success: true });
      } else {
        pending.resolve({
          dataUrl: message.dataUrl,
          originalSize: pending.originalSize,
          newSize: message.newSize,
          width: message.width,
          height: message.height,
          format: message.format,
          hasAlpha: message.hasAlpha,
        });
      }
    }
    return false;
  }

  return false;
});

// ---------- Try Send Message to Tab ----------
function trySendMessage(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { action: 'getImages' }, (images) => {
      if (chrome.runtime.lastError) {
        resolve(null); // Content script not ready
      } else {
        resolve(images || []);
      }
    });
  });
}

// ---------- Offscreen Document Management ----------
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

  if (offscreenCreating) {
    await offscreenCreating;
    return;
  }

  offscreenCreating = chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: [chrome.offscreen.Reason.DOM_SCRAPING, chrome.offscreen.Reason.BLOBS, chrome.offscreen.Reason.CLIPBOARD],
    justification: 'Canvas-based image processing, metadata probing, and clipboard operations',
  }).catch((err) => {
    if (!err.message?.includes('Only a single offscreen')) {
      throw err;
    }
  });

  await offscreenCreating;
  offscreenCreating = null;
}

// ---------- Fetch Image ----------
async function fetchImageAsDataUrl(imageUrl) {
  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const blob = await response.blob();
  const originalSize = blob.size;

  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to read blob'));
    reader.readAsDataURL(blob);
  });

  return { dataUrl, originalSize };
}

// ---------- Process Image via Offscreen ----------
const pendingRequests = new Map();
let requestIdCounter = 0;

async function processImage(imageUrl, instructions) {
  const { dataUrl, originalSize } = await fetchImageAsDataUrl(imageUrl);
  await ensureOffscreen();

  const id = ++requestIdCounter;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error('Processing timed out (30s)'));
    }, 30000);

    pendingRequests.set(id, { resolve, reject, timeout, originalSize });

    chrome.runtime.sendMessage({
      action: 'offscreen-process',
      id,
      imageDataUrl: dataUrl,
      originalSize,
      instructions,
    });
  });
}

// ---------- Process and Save ----------
async function processAndSave(imageUrl, instructions, settings) {
  try {
    if (!settings) settings = await getSettings();
    if (instructions.quality == null) {
      instructions.quality = settings.defaultQuality / 100;
    }
    instructions.jpgBackground = settings.jpgBackground || '#FFFFFF';

    const result = await processImage(imageUrl, instructions);
    const filename = buildFilename(imageUrl, instructions);

    triggerDownload(result.dataUrl, filename, settings.saveAs);

    if (settings.showNotification) {
      showSaveNotification(filename, result.originalSize, result.newSize, instructions.format);
    }

    return { success: true, filename, ...result };
  } catch (err) {
    notify(`${i18n('errorSaveFailed')}: ${err.message}`);
    return { error: err.message };
  }
}


// ---------- Process and Copy to Clipboard ----------
async function processAndCopy(imageUrl) {
  try {
    const settings = await getSettings();
    const instructions = {
      format: 'png',
      quality: 1.0,
      jpgBackground: settings.jpgBackground || '#FFFFFF',
    };
    const result = await processImage(imageUrl, instructions);
    const copyResult = await copyDataUrlToClipboard(result.dataUrl);
    if (copyResult?.error) throw new Error(copyResult.error);
    notify(i18n('notifCopied'));
    return { success: true };
  } catch (err) {
    notify(`${i18n('errorCopyFailed')}: ${err.message}`);
    return { error: err.message };
  }
}

async function copyDataUrlToClipboard(dataUrl) {
  await ensureOffscreen();
  const id = ++requestIdCounter;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error('Clipboard timed out (15s)'));
    }, 15000);

    pendingRequests.set(id, { resolve, reject, timeout, originalSize: 0 });
    chrome.runtime.sendMessage({
      action: 'offscreen-copy',
      id,
      imageDataUrl: dataUrl,
    });
  });
}

async function copyTextToClipboard(text) {
  await ensureOffscreen();
  const id = ++requestIdCounter;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error('Clipboard timed out (15s)'));
    }, 15000);

    pendingRequests.set(id, { resolve, reject, timeout, originalSize: 0 });
    chrome.runtime.sendMessage({
      action: 'offscreen-copy-text',
      id,
      text,
    });
  });
}

// ---------- Side Panel Support ----------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'openSidePanel') {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (tab) {
        chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
      }
    });
    sendResponse({ success: true });
    return false;
  }
});

// ---------- Filename Sanitization ----------
function sanitizeFilename(input, allowSlash = false) {
  if (!input) return allowSlash ? '' : 'image';
  const illegal = allowSlash ? /[\\?<>:*|"]/g : /[\/\\?<>:*|"]/g;
  let name = input
    .replace(illegal, '')
    .replace(/[\x00-\x1f\x80-\x9f]/g, '')
    .replace(/^\.+$/, 'image')
    .replace(/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i, 'image')
    .replace(/[\s.]+$/g, '')
    .trim();
  if (!allowSlash && name.length > 60) name = name.substring(0, 60).replace(/[^a-zA-Z0-9]+$/i, '');
  return name || (allowSlash ? '' : 'image');
}

function buildFilename(imageUrl, instructions) {
  let baseName = 'image';
  try {
    const urlPath = new URL(imageUrl).pathname;
    baseName = urlPath.split('/').pop().split('?')[0].split('#')[0];
    baseName = decodeURIComponent(baseName);
    baseName = baseName.replace(/\.(jpe?g|png|gif|webp|avif|svg|bmp|tiff?)$/i, '');
  } catch {
    baseName = 'image';
  }

  baseName = sanitizeFilename(baseName);

  // Filename pattern
  const pattern = instructions.filenamePattern || 'original';
  if (pattern === 'system') {
    baseName = `imagetoolkit_${Date.now()}`;
  } else if (pattern === 'custom') {
    const prefix = sanitizeFilename(instructions.filenamePrefix || 'img_');
    baseName = `${prefix}${baseName}`;
  }

  // Suffix for resize/crop
  let suffix = '';
  if (instructions.resizeWidth) suffix = `_${instructions.resizeWidth}px`;
  if (instructions.cropWidth) suffix = `_${instructions.cropWidth}x${instructions.cropHeight}`;

  // Extension
  const fmt = instructions.format || 'png';
  const ext = fmt === 'jpeg' ? 'jpg' : fmt;

  // Subfolder
  const sub = sanitizeFilename(instructions.subfolder || '', true);
  const path = sub ? `${sub}/${baseName}${suffix}.${ext}` : `${baseName}${suffix}.${ext}`;
  return path;
}

// ---------- Download ----------
function triggerDownload(dataUrl, filename, saveAs = true) {
  chrome.downloads.download({
    url: dataUrl,
    filename,
    saveAs,
    conflictAction: 'uniquify',
  }, (downloadId) => {
    if (!downloadId && chrome.runtime.lastError) {
      notify(`${i18n('errorOnSaving')}: ${chrome.runtime.lastError.message}`);
    }
  });
}

// ---------- Custom Resize Window ----------
// ---------- Screenshot Crop ----------
async function cropScreenshot(dataUrl, rect) {
  // Use offscreen canvas to crop the screenshot
  await ensureOffscreen();
  const id = ++requestIdCounter;
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(id);
      resolve(dataUrl); // Fallback: return uncropped
    }, 15000);
    pendingRequests.set(id, {
      resolve: (r) => { clearTimeout(timeout); resolve(r.dataUrl || dataUrl); },
      reject: () => { clearTimeout(timeout); resolve(dataUrl); },
      timeout, originalSize: 0,
    });
    chrome.runtime.sendMessage({
      action: 'offscreen-crop',
      id,
      dataUrl,
      rect,
    });
  });
}

function openCustomResizeWindow(imageUrl) {
  // Store URL in local storage (handles long URLs and data URLs)
  chrome.storage.local.set({ _resizeImageUrl: imageUrl }, () => {
    chrome.windows.create({
      url: 'resize.html',
      type: 'popup',
      width: 900,
      height: 720,
      focused: true,
    });
  });
}

// ---------- Notifications ----------
function notify(msg) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: i18n('extShortName'),
    message: typeof msg === 'string' ? msg : String(msg),
    priority: 1,
  });
}

function showSaveNotification(filename, originalSize, newSize, format) {
  const reduction = originalSize > 0
    ? Math.round((1 - newSize / originalSize) * 100)
    : 0;
  const fmtLabel = format === 'jpeg' ? 'JPG' : (format || 'PNG').toUpperCase();
  const sizeInfo = `${formatBytes(originalSize)} → ${formatBytes(newSize)}`;
  const reductionInfo = reduction > 0 ? ` (${reduction}% ${i18n('smaller')})` : '';

  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: `✅ ${i18n('notifSavedAs', [fmtLabel])}`,
    message: `${sizeInfo}${reductionInfo}`,
    priority: 1,
  });
}

function formatBytes(bytes) {
  if (!bytes || bytes < 0) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(2) + ' MB';
}


// ---------- Type Probing & Metadata ----------
const MIME_TO_TYPE = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/avif': 'avif',
  'image/bmp': 'bmp', 'image/tiff': 'tiff', 'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
};

async function probeImageTypes(urls) {
  const out = {};
  await mapLimit(urls.slice(0, 30), 6, async (url) => {
    const type = await probeType(url);
    if (type) out[url] = type;
  });
  return out;
}

async function probeImageSizes(urls) {
  const out = {};
  await mapLimit(urls, 6, async (url) => {
    const size = await probeRemoteSize(url);
    if (size > 0) out[url] = size;
  });
  return out;
}

async function probeType(url) {
  try {
    const response = await fetchWithFallback(url, { method: 'HEAD', cache: 'force-cache' }, true);
    const ct = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    return MIME_TO_TYPE[ct] || null;
  } catch {
    return null;
  }
}

async function probeRemoteSize(url) {
  try {
    const head = await fetchWithFallback(url, { method: 'HEAD', cache: 'force-cache' }, true);
    let size = parseSizeFromHeaders(head.headers);
    if (size > 0) return size;
  } catch {}

  try {
    const range = await fetchWithFallback(url, { headers: { Range: 'bytes=0-0' }, cache: 'force-cache' }, true);
    let size = parseSizeFromHeaders(range.headers);
    if (size > 0) return size;
  } catch {}

  try {
    const full = await fetchWithFallback(url, { cache: 'force-cache' }, false);
    let size = parseSizeFromHeaders(full.headers);
    if (size > 0) return size;
    const blob = await full.blob();
    return blob.size || 0;
  } catch {
    return 0;
  }
}

function parseSizeFromHeaders(headers) {
  const len = headers.get('content-length');
  if (len && /^\d+$/.test(len)) return parseInt(len, 10);
  const range = headers.get('content-range');
  if (range) {
    const match = /\/(\d+)$/.exec(range);
    if (match) return parseInt(match[1], 10);
  }
  return 0;
}

async function fetchWithFallback(url, init, allowGetFallback) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok && response.status !== 206) throw new Error(`HTTP ${response.status}`);
    return response;
  } catch (err) {
    if (allowGetFallback && (init.method === 'HEAD' || !init.method)) {
      const fallbackController = new AbortController();
      const fallbackTimeout = setTimeout(() => fallbackController.abort(), 4000);
      try {
        const response = await fetch(url, { headers: { Range: 'bytes=0-0' }, cache: 'force-cache', signal: fallbackController.signal });
        if (!response.ok && response.status !== 206) throw new Error(`HTTP ${response.status}`);
        return response;
      } finally {
        clearTimeout(fallbackTimeout);
      }
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
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

// ---------- Settings ----------

function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['settings'], (result) => {
      resolve({ ...DEFAULT_SETTINGS, ...(result.settings || {}) });
    });
  });
}
