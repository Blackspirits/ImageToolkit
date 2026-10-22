// End-to-end tests: loads the unpacked extension in Chromium (Playwright) and drives
// the real service worker, offscreen document, content script and pages.
// Run with: npm run test:e2e   (needs `npm install` and `npx playwright install chromium`)

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// ---------- Fixtures ----------
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (const byte of buf) {
    c = (crc ^ byte) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function png(width, height, rgba = [255, 0, 0, 255]) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(width).fill(rgba).flat())]);
  const raw = Buffer.concat(Array(height).fill(row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// Opaque PNG with a small fully transparent square (an alpha detail a sampled check misses).
function pngWithHole(size, hole) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const p = y * stride + 1 + x * 4;
      const inHole = x >= hole.x && x < hole.x + hole.size && y >= hole.y && y < hole.y + hole.size;
      raw[p] = 200; raw[p + 1] = 60; raw[p + 2] = 40; raw[p + 3] = inHole ? 0 : 255;
    }
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const MiB = 1024 * 1024;

const FIXTURES = {
  'anim.gif': Buffer.from('R0lGODlhAQABAIAAAP///wAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQJCgAAACwAAAAAAQABAAACAkQBACH5BAkKAAAALAAAAAABAAEAAAICTAEAOw==', 'base64'),
  'logo.svg': Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="red"/></svg>'),
  'photo.png': png(30, 20),
  'wide.png': png(40, 20, [0, 128, 255, 255]),
  'noext': png(8, 8),
  // Mislabelled responses: an SVG sent as text/plain, and an HTML error page behind a .jpg URL.
  'plain.svg': Buffer.from('<?xml version="1.0"?>\n<!-- icon -->\n<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8"/></svg>'),
  'fake.jpg': Buffer.from('<!doctype html><title>Not found</title><p>Sorry'),
  // Icons painted by the page: currentColor (red from <body>), a CSS-class fill (green), a
  // Material-style icon whose viewBox is 960 units but which renders at 24 px, and a hidden
  // sprite sheet (not an image).
  'icons.html': Buffer.from('<!doctype html><title>i</title><style>.ic{fill:#00ff00}.mat{width:24px;height:24px}</style><body style="color:rgb(255,0,0)">'
    + '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M0 0h24v24H0z"/></svg>'
    + '<svg class="ic" viewBox="0 0 24 24" width="24" height="24"><path d="M0 0h24v24H0z"/></svg>'
    + '<svg id="mat" class="mat" viewBox="0 -960 960 960"><path fill="#333" d="M0 -960h960v960H0z"/></svg>'
    + '<svg style="display:none"><symbol id="s" viewBox="0 0 10 10"><path d="M0 0h10v10H0z"/></symbol></svg></body>'),
  // Inline images built in the page: one larger than a scan item, then enough to pass the
  // scan's total budget.
  'heavy.html': Buffer.from('<!doctype html><title>h</title><body><script>'
    + 'const add=(mb,i)=>{const img=new Image();img.alt="h"+i;img.src="data:image/png;base64,"+String.fromCharCode(65+i).repeat(mb*1024*1024);document.body.append(img)};'
    + 'add(9,0);for(let i=1;i<=5;i++)add(6,i);</script></body>'),
  'holey.png': pngWithHole(2000, { x: 1000, y: 700, size: 4 }),
  'frame.html': Buffer.from('<!doctype html><title>fr</title><body><img src="anim.gif?inframe=1"><div style="width:40px;height:40px;background:url(wide.png?inframebg=1)"></div></body>'),
  // Infinite feed: reaching the end appends a batch and drops the oldest (like virtualised
  // timelines), three times. A lazy image sits far below the first screen.
  'feed.html': Buffer.from('<!doctype html><title>f</title><body style="margin:0">'
    + '<img src="photo.png?feed=0" style="display:block;height:300px">'
    + '<div style="height:3000px"></div><img loading="lazy" src="wide.png?lazy=1" style="display:block;height:50px">'
    + '<div id="list"></div><div id="end" style="height:10px"></div><script>'
    + 'let batch=0;const list=document.getElementById("list");'
    + 'new IntersectionObserver((e)=>{if(!e[0].isIntersecting||batch>=3)return;batch++;'
    + 'const box=document.createElement("div");box.className="batch";'
    + 'box.innerHTML=`<img src="photo.png?feed=${batch}a" style="display:block;height:900px"><img src="photo.png?feed=${batch}b" style="display:block;height:900px">`;'
    + 'list.append(box);[...list.children].slice(0,-1).forEach((b)=>b.querySelectorAll("img").forEach((i)=>{const d=document.createElement("div");d.style.height="900px";i.replaceWith(d);}));'
    + '}).observe(document.getElementById("end"));'
    + '</script></body>'),
  'page.html': Buffer.from('<!doctype html><title>t</title><body><img src="anim.gif"><img src="logo.svg"><img src="photo.png" srcset="photo.png 1x, wide.png 2x"><div style="position:fixed;inset:0 auto auto 0;width:50px;height:50px;background:url(wide.png)"></div><a href="javascript:alert(1)//x.png">x</a></body>'),
  // Right-click targets: every way a page can show an image the context menu may be used on.
  // The page also builds a data: and a blob: copy of a PNG with its own script.
  'mislabel.png': png(16, 16, [0, 160, 0, 255]),
  'typed': png(12, 12, [160, 0, 160, 255]),
  'menu.html': Buffer.from('<!doctype html><title>m</title><body>'
    + '<img id="png" src="wide.png"><img id="jpg" src="photo.jpg"><img id="typed" src="typed"><img id="octet" src="noext">'
    + '<img id="mislabel" src="mislabel.png"><img id="cookie" src="auth/cookie.png"><img id="referer" src="ref/guard.png">'
    + '<img id="data"><img id="blob"><script>fetch("wide.png").then((r) => r.blob()).then((b) => {'
    + 'document.getElementById("blob").src = URL.createObjectURL(b);'
    + 'const fr = new FileReader(); fr.onload = () => { document.getElementById("data").src = fr.result; }; fr.readAsDataURL(b); });</script></body>'),
};
const TYPES = { gif: 'image/gif', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', html: 'text/html' };
const TYPE_OVERRIDES = { 'plain.svg': 'text/plain', 'fake.jpg': 'text/html', 'mislabel.png': 'text/plain', typed: 'image/png' };

let server, base, ctx, sw, id, ui;
const cookieLog = [];
const hits = new Map(); // GET requests per path, to check that work is not repeated
const fetchHits = new Map(); // the same, without <img> loads (grid thumbnails): extension fetches only
let hugeBytesSent = 0;   // bytes the "huge" endpoint managed to push before the client hung up
const traffic = { nolenBytes: 0, nolenGets: 0, hotBytes: 0, hotGets: 0 };

async function send(message) {
  return ui.evaluate((m) => chrome.runtime.sendMessage(m), message);
}

async function waitFor(fn, timeout = 8000) {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - start > timeout) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 100));
  }
}

before(async () => {
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const name = decodeURIComponent(url.pathname.slice(1));
    if (req.method === 'GET') hits.set(name, (hits.get(name) || 0) + 1);
    if (req.method === 'GET' && req.headers['sec-fetch-dest'] !== 'image') fetchHits.set(name, (fetchHits.get(name) || 0) + 1);

    // Endless chunked body without Content-Length: the client must stop reading at its cap.
    if (name === 'huge') {
      hugeBytesSent = 0;
      res.writeHead(200, { 'content-type': 'image/png' });
      const chunk = Buffer.alloc(256 * 1024);
      const pump = () => {
        while (!res.destroyed && hugeBytesSent < 200 * 1024 * 1024) {
          hugeBytesSent += chunk.length;
          if (!res.write(chunk)) { res.once('drain', pump); return; }
        }
        if (!res.destroyed) res.end();
      };
      res.on('close', () => res.destroy());
      pump();
      return;
    }
    // 1 MiB images whose server never says how big they are (no Content-Length, no ranges).
    if (name.startsWith('nolen/')) {
      // A 1-byte range answer whose total is unknown ("bytes 0-0/*"): no size from headers.
      if (req.headers.range) {
        res.writeHead(206, { 'content-type': 'image/png', 'content-range': 'bytes 0-0/*', 'cache-control': 'no-store' });
        res.write(Buffer.alloc(1));
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
      if (req.method === 'HEAD') { res.end(); return; }
      traffic.nolenGets++;
      const chunk = Buffer.alloc(64 * 1024);
      let left = 16;
      const pump = () => {
        while (!res.destroyed && left > 0) {
          left--;
          traffic.nolenBytes += chunk.length;
          if (!res.write(chunk)) { res.once('drain', pump); return; }
        }
        if (!res.destroyed) res.end();
      };
      res.on('close', () => res.destroy());
      pump();
      return;
    }
    // Hotlink-protected 1 MiB images: <img> loads are refused, extension fetches are served.
    if (name.startsWith('hot/')) {
      if (req.headers['sec-fetch-dest'] === 'image') { res.writeHead(403); res.end(); return; }
      const body = Buffer.concat([FIXTURES['wide.png'], Buffer.alloc(MiB - FIXTURES['wide.png'].length)]);
      // Only whole-body downloads count (size probes use HEAD / 1-byte ranges).
      if (req.method === 'GET' && !req.headers.range) { traffic.hotGets++; traffic.hotBytes += body.length; }
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store', 'content-length': body.length });
      res.end(body);
      return;
    }
    // Sends the headers and a first chunk, then nothing more: only a time limit ends it.
    if (name === 'stall.png') {
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
      res.write(FIXTURES['wide.png'].subarray(0, 64));
      res.on('close', () => res.destroy());
      return;
    }
    // Records the cookies each image load carried.
    if (name.startsWith('echo/')) {
      cookieLog.push({ name, cookie: req.headers.cookie || '', dest: req.headers['sec-fetch-dest'] || '' });
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store', 'set-cookie': 'tracker=1; Path=/' });
      res.end(FIXTURES['wide.png']);
      return;
    }
    // Needs the session cookie, like an image behind a login.
    if (name === 'auth/cookie.png') {
      if (!/(?:^|;\s*)itk=1(?:;|$)/.test(req.headers.cookie || '')) { res.writeHead(401); res.end(); return; }
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
      res.end(FIXTURES['wide.png']);
      return;
    }
    // Classic anti-hotlink rule: only requests whose Referer is this site get the image.
    if (name === 'ref/guard.png') {
      if (!(req.headers.referer || '').startsWith(base)) { res.writeHead(403); res.end(); return; }
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
      res.end(FIXTURES['wide.png']);
      return;
    }
    // Refuses <img> loads (like hotlink protection) but serves fetches.
    if (name === 'hotlink.png' && req.headers['sec-fetch-dest'] === 'image') { res.writeHead(403); res.end(); return; }

    const delay = Number(url.searchParams.get('delay')) || 0;
    if (delay) await new Promise((r) => setTimeout(r, delay));
    const body = name === 'hotlink.png' ? FIXTURES['wide.png'] : FIXTURES[name];
    if (!body) { res.writeHead(404); res.end(); return; }
    // "noext" is served without a useful type, like many CDNs do.
    res.writeHead(200, { 'content-type': TYPE_OVERRIDES[name] || TYPES[name.split('.').pop()] || 'application/octet-stream', 'cache-control': 'no-store', 'content-length': body.length });
    res.end(req.method === 'HEAD' ? undefined : body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/`;

  ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'itk-')), {
    channel: 'chromium',
    headless: true,
    acceptDownloads: true,
    // itk-other.test is the same local server under another origin (cross-origin iframes).
    args: ['--screen-info={1600x1200}', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--host-resolver-rules=MAP itk-other.test 127.0.0.1'],
  });
  sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  id = new URL(sw.url()).host;
  ui = await ctx.newPage();
  await ui.goto(`chrome-extension://${id}/popup.html`);
});

after(async () => {
  await ctx?.close();
  server?.close();
});

test('"Original" keeps the exact bytes and detects the real type', async () => {
  for (const [name, type] of [['anim.gif', 'gif'], ['logo.svg', 'svg'], ['photo.png', 'png'], ['noext', 'png']]) {
    const r = await send({ action: 'processAndReturnData', imageUrl: base + name, instructions: { passthrough: true } });
    assert.equal(r.format, type, name);
    assert.ok(Buffer.from(r.dataUrl.split(',')[1], 'base64').equals(FIXTURES[name]), `${name} bytes differ`);
  }
});

test('"Original" trusts content over a wrong MIME type, but never saves HTML as an image', async () => {
  const svg = await send({ action: 'processAndReturnData', imageUrl: base + 'plain.svg', instructions: { passthrough: true } });
  assert.equal(svg.format, 'svg');
  assert.ok(Buffer.from(svg.dataUrl.split(',')[1], 'base64').equals(FIXTURES['plain.svg']));
  const html = await send({ action: 'processAndReturnData', imageUrl: base + 'fake.jpg', instructions: { passthrough: true } });
  assert.match(html.error, /Unsupported image type/);
});

test('AVIF falls back to WebP and reports it', async () => {
  const r = await send({ action: 'processAndReturnData', imageUrl: base + 'photo.png', instructions: { format: 'avif', quality: 0.8 } });
  assert.ok(['avif', 'webp'].includes(r.format));
  assert.ok(r.dataUrl.startsWith(`data:image/${r.format};`));
});

test('saved files are named after the produced format', async () => {
  const avif = await send({ action: 'processAndSave', imageUrl: base + 'photo.png', instructions: { format: 'avif', saveAs: false, silent: true } });
  assert.match(avif.filename, /^photo\.(avif|webp)$/);
  assert.equal(avif.filename.split('.').pop(), avif.format);
  const svg = await send({ action: 'processAndSave', imageUrl: base + 'logo.svg', instructions: { passthrough: true, saveAs: false, silent: true } });
  assert.equal(svg.filename, 'logo.svg');
  assert.equal(svg.dataUrl, undefined, 'save responses should not carry the image back');
});

test('the format advisor downloads the image once and reports every format', async () => {
  hits.delete('wide.png');
  const r = await send({ action: 'analyzeFormats', imageUrl: base + 'wide.png' });
  assert.deepEqual(r.results.map((x) => x.format), ['png', 'jpeg', 'webp']);
  assert.ok(r.results.every((x) => x.size > 0));
  assert.equal(r.originalSize, FIXTURES['wide.png'].length);
  assert.equal(r.hasAlpha, false);
  assert.equal(hits.get('wide.png'), 1);
});

test('fit mode letterboxes with transparency', async () => {
  const r = await send({ action: 'processAndReturnData', imageUrl: base + 'wide.png', instructions: { format: 'png', cropWidth: 20, cropHeight: 20, fitMode: true } });
  assert.equal(r.width, 20);
  const alpha = await ui.evaluate(async (src) => {
    const img = new Image(); img.src = src; await img.decode();
    const c = document.createElement('canvas'); c.width = 20; c.height = 20;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    return [x.getImageData(10, 0, 1, 1).data[3], x.getImageData(10, 10, 1, 1).data[3]];
  }, r.dataUrl);
  assert.deepEqual(alpha, [0, 255]);
});

test('oversized outputs are rejected with a clear error', async () => {
  const r = await send({ action: 'processAndReturnData', imageUrl: base + 'photo.png', instructions: { format: 'png', width: 16000, height: 16000 } });
  assert.match(r.error, /too large/i);
});

test('unsupported URL schemes are refused', async () => {
  for (const imageUrl of ['file:///etc/hostname', `blob:chrome-extension://${id}/x`, 'javascript:alert(1)//x.png', 'chrome://version']) {
    const r = await send({ action: 'fetchAsDataUrl', imageUrl });
    assert.match(r.error, /Unsupported/, imageUrl);
  }
});

test('scanner collects images, skips unsafe schemes and survives re-injection', async () => {
  const page = await ctx.newPage();
  await page.goto(base + 'page.html');
  await page.bringToFront();
  const tabId = await sw.evaluate(async (url) => (await chrome.tabs.query({ url })).at(0).id, base + 'page.html');
  const first = await send({ action: 'collectImages', tabId });
  const srcs = first.images.map((i) => i.src);
  for (const name of ['anim.gif', 'logo.svg', 'photo.png', 'wide.png']) assert.ok(srcs.includes(base + name), name);
  assert.ok(!srcs.some((s) => s.startsWith('javascript:')));
  // Injecting again must not throw or duplicate listeners.
  await sw.evaluate((tabId) => chrome.scripting.executeScript({ target: { tabId }, files: ['lib/core.js', 'content.js'] }), tabId);
  const second = await send({ action: 'collectImages', tabId });
  assert.equal(second.images.length, first.images.length);
  await page.close();
});

test('content scripts cannot use privileged actions', async () => {
  const page = await ctx.newPage();
  await page.goto(base + 'page.html');
  const result = await sw.evaluate(async ({ url, target }) => {
    const [tab] = await chrome.tabs.query({ url });
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (u) => new Promise((resolve) => chrome.runtime.sendMessage({ action: 'fetchAsDataUrl', imageUrl: u }, (r) => resolve(r ?? null))),
      args: [target],
    });
    return injection.result;
  }, { url: base + 'page.html', target: base + 'photo.png' });
  assert.equal(result, null);
  await page.close();
});

test('pages that cannot be scripted report "restricted"', async () => {
  const tabId = await ui.evaluate(async () => (await chrome.tabs.getCurrent()).id);
  assert.equal((await send({ action: 'collectImages', tabId })).error, 'restricted');
  assert.equal((await send({ action: 'startCapture', tabId })).error, 'restricted');
});

test('saving a setting keeps unrelated keys', async () => {
  await ui.evaluate(() => chrome.storage.sync.get('settings').then(({ settings }) => chrome.storage.sync.set({ settings: { ...settings, savedAtLeastW: 500, savedAtLeastH: 300 } })));
  await ui.reload();
  await ui.waitForSelector('#setting-quality', { state: 'attached' });
  await ui.evaluate(() => { const q = document.getElementById('setting-quality'); q.value = '70'; q.dispatchEvent(new Event('change')); });
  const settings = await waitFor(() => ui.evaluate(() => chrome.storage.sync.get('settings').then((r) => (r.settings.defaultQuality === 70 ? r.settings : null))));
  assert.equal(settings.savedAtLeastW, 500);
  assert.equal(settings.savedAtLeastH, 300);
});

test('editor opens from a handoff, crops and saves', async () => {
  await sw.evaluate((url) => openEditor(url), base + 'wide.png');
  const editor = await waitFor(() => ctx.pages().find((p) => p.url().includes('resize.html')));
  await editor.waitForSelector('.cropper-container', { timeout: 10000 });
  const info = await waitFor(() => editor.textContent('#info-text'));
  assert.match(info, /40 × 20/);
  // Playwright renames intercepted downloads, so count PNG downloads instead of matching names.
  const countPng = () => sw.evaluate(() => chrome.downloads.search({ mime: 'image/png' }).then((d) => d.length));
  const before = await countPng();
  const toastText = await editor.evaluate(async () => {
    document.querySelector('#resize-format [data-value="png"]').click();
    await save();
    return document.getElementById('toasts').textContent;
  });
  assert.match(toastText, /PNG/);
  await waitFor(async () => (await countPng()) > before);
  await editor.close();
});

test('the panel copies images straight to the clipboard', async () => {
  // Chromium only grants clipboard-read to web origins, so read it back from a page.
  const reader = await ctx.newPage();
  await reader.goto(base + 'page.html');
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base.slice(0, -1) });
  await ui.bringToFront();
  await ui.evaluate((src) => copyImage(src), base + 'photo.png');
  assert.match(await ui.textContent('#toasts'), /./);
  await reader.bringToFront();
  const types = await reader.evaluate(async () => (await navigator.clipboard.read()).flatMap((item) => item.types));
  assert.ok(types.includes('image/png'), `clipboard has ${types}`);
  await reader.close();
});

test('context-menu copy writes the image from the focused page', async () => {
  const page = await ctx.newPage();
  await page.goto(base + 'page.html');
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base.slice(0, -1) });
  await page.bringToFront();
  await page.evaluate(() => navigator.clipboard.writeText('placeholder'));
  const result = await sw.evaluate(async ({ url, image }) => {
    const [tab] = await chrome.tabs.query({ url });
    return copyImageUrl(image, tab.id, { showNotification: false });
  }, { url: base + 'page.html', image: base + 'photo.png' });
  assert.deepEqual(result, { success: true });
  const types = await page.evaluate(async () => (await navigator.clipboard.read()).flatMap((item) => item.types));
  assert.ok(types.includes('image/png'), `clipboard has ${types}`);
  await page.close();
});

test('area capture crops the selection and opens the editor', async () => {
  const page = await screenPage('page.html');
  await page.bringToFront();
  const tabId = await sw.evaluate(async (url) => (await chrome.tabs.query({ url })).at(0).id, base + 'page.html');
  assert.deepEqual(await send({ action: 'startCapture', tabId }), { success: true });
  await page.waitForSelector('#imagetoolkit-capture-overlay');
  await page.bringToFront();
  await page.mouse.move(100, 100);
  await page.mouse.down();
  await page.mouse.move(300, 250, { steps: 5 });
  await page.mouse.up();
  const editor = await waitFor(() => ctx.pages().find((p) => p.url().includes('resize.html') && p !== page), 10000);
  await editor.waitForSelector('.cropper-container', { timeout: 10000 });
  const info = await waitFor(() => editor.textContent('#info-text'));
  const dpr = await page.evaluate(() => devicePixelRatio);
  assert.equal(info, `${200 * dpr} × ${150 * dpr} px`);
  assert.equal(await page.$('#imagetoolkit-capture-overlay'), null);
  await editor.close();
  await page.close();
});

test('batch download from the panel saves every image without dialogs', async () => {
  await ui.bringToFront();
  await ui.evaluate(() => document.querySelector('.tab[data-tab="images"]').click());
  const countDownloads = () => sw.evaluate(() => chrome.downloads.search({}).then((d) => d.length));
  const before = await countDownloads();
  await ui.evaluate((b) => {
    setImages(['photo.png', 'wide.png', 'anim.gif'].map((n) => ({ src: b + n, width: 0, height: 0 })));
    toggleSelectAll();
    document.getElementById('action-format').value = 'png';
  }, base);
  assert.equal(await ui.textContent('#action-bar-count'), '3');
  await ui.click('#action-download');
  await waitFor(async () => /3/.test(await ui.textContent('#progress-text')) && !(await ui.isDisabled('#action-download')), 15000);
  assert.match(await ui.textContent('#progress-text'), /3\D+3/);
  await waitFor(async () => (await countDownloads()) >= before + 3);
});


// ---------- Regression tests for the second audit ----------

async function freshPanel() {
  await ui.bringToFront();
  await ui.reload();
  await ui.waitForSelector('#image-grid', { state: 'attached' });
}

test('preview actions follow the image, not its position, when the grid re-sorts', async () => {
  await freshPanel();
  await ui.evaluate((b) => setImages([
    { src: b + 'photo.png', width: 30, height: 20 },
    { src: b + 'wide.png', width: 40, height: 20 },
  ]), base);
  await ui.evaluate((b) => openPreview(b + 'wide.png'), base);
  // A late probe makes photo.png the largest image: the pixel sort puts it first.
  await ui.evaluate((b) => { const img = state.images.find((i) => i.src === b + 'photo.png'); img.width = 3000; img.height = 2000; updateDerived(img); applyFilters(); }, base);
  assert.equal(await ui.evaluate(() => state.filtered[0].src.split('/').pop()), 'photo.png');
  assert.equal(await ui.evaluate(() => currentPreview().src.split('/').pop()), 'wide.png');
  assert.match(await ui.textContent('#preview-meta'), /2\/2/);
  await ui.evaluate(() => closePreview());
});

test('the preview dialog keeps focus inside and makes the background inert', async () => {
  await freshPanel();
  await ui.evaluate((b) => setImages([{ src: b + 'photo.png', width: 30, height: 20 }]), base);
  await ui.evaluate((b) => openPreview(b + 'photo.png'), base);
  assert.equal(await ui.evaluate(() => document.querySelector('.views').hasAttribute('inert')), true);
  for (let i = 0; i < 12; i++) await ui.keyboard.press('Tab');
  assert.equal(await ui.evaluate(() => document.getElementById('preview-modal').contains(document.activeElement)), true);
  await ui.keyboard.press('Escape');
  assert.equal(await ui.evaluate(() => document.querySelector('.views').hasAttribute('inert')), false);
});

test('tabs follow the WAI-ARIA pattern (roving tabindex, arrow keys)', async () => {
  await freshPanel();
  await ui.focus('#tab-btn-images');
  await ui.keyboard.press('ArrowRight');
  assert.equal(await ui.evaluate(() => document.activeElement.id), 'tab-btn-tools');
  assert.equal(await ui.getAttribute('#tab-btn-tools', 'aria-selected'), 'true');
  assert.deepEqual(await ui.evaluate(() => [...document.querySelectorAll('.tab')].map((t) => t.tabIndex)), [-1, 0, -1]);
  await ui.keyboard.press('End');
  assert.equal(await ui.evaluate(() => document.activeElement.id), 'tab-btn-settings');
  await ui.keyboard.press('Home');
  assert.equal(await ui.evaluate(() => document.activeElement.id), 'tab-btn-images');
});

test('quick successive setting changes are all kept', async () => {
  await freshPanel();
  await ui.evaluate(() => Promise.all([saveSettings({ defaultQuality: 61 }), saveSettings({ theme: 'dark' }), saveSettings({ zipDefault: true })]));
  const stored = await ui.evaluate(() => chrome.storage.sync.get('settings').then((r) => r.settings));
  assert.equal(stored.defaultQuality, 61);
  assert.equal(stored.theme, 'dark');
  assert.equal(stored.zipDefault, true);
  await ui.evaluate(() => saveSettings({ theme: 'auto', zipDefault: false }));
});

test('a slow earlier source in Tools never overwrites the newer one', async () => {
  await freshPanel();
  await ui.evaluate((b) => { setToolSource(b + 'photo.png?delay=900', 'slow'); return setToolSource(b + 'wide.png', 'fast'); }, base);
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(await ui.textContent('#tool-preview-name'), 'fast');
  assert.equal(await ui.inputValue('#resize-url-w'), '40');
  assert.equal(await ui.evaluate(() => state.tool.src.split('/').pop()), 'wide.png');
});

test('local files over the size limit are refused before being read', async () => {
  await freshPanel();
  await ui.evaluate(() => loadToolFile(new File([new Uint8Array(ITK.MAX_IMAGE_BYTES + 1)], 'big.png', { type: 'image/png' })));
  assert.match(await ui.textContent('#toasts'), /40/);
  assert.equal(await ui.isHidden('#tool-preview'), true);
});

test('the format advisor in one window does not cancel another window', async () => {
  const other = await ctx.newPage();
  await other.goto(`chrome-extension://${id}/popup.html`);
  const [a, b] = await Promise.all([
    ui.evaluate((u) => chrome.runtime.sendMessage({ action: 'analyzeFormats', imageUrl: u }), base + 'photo.png?delay=300'),
    other.evaluate((u) => chrome.runtime.sendMessage({ action: 'analyzeFormats', imageUrl: u }), base + 'wide.png'),
  ]);
  assert.ok(a.results?.length === 3 && !a.superseded, JSON.stringify(a));
  assert.ok(b.results?.length === 3 && !b.superseded, JSON.stringify(b));
  await other.close();
});

test('hotlink-protected images still get their dimensions', async () => {
  await freshPanel();
  await ui.evaluate((b) => setImages([{ src: b + 'hotlink.png', width: 0, height: 0 }]), base);
  const dims = await waitFor(() => ui.evaluate(() => (state.images[0].width ? [state.images[0].width, state.images[0].height] : null)), 10000);
  assert.deepEqual(dims, [40, 20]);
});

test('a download without Content-Length stops at the size cap', async () => {
  const r = await send({ action: 'fetchAsDataUrl', imageUrl: base + 'huge' });
  assert.match(r.error, /too large/i);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.ok(hugeBytesSent < 80 * 1024 * 1024, `server pushed ${hugeBytesSent} bytes`);
});

test('closing Save As for a ZIP ends quietly instead of reporting success', async () => {
  await freshPanel();
  await ui.evaluate((b) => {
    // Simulate the user closing the Save As dialog.
    const original = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (message, callback) => (message?.action === 'downloadBlob' ? callback({ cancelled: true }) : original(message, callback));
    setImages([{ src: b + 'photo.png', width: 30, height: 20 }]);
    toggleSelectAll();
  }, base);
  await ui.evaluate(() => batchDownload(true));
  assert.equal(await ui.textContent('#toasts'), '');
  assert.equal(await ui.isHidden('#batch-progress'), true);
});

test('Shift-click ranges use the anchor image, not a stale position', async () => {
  await freshPanel();
  await ui.evaluate((b) => {
    setImages(['anim.gif', 'logo.svg', 'photo.png', 'wide.png', 'noext'].map((n, i) => ({ src: b + n, width: 10 * (5 - i), height: 10 })));
    state.sort = 'position';
    applyFilters();
    const byName = (n) => state.images.find((i) => i.src === b + n);
    selectFromClick(byName('noext'), false);          // anchor at the end
    document.getElementById('filter-type').value = 'png';
    applyFilters();                                  // only photo.png and wide.png remain (noext is 'other')
    state.selected.clear();
    selectFromClick(byName('wide.png'), true);       // anchor is gone: acts as a plain click
  }, base);
  assert.deepEqual(await ui.evaluate(() => [...state.selected].map((s) => s.split('/').pop())), ['wide.png']);
});

test('editor: "Custom" after a fixed preset lets the output follow the crop again', async () => {
  await sw.evaluate((url) => openEditor(url), base + 'wide.png');
  const editor = await waitFor(() => ctx.pages().find((p) => p.url().includes('resize.html')));
  await editor.waitForSelector('.cropper-container', { timeout: 10000 });
  await editor.click('[data-preset="1080x1080"]');
  assert.equal(await editor.inputValue('#out-w'), '1080');
  await editor.click('[data-preset="custom"]');
  await editor.evaluate(() => editor.cropper.setData({ x: 0, y: 0, width: 32, height: 18 }));
  const out = [await editor.inputValue('#out-w'), await editor.inputValue('#out-h')].map(Number);
  assert.ok(Math.abs(out[0] / out[1] - 32 / 18) < 0.1, `output ${out} does not follow crop 32×18`);
  await editor.close();
});

test('inline SVG icons keep the colours the page paints them with', async () => {
  const page = await ctx.newPage();
  await page.goto(base + 'icons.html');
  const tabId = await sw.evaluate(async (url) => (await chrome.tabs.query({ url })).at(0).id, base + 'icons.html');
  const { images } = await send({ action: 'collectImages', tabId });
  const svgs = images.filter((i) => i.src.startsWith('data:image/svg+xml'))
    .map((i) => Buffer.from(i.src.split(',')[1], 'base64').toString('utf8'));
  assert.equal(svgs.length, 3);
  assert.ok(svgs.some((m) => /color:\s*rgb\(255, 0, 0\)/.test(m)), 'currentColor icon lost its colour');
  assert.ok(svgs.some((m) => m.includes('fill="rgb(0, 255, 0)"')), 'CSS fill was not kept');
  await page.close();
});

test('the "new images" banner counts only images the panel has not seen', async () => {
  const page = await ctx.newPage();
  await page.goto(base + 'page.html');
  const tabId = await sw.evaluate(async (url) => (await chrome.tabs.query({ url })).at(0).id, base + 'page.html');
  await ui.evaluate(() => {
    window.__newImages = 0;
    chrome.runtime.onMessage.addListener((m) => { if (m.action === 'newImagesAvailable') window.__newImages += m.count; });
  });
  await send({ action: 'collectImages', tabId });
  await page.evaluate((base) => {
    // Re-renders of known images, then one image the panel has never seen (twice).
    document.body.append(document.querySelector('img').cloneNode(true));
    document.querySelector('img[src="photo.png"]').setAttribute('src', 'photo.png');
    for (let i = 0; i < 2; i++) { const img = new Image(); img.src = base + 'noext'; document.body.append(img); }
  }, base);
  await waitFor(() => ui.evaluate(() => window.__newImages > 0));
  await new Promise((r) => setTimeout(r, 1200));
  assert.equal(await ui.evaluate(() => window.__newImages), 1);
  await page.close();
});

test('editor: crop and output sizes use the same rounding', async () => {
  await sw.evaluate((url) => openEditor(url), base + 'wide.png');
  const editor = await waitFor(() => ctx.pages().find((p) => p.url().includes('resize.html')));
  await editor.waitForSelector('.cropper-container', { timeout: 10000 });
  const [data, shown] = await editor.evaluate(async () => {
    editor.cropper.setData({ x: 0.6, y: 0.4, width: 20.8, height: 10.3 });
    await new Promise((r) => setTimeout(r, 50));
    const d = editor.cropper.getData(true);
    const v = (id) => Number(document.getElementById(id).value);
    return [[d.width, d.height], [v('crop-w'), v('crop-h'), v('out-w'), v('out-h')]];
  });
  assert.deepEqual(shown, [...data, ...data]);
  await editor.close();
});

// ---------- Release hardening ----------
const countDownloadsAll = () => sw.evaluate(() => chrome.downloads.search({}).then((d) => d.length));
const tabIdOf = (url) => sw.evaluate(async (u) => (await chrome.tabs.query({ url: u })).at(0).id, url);
// A screenshot shows what the window really displays: it must be at least as large as the
// emulated viewport, or the bottom of each screen is never visible.
async function screenPage(name, width = 800, height = 600) {
  const page = await ctx.newPage();
  await page.goto(base + name);
  const shown = await sw.evaluate(async (u) => {
    const tab = (await chrome.tabs.query({ url: u })).at(0);
    const win = await chrome.windows.update(tab.windowId, { left: 0, top: 0, width: 1200, height: 1000, state: 'normal' }).catch((e) => e.message);
    return win;
  }, base + name);
  if (typeof shown === 'string') throw new Error(shown);
  await page.setViewportSize({ width, height });
  return page;
}

test('scan payload is bounded: an oversized inline image is skipped and the total stays in budget', async () => {
  const page = await ctx.newPage();
  await page.goto(base + 'heavy.html');
  const { images, truncated } = await send({ action: 'collectImages', tabId: await tabIdOf(base + 'heavy.html') });
  const inline = images.filter((i) => i.src.startsWith('data:'));
  const limits = await ui.evaluate(() => ({ item: ITK.SCAN_MAX_ITEM_CHARS, total: ITK.SCAN_MAX_TOTAL_CHARS }));
  assert.equal(truncated, true);
  assert.ok(!inline.some((i) => i.alt === 'h0'), 'the 9 MiB image is larger than one scan item');
  assert.ok(inline.every((i) => i.src.length <= limits.item));
  assert.ok(inline.reduce((n, i) => n + i.src.length, 0) <= limits.total);
  assert.ok(inline.length >= 3 && inline.length < 5, `kept ${inline.length} of the 6 MiB images`);
  await page.close();
});

test('size probing has one byte budget for all images of a request', async () => {
  traffic.nolenBytes = 0; traffic.nolenGets = 0;
  const urls = Array.from({ length: 60 }, (_, i) => `${base}nolen/${i}.png`);
  const sizes = await send({ action: 'probeImageSizes', urls });
  // Without the budget every body would be read: 60 GETs, 60 MiB.
  assert.ok(traffic.nolenBytes < 20 * MiB, `read ${(traffic.nolenBytes / MiB).toFixed(1)} MiB`);
  assert.ok(traffic.nolenGets < 30, `${traffic.nolenGets} body downloads`);
  assert.ok(Object.values(sizes).every((v) => v === MiB), 'sizes that were measured are right');
});

test('hotlink fallback for previews and dimensions has a per-scan budget, reset by a new scan', async () => {
  // The panel's own first scan must be over, or it would reset the budget mid-test.
  await waitFor(() => ui.evaluate(() => document.getElementById('grid-loading').hidden));
  traffic.hotBytes = 0; traffic.hotGets = 0;
  await ui.evaluate((b) => {
    resetViaExtension();
    // Known file sizes: no size probes, so every whole-body GET is a preview/dimension fallback.
    setImages(Array.from({ length: 80 }, (_, i) => ({ src: `${b}hot/${i}.png`, width: 0, height: 0, fileSize: 1 })));
  }, base);
  const limits = await ui.evaluate(() => ({ ...LIMITS }));
  // Settled = the budget is spent, or nothing new for 2 s.
  let last = -1, since = Date.now();
  await waitFor(async () => {
    if (traffic.hotGets !== last) { last = traffic.hotGets; since = Date.now(); }
    return traffic.hotGets >= limits.fallbackFetches || (last > 0 && Date.now() - since > 2000);
  }, 30000);
  await new Promise((r) => setTimeout(r, 1500)); // anything over budget would arrive now
  assert.ok(traffic.hotGets <= limits.fallbackFetches, `${traffic.hotGets} fallback downloads`);
  assert.ok(traffic.hotBytes <= limits.fallbackBytes, `${(traffic.hotBytes / MiB).toFixed(1)} MiB`);
  assert.equal(await ui.evaluate(() => viaExtensionBudget.fetches <= 0 || viaExtensionBudget.bytes <= 0), true);
  await ui.evaluate(() => { resetViaExtension(); setImages([]); });
  assert.equal(await ui.evaluate(() => viaExtension.size), 0);
});

test('the preview byte budget is reserved up front: concurrent downloads never exceed it', async () => {
  await waitFor(() => ui.evaluate(() => document.getElementById('grid-loading').hidden));
  traffic.hotBytes = 0; traffic.hotGets = 0;
  // 3 MiB in total, 1 MiB per download, 1 MiB images and 4 downloads in parallel: without a
  // reservation, four start against the same untouched 3 MiB.
  await ui.evaluate((b) => {
    Object.assign(LIMITS, { fallbackBytes: 3 * 1024 * 1024, fallbackItemBytes: 1024 * 1024 });
    resetViaExtension();
    setImages(Array.from({ length: 12 }, (_, i) => ({ src: `${b}hot/r${i}.png`, width: 0, height: 0, fileSize: 1 })));
  }, base);
  let last = -1, since = Date.now();
  await waitFor(async () => {
    if (traffic.hotGets !== last) { last = traffic.hotGets; since = Date.now(); }
    return last > 0 && Date.now() - since > 2000;
  }, 30000);
  assert.ok(traffic.hotBytes <= 3 * MiB, `${(traffic.hotBytes / MiB).toFixed(1)} MiB downloaded`);
  assert.equal(traffic.hotGets, 3);
  await ui.evaluate(() => {
    Object.assign(LIMITS, { fallbackBytes: 48 * 1024 * 1024, fallbackItemBytes: 8 * 1024 * 1024 });
    resetViaExtension();
    setImages([]);
  });
});

test('ZIP refuses an oversized selection before and during the batch, with no download', async () => {
  const before = await countDownloadsAll();
  await ui.evaluate((b) => {
    LIMITS.zipBytes = 50; // smaller than the first file
    document.getElementById('toasts').replaceChildren();
    switchTab('images');
    setImages(['photo.png', 'wide.png', 'anim.gif'].map((n) => ({ src: b + n, width: 10, height: 10, fileSize: 0 })));
    state.images.forEach((i) => state.selected.add(i.src));
  }, base);
  await ui.evaluate(() => batchDownload(true));
  assert.match(await ui.textContent('#toasts'), /ZIP/);
  // Known sizes already over the limit: refused without processing anything. Grid thumbnails
  // of the same URLs may still be loading, so only the extension's own fetches count.
  const processed = fetchHits.get('photo.png') || 0;
  await ui.evaluate(() => { document.getElementById('toasts').replaceChildren(); state.images.forEach((i) => { i.fileSize = 1000; }); return batchDownload(true); });
  assert.match(await ui.textContent('#toasts'), /ZIP/);
  assert.equal(fetchHits.get('photo.png') || 0, processed);
  assert.equal(await countDownloadsAll(), before);
  await ui.evaluate(() => { LIMITS.zipBytes = 256 * 1024 * 1024; state.selected.clear(); setImages([]); });
});

test('large outputs skip the base64 message and still download completely', async () => {
  const result = await ui.evaluate(async () => {
    const small = await ITK.ui.saveBlob(new Blob([new Uint8Array(1024)], { type: 'application/zip' }), 'small-test.zip', false);
    const big = await ITK.ui.saveBlob(new Blob([new Uint8Array(37 * 1024 * 1024)], { type: 'application/zip' }), 'big-test.zip', false);
    return { small: small.via, big: big.via, id: big.downloadId };
  });
  assert.deepEqual([result.small, result.big], ['data', 'blob']);
  const item = await waitFor(() => sw.evaluate(async (id) => {
    const [d] = await chrome.downloads.search({ id });
    return d && d.state !== 'in_progress' ? d : null;
  }, result.id), 20000);
  assert.equal(item.state, 'complete');
  assert.equal(item.fileSize, 37 * MiB);
});

test('a 24 px icon with a 960-unit viewBox is 24×24, not 960×960, and is not "large"', async () => {
  const page = await ctx.newPage();
  await page.goto(base + 'icons.html');
  const { images } = await send({ action: 'collectImages', tabId: await tabIdOf(base + 'icons.html') });
  const svgs = images.filter((i) => i.src.startsWith('data:image/svg+xml'));
  assert.equal(svgs.length, 3, 'three visible icons; the hidden sprite sheet is not an image');
  assert.ok(svgs.every((i) => i.width === 24 && i.height === 24), JSON.stringify(svgs.map((i) => [i.width, i.height])));
  const material = svgs.find((i) => Buffer.from(i.src.split(',')[1], 'base64').toString().includes('-960'));
  assert.match(Buffer.from(material.src.split(',')[1], 'base64').toString(), /width="24" height="24"/);
  const inLarge = await ui.evaluate((list) => {
    setImages(list);
    document.getElementById('filter-size').value = 'large';
    applyFilters();
    const n = state.filtered.length;
    document.getElementById('filter-size').value = 'all';
    applyFilters();
    setImages([]);
    return n;
  }, svgs);
  assert.equal(inLarge, 0);
  await page.close();
});

test('sizes over the limit are refused at the privileged boundary, with zero downloads', async () => {
  const before = await countDownloadsAll();
  const saved = await send({ action: 'processAndSave', imageUrl: base + 'photo.png', instructions: { format: 'png', width: 20000, saveAs: false, silent: true } });
  assert.match(saved.error || '', /too large/);
  const cropped = await send({ action: 'processAndReturnData', imageUrl: base + 'photo.png', instructions: { format: 'png', cropWidth: 20000, cropHeight: 500 } });
  assert.match(cropped.error || '', /too large/);
  assert.equal(await countDownloadsAll(), before);
});

test('editor: a manual output size follows the crop shape and the canvas matches the fields', async () => {
  await sw.evaluate((url) => openEditor(url), base + 'wide.png');
  const editor = await waitFor(() => ctx.pages().find((p) => p.url().includes('resize.html')));
  await editor.waitForSelector('.cropper-container', { timeout: 10000 });
  const run = (steps) => editor.evaluate(async (steps) => {
    const out = [];
    for (const step of steps) {
      if (step.crop) editor.cropper.setData(step.crop);
      if (step.preset) document.querySelector(`[data-preset="${step.preset}"]`).click();
      if (step.unlock) document.getElementById('btn-lock').click();
      if (step.type) { const f = document.getElementById(step.type[0]); f.value = String(step.type[1]); f.dispatchEvent(new Event('input')); }
      await new Promise((r) => setTimeout(r, 30));
    }
    const shown = [+document.getElementById('out-w').value, +document.getElementById('out-h').value];
    const canvas = croppedCanvas('png');
    out.push(shown, [canvas.width, canvas.height]);
    return out;
  }, steps);
  // Typed width, then a square crop: the height follows, and the file is exactly that size.
  let [shown, canvas] = await run([{ crop: { x: 0, y: 0, width: 32, height: 18 } }, { type: ['out-w', 16] }, { crop: { x: 0, y: 0, width: 20, height: 20 } }]);
  assert.deepEqual(shown, [16, 16]);
  assert.deepEqual(canvas, shown);
  // Typed height keeps the height.
  [shown, canvas] = await run([{ type: ['out-h', 10] }, { crop: { x: 0, y: 0, width: 40, height: 20 } }]);
  assert.deepEqual(shown, [20, 10]);
  assert.deepEqual(canvas, shown);
  // Fixed preset, then unlock and reshape the crop: width kept, height follows, no stretch.
  [shown, canvas] = await run([{ preset: '1080x1080' }, { unlock: true }, { crop: { x: 0, y: 0, width: 40, height: 20 } }]);
  assert.deepEqual(shown, [1080, 540]);
  assert.deepEqual(canvas, shown);
  await editor.close();
});

test('area capture: a crop failure reports an error and never opens the whole screenshot', async () => {
  const page = await ctx.newPage();
  await page.goto(base + 'page.html');
  await page.bringToFront();
  const editors = () => ctx.pages().filter((p) => p.url().includes('resize.html')).length;
  const before = editors();
  for (const rect of [{ x: 1e6, y: 1e6, width: 50, height: 50 }, { x: 0, y: 0, width: NaN, height: 10 }]) {
    const result = await sw.evaluate(async ({ url, rect }) => {
      const [tab] = await chrome.tabs.query({ url });
      const [injection] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (r) => new Promise((resolve) => chrome.runtime.sendMessage({ action: 'captureSelection', rect: r }, resolve)),
        args: [rect],
      });
      return injection.result;
    }, { url: base + 'page.html', rect });
    assert.ok(result?.error, JSON.stringify(result));
  }
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(editors(), before);
  await page.close();
});

test('upgrade: the 2.3.5 editor hand-off key is removed, idempotently', async () => {
  const left = await sw.evaluate(async () => {
    await chrome.storage.local.set({ _resizeImageUrl: 'data:image/png;base64,AAAA', keep: 1 });
    await cleanupLegacyStorage();
    await cleanupLegacyStorage();
    const r = await chrome.storage.local.get(null);
    await chrome.storage.local.remove('keep');
    return r;
  });
  assert.equal(left._resizeImageUrl, undefined);
  assert.equal(left.keep, 1);
});

test('advisor: a new source hides the previous figures at once and the old answer never shows', async () => {
  await ui.evaluate(() => switchTab('tools'));
  await ui.evaluate((u) => setToolSource(u, 'a.png'), base + 'photo.png?delay=600');
  await waitFor(() => ui.evaluate(() => !document.getElementById('format-advisor').hidden));
  // B loads slowly, so its own analysis starts late; A must already be gone.
  ui.evaluate((u) => setToolSource(u, 'b.png'), base + 'wide.png?delay=1500');
  await new Promise((r) => setTimeout(r, 50));
  const midway = await ui.evaluate(() => ({ hidden: document.getElementById('format-advisor').hidden, bars: document.getElementById('advisor-sizes').children.length }));
  assert.deepEqual(midway, { hidden: true, bars: 0 });
  await new Promise((r) => setTimeout(r, 900)); // A's analysis would have finished by now
  assert.equal(await ui.evaluate(() => document.getElementById('advisor-sizes').children.length), 0);
  await waitFor(() => ui.evaluate(() => document.getElementById('advisor-sizes').children.length > 0), 15000);
  await ui.evaluate(() => clearToolSource());
});

test('radio groups: named, one Tab stop, arrows change the option', async () => {
  await ui.evaluate(() => switchTab('tools'));
  const info = await ui.evaluate(async () => {
    const group = document.getElementById('convert-format');
    const label = document.getElementById(group.getAttribute('aria-labelledby'))?.textContent.trim();
    const stops = () => [...group.querySelectorAll('[role="radio"]')].filter((r) => r.tabIndex === 0).map((r) => r.dataset.value);
    const before = stops();
    group.querySelector('[tabindex="0"]').focus();
    return { label, before };
  });
  assert.ok(info.label);
  assert.equal(info.before.length, 1);
  await ui.keyboard.press('ArrowRight');
  const after = await ui.evaluate(() => {
    const group = document.getElementById('convert-format');
    const checked = [...group.querySelectorAll('[aria-checked="true"]')].map((r) => r.dataset.value);
    return { checked, focused: document.activeElement.dataset.value, stops: [...group.querySelectorAll('[tabindex="0"]')].length };
  });
  assert.equal(after.checked.length, 1);
  assert.equal(after.focused, after.checked[0]);
  assert.notEqual(after.checked[0], info.before[0]);
  assert.equal(after.stops, 1);
});

test('the image grid is one Tab stop with arrow-key navigation inside it', async () => {
  await ui.evaluate((b) => { switchTab('images'); setImages(Array.from({ length: 60 }, (_, i) => ({ src: `${b}photo.png?n=${i}`, width: 30, height: 20 }))); }, base);
  const stops = await ui.evaluate(() => [...document.querySelectorAll('#image-grid [tabindex]')].filter((n) => n.tabIndex >= 0).length);
  assert.equal(stops, 1);
  await ui.evaluate(() => document.querySelector('#image-grid .gcard[tabindex="0"]').focus());
  await ui.keyboard.press('ArrowRight');
  const moved = await ui.evaluate(() => ({ idx: [...document.getElementById('image-grid').children].indexOf(document.activeElement), stops: document.querySelectorAll('#image-grid [tabindex="0"]').length }));
  assert.deepEqual(moved, { idx: 1, stops: 1 });
  await ui.keyboard.press('Tab');
  assert.equal(await ui.evaluate(() => document.getElementById('image-grid').contains(document.activeElement)), false);
  await ui.evaluate(() => setImages([]));
});

test('live observer: inline SVG, inline-style backgrounds and <picture> sources count as new', async () => {
  const page = await ctx.newPage();
  await page.goto(base + 'page.html');
  const tabId = await tabIdOf(base + 'page.html');
  await ui.evaluate(() => {
    window.__observed = 0;
    chrome.runtime.onMessage.addListener((m) => { if (m.action === 'newImagesAvailable') window.__observed += m.count; });
  });
  await send({ action: 'collectImages', tabId });
  await page.evaluate((b) => {
    document.body.insertAdjacentHTML('beforeend',
      '<svg width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill="teal"/></svg>'
      + `<div style="width:40px;height:40px;background-image:url(${b}hotlink.png)"></div>`
      + `<picture><source srcset="${b}noext"><img src="${b}photo.png"></picture>`);
  }, base);
  await waitFor(() => ui.evaluate(() => window.__observed > 0));
  await new Promise((r) => setTimeout(r, 1200));
  assert.equal(await ui.evaluate(() => window.__observed), 3);
  await page.close();
});

test('transparency in a small area of a large image is detected', async () => {
  const holey = await send({ action: 'analyzeFormats', imageUrl: base + 'holey.png' });
  assert.equal(holey.hasAlpha, true);
  const opaque = await send({ action: 'analyzeFormats', imageUrl: base + 'photo.png' });
  assert.equal(opaque.hasAlpha, false);
});

// ---------- Context menu: "Save as PNG/JPG/WebP/AVIF" ----------
// The native menu cannot be clicked headless, so the real onClicked listener is dispatched
// with the info Chrome would pass (srcUrl = the image's current URL). Save As is turned off
// because a file dialog cannot be answered headless.
let menuPage;
async function openMenuPage() {
  if (menuPage) return menuPage;
  FIXTURES['photo.jpg'] = Buffer.from((await ui.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 48; c.height = 32;
    const g = c.getContext('2d'); g.fillStyle = '#0080ff'; g.fillRect(0, 0, 48, 32);
    return c.toDataURL('image/jpeg', 0.9);
  })).split(',')[1], 'base64');
  await ctx.addCookies([{ name: 'itk', value: '1', url: base }]);
  menuPage = await ctx.newPage();
  await menuPage.goto(base + 'menu.html');
  await menuPage.waitForFunction(() => [...document.images].every((im) => im.complete && im.naturalWidth > 0));
  return menuPage;
}

const MAGIC = {
  jpeg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  png: (b) => b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
  webp: (b) => b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP',
};

async function saveFromMenu(imageId, fmt) {
  const page = await openMenuPage();
  const srcUrl = await page.evaluate((i) => document.getElementById(i).currentSrc, imageId);
  return sw.evaluate(async ({ srcUrl, fmt, pageUrl }) => {
    const { settings = {} } = await chrome.storage.sync.get('settings');
    await chrome.storage.sync.set({ settings: { ...settings, saveAs: false, showNotification: true } });
    const create = chrome.notifications.create;
    const notes = [];
    chrome.notifications.create = (...args) => { notes.push(args.find((a) => a && typeof a === 'object').message); };
    const known = new Set((await chrome.downloads.search({})).map((d) => d.id));
    try {
      const [tab] = await chrome.tabs.query({ url: pageUrl });
      chrome.contextMenus.onClicked.dispatch({ menuItemId: `save-as-${fmt}`, srcUrl, mediaType: 'image', pageUrl, frameId: 0 }, tab);
      for (let i = 0; i < 100; i++) {
        const d = (await chrome.downloads.search({})).find((x) => !known.has(x.id) && x.state !== 'in_progress');
        if (d) return { srcUrl, notes, download: { path: d.filename, state: d.state, error: d.error || null, mime: d.mime } };
        if (notes.length && !notes.some((n) => /→/.test(n))) return { srcUrl, notes, download: null };
        await new Promise((r) => setTimeout(r, 100));
      }
      return { srcUrl, notes, download: null };
    } finally {
      chrome.notifications.create = create;
      await chrome.storage.sync.set({ settings });
    }
  }, { srcUrl, fmt, pageUrl: base + 'menu.html' });
}

async function assertSaved(imageId, fmt, produced) {
  const r = await saveFromMenu(imageId, fmt);
  assert.ok(r.download, `${imageId} → ${fmt}: no download (${r.srcUrl.slice(0, 40)}): ${JSON.stringify(r.notes)}`);
  assert.equal(r.download.state, 'complete', JSON.stringify(r.download));
  const bytes = fs.readFileSync(r.download.path);
  assert.ok(MAGIC[produced](bytes), `${imageId} → ${fmt}: the file is not ${produced}`);
  assert.ok(!r.notes.some((n) => /fail/i.test(n)), JSON.stringify(r.notes));
}

test('context menu: HTTP PNG → JPG', () => assertSaved('png', 'jpg', 'jpeg'));
test('context menu: PNG → PNG', () => assertSaved('png', 'png', 'png'));
test('context menu: PNG → WebP', () => assertSaved('png', 'webp', 'webp'));
test('context menu: PNG → AVIF falls back to a real WebP file', () => assertSaved('png', 'avif', 'webp'));
test('context menu: JPEG → PNG', () => assertSaved('jpg', 'png', 'png'));
test('context menu: data:image/png → JPG', () => assertSaved('data', 'jpg', 'jpeg'));
test('context menu: an image that needs the site cookie → JPG', () => assertSaved('cookie', 'jpg', 'jpeg'));
test('context menu: URL without extension but an image MIME → JPG', () => assertSaved('typed', 'jpg', 'jpeg'));
test('context menu: PNG served as application/octet-stream → JPG', () => assertSaved('octet', 'jpg', 'jpeg'));
test('context menu: PNG served as text/plain → JPG', () => assertSaved('mislabel', 'jpg', 'jpeg'));

// Images a page builds with its own script have a blob: URL; the extension can read it.
test('context menu: a blob: image created by the page → JPG', async () => {
  const page = await openMenuPage();
  assert.match(await page.evaluate(() => document.getElementById('blob').currentSrc), /^blob:http:\/\//);
  await assertSaved('blob', 'jpg', 'jpeg');
});

test('blob: images also copy and open in the editor (same fetch path)', async () => {
  const page = await openMenuPage();
  const blobUrl = await page.evaluate(() => document.getElementById('blob').currentSrc);
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base.slice(0, -1) });
  await page.bringToFront();
  const copied = await sw.evaluate(async ({ url, image }) => {
    const [tab] = await chrome.tabs.query({ url });
    return copyImageUrl(image, tab.id, { showNotification: false });
  }, { url: base + 'menu.html', image: blobUrl });
  assert.deepEqual(copied, { success: true });
  const types = await page.evaluate(async () => (await navigator.clipboard.read()).flatMap((item) => item.types));
  assert.ok(types.includes('image/png'), `clipboard has ${types}`);
  // The editor loads its source through this message.
  const r = await send({ action: 'fetchAsDataUrl', imageUrl: blobUrl });
  assert.match(r.dataUrl || '', /^data:image\/png;base64,/, JSON.stringify(r).slice(0, 120));
  assert.equal(r.size, FIXTURES['wide.png'].length);
});

// Known limitation (same in 2.3.5): the extension's request carries no Referer, so a
// Referer-based hotlink rule refuses it. It must fail clearly and save nothing.
test('context menu: a Referer-protected image fails with a clear error and no file', async () => {
  const r = await saveFromMenu('referer', 'jpg');
  assert.equal(r.download, null);
  assert.ok(r.notes.some((n) => /HTTP 403/.test(n)), JSON.stringify(r.notes));
});

// ---------- 2.4.1 ----------

test('page outlines follow the panel: gone when it moves to another tab or closes', async () => {
  const page = await ctx.newPage();
  await page.goto(base + 'page.html');
  const tabId = await tabIdOf(base + 'page.html');
  const outlined = () => page.evaluate(() => document.querySelectorAll('[data-imagetoolkit-selected]').length);
  const styled = () => page.evaluate(() => !!document.getElementById('imagetoolkit-highlight-style'));

  const panel = await ctx.newPage();
  await panel.goto(`chrome-extension://${id}/popup.html`);
  await panel.waitForSelector('#image-grid', { state: 'attached' });
  const select = () => panel.evaluate(async ({ tabId, src }) => {
    state.tabId = tabId;
    await scan();
    state.selected.add(src);
    updateSelectionUI();
  }, { tabId, src: base + 'photo.png' });

  await select();
  await waitFor(async () => (await outlined()) === 1);
  // The panel follows another tab: the page it left is cleaned up.
  await panel.evaluate(() => { state.tabId = -1; updateSelectionUI(); });
  await waitFor(async () => (await outlined()) === 0 && !(await styled()));

  await select();
  await waitFor(async () => (await outlined()) === 1);
  await panel.close();
  await waitFor(async () => (await outlined()) === 0 && !(await styled()));
  await page.close();
});

test('closing the editor window forgets the handed-off image', async () => {
  const known = new Set(ctx.pages());
  await sw.evaluate((url) => openEditor(url), base + 'wide.png');
  const editor = await waitFor(() => ctx.pages().find((p) => !known.has(p) && p.url().includes('resize.html')));
  await editor.waitForSelector('.cropper-container', { timeout: 10000 });
  const key = new URL(editor.url()).searchParams.get('key');
  assert.equal(await sw.evaluate((k) => ITK.handoff.get(k), key), base + 'wide.png');
  await editor.close();
  await waitFor(() => sw.evaluate((k) => ITK.handoff.get(k).then((v) => v == null), key));
});

test('a large download completes even when the page that started it closes at once', async () => {
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${id}/popup.html`);
  await page.waitForSelector('#image-grid', { state: 'attached' });
  const res = await page.evaluate(() => ITK.ui.saveBlob(new Blob([new Uint8Array(37 * 1024 * 1024)], { type: 'application/zip' }), 'closing-test.zip', false));
  assert.equal(res.via, 'blob');
  await page.close();
  const item = await waitFor(() => sw.evaluate(async (downloadId) => {
    const [d] = await chrome.downloads.search({ id: downloadId });
    return d && d.state !== 'in_progress' ? d : null;
  }, res.downloadId), 20000);
  assert.equal(item.state, 'complete');
  assert.equal(item.fileSize, 37 * MiB);
  // The file was taken out of the handoff store once the offscreen document picked it up.
  assert.equal(await sw.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open('imagetoolkit');
    req.onsuccess = () => {
      const all = req.result.transaction('handoff').objectStore('handoff').getAll();
      all.onsuccess = () => { resolve(all.result.filter((e) => e.value instanceof Blob).length); req.result.close(); };
    };
  })), 0);
});

test('a page with no images resets the count and "Select all" acts on nothing', async () => {
  await freshPanel();
  await ui.evaluate((b) => setImages([{ src: b + 'photo.png', width: 30, height: 20 }, { src: b + 'wide.png', width: 40, height: 20 }]), base);
  await ui.evaluate(() => setImages([], 'restricted'));
  assert.match(await ui.textContent('#grid-count'), /^0\b/);
  await ui.evaluate(() => toggleSelectAll());
  assert.equal(await ui.evaluate(() => state.selected.size), 0);
  assert.equal(await ui.isHidden('#action-bar'), true);
});

test('files without a name in their URL keep their own name when saved from Tools', async () => {
  const res = await ui.evaluate(async (b) => {
    const blob = await (await fetch(b + 'photo.png')).blob();
    const dataUrl = await ITK.ui.blobToDataUrl(blob);
    return chrome.runtime.sendMessage({ action: 'processAndSave', imageUrl: dataUrl, instructions: { format: 'png', saveAs: false, silent: true, sourceName: 'holiday.photo.png' } });
  }, base);
  assert.equal(res.filename, 'holiday.photo.png');
});

test('editor presets: groups can be hidden and your own sizes added, used and removed', async () => {
  await freshPanel();
  await ui.evaluate(() => switchTab('settings'));
  // Hide two groups and add a preset from the Settings card.
  await ui.click('#preset-group-tmdb');
  await ui.click('#preset-group-social');
  await ui.fill('#preset-name', 'Blog cover');
  await ui.fill('#preset-w', '1200');
  await ui.fill('#preset-h', '630');
  await ui.click('#preset-form button[type="submit"]');
  // Invalid input is refused, nothing is added.
  await ui.fill('#preset-name', 'Broken');
  await ui.fill('#preset-w', '0');
  await ui.fill('#preset-h', '10');
  await ui.click('#preset-form button[type="submit"]');
  const saved = await waitFor(() => ui.evaluate(() => chrome.storage.sync.get('settings').then(({ settings }) =>
    settings.customPresets?.length && settings.presetGroups?.social === false ? settings : null)));
  assert.deepEqual(saved.customPresets, [{ name: 'Blog cover', w: 1200, h: 630 }]);
  assert.equal(saved.presetGroups.tmdb, false);
  assert.equal(await ui.locator('#custom-presets .preset-item').count(), 1);

  const known = new Set(ctx.pages());
  await sw.evaluate((url) => openEditor(url), base + 'wide.png');
  const editor = await waitFor(() => ctx.pages().find((p) => !known.has(p) && p.url().includes('resize.html')));
  await editor.waitForSelector('.cropper-container', { timeout: 10000 });
  const visible = await editor.evaluate(() => [...document.querySelectorAll('details.panel')].filter((d) => !d.hidden).map((d) => d.dataset.group || d.id));
  assert.deepEqual(visible, ['custom-presets-panel', 'ratio', 'common', 'tvdb']);
  await editor.click('#custom-presets [data-preset="1200x630"]');
  assert.deepEqual([await editor.inputValue('#out-w'), await editor.inputValue('#out-h')], ['1200', '630']);
  await editor.close();

  // Remove it again and restore the groups.
  await ui.click('#custom-presets .preset-item button');
  await ui.click('#preset-group-tmdb');
  await ui.click('#preset-group-social');
  const restored = await waitFor(() => ui.evaluate(() => chrome.storage.sync.get('settings').then(({ settings }) =>
    !settings.customPresets?.length && settings.presetGroups?.social === true && settings.presetGroups?.tmdb === true ? settings : null)));
  assert.ok(restored);
  assert.equal(await ui.isVisible('#custom-presets-empty'), true);
});

test('filename template: chips insert variables, preview matches, downloads and ZIP use it', async () => {
  await freshPanel();
  await ui.evaluate(() => switchTab('settings'));
  await ui.selectOption('#setting-filename', 'template');
  assert.equal(await ui.isVisible('#template-row'), true);
  await ui.fill('#setting-template', 'shots/');
  await ui.click('#template-tokens .token:has-text("{name}")');
  await ui.click('#template-tokens .token:has-text("{index}")');
  assert.equal(await ui.inputValue('#setting-template'), 'shots/{name}{index}');
  await ui.fill('#setting-template', 'shots/{name}_{width}x{height}_{index}');
  await ui.dispatchEvent('#setting-template', 'change');
  assert.match(await ui.textContent('#template-preview'), /shots\/sunset_1920x1080_001\.\w+/);
  await waitFor(() => ui.evaluate(() => chrome.storage.sync.get('settings').then(({ settings }) => settings.filenameTemplate === 'shots/{name}_{width}x{height}_{index}')));

  // A single download: real size of the produced image, no index outside a batch.
  const single = await send({ action: 'processAndSave', imageUrl: base + 'wide.png', instructions: { format: 'png', saveAs: false, silent: true } });
  assert.equal(single.filename, 'shots/wide_40x20.png');

  // ZIP entries follow the template and never collide.
  const names = await ui.evaluate((b) => {
    state.settings.filenamePattern = 'template';
    state.settings.filenameTemplate = '{name}';
    const used = new Set();
    const img = { src: b + 'wide.png', width: 40, height: 20 };
    return [1, 2].map((i) => zipEntryName(img, buildInstructions('png', img, i), { format: 'png', width: 40, height: 20 }, i, used));
  }, base);
  assert.deepEqual(names, ['wide.png', 'wide (2).png']);

  await ui.selectOption('#setting-filename', 'original');
  await waitFor(() => ui.evaluate(() => chrome.storage.sync.get('settings').then(({ settings }) => settings.filenamePattern === 'original')));
});

test('auto-scroll loads lazy and infinite-scroll images, keeps the ones a feed unloads, and returns', async () => {
  const page = await screenPage('feed.html');
  await page.evaluate(() => window.scrollTo(0, 120));
  const tabId = await tabIdOf(base + 'feed.html');
  const before = await send({ action: 'collectImages', tabId });
  assert.ok(!before.images.some((i) => i.src.includes('feed=1a')));
  const res = await send({ action: 'autoScroll', tabId });
  const srcs = res.images.map((i) => new URL(i.src).search);
  for (const q of ['?feed=0', '?lazy=1', '?feed=1a', '?feed=1b', '?feed=2a', '?feed=3b']) assert.ok(srcs.includes(q), `missing ${q}: ${srcs}`);
  // The page itself only holds the last batch's images now: the others were collected on the way.
  assert.equal(await page.locator('#list img').count(), 2);
  assert.equal(await page.evaluate(() => scrollY), 120);
  assert.equal(res.stopped, false);
  await page.close();
});

test('auto-scroll can be stopped from the panel', async () => {
  const page = await screenPage('feed.html');
  const tabId = await tabIdOf(base + 'feed.html');
  const running = send({ action: 'autoScroll', tabId });
  await new Promise((r) => setTimeout(r, 400));
  await send({ action: 'stopAutoScroll', tabId });
  const res = await running;
  assert.equal(res.stopped, true);
  assert.equal(await page.evaluate(() => scrollY), 0);
  await page.close();
});

test('images inside iframes are listed, same-origin and cross-origin, and outlined there too', async () => {
  const port = new URL(base).port;
  FIXTURES['frames.html'] = Buffer.from('<!doctype html><title>frames</title><body><img src="photo.png?top=1">'
    + `<iframe src="frame.html" width="200" height="120"></iframe><iframe src="http://itk-other.test:${port}/frame.html?x=1" width="200" height="120"></iframe></body>`);
  const page = await ctx.newPage();
  await page.goto(base + 'frames.html');
  await page.waitForTimeout(300);
  const tabId = await tabIdOf(base + 'frames.html');
  const { images } = await send({ action: 'collectImages', tabId });
  const srcs = images.map((i) => i.src);
  assert.equal(srcs[0], base + 'photo.png?top=1', 'the page itself comes first');
  assert.ok(srcs.includes(base + 'anim.gif?inframe=1'), srcs.join(' '));
  assert.ok(srcs.includes(base + 'wide.png?inframebg=1'));
  assert.ok(srcs.includes(`http://itk-other.test:${port}/anim.gif?inframe=1`), 'cross-origin frame');
  // A second scan does not inject again or duplicate anything.
  assert.equal((await send({ action: 'collectImages', tabId })).images.length, images.length);

  // Outlines reach the frames through the same port.
  const panel = await ctx.newPage();
  await panel.goto(`chrome-extension://${id}/popup.html`);
  await panel.waitForSelector('#image-grid', { state: 'attached' });
  await panel.evaluate(async ({ tabId, src }) => { state.tabId = tabId; await scan(); state.selected.add(src); updateSelectionUI(); }, { tabId, src: `http://itk-other.test:${port}/anim.gif?inframe=1` });
  const frame = page.frames().find((f) => f.url().startsWith('http://itk-other.test'));
  await waitFor(() => frame.evaluate(() => document.querySelectorAll('[data-imagetoolkit-selected]').length === 1));
  await panel.close();
  await waitFor(() => frame.evaluate(() => document.querySelectorAll('[data-imagetoolkit-selected]').length === 0));
  await page.close();
});

test('all tabs of a window: merged, tagged with their page, browser pages skipped, tab filter', async () => {
  const win = await sw.evaluate(async (urls) => {
    const w = await chrome.windows.create({ url: urls, focused: false });
    return { id: w.id, tabs: w.tabs.map((t) => t.id) };
  }, [base + 'page.html', base + 'frames.html', base + 'feed.html', 'chrome://version']);
  await waitFor(() => sw.evaluate(async (id) => (await chrome.tabs.query({ windowId: id })).every((t) => t.status === 'complete'), win.id), 10000);

  const res = await send({ action: 'collectWindowImages', windowId: win.id });
  assert.equal(res.tabs, 3);
  assert.equal(res.skipped, 1);
  const bySrc = new Map(res.images.map((i) => [i.src, i]));
  assert.ok(bySrc.has(base + 'anim.gif'), 'page.html');
  assert.ok(bySrc.has(base + 'photo.png?top=1'), 'frames.html');
  assert.ok(bySrc.has(base + 'photo.png?feed=0'), 'feed.html');
  assert.equal(bySrc.get(base + 'photo.png?top=1').pageTitle, 'frames');
  assert.equal(bySrc.get(base + 'photo.png?top=1').pageHost, '127.0.0.1');
  assert.equal(new Set(res.images.map((i) => i.src)).size, res.images.length, 'no duplicates across tabs');

  // The panel: switch scope, then filter one tab.
  await freshPanel();
  await ui.evaluate(async (windowId) => { state.windowId = windowId; setScope('window', false); await scan(); }, win.id);
  assert.equal(await ui.isVisible('#filter-tab-field', { strict: false }) || await ui.evaluate(() => !document.getElementById('filter-tab-field').hidden), true);
  assert.equal(await ui.locator('#filter-tab option').count(), 4); // Any + 3 tabs
  const feedTab = await ui.evaluate(() => [...document.querySelectorAll('#filter-tab option')].find((o) => o.textContent.startsWith('f ('))?.value);
  await ui.evaluate((v) => { const s = document.getElementById('filter-tab'); s.value = v; s.dispatchEvent(new Event('change')); }, feedTab);
  assert.ok(await ui.evaluate(() => state.filtered.length > 0 && state.filtered.every((i) => i.pages.some((p) => p.pageTitle === 'f'))));
  assert.match(await ui.textContent('#scan-host'), /3/);
  await ui.evaluate(() => setScope('tab', false));
  await sw.evaluate((id) => chrome.windows.remove(id), win.id);
});

test('all tabs: an image on two pages belongs to both, for the filter and for file names', async () => {
  FIXTURES['shareA.html'] = Buffer.from('<!doctype html><title>Alpha</title><img src="photo.png?shared=1"><img src="wide.png?onlyA=1">');
  FIXTURES['shareB.html'] = Buffer.from('<!doctype html><title>Beta</title><img src="photo.png?shared=1">');
  const win = await sw.evaluate(async (urls) => {
    const w = await chrome.windows.create({ url: urls, focused: false });
    return { id: w.id, tabs: w.tabs.map((t) => t.id) };
  }, [base + 'shareA.html', base + 'shareB.html']);
  await waitFor(() => sw.evaluate(async (id) => (await chrome.tabs.query({ windowId: id })).every((t) => t.status === 'complete'), win.id), 10000);
  await freshPanel();
  await ui.evaluate(async (windowId) => { state.windowId = windowId; setScope('window', false); await scan(); }, win.id);
  const betaTab = await ui.evaluate(() => [...document.querySelectorAll('#filter-tab option')].find((o) => o.textContent.startsWith('Beta ('))?.value);
  assert.ok(betaTab, 'the page with only shared images is in the filter');
  await ui.evaluate((v) => { const s = document.getElementById('filter-tab'); s.value = v; s.dispatchEvent(new Event('change')); }, betaTab);
  const shown = await ui.evaluate(() => state.filtered.map((i) => i.src));
  assert.deepEqual(shown, [base + 'photo.png?shared=1']);
  const title = await ui.evaluate(() => buildInstructions('png', state.filtered[0], 1).pageTitle);
  assert.equal(title, 'Beta');
  await ui.evaluate(() => setScope('tab', false));
  await sw.evaluate((id) => chrome.windows.remove(id), win.id);
});

test('scanner: inline images with the same length and ending are both listed', async () => {
  const svg = (color) => `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#${color}"/><!--${'x'.repeat(120)}--></svg>`;
  const src = (color) => 'data:image/svg+xml;base64,' + Buffer.from(svg(color)).toString('base64');
  FIXTURES['inline2.html'] = Buffer.from(`<!doctype html><title>inline</title><img src="${src('ff0000')}"><img src="${src('8b4513')}">`);
  const page = await ctx.newPage();
  await page.goto(base + 'inline2.html');
  const { images } = await send({ action: 'collectImages', tabId: await tabIdOf(base + 'inline2.html') });
  assert.equal(images.filter((i) => i.src.startsWith('data:image/svg+xml')).length, 2);
  await page.close();
});

test('full-page capture: slices in order, fixed header only once, scrollbar off, position restored', async () => {
  FIXTURES['long.html'] = Buffer.from('<!doctype html><title>long</title><style>body{margin:0}div.b{height:600px}</style><body>'
    + '<header style="position:fixed;top:0;left:0;right:0;height:40px;background:#000"></header>'
    + ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff'].map((c) => `<div class="b" style="background:${c}"></div>`).join('') + '</body>');
  const page = await screenPage('long.html');
  await page.evaluate(() => window.scrollTo(0, 250));
  await page.bringToFront();
  const tabId = await tabIdOf(base + 'long.html');
  const known = new Set(ctx.pages());
  const res = await send({ action: 'captureFullPage', tabId });
  assert.equal(res.success, true, JSON.stringify(res));
  const editor = await waitFor(() => ctx.pages().find((p) => !known.has(p) && p.url().includes('resize.html')), 15000);
  await editor.waitForSelector('.cropper-container', { timeout: 15000 });
  const { dpr, clientWidth } = await page.evaluate(() => ({ dpr: devicePixelRatio, clientWidth: document.documentElement.clientWidth }));
  const probe = await editor.evaluate(async (dpr) => {
    const img = document.getElementById('cropper-img');
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const at = (y) => [...x.getImageData(Math.round(400 * dpr), Math.round(y * dpr), 1, 1).data.slice(0, 3)].join(',');
    return { w: img.naturalWidth, h: img.naturalHeight, src: img.src.slice(0, 5), header: at(20), band1: at(300), seam: at(615), band2: at(900), band3: at(1500), band4: at(2100), band5: at(2990) };
  }, dpr);
  assert.equal(probe.src, 'blob:');
  assert.equal(probe.w, Math.round(clientWidth * dpr));
  assert.equal(probe.h, Math.round(3000 * dpr));
  assert.deepEqual([probe.header, probe.band1, probe.seam, probe.band2, probe.band3, probe.band4, probe.band5],
    ['0,0,0', '255,0,0', '0,255,0', '0,255,0', '0,0,255', '255,255,0', '255,0,255']);
  assert.equal(await page.evaluate(() => scrollY), 250);
  assert.equal(await page.evaluate(() => !!document.getElementById('imagetoolkit-fullpage-style')), false);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('header')).visibility), 'visible');
  await editor.close();
  await page.close();
});

test('annotate: pixelate hides detail, box and text draw, undo/redo, applies on a rotated image', async () => {
  // 200×100: a fine black/white checker on the left half, plain red on the right.
  const dataUrl = await ui.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 200; c.height = 100;
    const x = c.getContext('2d');
    x.fillStyle = '#ff0000'; x.fillRect(100, 0, 100, 100);
    for (let i = 0; i < 100; i += 2) for (let j = 0; j < 100; j += 2) { x.fillStyle = (i + j) % 4 ? '#000' : '#fff'; x.fillRect(i, j, 2, 2); }
    return c.toDataURL('image/png');
  });
  const known = new Set(ctx.pages());
  await sw.evaluate((url) => openEditor(url), dataUrl);
  const editor = await waitFor(() => ctx.pages().find((p) => !known.has(p) && p.url().includes('resize.html')));
  await editor.setViewportSize({ width: 1200, height: 800 });
  await editor.waitForSelector('.cropper-container', { timeout: 10000 });
  await editor.click('#btn-rotate-left'); // annotations work on the image as it is now oriented
  await editor.click('#btn-annotate');
  await editor.waitForSelector('.annot-layer');
  const canvasSize = await editor.evaluate(() => { const c = document.querySelector('.annot-canvas'); return [c.width, c.height]; });
  assert.deepEqual(canvasSize, [100, 200]);

  // Drag helper in image pixels.
  const drag = async (x1, y1, x2, y2) => {
    const box = await editor.locator('.annot-overlay').boundingBox();
    const at = (x, y) => [box.x + (x / 100) * box.width, box.y + (y / 200) * box.height];
    await editor.mouse.move(...at(x1, y1));
    await editor.mouse.down();
    await editor.mouse.move(...at(x2, y2), { steps: 4 });
    await editor.mouse.up();
  };
  const pixel = (x, y) => editor.evaluate(([x, y]) => [...document.querySelector('.annot-canvas').getContext('2d').getImageData(x, y, 1, 1).data.slice(0, 3)], [x, y]);
  // After rotating left, the checker (formerly the left half) is the bottom half.
  const variance = () => editor.evaluate(() => {
    const d = document.querySelector('.annot-canvas').getContext('2d').getImageData(20, 120, 40, 40).data;
    let min = 255, max = 0;
    for (let i = 0; i < d.length; i += 4) { min = Math.min(min, d[i]); max = Math.max(max, d[i]); }
    return max - min;
  });
  assert.equal(await variance(), 255);
  await editor.keyboard.press('p');
  await editor.waitForSelector('.annot-tool[data-tool="pixelate"].active');
  await drag(10, 110, 90, 190);
  assert.ok(await variance() < 60, 'the checker is pixelated');
  await editor.keyboard.press('r');
  await editor.waitForSelector('.annot-tool[data-tool="box"].active');
  await editor.click('.annot-color[data-color="#3b82f6"]');
  await drag(10, 10, 90, 90);
  const edge = await pixel(10, 50);
  assert.ok(edge[2] > 180 && edge[0] < 120, `box edge is blue: ${edge}`);
  await editor.keyboard.press('Control+z');
  assert.deepEqual(await pixel(10, 50), [255, 0, 0]);
  await editor.keyboard.press('Control+y');
  assert.ok((await pixel(10, 50))[2] > 180);
  // Text: click, type, Enter.
  await editor.keyboard.press('t');
  await editor.waitForSelector('.annot-tool[data-tool="text"].active');
  const box = await editor.locator('.annot-overlay').boundingBox();
  await editor.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await editor.locator('.annot-text').fill('Hi');
  await editor.keyboard.press('Enter');
  assert.equal(await editor.locator('.annot-text').count(), 0);

  await editor.click('.annot-bar .btn-primary'); // Apply
  await editor.waitForSelector('.annot-layer', { state: 'detached' });
  await waitFor(() => editor.evaluate(() => document.getElementById('cropper-img').src.startsWith('blob:')));
  const result = await waitFor(() => editor.evaluate(() => {
    const img = document.getElementById('cropper-img');
    return img.naturalWidth === 100 && editor.cropper.ready ? { w: img.naturalWidth, h: img.naturalHeight, rotate: editor.cropper.getData().rotate } : null;
  }));
  assert.deepEqual(result, { w: 100, h: 200, rotate: 0 });
  assert.match(await editor.textContent('#info-text'), /100 × 200/);
  // Saving still works on the annotated image.
  const countPng = () => sw.evaluate(() => chrome.downloads.search({ mime: 'image/png' }).then((d) => d.length));
  const before = await countPng();
  await editor.evaluate(async () => { document.querySelector('#resize-format [data-value="png"]').click(); await save(); });
  await waitFor(async () => (await countPng()) > before);
  await editor.close();
});

// ---------- Review of 2.5.0 ----------

test('a scanner left in the page by an older version does not block the new one', async () => {
  const page = await ctx.newPage();
  await page.goto(base + 'page.html');
  const tabId = await tabIdOf(base + 'page.html');
  // 2.4.x marked its scanner with this flag and had no scan function.
  await sw.evaluate((tabId) => chrome.scripting.executeScript({ target: { tabId }, func: () => { window.__imagetoolkitScanner = true; } }), tabId);
  const { images, error } = await send({ action: 'collectImages', tabId });
  assert.equal(error, undefined);
  assert.ok(images.some((i) => i.src === base + 'photo.png'));
  await page.close();
});

test('full-page capture keeps sticky content where it belongs and never repeats it', async () => {
  FIXTURES['sticky.html'] = Buffer.from('<!doctype html><title>sticky</title><style>body{margin:0}section{height:1200px;background:#00ff00}h2{position:sticky;top:0;margin:0;height:60px;background:#ff0000}</style><body>'
    + '<section></section><section><h2></h2></section><section style="background:#0000ff"></section></body>');
  const page = await screenPage('sticky.html');
  await page.bringToFront();
  const known = new Set(ctx.pages());
  assert.equal((await send({ action: 'captureFullPage', tabId: await tabIdOf(base + 'sticky.html') })).success, true);
  const editor = await waitFor(() => ctx.pages().find((p) => !known.has(p) && p.url().includes('resize.html')), 15000);
  await editor.waitForSelector('.cropper-container', { timeout: 15000 });
  const dpr = await page.evaluate(() => devicePixelRatio);
  const px = await editor.evaluate((dpr) => {
    const img = document.getElementById('cropper-img');
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const at = (y) => [...x.getImageData(Math.round(400 * dpr), Math.round(y * dpr), 1, 1).data.slice(0, 3)].join(',');
    return { heading: at(1230), afterHeading: at(1300), slice3top: at(1805), blue: at(3000) };
  }, dpr);
  // The heading sits at the top of its section (y 1200–1260), once; nowhere else is red.
  assert.deepEqual(px, { heading: '255,0,0', afterHeading: '0,255,0', slice3top: '0,255,0', blue: '0,0,255' });
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('h2')).position), 'sticky');
  await editor.close();
  await page.close();
});

test('full-page capture of an app-like layout follows its inner scrolling area', async () => {
  FIXTURES['app.html'] = Buffer.from('<!doctype html><title>app</title><style>html,body{margin:0;height:100%;overflow:hidden}'
    + 'header{height:50px;background:#000}main{height:calc(100% - 50px);overflow:auto}main div{height:600px}</style><body><header></header><main>'
    + ['#ff0000', '#00ff00', '#0000ff'].map((c) => `<div style="background:${c}"></div>`).join('') + '</main></body>');
  const page = await screenPage('app.html');
  await page.evaluate(() => { document.querySelector('main').scrollTop = 120; });
  await page.bringToFront();
  const known = new Set(ctx.pages());
  const res = await send({ action: 'captureFullPage', tabId: await tabIdOf(base + 'app.html') });
  assert.equal(res.success, true, JSON.stringify(res));
  const editor = await waitFor(() => ctx.pages().find((p) => !known.has(p) && p.url().includes('resize.html')), 15000);
  await editor.waitForSelector('.cropper-container', { timeout: 15000 });
  const dpr = await page.evaluate(() => devicePixelRatio);
  const probe = await editor.evaluate((dpr) => {
    const img = document.getElementById('cropper-img');
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const at = (y) => [...x.getImageData(Math.round(400 * dpr), Math.round(y * dpr), 1, 1).data.slice(0, 3)].join(',');
    return { h: img.naturalHeight, top: at(5), red: at(300), green: at(900), blue: at(1500), end: at(1795) };
  }, dpr);
  // The whole scrolling area (3 × 600 px), not one screen of it; the header is not part of it.
  assert.equal(probe.h, Math.round(1800 * dpr));
  assert.deepEqual([probe.top, probe.red, probe.green, probe.blue, probe.end], ['255,0,0', '255,0,0', '0,255,0', '0,0,255', '0,0,255']);
  assert.equal(await page.evaluate(() => document.querySelector('main').scrollTop), 120);
  await editor.close();
  await page.close();
});

test('full-page capture ends on a page that refuses to scroll, and says it may be incomplete', async () => {
  FIXTURES['stuck.html'] = Buffer.from('<!doctype html><title>stuck</title><style>body{margin:0}div{height:4000px;background:#ff0000}</style><body><div></div>'
    + '<script>addEventListener("scroll", () => scrollTo(0, 0));</script></body>');
  const page = await screenPage('stuck.html');
  await page.bringToFront();
  const known = new Set(ctx.pages());
  const started = Date.now();
  const res = await send({ action: 'captureFullPage', tabId: await tabIdOf(base + 'stuck.html') });
  assert.equal(res.success, true, JSON.stringify(res));
  assert.equal(res.truncated, true);
  assert.ok(Date.now() - started < 20000, 'ends at once instead of looping');
  const editor = await waitFor(() => ctx.pages().find((p) => !known.has(p) && p.url().includes('resize.html')), 15000);
  await editor.close();
  assert.equal(await page.evaluate(() => !!document.getElementById('imagetoolkit-fullpage-style')), false);
  await page.close();
});

test('full-page capture of a page that jumps while scrolling (chats) has no holes: it stops at the jump and is trimmed', async () => {
  FIXTURES['jumpy.html'] = Buffer.from('<!doctype html><title>jumpy</title><style>body{margin:0}div{height:600px}</style><body>'
    + ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#000000'].map((c) => `<div style="background:${c}"></div>`).join('')
    + '<script>addEventListener("scroll", () => { if (scrollY > 900 && scrollY < 2500) scrollTo(0, 3000); });</script></body>');
  const page = await screenPage('jumpy.html');
  await page.bringToFront();
  const known = new Set(ctx.pages());
  const res = await send({ action: 'captureFullPage', tabId: await tabIdOf(base + 'jumpy.html') });
  assert.equal(res.success, true, JSON.stringify(res));
  assert.equal(res.truncated, true);
  const editor = await waitFor(() => ctx.pages().find((p) => !known.has(p) && p.url().includes('resize.html')), 15000);
  await editor.waitForSelector('.cropper-container', { timeout: 15000 });
  const dpr = await page.evaluate(() => devicePixelRatio);
  const probe = await editor.evaluate((dpr) => {
    const img = document.getElementById('cropper-img');
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const rows = [];
    for (let y = 50; y < img.naturalHeight / dpr; y += 100) rows.push(x.getImageData(Math.round(400 * dpr), Math.round(y * dpr), 1, 1).data[3]);
    return { h: Math.round(img.naturalHeight / dpr), transparentRows: rows.filter((a) => a < 255).length };
  }, dpr);
  assert.ok(probe.h <= 1200 && probe.h >= 600, `trimmed to what was captured: ${probe.h}`);
  assert.equal(probe.transparentRows, 0, 'no empty band anywhere');
  await editor.close();
  await page.close();
});

test('Esc in the panel cancels a full-page capture; the page is restored and no editor opens', async () => {
  FIXTURES['esc.html'] = Buffer.from('<!doctype html><title>esc</title><style>body{margin:0}div{height:8000px;background:linear-gradient(#f00,#00f)}</style><body><div></div></body>');
  const page = await screenPage('esc.html');
  await page.bringToFront();
  const known = new Set(ctx.pages());
  const tabId = await tabIdOf(base + 'esc.html');
  // The side panel keeps the focus after its button is clicked: Esc there must cancel.
  const panel = await ctx.newPage();
  await panel.goto(`chrome-extension://${id}/popup.html?mode=sidepanel`);
  await panel.waitForSelector('#image-grid', { state: 'attached' });
  await page.bringToFront();
  await panel.evaluate((id) => { state.tabId = id; document.getElementById('btn-capture-full').click(); }, tabId);
  await new Promise((r) => setTimeout(r, 1200));
  await panel.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  await waitFor(() => panel.evaluate(() => !state.fullPageRunning), 15000);
  await new Promise((r) => setTimeout(r, 500));
  known.add(panel);
  assert.equal(ctx.pages().some((p) => !known.has(p) && p.url().includes('resize.html')), false);
  assert.equal(await page.evaluate(() => !!document.getElementById('imagetoolkit-fullpage-style')), false);
  assert.equal(await page.evaluate(() => scrollY), 0);
  await panel.close();
  await page.close();
});

test('full-page capture stops when another tab comes to the front, and restores the page', async () => {
  FIXTURES['tall.html'] = Buffer.from('<!doctype html><title>tall</title><style>body{margin:0}div{height:6000px;background:linear-gradient(#f00,#00f)}</style><body><div></div></body>');
  const page = await screenPage('tall.html');
  FIXTURES['other.html'] = Buffer.from('<!doctype html><title>other</title><body>other</body>');
  const other = await ctx.newPage();
  await other.goto(base + 'other.html');
  await page.bringToFront();
  const known = new Set(ctx.pages());
  const pending = send({ action: 'captureFullPage', tabId: await tabIdOf(base + 'tall.html') });
  await new Promise((r) => setTimeout(r, 1200));
  await other.bringToFront();
  const res = await pending;
  assert.equal(res.error, 'tabChanged', JSON.stringify(res));
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(ctx.pages().some((p) => !known.has(p) && p.url().includes('resize.html')), false, 'no editor with a mixed capture');
  assert.equal(await page.evaluate(() => !!document.getElementById('imagetoolkit-fullpage-style')), false);
  assert.equal(await page.evaluate(() => scrollY), 0);
  await other.close();
  await page.close();
});

test('automatic preview fetches never send cookies; a fetch the user asks for does', async () => {
  await ctx.addCookies([{ name: 'itk', value: '1', url: base }]);
  const automatic = await send({ action: 'fetchAsDataUrl', imageUrl: base + 'auth/cookie.png', automatic: true });
  assert.ok(!automatic?.dataUrl, JSON.stringify(automatic).slice(0, 120));
  const asked = await send({ action: 'fetchAsDataUrl', imageUrl: base + 'auth/cookie.png' });
  assert.ok(asked?.dataUrl?.startsWith('data:image/png'), 'the editor and downloads still reach images behind a login');
});

test('a download that stalls ends with a time-out instead of hanging', async () => {
  const started = Date.now();
  const message = await sw.evaluate((url) => fetchImageBlob(url, { totalMs: 1500 }).then(() => 'resolved', (err) => err.message), base + 'stall.png');
  assert.equal(message, 'Download timed out');
  assert.ok(Date.now() - started < 8000);
});

test('auto-scroll: Stop goes to the tab being scrolled, not the one now active', async () => {
  await freshPanel();
  const calls = await ui.evaluate(async () => {
    const calls = [];
    const original = chrome.runtime.sendMessage;
    chrome.runtime.sendMessage = (message) => { calls.push(message); return Promise.resolve({}); };
    try {
      Object.assign(state, { autoScrolling: true, autoScrollTab: 111, tabId: 222 });
      await toggleAutoScroll();
    } finally {
      chrome.runtime.sendMessage = original;
      state.autoScrolling = false;
    }
    return calls;
  });
  assert.deepEqual(calls.map((m) => [m.action, m.tabId]), [['stopAutoScroll', 111]]);
});

test('the panel loads thumbnails directly only once the no-cookie rule is confirmed', async () => {
  await ctx.addCookies([{ name: 'itk', value: '1', url: base }]);
  await freshPanel();
  assert.deepEqual(await send({ action: 'imagesReady' }), { ok: true });
  assert.equal(await ui.evaluate(() => state.directImages), true);
  // Without the rule (Chrome refused it): no direct load at all, only the cookie-less download.
  cookieLog.length = 0;
  await ui.evaluate((b) => { state.directImages = false; setImages([{ src: b + 'echo/norule.png', width: 0, height: 0 }]); }, base);
  await waitFor(() => cookieLog.length > 0, 10000);
  await waitFor(() => ui.evaluate(() => document.querySelector('.gthumb img')?.src.startsWith('data:')), 10000);
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(cookieLog.every((e) => e.dest !== 'image' && !/itk=1/.test(e.cookie)), JSON.stringify(cookieLog));
});

test('thumbnails and previews the panel loads by itself carry no cookies and cannot set any', async () => {
  await ctx.addCookies([{ name: 'itk', value: '1', url: base }]);
  await freshPanel();
  cookieLog.length = 0;
  await ui.evaluate((b) => setImages([{ src: b + 'echo/thumb.png', width: 0, height: 0 }]), base);
  await waitFor(() => cookieLog.length > 0, 10000);
  await new Promise((r) => setTimeout(r, 500));
  assert.ok(cookieLog.every((entry) => !/itk=1/.test(entry.cookie)), JSON.stringify(cookieLog));
  assert.equal((await ctx.cookies(base)).some((c) => c.name === 'tracker'), false, 'no cookie set through a thumbnail');
  // The page itself still sends its cookies: only the extension's own loads are changed.
  cookieLog.length = 0;
  FIXTURES['echo.html'] = Buffer.from('<!doctype html><title>echo</title><img src="echo/page.png">');
  const page = await ctx.newPage();
  await page.goto(base + 'echo.html');
  await waitFor(() => cookieLog.some((e) => e.name === 'echo/page.png'), 10000);
  assert.ok(cookieLog.find((e) => e.name === 'echo/page.png').cookie.includes('itk=1'));
  await page.close();
});

test('capture watch: a tab that leaves and comes back, or reloads the same URL, stays marked', async () => {
  FIXTURES['w1.html'] = Buffer.from('<!doctype html><title>w1</title>');
  FIXTURES['w2.html'] = Buffer.from('<!doctype html><title>w2</title>');
  const a = await ctx.newPage(); await a.goto(base + 'w1.html');
  const b = await ctx.newPage(); await b.goto(base + 'w2.html');
  await a.bringToFront();
  const ids = { a: await tabIdOf(base + 'w1.html'), b: await tabIdOf(base + 'w2.html') };
  const awayAndBack = await sw.evaluate(async ({ a, b }) => {
    const tab = await chrome.tabs.get(a);
    const watch = watchTab(a, tab.windowId);
    await chrome.tabs.update(b, { active: true });
    await chrome.tabs.update(a, { active: true });
    await new Promise((r) => setTimeout(r, 200));
    watch.stop();
    return { changed: watch.changed, front: (await chrome.tabs.get(a)).active };
  }, ids);
  assert.deepEqual(awayAndBack, { changed: true, front: true });
  const quiet = await sw.evaluate(async ({ a }) => {
    const tab = await chrome.tabs.get(a);
    const watch = watchTab(a, tab.windowId);
    await new Promise((r) => setTimeout(r, 300));
    watch.stop();
    return watch.changed;
  }, ids);
  assert.equal(quiet, false);
  const reloaded = await sw.evaluate(async ({ a }) => {
    const tab = await chrome.tabs.get(a);
    const watch = watchTab(a, tab.windowId);
    await chrome.tabs.reload(a);
    await new Promise((r) => setTimeout(r, 500));
    watch.stop();
    return watch.changed;
  }, ids);
  assert.equal(reloaded, true);
  await a.close(); await b.close();
});

test('full-page capture stops when the page reloads the same URL midway', async () => {
  FIXTURES['reload.html'] = Buffer.from('<!doctype html><title>reload</title><style>body{margin:0}div{height:6000px;background:linear-gradient(#0f0,#f0f)}</style><body><div></div></body>');
  const page = await screenPage('reload.html');
  await page.bringToFront();
  const known = new Set(ctx.pages());
  const tabId = await tabIdOf(base + 'reload.html');
  const pending = send({ action: 'captureFullPage', tabId });
  await new Promise((r) => setTimeout(r, 1200));
  await sw.evaluate((id) => chrome.tabs.reload(id), tabId);
  const res = await pending;
  assert.ok(res.error, JSON.stringify(res));
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(ctx.pages().some((p) => !known.has(p) && p.url().includes('resize.html')), false);
  await page.close();
});

test('full-page capture ignores a hidden off-screen scrolling panel', async () => {
  FIXTURES['panel.html'] = Buffer.from('<!doctype html><title>panel</title><style>html,body{margin:0;height:100%;overflow:hidden;background:#00ff00}'
    + 'aside{position:fixed;top:900px;left:0;width:700px;height:700px;overflow:auto;visibility:hidden;background:#f00}aside div{height:5000px}</style>'
    + '<body><aside><div></div></aside></body>');
  const page = await screenPage('panel.html');
  await page.bringToFront();
  const known = new Set(ctx.pages());
  const res = await send({ action: 'captureFullPage', tabId: await tabIdOf(base + 'panel.html') });
  assert.equal(res.success, true, JSON.stringify(res));
  const editor = await waitFor(() => ctx.pages().find((p) => !known.has(p) && p.url().includes('resize.html')), 15000);
  await editor.waitForSelector('.cropper-container', { timeout: 15000 });
  const dpr = await page.evaluate(() => devicePixelRatio);
  const probe = await editor.evaluate((dpr) => {
    const img = document.getElementById('cropper-img');
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    return { h: img.naturalHeight, mid: [...x.getImageData(Math.round(400 * dpr), Math.round(300 * dpr), 1, 1).data.slice(0, 3)].join(',') };
  }, dpr);
  assert.equal(probe.h, Math.round(600 * dpr), 'the visible page, not the hidden panel');
  assert.equal(probe.mid, '0,255,0');
  await editor.close();
  await page.close();
});

test('offscreen: at most two stitching sessions live at once; a slice outside the screenshot is an error', async () => {
  const result = await sw.evaluate(async () => {
    const begin = () => offscreenRequest({ action: 'fullpage-begin', width: 10, height: 10 }).then((r) => r.session);
    const s1 = await begin(); const s2 = await begin(); const s3 = await begin();
    const tiny = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYPj/HwADAgH/eL9GtQAAAABJRU5ErkJggg==';
    const draw = (session, crop) => offscreenRequest({ action: 'fullpage-draw', session, dataUrl: tiny, crop, y: 0, scale: 1 }).then(() => 'ok', (e) => e.message);
    const out = {
      oldest: await draw(s1, { x: 0, y: 0, width: 1, height: 1 }),
      newest: await draw(s3, { x: 0, y: 0, width: 1, height: 1 }),
      outside: await draw(s3, { x: 0, y: 5, width: 1, height: 1 }),
    };
    for (const session of [s2, s3]) await offscreenRequest({ action: 'fullpage-cancel', session });
    return out;
  });
  assert.deepEqual(result, { oldest: 'Capture expired', newest: 'ok', outside: 'Capture area is outside the screenshot' });
});

test('the header theme button flips light/dark; Automatic is only chosen in Settings', async () => {
  await freshPanel();
  await ui.evaluate(() => applyTheme('auto'));
  const shownDark = await ui.evaluate(() => document.getElementById('app').classList.contains('dark'));
  const seen = [];
  for (let i = 0; i < 3; i++) {
    await ui.click('#btn-theme');
    seen.push(await ui.evaluate(() => ({ theme: document.getElementById('app').dataset.theme, icon: document.getElementById('theme-icon').getAttribute('href') })));
  }
  const first = shownDark ? 'light' : 'dark';
  const second = shownDark ? 'dark' : 'light';
  const icon = (t) => (t === 'dark' ? '#i-moon' : '#i-sun');
  assert.deepEqual(seen, [first, second, first].map((theme) => ({ theme, icon: icon(theme) })));
  await waitFor(async () => (await sw.evaluate(async () => (await chrome.storage.sync.get('settings')).settings.theme)) === first);
  await ui.evaluate(() => { applyTheme('auto'); saveSettings({ theme: 'auto' }); });
});

test('transparency background: checkerboard, white, grey, black, shown on the button', async () => {
  await freshPanel();
  await ui.evaluate(() => setChecker('auto', false));
  const seen = [];
  for (let i = 0; i < 4; i++) {
    await ui.click('#btn-checker');
    seen.push(await ui.evaluate(() => ({
      mode: document.querySelector('.app').dataset.checker || 'auto',
      bg: getComputedStyle(document.querySelector('.app')).getPropertyValue('--checker').trim(),
      swatch: !!document.querySelector('#btn-checker .bg-swatch'),
    })));
  }
  assert.deepEqual(seen.map((s) => [s.mode, s.swatch]), [['white', true], ['gray', true], ['black', true], ['auto', false]]);
  assert.deepEqual(seen.slice(0, 3).map((s) => s.bg), ['#ffffff', '#808080', '#000000']);
  assert.match(await ui.getAttribute('#btn-checker', 'title'), /:/);
});

test('the editor starts with the whole image selected, so saving never trims a capture', async () => {
  const known = new Set(ctx.pages());
  await sw.evaluate((url) => openEditor(url), base + 'wide.png');
  const editor = await waitFor(() => ctx.pages().find((p) => !known.has(p) && p.url().includes('resize.html')));
  await editor.waitForSelector('.cropper-container', { timeout: 10000 });
  const r = await waitFor(() => editor.evaluate(() => {
    if (!editor.cropper?.ready) return null;
    const img = document.getElementById('cropper-img');
    const d = editor.cropper.getData(true);
    return { x: d.x, y: d.y, w: d.width, h: d.height, nw: img.naturalWidth, nh: img.naturalHeight };
  }));
  assert.deepEqual([r.x, r.y, r.w, r.h], [0, 0, r.nw, r.nh]);
  await editor.close();
});

test('copy link: one image address from the card or the preview; never for inline images', async () => {
  await freshPanel();
  await ui.evaluate(() => {
    window.__copied = [];
    window.copyText = async (text) => { window.__copied.push(text); };
    setImages([{ src: 'https://example.com/a.png', width: 10, height: 10 }, { src: 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="9" height="9"><!--' + 'x'.repeat(120) + '--></svg>'), width: 9, height: 9 }]);
  });
  const cards = ui.locator('.gcard');
  assert.equal(await cards.nth(0).locator('[data-act="link"]').count(), 1);
  assert.equal(await cards.nth(1).locator('[data-act="link"]').count(), 0, 'no link for an inline image');
  await ui.evaluate(() => document.querySelector('.gcard [data-act="link"]').click());
  await ui.evaluate(() => openPreview('https://example.com/a.png'));
  assert.equal(await ui.isHidden('#preview-link'), false);
  await ui.click('#preview-link');
  assert.deepEqual(await ui.evaluate(() => window.__copied), ['https://example.com/a.png', 'https://example.com/a.png']);
  await ui.evaluate(() => closePreview());
});

test('auto-scroll runs once per page: a second request gets "busy"', async () => {
  const page = await screenPage('feed.html');
  const tabId = await tabIdOf(base + 'feed.html');
  const first = send({ action: 'autoScroll', tabId });
  await new Promise((r) => setTimeout(r, 300));
  const second = await send({ action: 'autoScroll', tabId });
  assert.equal(second.error, 'busy');
  assert.ok((await first).images.length > 0);
  await page.close();
});

test('annotate: Redact is opaque, a click confirms text, only Ctrl+Enter applies, the stage takes the new shape', async () => {
  const dataUrl = await ui.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 400; c.height = 100;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, 400, 100);
    x.fillStyle = '#000'; x.font = '700 70px sans-serif'; x.textBaseline = 'top'; x.fillText('SECRET', 10, 15);
    return c.toDataURL('image/png');
  });
  const known = new Set(ctx.pages());
  await sw.evaluate((url) => openEditor(url), dataUrl);
  const editor = await waitFor(() => ctx.pages().find((p) => !known.has(p) && p.url().includes('resize.html')));
  await editor.setViewportSize({ width: 1200, height: 800 });
  await editor.waitForSelector('.cropper-container', { timeout: 10000 });
  await editor.click('#btn-rotate-left'); // 400×100 becomes 100×400
  await editor.click('#btn-annotate');
  await editor.waitForSelector('.annot-layer');
  // Positions are read at every step, from the board as it is now (it is fitted after opening).
  const at = async (x, y) => {
    const box = await editor.locator('.annot-overlay').boundingBox();
    return [box.x + (x / 100) * box.width, box.y + (y / 400) * box.height];
  };
  const drag = async (x1, y1, x2, y2) => {
    await editor.mouse.move(...await at(x1, y1)); await editor.mouse.down();
    await editor.mouse.move(...await at(x2, y2), { steps: 4 }); await editor.mouse.up();
  };
  // Tools are picked with their button and confirmed active before anything is drawn.
  const pick = async (tool) => {
    await editor.click(`.annot-tool[data-tool="${tool}"]`);
    await editor.waitForSelector(`.annot-tool[data-tool="${tool}"].active`);
  };
  await editor.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const region = (x, y, w, h) => editor.evaluate(([x, y, w, h]) => {
    const d = document.querySelector('.annot-canvas').getContext('2d').getImageData(x, y, w, h).data;
    const colours = new Set();
    for (let i = 0; i < d.length; i += 4) colours.add(`${d[i]},${d[i + 1]},${d[i + 2]},${d[i + 3]}`);
    return [...colours];
  }, [x, y, w, h]);

  await pick('redact');
  await editor.click('.annot-color[data-color="#111111"]');
  await drag(5, 5, 95, 395);
  assert.deepEqual(await region(10, 10, 80, 380), ['17,17,17,255'], 'nothing of the text is left');

  // Text: a click outside the open field confirms it and does not open another one.
  await pick('text');
  await editor.mouse.click(...await at(50, 100));
  await editor.locator('.annot-text').fill('Hi');
  await editor.mouse.click(...await at(50, 300));
  assert.equal(await editor.locator('.annot-text').count(), 0);

  await editor.keyboard.press('x'); // the shortcut picks the tool too
  await editor.waitForSelector('.annot-tool[data-tool="redact"].active');
  await editor.keyboard.press('Enter');
  assert.equal(await editor.locator('.annot-layer').count(), 1, 'Enter alone does not apply');
  await editor.keyboard.press('Control+Enter');
  await editor.waitForSelector('.annot-layer', { state: 'detached' });
  await waitFor(() => editor.evaluate(() => editor.cropper.ready && document.getElementById('cropper-img').naturalWidth === 100));
  const ratio = await editor.evaluate(() => { const r = document.querySelector('.crop-inner').getBoundingClientRect(); return r.width / r.height; });
  assert.ok(Math.abs(ratio - 0.25) < 0.02, `the stage is shaped like the new image: ${ratio}`);
  await editor.close();
});

test('the editor knows the page an image or screenshot came from', async () => {
  const known = new Set(ctx.pages());
  await sw.evaluate((url) => openEditor(url, { site: 'example.org', title: 'My page' }), base + 'wide.png');
  const editor = await waitFor(() => ctx.pages().find((p) => !known.has(p) && p.url().includes('resize.html')));
  await editor.waitForSelector('.cropper-container', { timeout: 10000 });
  assert.deepEqual(await editor.evaluate(() => editor.page), { host: 'example.org', title: 'My page' });
  await editor.close();
});

test('annotate: Esc drops a shape in progress but never the marks already made', async () => {
  const known = new Set(ctx.pages());
  await sw.evaluate((url) => openEditor(url), base + 'wide.png');
  const editor = await waitFor(() => ctx.pages().find((p) => !known.has(p) && p.url().includes('resize.html')));
  await editor.setViewportSize({ width: 1000, height: 700 });
  await editor.waitForSelector('.cropper-container', { timeout: 10000 });
  await editor.click('#btn-annotate');
  await editor.waitForSelector('.annot-layer');
  const box = await editor.locator('.annot-overlay').boundingBox();
  await editor.mouse.move(box.x + 5, box.y + 5);
  await editor.mouse.down();
  await editor.mouse.move(box.x + box.width - 5, box.y + box.height - 5, { steps: 3 });
  await editor.mouse.up();
  await editor.keyboard.press('Escape');
  assert.equal(await editor.locator('.annot-layer').count(), 1, 'still annotating');
  await editor.click('.annot-bar .btn-ghost'); // Cancel
  assert.equal(await editor.locator('.annot-layer').count(), 0);
  // With nothing drawn, Esc simply leaves.
  await editor.click('#btn-annotate');
  await editor.waitForSelector('.annot-layer');
  await editor.keyboard.press('Escape');
  assert.equal(await editor.locator('.annot-layer').count(), 0);
  await editor.close();
});
