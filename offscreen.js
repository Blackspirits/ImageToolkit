// ============================================================
// ImageToolkit – Offscreen Engine
// Canvas-based conversion · Resize · Crop · Clipboard support
// ============================================================

'use strict';

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'offscreen-process') {
    handleProcess(message)
      .then((result) => {
        chrome.runtime.sendMessage({ action: 'offscreen-response', id: message.id, ...result });
      })
      .catch((err) => {
        chrome.runtime.sendMessage({ action: 'offscreen-response', id: message.id, error: err.message || 'Unknown processing error' });
      });
    return false;
  }

  if (message.action === 'offscreen-copy') {
    handleCopy(message)
      .then(() => {
        chrome.runtime.sendMessage({ action: 'offscreen-response', id: message.id, copied: true });
      })
      .catch((err) => {
        chrome.runtime.sendMessage({ action: 'offscreen-response', id: message.id, error: err.message || 'Clipboard write failed' });
      });
    return false;
  }

  if (message.action === 'offscreen-copy-text') {
    handleCopyText(message)
      .then(() => {
        chrome.runtime.sendMessage({ action: 'offscreen-response', id: message.id, copied: true });
      })
      .catch((err) => {
        chrome.runtime.sendMessage({ action: 'offscreen-response', id: message.id, error: err.message || 'Clipboard write failed' });
      });
    return false;
  }

  if (message.action === 'offscreen-crop') {
    handleCrop(message)
      .then((dataUrl) => {
        chrome.runtime.sendMessage({ action: 'offscreen-response', id: message.id, dataUrl });
      })
      .catch((err) => {
        chrome.runtime.sendMessage({ action: 'offscreen-response', id: message.id, error: err.message });
      });
    return false;
  }

  return false;
});

// ---------- Main Processing Pipeline ----------
async function handleProcess(message) {
  const { imageDataUrl, instructions } = message;
  const img = await loadImage(imageDataUrl);
  const hasAlpha = detectAlpha(img);
  const dims = calculateDimensions(img, instructions);

  const canvas = document.createElement('canvas');
  canvas.width = dims.outWidth;
  canvas.height = dims.outHeight;
  const ctx = canvas.getContext('2d');

  const format = instructions.format || 'png';
  if (format === 'jpeg' || format === 'jpg') {
    ctx.fillStyle = instructions.jpgBackground || '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  if (instructions.fitMode && instructions.cropWidth) {
    drawFitMode(ctx, img, dims, instructions);
  } else if (instructions.cropWidth) {
    ctx.drawImage(img, dims.sx, dims.sy, dims.sw, dims.sh, 0, 0, dims.outWidth, dims.outHeight);
  } else {
    ctx.drawImage(img, 0, 0, dims.outWidth, dims.outHeight);
  }

  const mimeType = getMimeType(format);
  const quality = format === 'png' ? undefined : (instructions.quality || 0.85);
  const blob = await canvasToBlob(canvas, mimeType, quality);

  if (format === 'avif' && blob.type !== 'image/avif') {
    const fallbackBlob = await canvasToBlob(canvas, 'image/webp', quality);
    const dataUrl = await blobToDataUrl(fallbackBlob);
    return {
      dataUrl,
      newSize: fallbackBlob.size,
      width: dims.outWidth,
      height: dims.outHeight,
      format: 'webp',
      hasAlpha,
    };
  }

  const dataUrl = await blobToDataUrl(blob);
  return {
    dataUrl,
    newSize: blob.size,
    width: dims.outWidth,
    height: dims.outHeight,
    format,
    hasAlpha,
  };
}

async function handleCopy(message) {
  const blob = await dataUrlToBlob(message.imageDataUrl);
  const clipboardBlob = blob.type === 'image/png' ? blob : await convertBlobToPng(blob);
  
  // Try Clipboard API first (needs focus)
  try {
    if (self.ClipboardItem && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': clipboardBlob })
      ]);
      return;
    }
  } catch {}

  // Fallback: canvas → img → selection → execCommand
  try {
    const dataUrl = await blobToDataUrl(clipboardBlob);
    const img = document.createElement('img');
    img.src = dataUrl;
    document.body.appendChild(img);
    const range = document.createRange();
    range.selectNode(img);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('copy');
    sel.removeAllRanges();
    img.remove();
    return;
  } catch {}

  throw new Error('Clipboard API unavailable');
}

async function handleCopyText(message) {
  const text = message.text || '';
  
  // Try Clipboard API first
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {}

  // Fallback: textarea + execCommand
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;left:-9999px;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
}

// ---------- Dimension Calculation ----------
function calculateDimensions(img, instructions) {
  let outWidth = img.naturalWidth;
  let outHeight = img.naturalHeight;
  let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;

  if (instructions.cropWidth && instructions.cropHeight) {
    const targetW = instructions.cropWidth;
    const targetH = instructions.cropHeight;
    const targetRatio = targetW / targetH;
    const imgRatio = img.naturalWidth / img.naturalHeight;

    if (instructions.fitMode) {
      outWidth = targetW;
      outHeight = targetH;
    } else {
      if (imgRatio > targetRatio) {
        sh = img.naturalHeight;
        sw = Math.round(sh * targetRatio);
        sx = Math.round((img.naturalWidth - sw) / 2);
      } else {
        sw = img.naturalWidth;
        sh = Math.round(sw / targetRatio);
        sy = Math.round((img.naturalHeight - sh) / 2);
      }
      outWidth = targetW;
      outHeight = targetH;
    }
  } else if (instructions.resizeWidth) {
    outWidth = instructions.resizeWidth;
    outHeight = Math.round(img.naturalHeight * (instructions.resizeWidth / img.naturalWidth));
  } else if (instructions.width) {
    outWidth = instructions.width;
    outHeight = instructions.height
      ? instructions.height
      : Math.round(img.naturalHeight * (instructions.width / img.naturalWidth));
  }

  return { outWidth, outHeight, sx, sy, sw, sh };
}

function drawFitMode(ctx, img, dims, instructions) {
  ctx.fillStyle = instructions.jpgBackground || '#000000';
  ctx.fillRect(0, 0, dims.outWidth, dims.outHeight);

  const targetRatio = instructions.cropWidth / instructions.cropHeight;
  const imgRatio = img.naturalWidth / img.naturalHeight;
  let drawW, drawH, drawX, drawY;

  if (imgRatio > targetRatio) {
    drawW = dims.outWidth;
    drawH = Math.round(dims.outWidth / imgRatio);
    drawX = 0;
    drawY = Math.round((dims.outHeight - drawH) / 2);
  } else {
    drawH = dims.outHeight;
    drawW = Math.round(dims.outHeight * imgRatio);
    drawX = Math.round((dims.outWidth - drawW) / 2);
    drawY = 0;
  }

  ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, drawX, drawY, drawW, drawH);
}

function detectAlpha(img) {
  try {
    const canvas = document.createElement('canvas');
    const size = Math.min(img.naturalWidth, img.naturalHeight, 100);
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, size, size);
    const data = ctx.getImageData(0, 0, size, size).data;
    for (let i = 3; i < data.length; i += 16) {
      if (data[i] < 250) return true;
    }
  } catch {}
  return false;
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to decode image'));
    img.src = dataUrl;
  });
}

function getMimeType(format) {
  const map = { png: 'image/png', jpeg: 'image/jpeg', jpg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif' };
  return map[format] || 'image/png';
}

function canvasToBlob(canvas, mimeType, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Canvas toBlob failed')), mimeType, quality);
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
  const dataUrl = await blobToDataUrl(blob);
  const img = await loadImage(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  return canvasToBlob(canvas, 'image/png');
}

// ---------- Screenshot Crop ----------
async function handleCrop(message) {
  const { dataUrl, rect } = message;
  const img = await loadImage(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(rect.width);
  canvas.height = Math.round(rect.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img,
    Math.round(rect.x), Math.round(rect.y),
    Math.round(rect.width), Math.round(rect.height),
    0, 0, canvas.width, canvas.height
  );
  return canvas.toDataURL('image/png');
}
