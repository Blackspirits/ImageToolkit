// ============================================================
// ImageToolkit – Core helpers (pure functions, shared by every context)
// Loaded by the service worker (importScripts), extension pages (<script>),
// the injected scanner (executeScript files) and Node tests (require).
// ============================================================

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ITK = Object.assign(root.ITK || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : self, function () {
  'use strict';

  // ---------- Image types ----------
  const MIME_TO_TYPE = {
    'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/pjpeg': 'jpg', 'image/png': 'png',
    'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/avif': 'avif',
    'image/bmp': 'bmp', 'image/tiff': 'tiff', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico',
  };

  const EXT_TO_TYPE = {
    jpg: 'jpg', jpeg: 'jpg', jpe: 'jpg', jfif: 'jpg', png: 'png', webp: 'webp', gif: 'gif', svg: 'svg',
    avif: 'avif', bmp: 'bmp', tif: 'tiff', tiff: 'tiff', ico: 'ico',
  };

  const KNOWN_TYPES = ['jpg', 'png', 'webp', 'gif', 'svg', 'avif', 'bmp', 'tiff', 'ico'];

  // Formats the canvas pipeline can produce. AVIF is requested but Chrome falls back to WebP.
  const OUTPUT_MIME = { png: 'image/png', jpeg: 'image/jpeg', jpg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif' };
  const MIME_TO_OUTPUT = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp', 'image/avif': 'avif' };

  function sniffImageType(bytes) {
    if (!bytes || bytes.length < 4) return null;
    const has = (offset, text) => [...text].every((ch, i) => bytes[offset + i] === ch.charCodeAt(0));
    if (bytes[0] === 0x89 && has(1, 'PNG')) return 'png';
    if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'jpg';
    if (has(0, 'GIF8')) return 'gif';
    if (has(0, 'RIFF') && has(8, 'WEBP')) return 'webp';
    if (has(4, 'ftyp') && (has(8, 'avif') || has(8, 'avis'))) return 'avif';
    if (has(0, 'BM')) return 'bmp';
    if (has(0, 'II*\0') || has(0, 'MM\0*')) return 'tiff';
    if (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0) return 'ico';
    return null;
  }

  // SVG is text, so it has no magic bytes: recognise it by its root element, allowing an
  // XML prolog, comments and a doctype before it (servers often send it as text/plain).
  function looksLikeSvg(text) {
    return /^\uFEFF?\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE\s+svg[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(String(text || ''));
  }

  function mimeToType(mime) {
    return MIME_TO_TYPE[String(mime || '').split(';')[0].trim().toLowerCase()] || null;
  }

  function extensionToType(url) {
    try {
      const ext = new URL(url).pathname.toLowerCase().split('.').pop();
      return EXT_TO_TYPE[ext] || null;
    } catch {
      return null;
    }
  }

  // Best guess from the URL alone (used by the grid before any network probe).
  function detectType(src) {
    const url = String(src || '');
    if (/^data:image\//i.test(url)) {
      return mimeToType(url.slice(5, url.search(/[;,]/))) || 'other';
    }
    return extensionToType(url) || 'other';
  }

  function outputMime(format) {
    return OUTPUT_MIME[format] || 'image/png';
  }

  function formatFromMime(mime) {
    return MIME_TO_OUTPUT[mime] || null;
  }

  function extensionFor(format) {
    return format === 'jpeg' ? 'jpg' : (format || 'png');
  }

  // Display names, written the way the formats are usually written (and as in the UI buttons).
  function formatLabel(format) {
    const f = String(format || '').toLowerCase();
    return { jpeg: 'JPG', jpg: 'JPG', webp: 'WebP' }[f] || f.toUpperCase();
  }

  // ---------- URLs ----------
  // Only schemes the extension can actually fetch and render are worth listing.
  function isAllowedImageSrc(src) {
    return /^https?:\/\//i.test(src) || /^data:image\//i.test(src);
  }

  // What the extension itself may fetch to process an image: the listed schemes plus a
  // page's own blob: URLs (what a right-click on a script-made image gives). The scanner
  // keeps using isAllowedImageSrc; blob: of other schemes (chrome-extension:, file:…) stays out.
  function isFetchableImageSrc(src) {
    return isAllowedImageSrc(src) || /^blob:https?:\/\//i.test(src);
  }

  // Follows the HTML srcset tokenizer, so commas inside URLs (e.g. CDN "w_100,h_100") survive.
  function parseSrcset(srcset) {
    const text = String(srcset || '');
    const urls = [];
    let i = 0;
    while (i < text.length) {
      while (i < text.length && /[\s,]/.test(text[i])) i++;
      const start = i;
      while (i < text.length && !/\s/.test(text[i])) i++;
      let url = text.slice(start, i);
      if (url.endsWith(',')) {
        url = url.replace(/,+$/, '');
      } else {
        while (i < text.length && text[i] !== ',') i++; // skip descriptors ("2x", "640w")
      }
      if (url) urls.push(url);
    }
    return urls;
  }

  function extractBgUrls(value) {
    const urls = [];
    const regex = /url\(\s*(["']?)(.*?)\1\s*\)/g;
    let match;
    while ((match = regex.exec(String(value || ''))) !== null) {
      if (match[2]) urls.push(match[2]);
    }
    return urls;
  }

  // Query parameters that change the rendered image; everything else is treated as cache-busting.
  const IMAGE_PARAMS = new Set(['w', 'h', 'width', 'height', 'size', 'format', 'quality', 'q', 'fit', 'crop', 'resize', 'auto', 'dpr', 'fm', 'fl', 'cs']);

  function dedupeKey(src) {
    try {
      const url = new URL(src);
      if (url.protocol === 'data:') return src;
      url.searchParams.sort();
      const kept = [];
      for (const [key, value] of url.searchParams) {
        if (IMAGE_PARAMS.has(key.toLowerCase())) kept.push(`${key}=${value}`);
      }
      return (url.hostname + url.pathname + (kept.length ? '?' + kept.join('&') : '')).replace(/\/+$/, '').toLowerCase();
    } catch {
      return src;
    }
  }

  function displayName(src, max = 48) {
    const url = String(src || '');
    if (url.startsWith('data:image/')) {
      const type = detectType(url);
      return `inline.${type === 'other' ? 'img' : type}`;
    }
    try {
      let name = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
      if (!name) return new URL(url).hostname || 'image';
      const chars = [...name];
      if (chars.length > max) name = chars.slice(0, max - 1).join('') + '…';
      return name;
    } catch {
      return 'image';
    }
  }

  function domainOf(src) {
    if (String(src).startsWith('data:')) return 'data:';
    try { return new URL(src).hostname || '?'; } catch { return '?'; }
  }

  // ---------- Filenames ----------
  function sanitizeFilename(input, allowSlash = false) {
    if (!input) return allowSlash ? '' : 'image';

    const cleanSegment = (segment) => {
      let name = String(segment)
        .replace(/[\\/?<>:*|"]/g, '')
        .replace(/[\x00-\x1f\x7f-\x9f]/g, '')
        .replace(/^\.+$/, 'image')
        .replace(/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i, 'image')
        .replace(/[\s.]+$/g, '')
        .replace(/^[\s.]+/g, '')
        .trim();
      // Truncate by code point and keep non-Latin letters (e.g. Japanese filenames).
      const chars = [...name];
      if (chars.length > 60) name = chars.slice(0, 60).join('').replace(/[^\p{L}\p{N}]+$/u, '');
      return name;
    };

    if (allowSlash) {
      return String(input)
        .split(/[\\/]/)
        .map(cleanSegment)
        .filter((segment) => segment && segment !== '.' && segment !== '..')
        .join('/');
    }

    return cleanSegment(input) || 'image';
  }

  function buildFilename(imageUrl, instructions = {}, now = Date.now()) {
    let baseName = 'image';
    try {
      const url = new URL(imageUrl);
      if (url.protocol !== 'data:') {
        baseName = decodeURIComponent(url.pathname.split('/').pop() || '');
        baseName = baseName.replace(/\.(jpe?g|jfif|png|gif|webp|avif|svg|bmp|ico|tiff?)$/i, '') || 'image';
      }
    } catch {
      baseName = 'image';
    }

    baseName = sanitizeFilename(baseName);

    const pattern = instructions.filenamePattern || 'original';
    if (pattern === 'system') {
      baseName = `imagetoolkit_${now}`;
    } else if (pattern === 'custom') {
      const prefix = sanitizeFilename(instructions.filenamePrefix || 'img_');
      baseName = `${prefix}${baseName}`;
    }

    let suffix = '';
    if (instructions.resizeWidth) suffix = `_${instructions.resizeWidth}px`;
    if (instructions.width) suffix = `_${instructions.width}${instructions.height ? 'x' + instructions.height : 'px'}`;
    if (instructions.cropWidth) suffix = `_${instructions.cropWidth}x${instructions.cropHeight}`;

    const ext = extensionFor(instructions.format || 'png');
    const sub = sanitizeFilename(instructions.subfolder || '', true);
    const name = `${baseName}${suffix}.${ext}`;
    return sub ? `${sub}/${name}` : name;
  }

  // ---------- Limits ----------
  // Largest image read or produced: base64 of it must still fit in one extension message (64 MiB).
  const MAX_IMAGE_BYTES = 40 * 1024 * 1024;
  const MAX_SIDE = 16384;
  const MAX_AREA = 100_000_000; // ~100 MP keeps canvas memory reasonable
  // Extension messages are capped at 64 MiB of JSON. Anything we send as one string stays
  // under this budget, leaving room for the JSON envelope and the other fields.
  const MAX_MESSAGE_CHARS = 48 * 1024 * 1024;
  // One scan of a page travels content script → service worker → panel as a single message.
  const SCAN_MAX_ITEM_CHARS = 8 * 1024 * 1024;   // one inline image (data URL / SVG markup)
  const SCAN_MAX_TOTAL_CHARS = 24 * 1024 * 1024; // all inline images of one scan together
  const SCAN_MAX_ITEMS = 5000;

  // True when `bytes` of binary data still fit in one message once base64-encoded as a data URL.
  function fitsInMessage(bytes) {
    return 4 * Math.ceil(Math.max(0, bytes) / 3) + 128 <= MAX_MESSAGE_CHARS;
  }

  // ---------- Dimensions ----------

  function toPositiveInt(value) {
    const n = Math.round(Number(value));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function calculateDimensions(naturalWidth, naturalHeight, instructions = {}) {
    let outWidth = naturalWidth;
    let outHeight = naturalHeight;
    let sx = 0, sy = 0, sw = naturalWidth, sh = naturalHeight;

    const cropW = toPositiveInt(instructions.cropWidth);
    const cropH = toPositiveInt(instructions.cropHeight);
    const resizeW = toPositiveInt(instructions.resizeWidth);
    const width = toPositiveInt(instructions.width);
    const height = toPositiveInt(instructions.height);

    if (cropW && cropH) {
      outWidth = cropW;
      outHeight = cropH;
      if (!instructions.fitMode) {
        const targetRatio = cropW / cropH;
        const imgRatio = naturalWidth / naturalHeight;
        if (imgRatio > targetRatio) {
          sh = naturalHeight;
          sw = Math.round(sh * targetRatio);
          sx = Math.round((naturalWidth - sw) / 2);
        } else {
          sw = naturalWidth;
          sh = Math.round(sw / targetRatio);
          sy = Math.round((naturalHeight - sh) / 2);
        }
      }
    } else if (resizeW) {
      outWidth = resizeW;
      outHeight = Math.max(1, Math.round(naturalHeight * (resizeW / naturalWidth)));
    } else if (width) {
      outWidth = width;
      outHeight = height || Math.max(1, Math.round(naturalHeight * (width / naturalWidth)));
    }

    return { outWidth, outHeight, sx, sy, sw, sh };
  }

  // Where an image lands inside a letterboxed (fit) output.
  function letterboxRect(naturalWidth, naturalHeight, outWidth, outHeight) {
    const scale = Math.min(outWidth / naturalWidth, outHeight / naturalHeight);
    const w = Math.round(naturalWidth * scale);
    const h = Math.round(naturalHeight * scale);
    return { x: Math.round((outWidth - w) / 2), y: Math.round((outHeight - h) / 2), w, h };
  }

  // Editor stage: one scale for both sides, so the box always has the image's
  // proportions. Fits the available area and enlarges tiny images until their longer
  // side reaches minSide (still within the area).
  function stageSize(naturalWidth, naturalHeight, maxWidth, maxHeight, minSide = 240) {
    const fit = Math.min(maxWidth / naturalWidth, maxHeight / naturalHeight);
    const enlarge = minSide / Math.max(naturalWidth, naturalHeight);
    const scale = Math.min(fit, Math.max(1, enlarge));
    return { width: Math.max(1, Math.round(naturalWidth * scale)), height: Math.max(1, Math.round(naturalHeight * scale)) };
  }

  function checkOutputSize(width, height) {
    if (!(width >= 1 && height >= 1)) throw new Error('Invalid output size');
    if (width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_AREA) {
      throw new Error(`Output too large (max ${MAX_SIDE}px per side, ${MAX_AREA / 1e6} MP)`);
    }
  }

  // ---------- Processing instructions ----------
  const OUTPUT_FORMATS = new Set(['png', 'jpeg', 'webp', 'avif']);
  const SIZE_KEYS = ['width', 'height', 'resizeWidth', 'cropWidth', 'cropHeight'];

  // Messages are untrusted input: keep only known fields with sane values. A size that is
  // given but unusable is an error, never silently dropped (that would save the original).
  function sanitizeInstructions(raw) {
    const ins = raw && typeof raw === 'object' ? raw : {};
    const out = {};
    if (ins.passthrough) out.passthrough = true;
    const format = ins.format === 'jpg' ? 'jpeg' : ins.format;
    out.format = OUTPUT_FORMATS.has(format) ? format : 'png';
    if (ins.quality != null) out.quality = Math.min(1, Math.max(0.1, Number(ins.quality) || 0.85));
    for (const key of SIZE_KEYS) {
      const value = ins[key];
      if (value == null || value === '') continue;
      const n = Number(value);
      if (!Number.isFinite(n) || Math.round(n) < 1) throw new Error('Invalid output size');
      if (Math.round(n) > MAX_SIDE) throw new Error(`Output too large (max ${MAX_SIDE}px per side, ${MAX_AREA / 1e6} MP)`);
      out[key] = Math.round(n);
    }
    if (ins.fitMode) out.fitMode = true;
    if (typeof ins.saveAs === 'boolean') out.saveAs = ins.saveAs;
    if (ins.silent) out.silent = true;
    if (/^#[0-9a-f]{6}$/i.test(ins.jpgBackground || '')) out.jpgBackground = ins.jpgBackground;
    for (const key of ['subfolder', 'filenamePattern', 'filenamePrefix']) {
      if (typeof ins[key] === 'string') out[key] = ins[key].slice(0, 120);
    }
    return out;
  }

  // ---------- Inline SVG size ----------
  // An absolute width/height attribute ("24", "24px"); percentages and ems are not pixels.
  function svgLength(value) {
    const m = /^\s*(\d+(?:\.\d+)?)(?:px)?\s*$/i.exec(String(value ?? ''));
    return m ? Number(m[1]) : 0;
  }

  // Pixel size of an inline <svg>: what the page renders, else absolute attributes.
  // The viewBox is a coordinate system (often 0 0 960 960 for a 24 px icon), not a size.
  function svgPixelSize({ renderedWidth = 0, renderedHeight = 0, width, height } = {}) {
    if (renderedWidth > 0 && renderedHeight > 0) return { width: Math.round(renderedWidth), height: Math.round(renderedHeight) };
    const w = svgLength(width), h = svgLength(height);
    return w > 0 && h > 0 ? { width: Math.round(w), height: Math.round(h) } : null;
  }

  // ---------- Transparency ----------
  // Looks for any non-opaque pixel at full resolution (up to maxArea; larger images are
  // scaled, which still blends even a 1 px hole into a non-opaque pixel). Strips keep the
  // pixel buffer small. `makeCanvas(w, h)` returns a canvas (DOM or OffscreenCanvas).
  function hasTransparency(source, width, height, makeCanvas, maxArea = 25e6, stripArea = 4e6) {
    if (!(width > 0 && height > 0)) return false;
    const scale = Math.min(1, Math.sqrt(maxArea / (width * height)));
    const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
    const rows = Math.max(1, Math.min(h, Math.floor(stripArea / w)));
    const canvas = makeCanvas(w, rows);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    for (let y = 0; y < h; y += rows) {
      const n = Math.min(rows, h - y);
      ctx.clearRect(0, 0, w, rows);
      ctx.drawImage(source, 0, -y, w, h);
      const data = ctx.getImageData(0, 0, w, n).data;
      for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
    }
    return false;
  }

  // ---------- Formatting ----------
  function formatBytes(bytes) {
    if (!bytes || bytes < 0) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(2) + ' MB';
  }

  // chrome.i18n-compatible formatting for messages loaded from _locales JSON.
  function formatMessage(entry, substitutions) {
    if (!entry || typeof entry.message !== 'string') return null;
    const values = Array.isArray(substitutions)
      ? substitutions.map((v) => String(v))
      : (substitutions != null ? [String(substitutions)] : []);

    const named = {};
    for (const [name, def] of Object.entries(entry.placeholders || {})) {
      const content = String(def?.content ?? '');
      named[name.toLowerCase()] = content.replace(/\$(\d)/g, (_, n) => values[n - 1] ?? '');
    }

    return entry.message.replace(/\$\$|\$([A-Za-z0-9_@]+)\$|\$(\d)/g, (all, name, index) => {
      if (all === '$$') return '$';
      if (name !== undefined) return Object.prototype.hasOwnProperty.call(named, name.toLowerCase()) ? named[name.toLowerCase()] : all;
      return values[index - 1] ?? '';
    });
  }

  // Replace {token} markers without interpreting `$` in the values.
  function fillTokens(text, tokens) {
    return String(text).replace(/\{(\w+)\}/g, (all, key) => (key in tokens ? String(tokens[key]) : all));
  }

  // ---------- Message trust ----------
  // True only for messages from this extension's own pages or service worker.
  // MessageSender.url and .origin are optional, so each is used when present and
  // anything that cannot be proven to be an extension page is refused. Content
  // scripts always carry a tab and the web page's URL, so they never pass.
  function isExtensionSender(sender, extensionId, extensionOrigin) {
    if (!sender || sender.id !== extensionId) return false;
    const origin = String(extensionOrigin || '').replace(/\/+$/, '');
    if (sender.url) return sender.url === origin || sender.url.startsWith(origin + '/');
    if (sender.origin) return sender.origin === origin;
    return !sender.tab;
  }

  // ---------- Network helpers ----------
  // Full size of the resource. A ranged (206) answer carries the size of the slice in
  // Content-Length and the full size after the slash in Content-Range, so that comes first;
  // "bytes 0-0/*" means unknown, and then a slice length is not the file size either.
  function parseSizeFromHeaders(headers) {
    const range = headers.get('content-range');
    if (range) {
      const match = /\/(\d+)\s*$/.exec(range);
      return match ? parseInt(match[1], 10) : 0;
    }
    const len = headers.get('content-length');
    if (len && /^\d+$/.test(len) && Number(len) > 0) return parseInt(len, 10);
    return 0;
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

  return {
    MIME_TO_TYPE, EXT_TO_TYPE, KNOWN_TYPES, MAX_IMAGE_BYTES, MAX_SIDE, MAX_AREA,
    MAX_MESSAGE_CHARS, SCAN_MAX_ITEM_CHARS, SCAN_MAX_TOTAL_CHARS, SCAN_MAX_ITEMS, fitsInMessage,
    OUTPUT_FORMATS, sanitizeInstructions, svgLength, svgPixelSize, hasTransparency,
    sniffImageType, looksLikeSvg, mimeToType, extensionToType, detectType, outputMime, formatFromMime, extensionFor, formatLabel,
    isAllowedImageSrc, isFetchableImageSrc, parseSrcset, extractBgUrls, dedupeKey, displayName, domainOf,
    sanitizeFilename, buildFilename,
    calculateDimensions, letterboxRect, stageSize, checkOutputSize,
    formatBytes, formatMessage, fillTokens,
    isExtensionSender, parseSizeFromHeaders, mapLimit,
  };
});
