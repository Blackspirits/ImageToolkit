// ============================================================
// ImageToolkit – Editor window (Cropper.js)
// Crop · rotate/flip · resize · convert · save or copy
// Requires lib/core.js, lib/i18n.js, lib/ui.js, lib/handoff.js and lib/cropper.min.js.
// ============================================================

'use strict';

const { i18n, ui, handoff } = ITK;
const { toast, send, flashError, withBusy, blobToDataUrl } = ui;
const t = i18n.t;
const $ = (id) => document.getElementById(id);

const editor = {
  cropper: null,
  source: '',        // original URL (used for the filename)
  hasAlpha: false,
  locked: false,
  outputManual: false,
  outputAnchor: 'w',   // the output side the user typed last; the other follows the crop's ratio
  settings: {},
};

document.addEventListener('DOMContentLoaded', async () => {
  editor.settings = (await send({ action: 'getSettings' })) || {};
  const app = $('app');
  ui.applyTheme(app, editor.settings.theme);
  ui.followSystemTheme(app, () => ui.applyTheme(app, 'auto'));
  await i18n.load(editor.settings.locale);
  i18n.apply();

  initFooter();
  initControls();
  initKeyboard();

  const key = new URLSearchParams(location.search).get('key');
  const source = await handoff.get(key).catch(() => null);
  if (!source) { showStatus(t('errorNoImage'), true); return; }
  editor.source = typeof source === 'string' ? source : '';
  loadImage(source);
});

function showStatus(message, isError = false) {
  const status = $('stage-status');
  status.hidden = !message;
  status.classList.toggle('error', isError);
  if (message) status.replaceChildren(isError ? ui.icon('alert', 'i') : Object.assign(document.createElement('div'), { className: 'spinner' }), ui.el('span', { text: message }));
}

// ---------- Loading ----------
// Remote images are fetched through the service worker so the canvas is never tainted.
async function resolveSource(source) {
  if (source instanceof Blob) return blobToDataUrl(source);
  if (source.startsWith('data:')) return source;
  const res = await send({ action: 'fetchAsDataUrl', imageUrl: source });
  if (res?.dataUrl) return res.dataUrl;
  return source; // last resort: displays, but saving may fail if the host forbids CORS
}

// Give Cropper a box with the image's own proportions, so no empty bands surround it.
function fitStage(img) {
  const area = $('crop-area');
  const maxW = area.clientWidth - 56, maxH = area.clientHeight - 120;
  if (!img.naturalWidth || !img.naturalHeight || maxW <= 0 || maxH <= 0) return;
  const { width, height } = ITK.stageSize(img.naturalWidth, img.naturalHeight, maxW, maxH);
  const inner = area.querySelector('.crop-inner');
  inner.style.width = `${width}px`;
  inner.style.height = `${height}px`;
}

async function loadImage(source) {
  const img = $('cropper-img');
  img.addEventListener('load', () => {
    fitStage(img);
    // Registered before Cropper's own resize handler, so the box is resized first.
    window.addEventListener('resize', () => fitStage(img));
    initCropper(img);
  }, { once: true });
  img.addEventListener('error', () => showStatus(t('errorNoImage'), true), { once: true });
  const src = await resolveSource(source);
  if (!src.startsWith('data:')) img.crossOrigin = 'anonymous';
  img.src = src;
}

function initCropper(img) {
  editor.hasAlpha = detectAlpha(img);
  $('bg-group').hidden = !editor.hasAlpha;
  $('info-text').textContent = `${img.naturalWidth} × ${img.naturalHeight} px`;
  showStatus('');

  editor.cropper = new Cropper(img, {
    viewMode: 1,
    dragMode: 'crop',
    autoCropArea: 0.86,
    background: false,
    responsive: true,
    restore: true,
    guides: true,
    center: true,
    highlight: true,
    toggleDragModeOnDblclick: true,
    wheelZoomRatio: 0.08,
    crop(event) {
      const { w, h } = roundedSize(event.detail);
      if (document.activeElement !== $('crop-w')) $('crop-w').value = w;
      if (document.activeElement !== $('crop-h')) $('crop-h').value = h;
      if (!editor.outputManual) { $('out-w').value = w; $('out-h').value = h; }
      else followCropRatio(event.detail.width / event.detail.height);
      const info = $('crop-info');
      info.hidden = false;
      info.textContent = `${w} × ${h}`;
    },
  });
}

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
    return false; // tainted canvas (host refused CORS)
  }
}

// A manual output size keeps the side the user typed and gives the other side the crop's
// proportions, so the saved image is exactly the size shown and is never stretched.
function followCropRatio(ratio) {
  if (!(ratio > 0)) return;
  const w = parseInt($('out-w').value, 10), h = parseInt($('out-h').value, 10);
  if (editor.outputAnchor === 'h' && h > 0) $('out-w').value = Math.max(1, Math.round(h * ratio));
  else if (w > 0) $('out-h').value = Math.max(1, Math.round(w / ratio));
}

// ---------- Controls ----------
function setLocked(locked) {
  editor.locked = locked;
  const btn = $('btn-lock');
  btn.classList.toggle('active', locked);
  btn.setAttribute('aria-pressed', String(locked));
  btn.querySelector('use').setAttribute('href', locked ? '#i-lock' : '#i-unlock');
}

function clearPresetActive() {
  document.querySelectorAll('[data-preset], [data-preset-ratio]').forEach((b) => b.classList.remove('active'));
}

function maximizeCropBox(ratio) {
  const { cropper } = editor;
  const canvas = cropper.getCanvasData();
  let width = canvas.width, height = canvas.height;
  if (width / height > ratio) width = height * ratio;
  else height = width / ratio;
  cropper.setCropBoxData({ left: canvas.left + (canvas.width - width) / 2, top: canvas.top + (canvas.height - height) / 2, width, height });
}

// Same rounding as cropper.getData(true) (edges, not width), so every size shown matches.
function roundedSize(d) {
  const x = Math.round(d.x), y = Math.round(d.y);
  return { w: Math.round(d.x + d.width) - x, h: Math.round(d.y + d.height) - y };
}

function cropRatio() {
  const d = editor.cropper?.getData();
  return d && d.width && d.height ? d.width / d.height : 0;
}

function initControls() {
  const need = (fn) => (...args) => { if (editor.cropper) fn(...args); };

  $('btn-lock').addEventListener('click', need(() => {
    setLocked(!editor.locked);
    editor.cropper.setAspectRatio(editor.locked ? cropRatio() : NaN);
  }));
  setLocked(false);

  // Apply an exact crop size (in image pixels), centred.
  $('btn-apply-dims').addEventListener('click', need(() => {
    const w = parseInt($('crop-w').value, 10), h = parseInt($('crop-h').value, 10);
    if (!(w > 0)) { flashError($('crop-w')); return; }
    if (!(h > 0)) { flashError($('crop-h')); return; }
    const image = editor.cropper.getImageData();
    const cw = Math.min(w, image.naturalWidth), ch = Math.min(h, image.naturalHeight);
    if (editor.locked) editor.cropper.setAspectRatio(cw / ch);
    editor.cropper.setData({ x: (image.naturalWidth - cw) / 2, y: (image.naturalHeight - ch) / 2, width: cw, height: ch });
  }));
  ['crop-w', 'crop-h'].forEach((id) => $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-apply-dims').click(); }));
  // With the ratio locked, typing one side of the crop fills in the other.
  $('crop-w').addEventListener('input', () => {
    const ratio = editor.locked && cropRatio(), w = parseInt($('crop-w').value, 10);
    if (ratio && w > 0) $('crop-h').value = Math.round(w / ratio);
  });
  $('crop-h').addEventListener('input', () => {
    const ratio = editor.locked && cropRatio(), h = parseInt($('crop-h').value, 10);
    if (ratio && h > 0) $('crop-w').value = Math.round(h * ratio);
  });

  // Output size: typing one side keeps the crop's proportions.
  $('out-w').addEventListener('input', () => {
    editor.outputManual = true;
    editor.outputAnchor = 'w';
    followCropRatio(cropRatio());
  });
  $('out-h').addEventListener('input', () => {
    editor.outputManual = true;
    editor.outputAnchor = 'h';
    followCropRatio(cropRatio());
  });

  document.querySelectorAll('[data-preset]').forEach((btn) => btn.addEventListener('click', need(() => {
    clearPresetActive();
    btn.classList.add('active');
    const value = btn.dataset.preset;
    if (value === 'free' || value === 'custom') {
      setLocked(false);
      editor.cropper.setAspectRatio(NaN);
      // Both go back to "output follows the crop"; a fixed size from an earlier preset
      // would otherwise stretch any new crop to the old proportions.
      editor.outputManual = false;
      if (value === 'free') {
        const image = editor.cropper.getImageData();
        editor.cropper.setData({ x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight });
      } else {
        const data = editor.cropper.getData(true);
        $('out-w').value = data.width;
        $('out-h').value = data.height;
      }
      return;
    }
    const [w, h] = value.split('x').map(Number);
    setLocked(true);
    editor.cropper.setAspectRatio(w / h);
    maximizeCropBox(w / h);
    $('out-w').value = w;
    $('out-h').value = h;
    editor.outputManual = true;
    editor.outputAnchor = 'w';
  })));

  document.querySelectorAll('[data-preset-ratio]').forEach((btn) => btn.addEventListener('click', need(() => {
    clearPresetActive();
    btn.classList.add('active');
    const [w, h] = btn.dataset.presetRatio.split('x').map(Number);
    setLocked(true);
    editor.outputManual = false;
    editor.cropper.setAspectRatio(w / h);
    maximizeCropBox(w / h);
  })));

  $('btn-rotate-left').addEventListener('click', need(() => editor.cropper.rotate(-90)));
  $('btn-flip-h').addEventListener('click', need(() => editor.cropper.scaleX(-(editor.cropper.getData().scaleX || 1))));
  $('btn-flip-v').addEventListener('click', need(() => editor.cropper.scaleY(-(editor.cropper.getData().scaleY || 1))));
  $('btn-reset').addEventListener('click', need(() => {
    editor.cropper.reset();
    editor.cropper.setAspectRatio(NaN);
    setLocked(false);
    editor.outputManual = false;
    clearPresetActive();
  }));

  document.querySelectorAll('.bg-btn').forEach((btn) => btn.addEventListener('click', () => {
    document.querySelectorAll('.bg-btn').forEach((b) => b.classList.toggle('active', b === btn));
    $('crop-area').style.background = btn.dataset.bg === 'checker' ? '' : btn.dataset.bg;
  }));
}

// ---------- Footer: format, quality, save, copy ----------
function currentFormat() {
  return $('resize-format').querySelector('.seg.active')?.dataset.value || 'webp';
}

function initFooter() {
  const group = $('resize-format');
  const showQuality = (value) => { $('quality-row').hidden = value === 'png'; };
  ui.setRadio(group, editor.settings.defaultFormat || 'webp');
  ui.initRadioGroup(group, showQuality);
  showQuality(currentFormat());

  const range = $('resize-quality');
  const paint = () => {
    $('resize-quality-value').textContent = `${range.value}%`;
    range.style.setProperty('--pct', `${((range.value - range.min) / (range.max - range.min)) * 100}%`);
  };
  range.value = editor.settings.defaultQuality ?? 85;
  paint();
  range.addEventListener('input', paint);

  $('btn-save').addEventListener('click', () => withBusy($('btn-save'), save));
  $('btn-copy').addEventListener('click', () => withBusy($('btn-copy'), copy));
}

// The canvas is exactly the size shown in "Output size". Cropper's own sizing keeps the
// crop's aspect ratio and may return something smaller, so the crop is taken at its native
// resolution and scaled into a canvas of the requested size.
function croppedCanvas(format) {
  const data = editor.cropper.getData(true);
  const width = parseInt($('out-w').value, 10) || data.width;
  const height = parseInt($('out-h').value, 10) || data.height;
  ITK.checkOutputSize(width, height);
  // JPEG has no alpha channel; anything else keeps transparency.
  const fillColor = format === 'jpeg' ? '#ffffff' : 'transparent';
  const source = editor.cropper.getCroppedCanvas({ imageSmoothingEnabled: true, imageSmoothingQuality: 'high', fillColor });
  if (!source) throw new Error(t('errorSaveFailed'));
  if (source.width === width && source.height === height) return source;
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (format === 'jpeg') { ctx.fillStyle = fillColor; ctx.fillRect(0, 0, width, height); }
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}

function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error(t('errorSaveFailed')))), mime, quality);
    } catch (err) {
      reject(err); // tainted canvas (host refused CORS)
    }
  });
}

async function encode(format) {
  const canvas = croppedCanvas(format);
  const quality = format === 'png' ? undefined : parseInt($('resize-quality').value, 10) / 100;
  let blob = await canvasToBlob(canvas, ITK.outputMime(format), quality);
  // Chrome cannot encode AVIF from a canvas and silently returns PNG; use WebP instead.
  if (format === 'avif' && blob.type !== 'image/avif') blob = await canvasToBlob(canvas, 'image/webp', quality);
  return { blob, width: canvas.width, height: canvas.height, format: ITK.formatFromMime(blob.type) || format };
}

async function save() {
  if (!editor.cropper) return;
  try {
    const { blob, width, height, format } = await encode(currentFormat());
    const s = editor.settings;
    const filename = ITK.buildFilename(/^https?:/i.test(editor.source) ? editor.source : 'https://local/imagetoolkit', {
      format, cropWidth: width, cropHeight: height,
      subfolder: s.subfolder, filenamePattern: s.filenamePattern, filenamePrefix: s.filenamePrefix,
    });
    const res = await ui.saveBlob(blob, filename, s.saveAs !== false);
    if (res.cancelled) return;
    toast(`${t('notifSavedAs', [ITK.formatLabel(format)])} · ${width} × ${height} · ${ITK.formatBytes(blob.size)}`);
  } catch (err) {
    toast(`${t('errorSaveFailed')}: ${err.message}`, 'error');
  }
}

async function copy() {
  if (!editor.cropper) return;
  try {
    const png = encode('png').then((r) => r.blob);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    toast(t('notifCopied'));
  } catch (err) {
    toast(`${t('errorCopyFailed')}: ${err.message}`, 'error');
  }
}

function initKeyboard() {
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); $('btn-save').click(); return; }
    if (mod && e.key.toLowerCase() === 'c' && !typing && !getSelection().toString()) { e.preventDefault(); $('btn-copy').click(); }
  });
}
