// ============================================================
// ImageToolkit – Adjust Image (Cropper.js)
// ============================================================
'use strict';
let customMessages = null;

function _(k, s) {
  if (customMessages && customMessages[k]) {
    let msg = customMessages[k].message || k;
    if (s && Array.isArray(s)) {
      s.forEach((val, i) => {
        msg = msg.replace(new RegExp(`\\$${i + 1}`, 'g'), val);
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

function localizeUI() {
  document.querySelectorAll('[data-i18n]').forEach(e => { const m = _(e.dataset.i18n); if (m !== e.dataset.i18n) e.textContent = m; });
  document.querySelectorAll('[data-i18n-title]').forEach(e => { const m = _(e.dataset.i18nTitle); if (m !== e.dataset.i18nTitle) e.title = m; });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(e => { const m = _(e.dataset.i18nPlaceholder); if (m !== e.dataset.i18nPlaceholder) e.placeholder = m; });
}

document.addEventListener('DOMContentLoaded', async () => {
  // Load settings and apply theme + custom locale
  const s = await new Promise(r => chrome.runtime.sendMessage({ action: 'getSettings' }, r));

  const t = s?.theme || 'auto'; const app = document.getElementById('app');
  if (t === 'auto') app.classList.add(matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light');
  else app.classList.add(t);

  if (s?.locale && s.locale !== 'auto') await loadCustomLocale(s.locale);
  localizeUI();

  const info = document.getElementById('info-text');

  // Get image URL from storage (supports long URLs + data URLs)
  // Fallback to query parameter for backward compat
  const qp = new URLSearchParams(window.location.search).get('imageUrl');
  
  async function getImageUrl() {
    if (qp) return qp;
    return new Promise((resolve) => {
      chrome.storage.local.get('_resizeImageUrl', (r) => {
        const url = r?._resizeImageUrl || '';
        // Clean up after reading
        chrome.storage.local.remove('_resizeImageUrl');
        resolve(url);
      });
    });
  }

  getImageUrl().then(imageUrl => {
    if (!imageUrl) { info.textContent = '❌ ' + _('errorNoImage'); return; }
    initCropper(imageUrl);
  });

  function initCropper(imageUrl) {

  // Elements
  const cropImg = document.getElementById('cropper-img');
  const cropW = document.getElementById('crop-w'), cropH = document.getElementById('crop-h');
  const outW = document.getElementById('out-w'), outH = document.getElementById('out-h');
  const btnLock = document.getElementById('btn-lock');
  const btnApply = document.getElementById('btn-apply-dims');
  const btnSave = document.getElementById('btn-save'), btnReset = document.getElementById('btn-reset');
  const fmtSel = document.getElementById('resize-format');
  const bgGroup = document.getElementById('bg-group');

  let cropper = null;
  let locked = true;
  const lockSvg = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>';
  const unlockSvg = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 019.9-1"/></svg>';
  let hasAlpha = false;
  let origW = 0, origH = 0;

  // ===== Load image =====
  // Chain: 1) fetch via background (CORS bypass) → 2) direct with crossOrigin → 3) direct without
  info.textContent = _('loadingImageInfo');
  
  async function loadImage() {
    // Already a data URL? Use directly
    if (imageUrl.startsWith('data:')) {
      cropImg.src = imageUrl;
      return;
    }
    
    // Try 1: fetch through background service worker
    try {
      const r = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout')), 15000);
        chrome.runtime.sendMessage({ action: 'fetchAsDataUrl', imageUrl }, (res) => {
          clearTimeout(timeout);
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          if (res?.error) return reject(new Error(res.error));
          if (res?.dataUrl) return resolve(res.dataUrl);
          reject(new Error('No data'));
        });
      });
      cropImg.src = r;
      return;
    } catch {}

    // Try 2: direct with crossOrigin
    try {
      await new Promise((resolve, reject) => {
        const test = new Image();
        test.crossOrigin = 'anonymous';
        const timeout = setTimeout(() => { test.src = ''; reject(new Error('Timeout')); }, 10000);
        test.onload = () => { clearTimeout(timeout); cropImg.crossOrigin = 'anonymous'; cropImg.src = imageUrl; resolve(); };
        test.onerror = () => { clearTimeout(timeout); reject(new Error('CORS')); };
        test.src = imageUrl;
      });
      return;
    } catch {}

    // Try 3: direct without crossOrigin (shows image but canvas tainted)
    cropImg.src = imageUrl;
  }

  loadImage().catch(() => {
    info.textContent = '⚠️ ' + _('errorNoImage');
  });

  cropImg.addEventListener('load', () => {
    // Detect transparency
    hasAlpha = detectAlpha(cropImg);
    // Always show bg preview for PNG/SVG (canvas may be tainted, can't detect alpha)
    const isPngSvg = /\.(png|svg)/i.test(imageUrl.split('?')[0]) || /^data:image\/(png|svg)/.test(imageUrl);
    if (hasAlpha || isPngSvg) bgGroup.style.display = '';

    origW = cropImg.naturalWidth;
    origH = cropImg.naturalHeight;
    info.textContent = `${_('customResizeTitle')}: ${origW} × ${origH} px`;

    // Init Cropper.js
    cropper = new Cropper(cropImg, {
      viewMode: 1,
      dragMode: 'crop',
      autoCropArea: 0.8,
      responsive: true,
      restore: false,
      guides: true,
      center: true,
      highlight: true,
      cropBoxMovable: true,
      cropBoxResizable: true,
      toggleDragModeOnDblclick: false,
      crop(event) {
        const d = event.detail;
        const w = Math.round(d.width), h = Math.round(d.height);
        cropW.value = w; cropH.value = h;
        // Sync output if not manually overridden
        if (!outW._manual) outW.value = w;
        if (!outH._manual) outH.value = h;
      }
    });
  });

  cropImg.addEventListener('error', () => {
    info.textContent = '⚠️ ' + _('errorNoImage');
  });

  // ===== Lock ratio =====
  btnLock.addEventListener('click', () => {
    locked = !locked;
    btnLock.classList.toggle('active', locked);
    btnLock.innerHTML = locked ? lockSvg : unlockSvg;
    if (cropper) {
      const data = cropper.getCropBoxData();
      if (locked && data.width && data.height) {
        cropper.setAspectRatio(data.width / data.height);
      } else {
        cropper.setAspectRatio(NaN);
      }
    }
  });

  // ===== Apply dimensions to crop box =====
  btnApply.addEventListener('click', () => {
    if (!cropper) return;
    const w = parseInt(cropW.value, 10), h = parseInt(cropH.value, 10);
    if (!w || !h) return;
    // Set aspect ratio and resize crop box
    if (locked) cropper.setAspectRatio(w / h);
    const containerData = cropper.getContainerData();
    const imageData = cropper.getImageData();
    // Scale crop box to match requested ratio within image
    const scale = Math.min(imageData.width / w, imageData.height / h, 1);
    cropper.setCropBoxData({
      left: (containerData.width - w * scale) / 2,
      top: (containerData.height - h * scale) / 2,
      width: w * scale,
      height: h * scale,
    });
  });

  // ===== Output size manual override =====
  outW.addEventListener('input', () => { outW._manual = true; });
  outH.addEventListener('input', () => { outH._manual = true; });

  // ===== Presets =====
  // Fixed-size presets (data-preset="WxH")
  document.querySelectorAll('[data-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!cropper) return;
      clearPresetActive();
      btn.classList.add('active');
      const val = btn.dataset.preset;
      if (val === 'free') {
        locked = false; btnLock.classList.remove('active'); btnLock.innerHTML = unlockSvg;
        cropper.setAspectRatio(NaN);
        outW._manual = false; outH._manual = false;
        return;
      }
      if (val === 'custom') {
        // Keep current crop, just unlock ratio for manual entry
        locked = false; btnLock.classList.remove('active'); btnLock.innerHTML = unlockSvg;
        cropper.setAspectRatio(NaN);
        return;
      }
      const [w, h] = val.split('x').map(Number);
      locked = true; btnLock.classList.add('active'); btnLock.innerHTML = lockSvg;
      cropper.setAspectRatio(w / h);
      outW.value = w; outH.value = h;
      outW._manual = true; outH._manual = true;
      maximizeCropBox(w / h);
    });
  });

  // Aspect-ratio-only presets (data-preset-ratio="WxH")
  document.querySelectorAll('[data-preset-ratio]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!cropper) return;
      clearPresetActive();
      btn.classList.add('active');
      const [rw, rh] = btn.dataset.presetRatio.split('x').map(Number);
      locked = true; btnLock.classList.add('active'); btnLock.innerHTML = lockSvg;
      cropper.setAspectRatio(rw / rh);
      outW._manual = false; outH._manual = false;
      maximizeCropBox(rw / rh);
    });
  });

  function clearPresetActive() {
    document.querySelectorAll('[data-preset], [data-preset-ratio]').forEach(b => b.classList.remove('active'));
  }

  function maximizeCropBox(targetRatio) {
    const canvasData = cropper.getCanvasData();
    let boxW, boxH;
    if (canvasData.width / canvasData.height >= targetRatio) {
      boxH = canvasData.height;
      boxW = boxH * targetRatio;
    } else {
      boxW = canvasData.width;
      boxH = boxW / targetRatio;
    }
    cropper.setCropBoxData({
      left: canvasData.left + (canvasData.width - boxW) / 2,
      top: canvasData.top + (canvasData.height - boxH) / 2,
      width: boxW,
      height: boxH,
    });
  }

  // ===== Background preview =====
  document.querySelectorAll('.bg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.bg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const bg = btn.dataset.bg;
      const area = document.getElementById('crop-area');
      const checker = 'conic-gradient(#ccc 25%,#fff 25% 50%,#ccc 50% 75%,#fff 75%) 0 0/14px 14px';
      const bgVal = bg === 'checker' ? checker : bg;

      // Use setProperty with !important to override CSS !important rules
      area.style.setProperty('background', bgVal, 'important');

      // Set on all Cropper.js internal layers
      const targets = [
        '.cropper-container',
        '.cropper-wrap-box',
        '.cropper-canvas',
        '.cropper-view-box',
      ];
      targets.forEach(sel => {
        const el = area.querySelector(sel);
        if (el) el.style.setProperty('background', bgVal, 'important');
      });
    });
  });

  // ===== Rotate & Flip =====
  document.getElementById('btn-rotate-left')?.addEventListener('click', () => {
    if (cropper) cropper.rotate(-90);
  });
  document.getElementById('btn-flip-h')?.addEventListener('click', () => {
    if (cropper) {
      const d = cropper.getData();
      cropper.scaleX(d.scaleX === -1 ? 1 : -1);
    }
  });
  document.getElementById('btn-flip-v')?.addEventListener('click', () => {
    if (cropper) {
      const d = cropper.getData();
      cropper.scaleY(d.scaleY === -1 ? 1 : -1);
    }
  });

  // ===== Reset =====
  btnReset.addEventListener('click', () => {
    if (!cropper) return;
    cropper.reset();
    cropper.setAspectRatio(NaN);
    locked = false; btnLock.classList.remove('active'); btnLock.innerHTML = unlockSvg;
    outW._manual = false; outH._manual = false;
  });

  // ===== Save =====
  btnSave.addEventListener('click', async () => {
    if (!cropper) return;
    btnSave.disabled = true;
    btnSave.textContent = '⏳ ' + _('processing');

    try {
      const cropData = cropper.getData(true); // rounded integer values
      const format = fmtSel.value;
      const finalW = parseInt(outW.value, 10) || cropData.width;
      const finalH = parseInt(outH.value, 10) || cropData.height;

      // Get cropped canvas
      const canvas = cropper.getCroppedCanvas({
        width: finalW,
        height: finalH,
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'high',
      });

      if (!canvas) {
        btnSave.textContent = '❌ ' + _('errorSaveFailed');
        btnSave.disabled = false;
        return;
      }

      // Handle background for JPEG (no alpha)
      let outputCanvas = canvas;
      if (format === 'jpeg' && hasAlpha) {
        outputCanvas = document.createElement('canvas');
        outputCanvas.width = canvas.width;
        outputCanvas.height = canvas.height;
        const ctx = outputCanvas.getContext('2d');
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(canvas, 0, 0);
      }

      const mimeType = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : format === 'avif' ? 'image/avif' : 'image/png';
      const settings = await new Promise(r => chrome.runtime.sendMessage({ action: 'getSettings' }, r));
      const quality = format === 'png' ? undefined : ((settings?.defaultQuality || 85) / 100);
      const dataUrl = outputCanvas.toDataURL(mimeType, quality);

      // Download via background
      const ext = format === 'jpeg' ? 'jpg' : format;
      const filename = `imagetoolkit_${finalW}x${finalH}.${ext}`;
      chrome.runtime.sendMessage({
        action: 'downloadBlob',
        dataUrl,
        filename,
        saveAs: settings?.saveAs !== false,
      }, (r) => {
        btnSave.disabled = false;
        if (r?.error) {
          btnSave.textContent = '❌ ' + r.error;
        } else {
          btnSave.textContent = '✅ ' + _('notifSavedAs').replace('$FORMAT$', format.toUpperCase());
          setTimeout(() => { btnSave.textContent = '💾 ' + _('saveImage'); }, 2500);
        }
      });
    } catch (err) {
      btnSave.disabled = false;
      btnSave.textContent = '💾 ' + _('saveImage');
    }
  });
  } // end initCropper
});

// ===== Detect transparency =====
function detectAlpha(img) {
  try {
    const c = document.createElement('canvas');
    const size = Math.min(img.naturalWidth, img.naturalHeight, 200);
    const scale = size / Math.max(img.naturalWidth, img.naturalHeight);
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < data.length; i += 16) {
      if (data[i] < 250) return true;
    }
    return false;
  } catch {
    return false;
  }
}

