// ============================================================
// ImageToolkit – Shared UI helpers for extension pages
// DOM builders, SVG sprite icons, toasts and theme handling.
// ============================================================

(function (root) {
  'use strict';

  function icon(name, cls = 'i i-sm') {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', cls);
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#i-${name}`);
    svg.appendChild(use);
    return svg;
  }

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value == null) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value);
    }
    for (const child of [].concat(children)) if (child) node.append(child);
    return node;
  }

  function debounce(fn, ms) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
  }

  const TOAST_ICONS = { success: 'check-circle', error: 'alert', info: 'sparkles' };

  function toast(message, type = 'success') {
    const host = document.getElementById('toasts');
    if (!host) return;
    const node = el('div', { class: `toast toast-${type}` }, [icon(TOAST_ICONS[type] || 'sparkles'), el('span', { text: message })]);
    host.append(node);
    while (host.children.length > 3) host.firstElementChild.remove();
    setTimeout(() => {
      node.classList.add('out');
      node.addEventListener('animationend', () => node.remove(), { once: true });
    }, type === 'error' ? 4200 : 2600);
  }

  const darkQuery = matchMedia('(prefers-color-scheme: dark)');

  // Applies "auto" | "light" | "dark" to the app root and follows the OS while on auto.
  function applyTheme(app, theme = 'auto') {
    const dark = theme === 'dark' || (theme === 'auto' && darkQuery.matches);
    app.dataset.theme = theme;
    app.classList.toggle('dark', dark);
    app.classList.toggle('light', !dark);
    return dark;
  }

  function followSystemTheme(app, onChange) {
    darkQuery.addEventListener('change', () => {
      if ((app.dataset.theme || 'auto') === 'auto') onChange?.();
    });
  }

  function flashError(input) {
    if (!input) return;
    input.classList.add('input-error');
    input.focus();
    setTimeout(() => input.classList.remove('input-error'), 1400);
  }

  async function withBusy(button, task) {
    button.disabled = true;
    button.classList.add('is-busy');
    try {
      return await task();
    } finally {
      button.disabled = false;
      button.classList.remove('is-busy');
    }
  }

  function send(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        void chrome.runtime.lastError;
        resolve(response);
      });
    });
  }

  async function call(message) {
    const response = await send(message);
    if (!response) throw new Error('No response');
    if (response.error) throw new Error(response.error);
    return response;
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  // Hands a Blob to the service worker for download. Small files travel as a data URL, which
  // outlives this page; anything whose base64 would not fit one message safely is passed as a
  // blob: URL, kept alive until Chrome reports the download finished (or 10 minutes pass).
  async function saveBlob(blob, filename, saveAs = true) {
    if (ITK.fitsInMessage(blob.size)) {
      const res = await call({ action: 'downloadBlob', dataUrl: await blobToDataUrl(blob), filename, saveAs });
      return { ...res, via: 'data' };
    }
    const url = URL.createObjectURL(blob);
    let res;
    try {
      res = await call({ action: 'downloadBlob', dataUrl: url, filename, saveAs });
    } catch (err) {
      URL.revokeObjectURL(url);
      throw err;
    }
    if (!Number.isInteger(res.downloadId)) { URL.revokeObjectURL(url); return { ...res, via: 'blob' }; }
    const release = () => { chrome.downloads.onChanged.removeListener(onChanged); clearTimeout(timer); URL.revokeObjectURL(url); };
    const onChanged = (delta) => {
      if (delta.id === res.downloadId && ['complete', 'interrupted'].includes(delta.state?.current)) release();
    };
    const timer = setTimeout(release, 10 * 60 * 1000);
    chrome.downloads.onChanged.addListener(onChanged);
    return { ...res, via: 'blob' };
  }

  // WAI-ARIA radio group for segmented controls: one Tab stop (the checked option), arrows /
  // Home / End move and select, aria-checked follows. `onChange(value)` runs on user changes.
  function setRadio(group, value) {
    const radios = [...group.querySelectorAll('[role="radio"]')];
    const current = radios.find((r) => r.dataset.value === value) || radios[0];
    radios.forEach((radio) => {
      const on = radio === current;
      radio.classList.toggle('active', on);
      radio.setAttribute('aria-checked', String(on));
      radio.tabIndex = on ? 0 : -1;
    });
  }

  function initRadioGroup(group, onChange) {
    const choose = (radio) => {
      setRadio(group, radio.dataset.value);
      onChange?.(radio.dataset.value);
    };
    group.addEventListener('click', (e) => {
      const radio = e.target.closest('[role="radio"]');
      if (radio && group.contains(radio)) choose(radio);
    });
    group.addEventListener('keydown', (e) => {
      const radios = [...group.querySelectorAll('[role="radio"]')];
      const i = radios.indexOf(document.activeElement);
      if (i < 0) return;
      const rtl = document.documentElement.dir === 'rtl';
      const step = { ArrowRight: rtl ? -1 : 1, ArrowDown: 1, ArrowLeft: rtl ? 1 : -1, ArrowUp: -1 }[e.key];
      const target = e.key === 'Home' ? radios[0] : e.key === 'End' ? radios[radios.length - 1]
        : step ? radios[(i + step + radios.length) % radios.length] : null;
      if (!target) return;
      e.preventDefault();
      choose(target);
      target.focus();
    });
    const checked = group.querySelector('[role="radio"].active') || group.querySelector('[role="radio"]');
    if (checked) setRadio(group, checked.dataset.value);
  }

  root.ITK = Object.assign(root.ITK || {}, {
    ui: { icon, el, debounce, toast, applyTheme, followSystemTheme, flashError, withBusy, send, call, blobToDataUrl, saveBlob, setRadio, initRadioGroup },
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
