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

  root.ITK = Object.assign(root.ITK || {}, {
    ui: { icon, el, debounce, toast, applyTheme, followSystemTheme, flashError, withBusy, send, call, blobToDataUrl },
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
