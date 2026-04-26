// ============================================================
// ImageToolkit – Content Script (injected on-demand only)
// Optimized image collection: TreeWalker + targeted BG scan
// ============================================================

'use strict';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getImages') {
    sendResponse(collectImages());
    return false;
  }

  // Highlight selected images on the page
  if (message.action === 'highlightImages') {
    highlightImages(message.urls || []);
    sendResponse({ success: true });
    return false;
  }
});

function collectImages() {
  const seen = new Set();
  const results = [];
  const shadowRoots = []; // Collect during traversal

  // Build file size map from Performance API
  const sizeMap = new Map();
  try {
    const entries = performance.getEntriesByType('resource');
    for (const entry of entries) {
      const size = entry.encodedBodySize || entry.decodedBodySize || entry.transferSize || 0;
      if (size > 0) sizeMap.set(entry.name, size);
    }
  } catch { /* Performance API not available */ }

  function addImage(src, width, height, alt) {
    if (!src) return;
    if (src.startsWith('chrome-extension:') || src.startsWith('moz-extension:')) return;
    // Allow data:image/ URIs (SVG, PNG, etc.) but skip tiny ones (tracking pixels)
    if (src.startsWith('data:')) {
      if (!src.startsWith('data:image/')) return; // skip data:text/, data:application/, etc.
      if (src.length < 100) return; // skip tiny placeholders
      // Use a hash for dedup since data URIs are long
      const key = 'data:' + src.length + ':' + src.substring(src.length - 40);
      if (seen.has(key)) return;
      seen.add(key);
      results.push({ src, width: width || 0, height: height || 0, alt: alt || '', fileSize: Math.round((src.length - src.indexOf(',') - 1) * 0.75) });
      return;
    }
    try { src = new URL(src, document.baseURI).href; } catch { return; }
    if (seen.has(src)) return;
    seen.add(src);
    results.push({ src, width: width || 0, height: height || 0, alt: alt || '', fileSize: sizeMap.get(src) || 0 });
  }

  // ---- 1. Single TreeWalker: <img> + shadow root collection ----
  const root = document.body || document.documentElement;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
  let node;
  while ((node = walker.nextNode())) {
    // Collect shadow roots during the single pass (avoids querySelectorAll('*'))
    if (node.shadowRoot) shadowRoots.push(node.shadowRoot);

    if (node.tagName === 'IMG') {
      const src = node.currentSrc || node.src;
      let w = node.naturalWidth || node.width || parseInt(node.getAttribute('width'), 10) || 0;
      let h = node.naturalHeight || node.height || parseInt(node.getAttribute('height'), 10) || 0;
      if (!w && !h && node.complete) {
        const rect = node.getBoundingClientRect();
        w = Math.round(rect.width); h = Math.round(rect.height);
      }
      addImage(src, w, h, node.alt);
      if (node.srcset) {
        parseSrcset(node.srcset).forEach((url) => addImage(url, 0, 0, node.alt));
      }
      // Lazy load attributes
      for (const attr of ['data-src','data-lazy-src','data-original','data-srcset','data-lazy-srcset']) {
        const val = node.getAttribute(attr);
        if (val) {
          if (attr.includes('srcset')) parseSrcset(val).forEach(url => addImage(url, 0, 0, node.alt));
          else addImage(val, 0, 0, node.alt);
        }
      }
    }

    // <input type="image">
    if (node.tagName === 'INPUT' && node.type === 'image' && node.src) {
      addImage(node.src, 0, 0, node.alt || '');
    }

    // Inline <svg> → convert to data:image/svg+xml;base64
    if (node.tagName === 'svg' && node.namespaceURI === 'http://www.w3.org/2000/svg') {
      try {
        const svgStr = new XMLSerializer().serializeToString(node);
        if (svgStr.length > 50) { // skip trivial SVGs
          const b64 = btoa(unescape(encodeURIComponent(svgStr)));
          const dataUrl = 'data:image/svg+xml;base64,' + b64;
          const vb = node.getAttribute('viewBox');
          let sw = parseInt(node.getAttribute('width'), 10) || 0;
          let sh = parseInt(node.getAttribute('height'), 10) || 0;
          if (!sw && !sh && vb) {
            const parts = vb.split(/[\s,]+/).map(Number);
            if (parts.length === 4) { sw = parts[2]; sh = parts[3]; }
          }
          addImage(dataUrl, sw, sh, '');
        }
      } catch {}
    }
  }

  // ---- 2. <picture> <source> srcset ----
  document.querySelectorAll('picture source[srcset]').forEach((source) => {
    parseSrcset(source.srcset).forEach((url) => addImage(url, 0, 0, ''));
  });

  // ---- 3. CSS background images (targeted tags only) ----
  const BG_TAGS = 'div,section,article,aside,header,footer,main,nav,figure,span,a,li,td,th,button';
  const bgCandidates = document.querySelectorAll(BG_TAGS);
  for (let i = 0; i < bgCandidates.length; i++) {
    const el = bgCandidates[i];
    // Skip invisible elements quickly
    if (!el.offsetParent && el.tagName !== 'BODY' && el.tagName !== 'HTML') continue;
    // Fast check: inline style first (avoids expensive getComputedStyle)
    const inlineBg = el.style.backgroundImage;
    if (inlineBg && inlineBg !== 'none') {
      extractBgUrls(inlineBg).forEach((url) => addImage(url, 0, 0, ''));
      continue;
    }
    // Computed style — only if element is large enough to matter
    if (el.offsetWidth < 10 || el.offsetHeight < 10) continue;
    try {
      const computed = getComputedStyle(el).backgroundImage;
      if (computed && computed !== 'none') {
        extractBgUrls(computed).forEach((url) => addImage(url, 0, 0, ''));
      }
    } catch { /* cross-origin frame elements */ }
  }

  // ---- 4. Shadow DOM (collected during TreeWalker, one level) ----
  for (const sr of shadowRoots) {
    sr.querySelectorAll('img').forEach((img) => {
      const src = img.currentSrc || img.src;
      addImage(src, img.naturalWidth || img.width, img.naturalHeight || img.height, img.alt);
      // Lazy load
      for (const attr of ['data-src','data-lazy-src','data-original']) {
        const val = img.getAttribute(attr);
        if (val) addImage(val, 0, 0, img.alt);
      }
    });
    // SVGs inside shadow DOM
    sr.querySelectorAll('svg').forEach((svg) => {
      try {
        const svgStr = new XMLSerializer().serializeToString(svg);
        if (svgStr.length > 50) addImage('data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgStr))), 0, 0, '');
      } catch {}
    });
    // Background images inside shadow DOM (targeted tags only)
    sr.querySelectorAll(BG_TAGS).forEach((el) => {
      if (el.offsetWidth < 10 || el.offsetHeight < 10) return;
      const inlineBg = el.style.backgroundImage;
      if (inlineBg && inlineBg !== 'none') {
        extractBgUrls(inlineBg).forEach((url) => addImage(url, 0, 0, ''));
        return;
      }
      try {
        const computed = getComputedStyle(el).backgroundImage;
        if (computed && computed !== 'none') {
          extractBgUrls(computed).forEach((url) => addImage(url, 0, 0, ''));
        }
      } catch { /* skip */ }
    });
  }

  // ---- 5. <video poster> ----
  document.querySelectorAll('video[poster]').forEach((video) => {
    addImage(video.poster, 0, 0, '');
  });

  // ---- 6. Favicons / app icons ----
  document.querySelectorAll('link[rel*="icon"]').forEach((link) => {
    addImage(link.href, 0, 0, 'icon');
  });

  // ---- 7. OG / Twitter meta images ----
  const metaSelectors = 'meta[property="og:image"], meta[name="twitter:image"], meta[name="twitter:image:src"]';
  document.querySelectorAll(metaSelectors).forEach((meta) => {
    const content = meta.getAttribute('content');
    if (content) addImage(content, 0, 0, 'meta');
  });

  // ---- 8. <object> / <embed> with image types ----
  document.querySelectorAll('object[data], embed[src]').forEach((el) => {
    const src = el.data || el.src;
    if (src && /\.(jpe?g|png|gif|svg|webp|avif)/i.test(src)) addImage(src, 0, 0, '');
  });

  // ---- 9. <link rel="preload" as="image"> ----
  document.querySelectorAll('link[rel="preload"][as="image"]').forEach((link) => {
    if (link.href) addImage(link.href, 0, 0, '');
  });

  // ---- 10. <a> with direct image hrefs (galleries) ----
  document.querySelectorAll('a[href]').forEach((a) => {
    const href = a.href;
    if (href && /\.(jpe?g|png|gif|svg|webp|avif)(\?|$)/i.test(href)) addImage(href, 0, 0, '');
  });

  return results;
}

// ============================================================
// Live DOM Observer — detects new images from lazy load / infinite scroll
// ============================================================
let observerActive = false;
let newImageCount = 0;
let debounceTimer = null;

function startObserver() {
  if (observerActive) return;
  observerActive = true;

  const observer = new MutationObserver((mutations) => {
    let found = 0;
    for (const m of mutations) {
      // Attribute changes (lazy load: src/srcset set on existing img)
      if (m.type === 'attributes' && m.target?.tagName === 'IMG') {
        found++;
        continue;
      }
      // New nodes added to DOM
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.tagName === 'IMG' && (node.src || node.currentSrc)) found++;
        else if (node.querySelectorAll) found += node.querySelectorAll('img[src]').length;
      }
    }
    if (found > 0) {
      newImageCount += found;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        // Notify popup that new images were found
        chrome.runtime.sendMessage({
          action: 'newImagesDetected',
          count: newImageCount,
        }).catch(() => {}); // popup might not be open
        newImageCount = 0;
      }, 500);
    }
  });

  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'srcset'],
  });
}

// Start observer after first scan
startObserver();

// ---- Helpers ----

function parseSrcset(srcset) {
  if (!srcset) return [];
  return srcset.split(',').map((entry) => entry.trim().split(/\s+/)[0]).filter(Boolean);
}

function extractBgUrls(bgValue) {
  const urls = [];
  const regex = /url\(["']?([^"')]+)["']?\)/g;
  let match;
  while ((match = regex.exec(bgValue)) !== null) {
    urls.push(match[1]);
  }
  return urls;
}

// ============================================================
// Highlight images on page (visual border when selected in panel)
// ============================================================
const HIGHLIGHT_CLASS = 'imagetoolkit-highlight';
const HIGHLIGHT_STYLE_ID = 'imagetoolkit-highlight-style';

function highlightImages(selectedUrls) {
  // Inject highlight CSS once
  if (!document.getElementById(HIGHLIGHT_STYLE_ID)) {
    const style = document.createElement('style');
    style.id = HIGHLIGHT_STYLE_ID;
    style.textContent = `
      .${HIGHLIGHT_CLASS} {
        outline: 2px solid #7c3aed !important;
        outline-offset: 1px !important;
        box-shadow: 0 0 0 4px rgba(124,58,237,0.2) !important;
        transition: outline 0.15s, box-shadow 0.15s !important;
      }
    `;
    document.head.appendChild(style);
  }

  const selectedSet = new Set(selectedUrls);

  // Walk all images and toggle highlight
  const images = document.querySelectorAll('img');
  images.forEach(img => {
    const src = img.currentSrc || img.src;
    if (selectedSet.has(src)) {
      img.classList.add(HIGHLIGHT_CLASS);
      // Scroll first selected into view (only once)
      if (selectedSet.size === 1 || src === selectedUrls[0]) {
        img.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } else {
      img.classList.remove(HIGHLIGHT_CLASS);
    }
  });

  // Also check shadow DOMs without querySelectorAll('*') on the main document
  const root = document.body || document.documentElement;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
  let node;
  const shadowRoots = [];

  while ((node = walker.nextNode())) {
    if (node.shadowRoot) shadowRoots.push(node.shadowRoot);
  }

  shadowRoots.forEach((shadowRoot) => {
    shadowRoot.querySelectorAll('img').forEach((img) => {
      const src = img.currentSrc || img.src;
      if (selectedSet.has(src)) {
        img.classList.add(HIGHLIGHT_CLASS);
      } else {
        img.classList.remove(HIGHLIGHT_CLASS);
      }
    });
  });
}
