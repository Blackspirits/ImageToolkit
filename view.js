// ============================================================
// ImageToolkit – Capture viewer
// Shows a screenshot whole, at the tab's width with the page's own scroll, ready to save or
// copy; Crop and Annotate continue in the editor, in the same tab, with the same image.
// Requires lib/core.js, lib/i18n.js, lib/ui.js and lib/handoff.js.
// ============================================================

'use strict';

const { i18n, ui, handoff } = ITK;
const { toast, send, withBusy } = ui;
const t = i18n.t;
const $ = (id) => document.getElementById(id);

const view = {
  settings: {},
  params: new URLSearchParams(location.search),
  blob: null,
  url: '',
  width: 0,
  height: 0,
  fit: true,
};

document.addEventListener('DOMContentLoaded', async () => {
  view.settings = (await send({ action: 'getSettings' })) || {};
  const app = $('app');
  ui.applyTheme(app, view.settings.theme);
  ui.followSystemTheme(app, () => ui.applyTheme(app, 'auto'));
  await i18n.load(view.settings.locale);
  i18n.apply();
  initControls();

  const source = await handoff.get(view.params.get('key')).catch(() => null);
  if (!source) { showStatus(t('errorNoImage'), true); return; }
  try {
    view.blob = source instanceof Blob ? source : await (await fetch(source)).blob();
  } catch {
    showStatus(t('errorNoImage'), true);
    return;
  }
  view.url = URL.createObjectURL(view.blob);
  const img = $('shot');
  img.addEventListener('load', () => {
    view.width = img.naturalWidth;
    view.height = img.naturalHeight;
    // Screenshots are in device pixels: shown at the page's own size, then fitted to the tab.
    img.style.width = `${Math.round(view.width / devicePixelRatio)}px`;
    $('info-text').textContent = `${view.width} × ${view.height} px`;
    img.hidden = false;
    showStatus('');
    $('stage').focus({ preventScroll: true });
    app.dataset.ready = 'true';
  }, { once: true });
  img.addEventListener('error', () => showStatus(t('errorNoImage'), true), { once: true });
  img.src = view.url;
});

addEventListener('pagehide', () => { if (view.url) URL.revokeObjectURL(view.url); });

function showStatus(message, isError = false) {
  const status = $('stage-status');
  status.hidden = !message;
  status.classList.toggle('error', isError);
  if (message) status.replaceChildren(isError ? ui.icon('alert', 'i') : Object.assign(document.createElement('div'), { className: 'spinner' }), ui.el('span', { text: message }));
}

// ---------- Controls ----------
function initControls() {
  const group = $('view-format');
  const preferred = view.settings.defaultFormat;
  ui.setRadio(group, ['png', 'jpeg', 'webp'].includes(preferred) ? preferred : 'png');
  ui.initRadioGroup(group);

  $('btn-zoom').addEventListener('click', () => setFit(!view.fit));
  $('btn-save').addEventListener('click', () => withBusy($('btn-save'), save));
  $('btn-copy').addEventListener('click', () => withBusy($('btn-copy'), copy));
  // Same tab, same image: the editor takes over (and the image stays tied to this tab).
  $('btn-crop').addEventListener('click', () => openEditor(false));
  $('btn-annotate').addEventListener('click', () => openEditor(true));

  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === 's') { e.preventDefault(); $('btn-save').click(); return; }
    if (mod && key === 'c' && !getSelection().toString()) { e.preventDefault(); $('btn-copy').click(); }
  });
}

// Fit: the capture fills the tab's width (never enlarged) and scrolls down.
// Actual size: one screenshot pixel per screen pixel, as on the page; scrolls both ways.
function setFit(fit) {
  view.fit = fit;
  $('shot').classList.toggle('fit', fit);
  const btn = $('btn-zoom');
  btn.setAttribute('aria-pressed', String(!fit));
  btn.querySelector('use').setAttribute('href', fit ? '#i-actual' : '#i-fit');
  btn.querySelector('span').textContent = fit ? t('zoomActual') : t('zoomFit');
}

function openEditor(annotate) {
  const params = new URLSearchParams(view.params);
  if (annotate) params.set('annotate', '1');
  else params.delete('annotate');
  location.href = `resize.html?${params}`;
}

// ---------- Save and copy ----------
const currentFormat = () => $('view-format').querySelector('.seg.active')?.dataset.value || 'png';

// A PNG capture saved as PNG keeps its exact bytes; other formats are encoded from it.
async function encode(format) {
  if (format === 'png' && view.blob.type === 'image/png') return view.blob;
  const canvas = document.createElement('canvas');
  canvas.width = view.width;
  canvas.height = view.height;
  const ctx = canvas.getContext('2d');
  if (format === 'jpeg') {
    ctx.fillStyle = view.settings.jpgBackground || '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage($('shot'), 0, 0);
  const quality = (view.settings.defaultQuality ?? 85) / 100;
  const blob = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(t('errorSaveFailed')))), ITK.outputMime(format), quality));
  canvas.width = canvas.height = 0; // a full-page canvas can be large: free it now
  return blob;
}

async function save() {
  if (!view.width) return;
  try {
    const format = currentFormat();
    const blob = await encode(format);
    const s = view.settings;
    const filename = ITK.buildFilename('data:,', {
      format, sourceName: 'screenshot',
      pageHost: view.params.get('site') || '', pageTitle: view.params.get('title') || '',
      subfolder: s.subfolder, filenamePattern: s.filenamePattern, filenamePrefix: s.filenamePrefix, filenameTemplate: s.filenameTemplate,
      cropWidth: view.width, cropHeight: view.height, knownWidth: view.width, knownHeight: view.height,
    });
    const res = await ui.saveBlob(blob, filename, s.saveAs !== false);
    if (res.cancelled) return;
    toast(`${t('notifSavedAs', [ITK.formatLabel(format)])} · ${view.width} × ${view.height} · ${ITK.formatBytes(blob.size)}`);
  } catch (err) {
    toast(`${t('errorSaveFailed')}: ${err.message}`, 'error');
  }
}

async function copy() {
  if (!view.width) return;
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': encode('png') })]);
    toast(t('notifCopied'));
  } catch (err) {
    toast(`${t('errorCopyFailed')}: ${err.message}`, 'error');
  }
}
