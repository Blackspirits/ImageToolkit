// ============================================================
// ImageToolkit – Content Script (injected on demand, after lib/core.js)
// Image collection: TreeWalker + targeted background scan + live observer
// ============================================================

(() => {
  'use strict';

  // Injected again after the extension reloads or when the panel rescans: keep one instance.
  if (window.__imagetoolkitScanner) return;
  window.__imagetoolkitScanner = true;

  const { isAllowedImageSrc, parseSrcset, extractBgUrls, svgPixelSize, SCAN_MAX_ITEM_CHARS, SCAN_MAX_TOTAL_CHARS, SCAN_MAX_ITEMS } = globalThis.ITK;

  const BG_TAGS = 'div,section,article,aside,header,footer,main,nav,figure,span,a,li,td,th,button,body';
  const LAZY_ATTRS = ['data-src', 'data-lazy-src', 'data-original', 'data-srcset', 'data-lazy-srcset'];
  const OBSERVER_IDLE_MS = 5 * 60 * 1000;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return false;

    if (message.action === 'getImages') {
      const { images, truncated } = collectImages();
      known = new Set(images.map((img) => keyOf(img.src)));
      sendResponse({ images, truncated });
      startObserver();
      return false;
    }

    if (message.action === 'highlightImages') {
      highlightImages(message.urls || []);
      sendResponse({ success: true });
      return false;
    }
    return false;
  });

  // ---------- Inline SVG ----------
  // Copy of an inline <svg> as a standalone file: the page's colours baked in (icons paint
  // with currentColor or CSS fills, which fall back to black outside the page) and the size
  // the page renders it at. The viewBox is only a coordinate system: a 24 px icon commonly
  // has viewBox="0 -960 960 960". Hidden SVGs without an absolute size (sprites) are skipped.
  function svgToDataUrl(node) {
    const rect = node.getBoundingClientRect();
    const size = svgPixelSize({
      renderedWidth: rect.width, renderedHeight: rect.height,
      width: node.getAttribute('width'), height: node.getAttribute('height'),
    });
    if (!size) return null;
    const clone = node.cloneNode(true);
    const cs = getComputedStyle(node);
    clone.style.color = cs.color;
    if (!node.hasAttribute('fill') && cs.fill) clone.setAttribute('fill', cs.fill);
    if (!node.hasAttribute('stroke') && cs.stroke && cs.stroke !== 'none') clone.setAttribute('stroke', cs.stroke);
    clone.setAttribute('width', String(size.width));
    clone.setAttribute('height', String(size.height));
    const markup = new XMLSerializer().serializeToString(clone);
    if (markup.length <= 50) return null; // trivial SVGs
    // Base64 grows by a third; a copy that cannot fit one scan item is not worth encoding.
    if (markup.length * 4 / 3 > SCAN_MAX_ITEM_CHARS) return { tooLarge: true };
    return { dataUrl: 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(markup))), ...size };
  }

  // ---------- Collection ----------
  // Everything travels back as one message, so the payload is bounded: one inline image
  // may take SCAN_MAX_ITEM_CHARS and all entries together SCAN_MAX_TOTAL_CHARS.
  function collectImages() {
    const seen = new Set();
    const results = [];
    const shadowRoots = [];
    let totalChars = 0;
    let truncated = false;

    // File sizes the page already downloaded (no extra requests).
    const sizeMap = new Map();
    try {
      for (const entry of performance.getEntriesByType('resource')) {
        const size = entry.encodedBodySize || entry.decodedBodySize || entry.transferSize || 0;
        if (size > 0) sizeMap.set(entry.name, size);
      }
    } catch { /* Performance API not available */ }

    // False once the budget is spent, so callers can stop early.
    function fits(src, alt) {
      if (results.length >= SCAN_MAX_ITEMS) { truncated = true; return false; }
      const cost = src.length + alt.length;
      if (src.length > SCAN_MAX_ITEM_CHARS || totalChars + cost > SCAN_MAX_TOTAL_CHARS) { truncated = true; return false; }
      totalChars += cost;
      return true;
    }

    function addImage(rawSrc, width, height, rawAlt) {
      if (!rawSrc) return;
      let src = String(rawSrc).trim();
      const alt = String(rawAlt || '').slice(0, 300);
      if (src.startsWith('data:')) {
        if (!src.startsWith('data:image/') || src.length < 100) return; // skip non-images and tracking pixels
        const key = 'data:' + src.length + ':' + src.slice(-64);
        if (seen.has(key)) return;
        seen.add(key);
        if (!fits(src, alt)) return;
        results.push({ src, width: width || 0, height: height || 0, alt, fileSize: Math.round((src.length - src.indexOf(',') - 1) * 0.75) });
        return;
      }
      try { src = new URL(src, document.baseURI).href; } catch { return; }
      if (!isAllowedImageSrc(src) || seen.has(src)) return;
      seen.add(src);
      if (!fits(src, alt)) return;
      results.push({ src, width: width || 0, height: height || 0, alt, fileSize: sizeMap.get(src) || 0 });
    }

    function addImgElement(node) {
      let w = node.naturalWidth || 0;
      let h = node.naturalHeight || 0;
      if (!w || !h) {
        w = node.width || parseInt(node.getAttribute('width'), 10) || 0;
        h = node.height || parseInt(node.getAttribute('height'), 10) || 0;
      }
      addImage(node.currentSrc || node.src, w, h, node.alt);
      if (node.srcset) parseSrcset(node.srcset).forEach((url) => addImage(url, 0, 0, node.alt));
      for (const attr of LAZY_ATTRS) {
        const value = node.getAttribute(attr);
        if (!value) continue;
        if (attr.includes('srcset')) parseSrcset(value).forEach((url) => addImage(url, 0, 0, node.alt));
        else addImage(value, 0, 0, node.alt);
      }
    }

    function addSvgElement(node) {
      if (truncated) return;
      try {
        const svg = svgToDataUrl(node);
        if (svg?.tooLarge) { truncated = true; return; }
        if (svg) addImage(svg.dataUrl, svg.width, svg.height, node.getAttribute('aria-label') || '');
      } catch {}
    }

    function addBackground(el) {
      // getClientRects() is empty for display:none, but not for position:fixed (unlike offsetParent).
      if (!el.getClientRects().length) return;
      const inline = el.style?.backgroundImage;
      if (inline && inline !== 'none') {
        extractBgUrls(inline).forEach((url) => addImage(url, 0, 0, ''));
        return;
      }
      if (el.offsetWidth < 10 || el.offsetHeight < 10) return;
      try {
        const computed = getComputedStyle(el).backgroundImage;
        if (computed && computed !== 'none') extractBgUrls(computed).forEach((url) => addImage(url, 0, 0, ''));
      } catch {}
    }

    // 1. Single TreeWalker pass: <img>, <input type=image>, inline <svg>, shadow roots.
    const root = document.body || document.documentElement;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
    let node = walker.currentNode;
    while (node) {
      if (node.shadowRoot) shadowRoots.push(node.shadowRoot);
      if (node.tagName === 'IMG') addImgElement(node);
      else if (node.tagName === 'INPUT' && node.type === 'image' && node.src) addImage(node.src, 0, 0, node.alt || '');
      else if (node.tagName === 'svg' && node.namespaceURI === 'http://www.w3.org/2000/svg' && !node.closest('svg svg')) addSvgElement(node);
      node = walker.nextNode();
    }

    // 2. <picture> sources
    document.querySelectorAll('picture source[srcset]').forEach((source) => {
      parseSrcset(source.srcset).forEach((url) => addImage(url, 0, 0, ''));
    });

    // 3. CSS backgrounds (targeted tags only, avoids querySelectorAll('*'))
    document.querySelectorAll(BG_TAGS).forEach(addBackground);

    // 4. Shadow DOM (one level, collected during the walk)
    for (const sr of shadowRoots) {
      sr.querySelectorAll('img').forEach(addImgElement);
      sr.querySelectorAll('svg').forEach(addSvgElement);
      sr.querySelectorAll(BG_TAGS).forEach(addBackground);
    }

    // 5. Video posters, icons, social meta, embeds, preloads and gallery links
    document.querySelectorAll('video[poster]').forEach((video) => addImage(video.poster, 0, 0, ''));
    document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]').forEach((link) => addImage(link.href, 0, 0, 'icon'));
    document.querySelectorAll('meta[property="og:image"], meta[name="twitter:image"], meta[name="twitter:image:src"]').forEach((meta) => {
      addImage(meta.getAttribute('content'), 0, 0, 'meta');
    });
    document.querySelectorAll('object[data], embed[src]').forEach((el) => {
      const src = el.data || el.src;
      if (src && /\.(jpe?g|png|gif|svg|webp|avif)(\?|#|$)/i.test(src)) addImage(src, 0, 0, '');
    });
    document.querySelectorAll('link[rel="preload"][as="image"]').forEach((link) => {
      if (link.href) addImage(link.href, 0, 0, '');
      if (link.imageSrcset) parseSrcset(link.imageSrcset).forEach((url) => addImage(url, 0, 0, ''));
    });
    document.querySelectorAll('a[href]').forEach((a) => {
      if (/\.(jpe?g|png|gif|svg|webp|avif)(\?|#|$)/i.test(a.href)) addImage(a.href, 0, 0, '');
    });

    return { images: results, truncated };
  }

  // ---------- Live observer (lazy load / infinite scroll) ----------
  // Runs only while the panel keeps asking for images, so idle tabs cost nothing.
  let observer = null;
  let idleTimer = null;
  let newImageCount = 0;
  let debounceTimer = null;
  let known = new Set();

  // Same identity collectImages() uses, so a re-render of a known image is not "new".
  function keyOf(rawSrc) {
    const src = String(rawSrc || '').trim();
    if (!src) return '';
    if (src.startsWith('data:')) return 'data:' + src.length + ':' + src.slice(-64);
    try { return new URL(src, document.baseURI).href; } catch { return ''; }
  }

  function countSrc(src) {
    src = String(src || '').trim();
    if (src.startsWith('data:') && (!src.startsWith('data:image/') || src.length < 100)) return 0; // as in collectImages
    const key = keyOf(src);
    if (!key || known.has(key) || (!key.startsWith('data:') && !isAllowedImageSrc(key))) return 0;
    known.add(key);
    return 1;
  }

  const countNew = (img) => countSrc(img.currentSrc || img.src);
  const countSrcset = (srcset) => parseSrcset(srcset).reduce((n, url) => n + countSrc(url), 0);
  const countInlineBackground = (el) => extractBgUrls(el.style?.backgroundImage).reduce((n, url) => n + countSrc(url), 0);

  function countSvg(svg) {
    if (svg.namespaceURI !== 'http://www.w3.org/2000/svg' || svg.parentElement?.closest('svg')) return 0;
    try {
      const copy = svgToDataUrl(svg);
      return copy?.dataUrl ? countSrc(copy.dataUrl) : 0;
    } catch {
      return 0;
    }
  }

  // What the live observer recognises without forcing style recalculation: <img>,
  // <picture><source srcset>, top-level inline <svg> and inline-style backgrounds. Images
  // that only appear through stylesheet classes are picked up by the next rescan.
  const OBSERVED = 'img,picture>source[srcset],svg,[style*="url("]';
  const MAX_NODES_PER_BATCH = 400;

  function countAdded(node) {
    let found = 0;
    const nodes = node.matches?.(OBSERVED) ? [node] : [];
    if (node.querySelectorAll) nodes.push(...[...node.querySelectorAll(OBSERVED)].slice(0, MAX_NODES_PER_BATCH));
    for (const el of nodes) {
      if (el.tagName === 'IMG') found += countNew(el);
      else if (el.tagName === 'SOURCE') found += countSrcset(el.srcset);
      else if (el.tagName.toLowerCase() === 'svg') found += countSvg(el);
      if (el.style?.backgroundImage) found += countInlineBackground(el);
    }
    return found;
  }

  function startObserver() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(stopObserver, OBSERVER_IDLE_MS);
    if (observer) return;

    observer = new MutationObserver((mutations) => {
      let found = 0;
      for (const m of mutations) {
        if (m.type === 'attributes') {
          if (m.target?.tagName === 'IMG') found += countNew(m.target);
          else if (m.target?.tagName === 'SOURCE' && m.target.parentElement?.tagName === 'PICTURE') found += countSrcset(m.target.srcset);
          continue;
        }
        for (const added of m.addedNodes) {
          if (added.nodeType === 1) found += countAdded(added);
        }
      }
      if (!found) return;
      newImageCount += found;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        chrome.runtime.sendMessage({ action: 'newImagesDetected', count: newImageCount }).catch(() => {});
        newImageCount = 0;
      }, 800);
    });

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'srcset'],
    });
  }

  function stopObserver() {
    observer?.disconnect();
    observer = null;
    clearTimeout(debounceTimer);
    newImageCount = 0;
  }

  // ---------- Highlight selected images on the page ----------
  const HIGHLIGHT_ATTR = 'data-imagetoolkit-selected';
  const HIGHLIGHT_STYLE_ID = 'imagetoolkit-highlight-style';

  function highlightImages(selectedUrls) {
    if (!document.getElementById(HIGHLIGHT_STYLE_ID)) {
      const style = document.createElement('style');
      style.id = HIGHLIGHT_STYLE_ID;
      style.textContent = `[${HIGHLIGHT_ATTR}]{outline:3px solid #7c5cff!important;outline-offset:2px!important;box-shadow:0 0 0 6px rgba(124,92,255,.25)!important;transition:outline-color .15s,box-shadow .15s!important}`;
      (document.head || document.documentElement).appendChild(style);
    }

    const selected = new Set(selectedUrls);
    let scrolled = false;
    const toggle = (img) => {
      const src = img.currentSrc || img.src;
      if (selected.has(src)) {
        img.setAttribute(HIGHLIGHT_ATTR, '');
        // Bring the most recently selected image into view once.
        if (!scrolled && src === selectedUrls[selectedUrls.length - 1]) {
          img.scrollIntoView({ behavior: 'smooth', block: 'center' });
          scrolled = true;
        }
      } else {
        img.removeAttribute(HIGHLIGHT_ATTR);
      }
    };

    document.querySelectorAll('img').forEach(toggle);
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_ELEMENT, null);
    let node;
    while ((node = walker.nextNode())) {
      if (node.shadowRoot) node.shadowRoot.querySelectorAll('img').forEach(toggle);
    }
  }
})();
