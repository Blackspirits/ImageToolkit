// ============================================================
// ImageToolkit – Capture Selection Overlay
// Injected into page when user clicks "Capture"
// ============================================================
'use strict';

(function() {
  // Prevent double injection
  if (document.getElementById('imagetoolkit-capture-overlay')) return;

  let startX = 0, startY = 0, isDrawing = false;

  // Overlay
  const overlay = document.createElement('div');
  overlay.id = 'imagetoolkit-capture-overlay';
  Object.assign(overlay.style, {
    position: 'fixed', inset: '0', zIndex: '2147483647',
    background: 'rgba(0,0,0,0.3)', cursor: 'crosshair',
    userSelect: 'none', WebkitUserSelect: 'none',
  });

  // Selection box
  const box = document.createElement('div');
  Object.assign(box.style, {
    position: 'fixed', border: '2px dashed #7c3aed',
    background: 'rgba(124,58,237,0.08)', display: 'none',
    zIndex: '2147483647', pointerEvents: 'none',
    boxShadow: '0 0 0 9999px rgba(0,0,0,0.35)',
  });

  // Dimensions label
  const label = document.createElement('div');
  Object.assign(label.style, {
    position: 'fixed', background: '#7c3aed', color: '#fff',
    padding: '2px 8px', borderRadius: '4px', fontSize: '12px',
    fontFamily: 'sans-serif', fontWeight: '600', zIndex: '2147483647',
    pointerEvents: 'none', display: 'none', whiteSpace: 'nowrap',
  });

  // Hint
  const hint = document.createElement('div');
  Object.assign(hint.style, {
    position: 'fixed', top: '16px', left: '50%', transform: 'translateX(-50%)',
    background: '#7c3aed', color: '#fff', padding: '8px 20px',
    borderRadius: '8px', fontSize: '14px', fontFamily: 'sans-serif',
    fontWeight: '600', zIndex: '2147483647', pointerEvents: 'none',
    boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
  });
  hint.textContent = window.__imagetoolkit_hint || chrome.i18n.getMessage('captureHint') || 'Draw a rectangle to capture · ESC to cancel';

  overlay.appendChild(box);
  overlay.appendChild(label);
  overlay.appendChild(hint);
  document.body.appendChild(overlay);

  function updateBox(e) {
    const x = Math.min(startX, e.clientX);
    const y = Math.min(startY, e.clientY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);
    Object.assign(box.style, {
      left: x + 'px', top: y + 'px',
      width: w + 'px', height: h + 'px', display: 'block',
    });
    label.textContent = `${w} × ${h}`;
    Object.assign(label.style, {
      left: (x + w + 8) + 'px', top: (y - 4) + 'px', display: 'block',
    });
  }

  overlay.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    startX = e.clientX; startY = e.clientY;
    isDrawing = true;
    hint.style.display = 'none';
  });

  overlay.addEventListener('mousemove', (e) => {
    if (!isDrawing) return;
    updateBox(e);
  });

  overlay.addEventListener('mouseup', (e) => {
    if (!isDrawing) return;
    isDrawing = false;
    const rect = {
      x: Math.min(startX, e.clientX) * window.devicePixelRatio,
      y: Math.min(startY, e.clientY) * window.devicePixelRatio,
      width: Math.abs(e.clientX - startX) * window.devicePixelRatio,
      height: Math.abs(e.clientY - startY) * window.devicePixelRatio,
    };
    cleanup();
    // Minimum size check
    if (rect.width < 10 || rect.height < 10) return;
    // Send to background
    chrome.runtime.sendMessage({ action: 'captureSelection', rect });
  });

  function cleanup() {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  }

  function onKey(e) {
    if (e.key === 'Escape') { cleanup(); }
  }
  document.addEventListener('keydown', onKey);
})();
