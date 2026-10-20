// ============================================================
// ImageToolkit – Offscreen Engine
// Canvas-based conversion · Resize · Crop · Clipboard fallback
// Requires lib/core.js.
// ============================================================

'use strict';

// Only the service worker (or another extension page) may drive this document.
const EXTENSION_ORIGIN = chrome.runtime.getURL('');

const OFFSCREEN_HANDLERS = {
  'offscreen-process': (message) => handleProcess(message),
  'offscreen-analyze': (message) => handleAnalyze(message),
  'offscreen-copy': (message) => handleCopy(message).then(() => ({ copied: true })),
  'offscreen-copy-text': (message) => handleCopyText(message).then(() => ({ copied: true })),
  'offscreen-crop': (message) => handleCrop(message).then((dataUrl) => ({ dataUrl })),
};

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!ITK.isExtensionSender(sender, chrome.runtime.id, EXTENSION_ORIGIN)) return false;
  const handler = OFFSCREEN_HANDLERS[message?.action];
  if (!handler) return false;

  handler(message)
    .then((result) => chrome.runtime.sendMessage({ action: 'offscreen-response', id: message.id, ...result }))
    .catch((err) => chrome.runtime.sendMessage({ action: 'offscreen-response', id: message.id, error: err?.message || 'Processing failed' }));
  return false;
});

// ---------- Main Processing Pipeline ----------
async function handleProcess(message) {
  const { imageDataUrl, instructions = {} } = message;
  const img = await loadImage(imageDataUrl);
  const naturalWidth = img.naturalWidth || 0;
  const naturalHeight = img.naturalHeight || 0;
  if (!naturalWidth || !naturalHeight) throw new Error('Image has no intrinsic size');

  const hasAlpha = detectAlpha(img);
  const dims = ITK.calculateDimensions(naturalWidth, naturalHeight, instructions);
  ITK.checkOutputSize(dims.outWidth, dims.outHeight);

  const canvas = document.createElement('canvas');
  canvas.width = dims.outWidth;
  canvas.height = dims.outHeight;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const format = instructions.format || 'png';
  const isJpeg = format === 'jpeg' || format === 'jpg';
  // JPEG has no alpha channel: paint the background instead of letting it turn black.
  if (isJpeg) {
    ctx.fillStyle = instructions.jpgBackground || '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  if (instructions.fitMode && instructions.cropWidth) {
    const box = ITK.letterboxRect(naturalWidth, naturalHeight, dims.outWidth, dims.outHeight);
    ctx.drawImage(img, box.x, box.y, box.w, box.h);
  } else {
    ctx.drawImage(img, dims.sx, dims.sy, dims.sw, dims.sh, 0, 0, dims.outWidth, dims.outHeight);
  }

  const quality = format === 'png' ? undefined : (instructions.quality || 0.85);
  let blob = await canvasToBlob(canvas, ITK.outputMime(format), quality);

  // Chrome cannot encode AVIF from a canvas and silently returns PNG instead.
  // Fall back to WebP (closest in size/quality) and report the real format.
  if (format === 'avif' && blob.type !== 'image/avif') {
    blob = await canvasToBlob(canvas, 'image/webp', quality);
  }

  // The result travels back as base64 in one message; refuse what cannot fit.
  if (blob.size > ITK.MAX_IMAGE_BYTES) {
    throw new Error(`Encoded image too large (${ITK.formatBytes(blob.size)})`);
  }

  return {
    dataUrl: await blobToDataUrl(blob),
    newSize: blob.size,
    width: dims.outWidth,
    height: dims.outHeight,
    format: ITK.formatFromMime(blob.type) || format,
    hasAlpha,
  };
}

// ---------- Format Advisor ----------
// Decodes once and encodes the same pixels in every requested format; only sizes go back.
async function handleAnalyze(message) {
  const img = await loadImage(message.imageDataUrl);
  const width = img.naturalWidth || 0, height = img.naturalHeight || 0;
  if (!width || !height) throw new Error('Image has no intrinsic size');
  ITK.checkOutputSize(width, height);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const quality = message.quality || 0.85;
  const results = [];
  for (const format of message.formats || []) {
    ctx.clearRect(0, 0, width, height);
    if (format === 'jpeg') {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(img, 0, 0);
    const blob = await canvasToBlob(canvas, ITK.outputMime(format), format === 'png' ? undefined : quality);
    results.push({ format: ITK.formatFromMime(blob.type) || format, size: blob.size });
  }
  return { results, hasAlpha: detectAlpha(img), width, height };
}

// ---------- Clipboard fallback ----------
// Only used when the page cannot be scripted; the offscreen document has no focus,
// so this can fail and the caller reports the error.
async function handleCopy(message) {
  const blob = await dataUrlToBlob(message.imageDataUrl);
  const pngBlob = blob.type === 'image/png' ? blob : await convertBlobToPng(blob);
  if (self.ClipboardItem && navigator.clipboard?.write) {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
    return;
  }
  throw new Error('Clipboard API unavailable');
}

async function handleCopyText(message) {
  const text = String(message.text || '');
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {}

  // execCommand works without focus in an offscreen document with the CLIPBOARD reason.
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  if (!ok) throw new Error('Clipboard write failed');
}

// ---------- Helpers ----------
function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function detectAlpha(img) {
  try {
    return ITK.hasTransparency(img, img.naturalWidth, img.naturalHeight, makeCanvas);
  } catch {
    return false;
  }
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to decode image'));
    img.src = dataUrl;
  });
}

function canvasToBlob(canvas, mimeType, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Canvas toBlob failed'))), mimeType, quality);
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to read blob'));
    reader.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(dataUrl) {
  const res = await fetch(dataUrl);
  return res.blob();
}

async function convertBlobToPng(blob) {
  const img = await loadImage(await blobToDataUrl(blob));
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext('2d').drawImage(img, 0, 0);
  return canvasToBlob(canvas, 'image/png');
}

// ---------- Screenshot Crop ----------
async function handleCrop(message) {
  const { dataUrl, rect } = message;
  const img = await loadImage(dataUrl);
  const x = Math.round(rect.x), y = Math.round(rect.y);
  if (!(x >= 0 && y >= 0 && x < img.naturalWidth && y < img.naturalHeight)) throw new Error('Selection outside the captured area');
  // Clamp the far edges to the captured bitmap (zoom/DPR rounding can overshoot by a pixel).
  const width = Math.min(img.naturalWidth - x, Math.round(rect.width));
  const height = Math.min(img.naturalHeight - y, Math.round(rect.height));
  if (!(width >= 1 && height >= 1)) throw new Error('Empty selection');

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(img, x, y, width, height, 0, 0, width, height);
  return canvas.toDataURL('image/png');
}
