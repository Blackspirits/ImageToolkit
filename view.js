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
  whole: false, // the whole capture in the window (an overview) instead of at the page's size
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
    $('info-text').textContent = `${view.width} × ${view.height} px`;
    img.hidden = false;
    layout();
    new ResizeObserver(() => layout()).observe($('stage'));
    showStatus('');
    $('stage').focus({ preventScroll: true });
    app.dataset.ready = 'true';
  }, { once: true });
  img.addEventListener('error', () => showStatus(t('errorNoImage'), true), { once: true });
  img.src = view.url;
});

// Kept while the page may come back from the back/forward cache (Back from the editor).
addEventListener('pagehide', (e) => { if (!e.persisted && view.url) URL.revokeObjectURL(view.url); });
// Back from the editor: the image may have been annotated there since; show it as it is now.
addEventListener('pageshow', (e) => { if (e.persisted) location.reload(); });

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

  $('btn-zoom').addEventListener('click', () => setWhole(!view.whole));
  // A click on the capture switches too, like an image viewer.
  $('shot').addEventListener('click', () => { if (!$('btn-zoom').disabled) setWhole(!view.whole); });
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

// Page size: the capture as the page looked (screenshots are in device pixels), narrowed to the
// tab if it is wider, scrolling down. Whole: all of it in the window, as an overview. The button
// switches between them, and is off when the capture fits at page size anyway.
function stageBox() {
  const stage = $('stage');
  const cs = getComputedStyle(stage);
  return {
    width: stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
    height: stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom),
  };
}

function layout() {
  if (!view.width) return;
  const img = $('shot');
  const box = stageBox();
  const pageWidth = view.width / devicePixelRatio, pageHeight = view.height / devicePixelRatio;
  const fitsAlready = pageWidth <= box.width + 1 && pageHeight <= box.height + 1;
  const scale = view.whole && !fitsAlready ? Math.min(1, box.width / pageWidth, box.height / pageHeight) : Math.min(1, box.width / pageWidth);
  img.style.width = `${Math.max(1, Math.floor(pageWidth * scale))}px`;
  img.classList.toggle('zoomable', !fitsAlready);
  img.classList.toggle('whole', view.whole && !fitsAlready);
  const btn = $('btn-zoom');
  btn.disabled = fitsAlready;
  btn.setAttribute('aria-pressed', String(view.whole && !fitsAlready));
  btn.querySelector('use').setAttribute('href', view.whole ? '#i-actual' : '#i-fit');
  btn.querySelector('span').textContent = view.whole ? t('zoomActual') : t('zoomFit');
}

function setWhole(whole) {
  view.whole = whole;
  layout();
  if (!whole) $('stage').scrollTo({ top: 0 });
}

function openEditor(annotate) {
  const params = new URLSearchParams(view.params);
  if (annotate) params.set('annotate', '1');
  else params.delete('annotate');
  params.set('from', 'view'); // the editor offers a way back here
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
