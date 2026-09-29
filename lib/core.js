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

  function formatLabel(format) {
    return format === 'jpeg' ? 'JPG' : String(format || '').toUpperCase();
  }

  // ---------- URLs ----------
  // Only schemes the extension can actually fetch and render are worth listing.
  function isAllowedImageSrc(src) {
    return /^https?:\/\//i.test(src) || /^data:image\//i.test(src);
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

  // ---------- Dimensions ----------
  const MAX_SIDE = 16384;
  const MAX_AREA = 100_000_000; // ~100 MP keeps canvas memory reasonable

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

  function checkOutputSize(width, height) {
    if (!(width >= 1 && height >= 1)) throw new Error('Invalid output size');
    if (width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_AREA) {
      throw new Error(`Output too large (max ${MAX_SIDE}px per side, ${MAX_AREA / 1e6} MP)`);
    }
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
  function parseSizeFromHeaders(headers) {
    const len = headers.get('content-length');
    if (len && /^\d+$/.test(len) && Number(len) > 0) return parseInt(len, 10);
    const range = headers.get('content-range');
    if (range) {
      const match = /\/(\d+)\s*$/.exec(range);
      if (match) return parseInt(match[1], 10);
    }
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
    MIME_TO_TYPE, EXT_TO_TYPE, KNOWN_TYPES, MAX_SIDE, MAX_AREA,
    sniffImageType, mimeToType, extensionToType, detectType, outputMime, formatFromMime, extensionFor, formatLabel,
    isAllowedImageSrc, parseSrcset, extractBgUrls, dedupeKey, displayName, domainOf,
    sanitizeFilename, buildFilename,
    calculateDimensions, letterboxRect, checkOutputSize,
    formatBytes, formatMessage, fillTokens,
    isExtensionSender, parseSizeFromHeaders, mapLimit,
  };
});
