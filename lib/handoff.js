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
  const EDITOR_MAX_AGE_MS = 12 * 60 * 60 * 1000;

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

  // `maxAge`: how long the entry may wait at most. An editor window keeps its image as long as
  // it is open (it is removed when the window closes), so editor entries get a long one.
  async function put(value, { maxAge = MAX_AGE_MS } = {}) {
    const key = crypto.randomUUID();
    await prune().catch(() => {});
    const created = Date.now();
    await run('readwrite', (store) => store.put({ value, created, expires: created + maxAge }, key));
    return key;
  }

  const expired = (entry, now = Date.now()) => !entry?.created || now > (entry.expires ?? entry.created + MAX_AGE_MS);

  // Not deleted on read, so reloading the editor window still works. Expired entries
  // are never returned and are deleted on the spot.
  async function get(key) {
    if (!key) return null;
    const entry = await run('readonly', (store) => store.get(key));
    if (entry && expired(entry)) {
      await run('readwrite', (store) => store.delete(key)).catch(() => {});
      return null;
    }
    return entry?.value ?? null;
  }

  async function remove(key) {
    if (key) await run('readwrite', (store) => store.delete(key));
  }

  // Forget handoffs nobody picked up (e.g. the window was closed immediately).
  async function prune() {
    const now = Date.now();
    await run('readwrite', (store) => {
      const cursorRequest = store.openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) return;
        if (expired(cursor.value, now)) cursor.delete();
        cursor.continue();
      };
    });
  }

  root.ITK = Object.assign(root.ITK || {}, { handoff: { put, get, remove, prune, EDITOR_MAX_AGE_MS } });
})(typeof globalThis !== 'undefined' ? globalThis : self);
