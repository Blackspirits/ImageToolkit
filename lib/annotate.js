// ============================================================
// ImageToolkit – Annotate (editor): redact and mark up an image
// Redact · Pixelate · Blur · Box · Arrow · Text · Highlight, with colours, three
// thicknesses and undo/redo. Nothing touches the image until Apply.
// Only Redact removes information for sure (opaque paint); Pixelate and Blur are effects.
// Requires lib/ui.js and lib/i18n.js.
// ============================================================

(function (root) {
  'use strict';

  const TOOLS = [
    { id: 'redact', key: 'x' },
    { id: 'pixelate', key: 'p' },
    { id: 'blur', key: 'b' },
    { id: 'box', key: 'r' },
    { id: 'arrow', key: 'a' },
    { id: 'text', key: 't' },
    { id: 'highlight', key: 'h' },
  ];
  const COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#ffffff', '#111111'];
  const SIZES = { fine: 0.6, medium: 1, thick: 1.7 };

  // ---------- Drawing (pure: the same code paints the preview and the final image) ----------
  function luminance(hex) {
    const n = parseInt(hex.slice(1), 16);
    return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  }

  function normRect(op) {
    const x = Math.min(op.x1, op.x2), y = Math.min(op.y1, op.y2);
    return { x: Math.round(x), y: Math.round(y), w: Math.round(Math.abs(op.x2 - op.x1)), h: Math.round(Math.abs(op.y2 - op.y1)) };
  }

  // `unit` is one "point" for this image: strokes, text, blur and pixel blocks scale with the
  // image, so a mark looks the same on a 600 px icon and on a 4000 px photo.
  function drawOp(ctx, op, unit) {
    const canvas = ctx.canvas;
    const r = normRect(op);
    const k = SIZES[op.size] || 1;
    // Pixel blocks and blur also grow with the area covered, so large text is hidden as well
    // as small text.
    const span = Math.min(r.w, r.h);
    ctx.save();
    if (op.tool === 'redact' && r.w >= 1 && r.h >= 1) {
      // Opaque paint over the final pixels: nothing of what was under it is left.
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = op.color;
      ctx.fillRect(r.x, r.y, r.w, r.h);
    } else if (op.tool === 'pixelate' && r.w >= 2 && r.h >= 2) {
      // Each block becomes the true average of its pixels. (Scaling the canvas down would only
      // sample a few of them, and fine text could survive.)
      const block = Math.max(6, Math.round(9 * unit * k), Math.round(span * 0.2 * k));
      const image = ctx.getImageData(r.x, r.y, r.w, r.h);
      const d = image.data;
      for (let by = 0; by < r.h; by += block) {
        for (let bx = 0; bx < r.w; bx += block) {
          const bw = Math.min(block, r.w - bx), bh = Math.min(block, r.h - by);
          let red = 0, green = 0, blue = 0, alpha = 0;
          for (let y = by; y < by + bh; y++) {
            for (let x = bx, i = (y * r.w + bx) * 4; x < bx + bw; x++, i += 4) {
              red += d[i]; green += d[i + 1]; blue += d[i + 2]; alpha += d[i + 3];
            }
          }
          const n = bw * bh;
          red /= n; green /= n; blue /= n; alpha /= n;
          for (let y = by; y < by + bh; y++) {
            for (let x = bx, i = (y * r.w + bx) * 4; x < bx + bw; x++, i += 4) {
              d[i] = red; d[i + 1] = green; d[i + 2] = blue; d[i + 3] = alpha;
            }
          }
        }
      }
      ctx.putImageData(image, r.x, r.y);
    } else if (op.tool === 'blur' && r.w >= 2 && r.h >= 2) {
      const radius = Math.max(3, Math.round(6 * unit * k), Math.round(span * 0.12 * k));
      // Blur a margin around the area too, so its edges are not pulled towards transparency.
      const m = radius * 2;
      const sx = Math.max(0, r.x - m), sy = Math.max(0, r.y - m);
      const sw = Math.min(canvas.width, r.x + r.w + m) - sx, sh = Math.min(canvas.height, r.y + r.h + m) - sy;
      const tmp = document.createElement('canvas');
      tmp.width = sw; tmp.height = sh;
      const t = tmp.getContext('2d');
      t.filter = `blur(${radius}px)`;
      t.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
      t.filter = `blur(${radius}px)`;
      t.drawImage(tmp, 0, 0); // a second pass, softer still
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.clip();
      ctx.drawImage(tmp, sx, sy);
      tmp.width = tmp.height = 0; // free its pixels now, not at the next garbage collection
    } else if (op.tool === 'box') {
      const lw = Math.max(2, 3 * unit * k);
      ctx.lineWidth = lw;
      ctx.strokeStyle = op.color;
      ctx.lineJoin = 'round';
      ctx.shadowColor = 'rgba(0,0,0,.35)';
      ctx.shadowBlur = 3 * unit;
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h, Math.min(6 * unit, r.w / 2, r.h / 2));
      ctx.stroke();
    } else if (op.tool === 'highlight') {
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = op.color;
      ctx.fillRect(r.x, r.y, r.w, r.h);
    } else if (op.tool === 'arrow') {
      const lw = Math.max(2, 3.2 * unit * k);
      const dx = op.x2 - op.x1, dy = op.y2 - op.y1;
      const len = Math.hypot(dx, dy);
      if (len >= 2) {
        const head = Math.min(len * 0.6, lw * 4.2);
        const angle = Math.atan2(dy, dx);
        const bx = op.x2 - Math.cos(angle) * head * 0.8, by = op.y2 - Math.sin(angle) * head * 0.8;
        ctx.strokeStyle = ctx.fillStyle = op.color;
        ctx.lineWidth = lw;
        ctx.lineCap = 'round';
        ctx.shadowColor = 'rgba(0,0,0,.35)';
        ctx.shadowBlur = 3 * unit;
        ctx.beginPath();
        ctx.moveTo(op.x1, op.y1);
        ctx.lineTo(bx, by);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(op.x2, op.y2);
        ctx.lineTo(op.x2 - Math.cos(angle - 0.45) * head, op.y2 - Math.sin(angle - 0.45) * head);
        ctx.lineTo(op.x2 - Math.cos(angle + 0.45) * head, op.y2 - Math.sin(angle + 0.45) * head);
        ctx.closePath();
        ctx.fill();
      }
    } else if (op.tool === 'text' && op.text) {
      const size = Math.max(12, Math.round(18 * unit * k));
      ctx.font = `700 ${size}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
      ctx.textBaseline = 'top';
      ctx.lineJoin = 'round';
      // An outline in the opposite tone keeps text readable on any background.
      ctx.lineWidth = Math.max(2, size / 6);
      ctx.strokeStyle = luminance(op.color) > 0.6 ? 'rgba(0,0,0,.85)' : 'rgba(255,255,255,.95)';
      ctx.strokeText(op.text, op.x1, op.y1);
      ctx.fillStyle = op.color;
      ctx.fillText(op.text, op.x1, op.y1);
    }
    ctx.restore();
  }

  // ---------- Session ----------
  // Opens the annotate layer over `host` for `base` (a canvas the caller owns). Resolves with a
  // PNG Blob on Apply, or null on Cancel.
  function open({ host, base }) {
    const { el, icon } = root.ITK.ui;
    const t = root.ITK.i18n.t;
    // Literal keys, so the i18n check sees every one in use.
    const toolLabel = (id) => ({ redact: t('toolRedact'), pixelate: t('toolPixelate'), blur: t('toolBlur'), box: t('toolBox'), arrow: t('toolArrow'), text: t('toolText'), highlight: t('toolHighlight') })[id];
    const sizeLabel = (id) => ({ fine: t('sizeFine'), medium: t('sizeMedium'), thick: t('sizeThick') })[id];
    return new Promise((resolve) => {
      const width = base.width, height = base.height;
      const unit = Math.max(1, Math.max(width, height) / 900);
      const state = { tool: 'box', color: COLORS[0], size: 'medium', ops: [], redo: [], draft: null };

      const work = el('canvas', { class: 'annot-canvas', width, height });
      const overlay = el('canvas', { class: 'annot-canvas annot-overlay', width, height });
      const board = el('div', { class: 'annot-board' }, [work, overlay]);
      const scroller = el('div', { class: 'annot-scroll' }, board);

      const toolButtons = TOOLS.map((tool) => el('button', {
        type: 'button', class: 'icon-btn annot-tool', 'data-tool': tool.id, role: 'radio',
        title: `${toolLabel(tool.id)} (${tool.key.toUpperCase()})`, 'aria-label': toolLabel(tool.id),
      }, icon(`tool-${tool.id}`, 'i')));
      const colorButtons = COLORS.map((color) => el('button', {
        type: 'button', class: 'annot-color', 'data-color': color, role: 'radio', style: `--swatch:${color}`,
        title: `${t('annotColor')} ${color}`, 'aria-label': `${t('annotColor')} ${color}`,
      }));
      const sizeButtons = Object.keys(SIZES).map((size) => el('button', {
        type: 'button', class: 'annot-size', 'data-size': size, role: 'radio',
        title: sizeLabel(size), 'aria-label': sizeLabel(size),
      }, el('i', { style: `--d:${{ fine: 4, medium: 7, thick: 11 }[size]}px` })));
      const undoBtn = el('button', { type: 'button', class: 'icon-btn', title: `${t('undo')} (Ctrl+Z)`, 'aria-label': t('undo') }, icon('undo', 'i'));
      const redoBtn = el('button', { type: 'button', class: 'icon-btn', title: `${t('redo')} (Ctrl+Y)`, 'aria-label': t('redo') }, icon('redo', 'i'));
      const cancelBtn = el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: t('cancel') });
      const applyBtn = el('button', { type: 'button', class: 'btn btn-primary btn-sm', text: t('applyDimensions'), title: `${t('applyDimensions')} (Ctrl+Enter)` });
      const sep = () => el('span', { class: 'tool-sep' });

      const bar = el('div', { class: 'floating-tools annot-bar', role: 'toolbar', 'aria-label': t('annotate') }, [
        el('div', { class: 'annot-group', role: 'radiogroup', 'aria-label': t('annotate') }, toolButtons), sep(),
        el('div', { class: 'annot-group', role: 'radiogroup', 'aria-label': t('annotColor') }, colorButtons), sep(),
        el('div', { class: 'annot-group', role: 'radiogroup', 'aria-label': t('annotSize') }, sizeButtons), sep(),
        undoBtn, redoBtn, sep(), cancelBtn, applyBtn,
      ]);
      const layer = el('div', { class: 'annot-layer' }, [scroller, bar]);
      host.append(layer);

      const wctx = work.getContext('2d');
      const octx = overlay.getContext('2d');

      // Fit to the stage; very tall images (full-page captures) fit the width and scroll.
      const fit = () => {
        const availW = scroller.clientWidth - 48, availH = scroller.clientHeight - 110;
        let scale = Math.min(1, availW / width, availH / height);
        if (height * Math.min(1, availW / width) > availH * 2.5) scale = Math.min(1, availW / width);
        board.style.width = `${Math.max(1, Math.round(width * scale))}px`;
        board.style.height = `${Math.max(1, Math.round(height * scale))}px`;
      };

      const render = () => {
        wctx.clearRect(0, 0, width, height);
        wctx.drawImage(base, 0, 0);
        for (const op of state.ops) drawOp(wctx, op, unit);
        undoBtn.disabled = !state.ops.length;
        redoBtn.disabled = !state.redo.length;
      };

      // While dragging, only the light overlay is redrawn; the effect lands on release.
      const renderDraft = () => {
        octx.clearRect(0, 0, width, height);
        const op = state.draft;
        if (!op) return;
        if (op.tool === 'pixelate' || op.tool === 'blur') {
          const r = normRect(op);
          octx.save();
          octx.fillStyle = 'rgba(124,92,255,.18)';
          octx.fillRect(r.x, r.y, r.w, r.h);
          octx.setLineDash([6 * unit, 4 * unit]);
          octx.lineWidth = Math.max(1.5, 1.5 * unit);
          octx.strokeStyle = '#7c5cff';
          octx.strokeRect(r.x, r.y, r.w, r.h);
          octx.restore();
        } else {
          drawOp(octx, op, unit);
        }
      };

      const select = (buttons, attr, value) => buttons.forEach((b) => {
        const on = b.dataset[attr] === value;
        b.classList.toggle('active', on);
        b.setAttribute('aria-checked', String(on));
      });
      const setTool = (tool) => { state.tool = tool; select(toolButtons, 'tool', tool); overlay.dataset.tool = tool; };
      const setColor = (color) => { state.color = color; select(colorButtons, 'color', color); };
      const setSize = (size) => { state.size = size; select(sizeButtons, 'size', size); };
      toolButtons.forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
      colorButtons.forEach((b) => b.addEventListener('click', () => setColor(b.dataset.color)));
      sizeButtons.forEach((b) => b.addEventListener('click', () => setSize(b.dataset.size)));

      const commit = (op) => { state.ops.push(op); state.redo = []; render(); };
      const undo = () => { if (state.ops.length) { state.redo.push(state.ops.pop()); render(); } };
      const redo = () => { if (state.redo.length) { state.ops.push(state.redo.pop()); render(); } };
      undoBtn.addEventListener('click', undo);
      redoBtn.addEventListener('click', redo);

      const point = (e) => {
        const rect = overlay.getBoundingClientRect();
        return {
          x: Math.max(0, Math.min(width, ((e.clientX - rect.left) / rect.width) * width)),
          y: Math.max(0, Math.min(height, ((e.clientY - rect.top) / rect.height) * height)),
        };
      };

      // Text: an inline field where the user clicked; Enter (or leaving it) places the text.
      let textField = null;
      const placeText = (p) => {
        textField?.blur();
        const rect = overlay.getBoundingClientRect();
        const cssScale = rect.width / width;
        const size = Math.max(12, Math.round(18 * unit * (SIZES[state.size] || 1)));
        const field = el('input', {
          type: 'text', class: 'annot-text', placeholder: t('textPlaceholder'), 'aria-label': t('toolText'),
          style: `left:${p.x * cssScale}px;top:${p.y * cssScale}px;font-size:${Math.max(12, size * cssScale)}px;color:${state.color}`,
        });
        board.append(field);
        textField = field;
        let done = false;
        const finish = (keep) => {
          if (done) return;
          done = true;
          const text = field.value.trim();
          field.remove();
          if (textField === field) textField = null;
          if (keep && text) commit({ tool: 'text', x1: p.x, y1: p.y, x2: p.x, y2: p.y, text, color: state.color, size: state.size });
        };
        field.addEventListener('keydown', (e) => {
          e.stopPropagation();
          if (e.key === 'Enter') finish(true);
          if (e.key === 'Escape') finish(false);
        });
        field.addEventListener('blur', () => finish(true));
        requestAnimationFrame(() => field.focus());
      };

      overlay.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const p = point(e);
        if (state.tool === 'text') {
          // A click outside an open field confirms it; the next click starts a new one.
          if (textField) { textField.blur(); return; }
          placeText(p);
          return;
        }
        overlay.setPointerCapture(e.pointerId);
        state.draft = { tool: state.tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y, color: state.color, size: state.size };
      });
      overlay.addEventListener('pointermove', (e) => {
        if (!state.draft) return;
        const p = point(e);
        Object.assign(state.draft, { x2: p.x, y2: p.y });
        renderDraft();
      });
      const endDraft = () => {
        const op = state.draft;
        state.draft = null;
        renderDraft();
        if (!op) return;
        const big = op.tool === 'arrow' ? Math.hypot(op.x2 - op.x1, op.y2 - op.y1) >= 4 : normRect(op).w >= 3 && normRect(op).h >= 3;
        if (big) commit(op);
      };
      overlay.addEventListener('pointerup', endDraft);
      overlay.addEventListener('pointercancel', () => { state.draft = null; renderDraft(); });

      const onKey = (e) => {
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
        const mod = e.ctrlKey || e.metaKey;
        const key = e.key.toLowerCase();
        if (mod && key === 'z' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); undo(); return; }
        if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) { e.preventDefault(); e.stopPropagation(); redo(); return; }
        if (mod && (key === 's' || key === 'c')) { e.preventDefault(); e.stopPropagation(); return; } // Apply first
        // Esc drops the shape being drawn, or leaves when nothing was drawn; marks already made
        // are only thrown away by Cancel, never by a stray key.
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          if (state.draft) { state.draft = null; renderDraft(); } else if (!state.ops.length) close(null);
          return;
        }
        // Ctrl+Enter applies; a bare Enter (pressed out of habit) never bakes the marks in.
        if (mod && e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); applyBtn.click(); return; }
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); return; }
        const tool = !mod && TOOLS.find((x) => x.key === key);
        if (tool) { e.preventDefault(); setTool(tool.id); }
      };
      document.addEventListener('keydown', onKey, true);
      const onResize = () => fit();
      window.addEventListener('resize', onResize);

      const close = (result) => {
        document.removeEventListener('keydown', onKey, true);
        window.removeEventListener('resize', onResize);
        layer.remove();
        resolve(result);
      };
      cancelBtn.addEventListener('click', () => close(null));
      applyBtn.addEventListener('click', () => {
        textField?.blur();
        if (!state.ops.length) { close(null); return; }
        work.toBlob((blob) => close(blob || null), 'image/png');
      });

      setTool(state.tool);
      setColor(state.color);
      setSize(state.size);
      render();
      fit();
      requestAnimationFrame(fit);
      toolButtons.find((b) => b.classList.contains('active'))?.focus();
    });
  }

  root.ITK = Object.assign(root.ITK || {}, { annotate: { open, drawOp, TOOLS, COLORS } });
})(typeof globalThis !== 'undefined' ? globalThis : self);
