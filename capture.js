// ============================================================
// ImageToolkit – Capture Selection Overlay
// Injected into the page when the user starts an area capture
// ============================================================

(() => {
  'use strict';

  // Prevent double injection
  if (document.getElementById('imagetoolkit-capture-overlay')) return;

  const ACCENT = '#7c5cff';
  let startX = 0, startY = 0, drawing = false;

  const overlay = document.createElement('div');
  overlay.id = 'imagetoolkit-capture-overlay';
  Object.assign(overlay.style, {
    position: 'fixed', inset: '0', zIndex: '2147483647',
    background: 'rgba(10,10,20,0.45)', cursor: 'crosshair',
    userSelect: 'none', WebkitUserSelect: 'none', touchAction: 'none',
  });

  // The selection "cuts a hole" in the dimmed page with a huge box-shadow.
  const box = document.createElement('div');
  Object.assign(box.style, {
    position: 'fixed', display: 'none', pointerEvents: 'none',
    border: `1.5px solid ${ACCENT}`, borderRadius: '2px',
    boxShadow: '0 0 0 100vmax rgba(10,10,20,0.45)',
  });

  const label = document.createElement('div');
  Object.assign(label.style, {
    position: 'fixed', display: 'none', pointerEvents: 'none', whiteSpace: 'nowrap',
    background: ACCENT, color: '#fff', padding: '3px 8px', borderRadius: '6px',
    font: '600 12px/1.3 system-ui, -apple-system, "Segoe UI", sans-serif',
    fontVariantNumeric: 'tabular-nums', boxShadow: '0 4px 14px rgba(0,0,0,.3)',
  });

  const hint = document.createElement('div');
  Object.assign(hint.style, {
    position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)',
    background: 'rgba(20,20,32,0.92)', color: '#fff', padding: '10px 18px',
    borderRadius: '999px', font: '600 13px/1.3 system-ui, -apple-system, "Segoe UI", sans-serif',
    pointerEvents: 'none', boxShadow: '0 8px 30px rgba(0,0,0,.35)',
    border: '1px solid rgba(255,255,255,.12)', backdropFilter: 'blur(8px)',
  });
  hint.textContent = window.__imagetoolkit_hint || chrome.i18n.getMessage('captureHint') || 'Draw a rectangle to capture · ESC to cancel';

  overlay.append(box, label, hint);
  (document.body || document.documentElement).appendChild(overlay);

  function selectionRect(e) {
    return {
      x: Math.min(startX, e.clientX),
      y: Math.min(startY, e.clientY),
      w: Math.abs(e.clientX - startX),
      h: Math.abs(e.clientY - startY),
    };
  }

  function update(e) {
    const r = selectionRect(e);
    overlay.style.background = 'transparent'; // the box-shadow now does the dimming
    Object.assign(box.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px', display: 'block' });
    label.textContent = `${Math.round(r.w)} × ${Math.round(r.h)}`;
    const labelTop = r.y > 30 ? r.y - 28 : r.y + r.h + 8;
    Object.assign(label.style, { left: r.x + 'px', top: labelTop + 'px', display: 'block' });
  }

  overlay.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    overlay.setPointerCapture(e.pointerId); // keep tracking outside the viewport
    startX = e.clientX; startY = e.clientY;
    drawing = true;
    hint.style.display = 'none';
  });

  overlay.addEventListener('pointermove', (e) => {
    if (drawing) update(e);
  });

  overlay.addEventListener('pointerup', (e) => {
    if (!drawing) return;
    drawing = false;
    const r = selectionRect(e);
    const dpr = window.devicePixelRatio || 1;
    const rect = { x: r.x * dpr, y: r.y * dpr, width: r.w * dpr, height: r.h * dpr };
    cleanup();
    if (r.w < 10 || r.h < 10) return;
    // Wait two frames so the overlay removal is painted before the tab is captured
    requestAnimationFrame(() => requestAnimationFrame(() => {
      chrome.runtime.sendMessage({ action: 'captureSelection', rect }).catch(() => {});
    }));
  });

  function cleanup() {
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      cleanup();
    }
  }
  document.addEventListener('keydown', onKey, true);
})();
