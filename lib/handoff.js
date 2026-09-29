// ============================================================
// ImageToolkit – Handoff store (IndexedDB)
// Passes an image (URL, data URL or Blob) from one extension context to another,
// e.g. service worker → editor window. IndexedDB has no 10 MB cap like
// chrome.storage.local, and each handoff gets its own key so windows never collide.
// ============================================================

(function (root) {
  'use strict';

  const DB_NAME = 'imagetoolkit';
  const STORE = 'handoff';
  const MAX_AGE_MS = 30 * 60 * 1000;

  function open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function run(mode, fn) {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const result = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(result?.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }

  async function put(value) {
    const key = crypto.randomUUID();
    await prune().catch(() => {});
    await run('readwrite', (store) => store.put({ value, created: Date.now() }, key));
    return key;
  }

  // Not deleted on read, so reloading the editor window still works; prune() expires it.
  async function get(key) {
    if (!key) return null;
    const entry = await run('readonly', (store) => store.get(key));
    return entry?.value ?? null;
  }

  // Forget handoffs nobody picked up (e.g. the window was closed immediately).
  async function prune() {
    const cutoff = Date.now() - MAX_AGE_MS;
    await run('readwrite', (store) => {
      const cursorRequest = store.openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) return;
        if (!cursor.value?.created || cursor.value.created < cutoff) cursor.delete();
        cursor.continue();
      };
    });
  }

  root.ITK = Object.assign(root.ITK || {}, { handoff: { put, get, prune } });
})(typeof globalThis !== 'undefined' ? globalThis : self);
