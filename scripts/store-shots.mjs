// Builds the Chrome Web Store screenshots (1280×800) from the real extension UI, used on the
// demo gallery in docs/store/demo (fictional characters, no real brand or person).
// Usage: npm run store:shots  →  docs/store/<locale>/01-find.png … 05-privacy.png

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = process.cwd();
const { chromium } = createRequire(path.join(ROOT, 'package.json'))('playwright');

// One entry per slide: label, title (the accent word first), subtitle, optional bullets.
const TEXT = {
  en: [
    { label: 'ImageToolkit', accent: 'Find', title: 'images', sub: 'Every image on the page — even lazy-loaded ones, inside frames or across all your tabs.' },
    { label: 'Filters', accent: 'Filter', title: '& select', sub: 'By size, type, shape, site or tab. Download one, a selection or a ZIP.' },
    { label: 'Editor', accent: 'Crop', title: '& resize', sub: 'Presets for social media, TMDB and TheTVDB. Save as PNG, JPG or WebP.' },
    { label: 'Capture', accent: 'Capture', title: '& redact', sub: 'Full-page screenshots, then hide private details with solid colour before you share.' },
    { label: 'Privacy', accent: 'Private', title: 'by design', sub: 'Images and screenshots stay in your browser.', list: ['Processed in your browser', 'No tracking, no analytics', 'No cookies on automatic requests', 'Open source'] },
  ],
  pt_PT: [
    { label: 'ImageToolkit', accent: 'Encontrar', title: 'imagens', sub: 'Todas as imagens da página — mesmo as que carregam ao deslizar, dentro de frames ou em todos os separadores.' },
    { label: 'Filtros', accent: 'Filtrar', title: 'e selecionar', sub: 'Por tamanho, tipo, formato, site ou separador. Descarrega uma, várias ou um ZIP.' },
    { label: 'Editor', accent: 'Recortar', title: 'e redimensionar', sub: 'Tamanhos para redes sociais, TMDB e TheTVDB. Guarda em PNG, JPG ou WebP.' },
    { label: 'Captura', accent: 'Capturar', title: 'e ocultar', sub: 'Capturas da página inteira; depois esconde dados privados com cor sólida antes de partilhar.' },
    { label: 'Privacidade', accent: 'Privacidade', title: 'de raiz', sub: 'As imagens e capturas ficam no teu navegador.', list: ['Processado no teu navegador', 'Sem rastreio nem estatísticas', 'Sem cookies nos pedidos automáticos', 'Código aberto'] },
  ],
};
const REDACT_NOTE = { en: 'Private', pt_PT: 'Privado' };
const SLIDES = ['01-find', '02-filter', '03-editor', '04-capture', '05-privacy'];
const THEMES = ['dark', 'light', 'dark', 'light', 'dark'];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(fn, timeout = 15000) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await fn().catch(() => null);
    if (value) return value;
    if (Date.now() > end) throw new Error('Timed out');
    await wait(100);
  }
}

// ---------- Static server for the demo gallery ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, 'docs/store/demo', decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html');
  if (!file.startsWith(path.join(ROOT, 'docs/store/demo')) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    const index = path.join(ROOT, 'docs/store/demo/index.html');
    if (req.url === '/' && fs.existsSync(index)) { res.writeHead(200, { 'content-type': TYPES['.html'] }); res.end(fs.readFileSync(index)); return; }
    res.writeHead(404); res.end(); return;
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
// Served under an example domain (resolved to this server), so the panel shows a plausible site.
const DEMO_HOST = 'rain-editorials.example';
const DEMO = `http://${DEMO_HOST}:${server.address().port}/`;

// ---------- UI captures ----------
async function captureUi(locale) {
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'itk-store-')), {
    channel: 'chromium', headless: true, deviceScaleFactor: 2, viewport: { width: 1280, height: 800 },
    args: [`--host-resolver-rules=MAP ${DEMO_HOST} 127.0.0.1`, `--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`],
  });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  // After the install defaults are written (else they could overwrite these).
  await waitFor(() => sw.evaluate(() => chrome.storage.sync.get('settings').then((r) => !!r.settings)));
  await sw.evaluate(async (locale) => {
    const { settings } = await chrome.storage.sync.get('settings');
    await chrome.storage.sync.set({ settings: { ...settings, theme: 'dark', locale, saveAs: false, enableGoogleLens: false } });
  }, locale);
  const id = new URL(sw.url()).host;
  const shots = {};
  const newPages = (known) => ctx.pages().filter((p) => !known.has(p));

  const demo = await ctx.newPage();
  await demo.setViewportSize({ width: 1180, height: 760 });
  await demo.goto(DEMO);
  await demo.waitForFunction(() => [...document.images].every((img) => img.complete));
  await demo.bringToFront();
  shots.demo = await demo.screenshot();
  const demoTab = await sw.evaluate((url) => chrome.tabs.query({ url }).then((t) => t[0]), DEMO);

  // Panel: a real scan of the demo page.
  const panel = await ctx.newPage();
  await panel.setViewportSize({ width: 400, height: 760 });
  await panel.goto(`chrome-extension://${id}/popup.html?mode=sidepanel`);
  await panel.waitForSelector('#app[data-ready="true"]');
  await panel.evaluate(async (tab) => { state.tabId = tab.id; state.windowId = tab.windowId; setHost(tab.url, tab.title); await scan(); }, demoTab);
  await panel.waitForFunction(() => document.querySelectorAll('.gcard img').length >= 6 && [...document.querySelectorAll('.gcard img')].slice(0, 6).every((i) => i.complete && i.naturalWidth));
  await wait(400);
  shots.panel = await panel.screenshot();

  // Filters open, two images selected: the selection bar shows.
  await panel.click('#btn-filters');
  await panel.evaluate(() => {
    const type = document.getElementById('filter-type');
    type.value = 'jpg';
    type.dispatchEvent(new Event('change', { bubbles: true }));
    [...document.querySelectorAll('.gcard .gcheck')].slice(0, 2).forEach((b) => b.click());
  });
  await wait(500);
  shots.filters = await panel.screenshot();
  await panel.click('#btn-filters');

  // Editor: a portrait with the Instagram 4:5 preset.
  let known = new Set(ctx.pages());
  await sw.evaluate(({ url, tab, site }) => openEditor(url, { opener: tab, site, title: tab.title }), { url: `${DEMO}post-01.jpg`, tab: demoTab, site: DEMO_HOST });
  const editor = await waitFor(async () => newPages(known).find((p) => p.url().includes('resize.html')));
  await editor.setViewportSize({ width: 1200, height: 740 });
  await editor.waitForSelector('.cropper-container');
  await wait(400);
  await editor.click('[data-preset="1080x1350"]');
  await wait(500);
  shots.editor = await editor.screenshot();
  await editor.close();

  // Full-page capture of the demo profile, then Annotate: redact the bio, point at it.
  await demo.bringToFront();
  await demo.evaluate(() => scrollTo(0, 0));
  const target = await demo.evaluate(() => {
    const a = document.querySelector('.stats').getBoundingClientRect();
    const b = document.querySelector('.bio').getBoundingClientRect();
    return { x1: Math.min(a.left, b.left) - 6, y1: a.top - 6, x2: Math.max(a.right, b.right) + 6, y2: b.bottom + 6, dpr: devicePixelRatio };
  });
  known = new Set(ctx.pages());
  await sw.evaluate((tabId) => captureFullPage(tabId), demoTab.id);
  const viewer = await waitFor(async () => newPages(known).find((p) => p.url().includes('view.html')));
  await viewer.setViewportSize({ width: 1200, height: 740 });
  await viewer.waitForSelector('#app[data-ready="true"]');
  await wait(300);
  shots.viewer = await viewer.screenshot();
  await viewer.close();

  // Annotate the profile as it shows on screen (the clean page screenshot, opened in the
  // viewer like a capture), where the redaction reads at a glance.
  known = new Set(ctx.pages());
  await sw.evaluate(({ url, site, title }) => openViewer(url, { site, title }), { url: `data:image/png;base64,${shots.demo.toString('base64')}`, site: DEMO_HOST, title: demoTab.title });
  const shot = await waitFor(async () => newPages(known).find((p) => p.url().includes('view.html')));
  await shot.setViewportSize({ width: 1200, height: 740 });
  await shot.waitForSelector('#app[data-ready="true"]');
  await shot.click('#btn-annotate');
  await shot.waitForSelector('.annot-layer');
  await wait(600);
  const size = await shot.evaluate(() => { const c = document.querySelector('.annot-canvas'); return { w: c.width, h: c.height }; });
  const at = async (x, y) => {
    const box = await shot.locator('.annot-overlay').boundingBox();
    return [box.x + (x * target.dpr / size.w) * box.width, box.y + (y * target.dpr / size.h) * box.height];
  };
  const drag = async (x1, y1, x2, y2) => {
    await shot.mouse.move(...await at(x1, y1)); await shot.mouse.down();
    await shot.mouse.move(...await at(x2, y2), { steps: 6 }); await shot.mouse.up();
  };
  await shot.click('.annot-tool[data-tool="redact"]');
  await shot.click('.annot-color[data-color="#111111"]');
  await drag(target.x1, target.y1, target.x2, target.y2);
  // A red frame around the bar: black on a dark page would hardly show in a thumbnail.
  await shot.click('.annot-tool[data-tool="box"]');
  await shot.click('.annot-color[data-color="#ef4444"]');
  await drag(target.x1 - 8, target.y1 - 8, target.x2 + 8, target.y2 + 8);
  await shot.click('.annot-tool[data-tool="arrow"]');
  await drag(target.x2 + 150, target.y2 + 70, target.x2 + 12, (target.y1 + target.y2) / 2);
  await shot.click('.annot-tool[data-tool="text"]');
  await shot.click('.annot-size[data-size="thick"]');
  await shot.mouse.click(...await at(target.x2 + 120, target.y2 + 80));
  await shot.waitForSelector('.annot-text');
  await shot.keyboard.type(REDACT_NOTE[locale]);
  await shot.keyboard.press('Enter'); // places the text
  await wait(300);
  shots.annotate = await shot.screenshot();
  await shot.close();

  // Settings.
  await panel.bringToFront();
  await panel.evaluate(() => document.querySelector('.tab[data-tab="settings"]').click());
  await wait(400);
  shots.settings = await panel.screenshot();

  await ctx.close();
  return shots;
}

// ---------- Slides ----------
const png = (buffer) => `data:image/png;base64,${buffer.toString('base64')}`;

function slideHtml(text, theme, layout, shots) {
  const dark = theme === 'dark';
  const frames = {
    pair: () => `<img class="frame" style="left:46px;top:150px;width:560px" src="${png(shots.demo)}"><img class="frame" style="left:470px;top:110px;width:300px" src="${png(shots.panel)}">`,
    capture: () => `<img class="frame" style="left:40px;top:96px;width:560px" src="${png(shots.viewer)}"><img class="frame" style="left:250px;top:330px;width:540px" src="${png(shots.annotate)}">`,
    panel: () => `<img class="frame" style="left:150px;top:56px;width:376px" src="${png(shots.main)}">`,
    wide: () => `<img class="frame" style="left:46px;top:150px;width:760px" src="${png(shots.main)}">`,
  }[layout]();
  const list = text.list ? `<ul>${text.list.map((item) => `<li>${item}</li>`).join('')}</ul>` : '';
  const copyLeft = layout === 'panel' ? 620 : 840;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box;margin:0}
    body{width:1280px;height:800px;overflow:hidden;font-family:Inter,"Segoe UI",system-ui,sans-serif;
      background:${dark ? 'radial-gradient(1000px 700px at 85% 10%,#3b1f6b 0%,transparent 60%),radial-gradient(900px 600px at 10% 100%,#10324a 0%,transparent 60%),#0a0a12' : 'radial-gradient(900px 700px at 90% 0%,#e9dcff 0%,transparent 60%),radial-gradient(800px 600px at 0% 100%,#ffe4f1 0%,transparent 55%),#f6f5fb'};
      color:${dark ? '#fff' : '#1b1b29'}}
    .frame{position:absolute;border-radius:22px;border:1px solid ${dark ? 'rgba(255,255,255,.35)' : 'rgba(20,20,40,.12)'};box-shadow:0 30px 70px -20px rgba(0,0,0,${dark ? '.75' : '.35'})}
    .copy{position:absolute;left:${copyLeft}px;right:${layout === 'panel' ? 120 : 44}px;top:50%;transform:translateY(-50%)}
    .pill{display:inline-block;padding:10px 26px;border-radius:999px;background:#fff;color:#8b5cf6;font-weight:700;font-size:16px;box-shadow:0 6px 20px rgba(0,0,0,.12)}
    h1{margin-top:34px;font-size:58px;line-height:1.05;font-weight:800;letter-spacing:-.02em}
    h1 em{font-style:normal;color:#e93aa8}
    p{margin-top:20px;font-size:21px;line-height:1.45;color:${dark ? 'rgba(255,255,255,.82)' : '#4a4a62'}}
    ul{margin-top:26px;padding:24px 28px;list-style:none;border-radius:22px;background:#fff;color:#22223a;box-shadow:0 14px 40px rgba(0,0,0,.18)}
    li{display:flex;align-items:center;gap:14px;font-size:19px;font-weight:700;padding:6px 0}
    li::before{content:"";width:14px;height:14px;border-radius:50%;background:#22c55e;flex:none}
  </style></head><body>${frames}<div class="copy"><span class="pill">${text.label}</span><h1><em>${text.accent}</em> ${text.title}</h1><p>${text.sub}</p>${list}</div></body></html>`;
}

const browser = await chromium.launch({ channel: 'chromium', headless: true });
try {
  for (const locale of Object.keys(TEXT)) {
    const shots = await captureUi(locale);
    const outDir = path.join(ROOT, 'docs/store', locale);
    fs.mkdirSync(outDir, { recursive: true });
    const plan = [
      ['pair', shots],
      ['panel', { main: shots.filters }],
      ['wide', { main: shots.editor }],
      ['capture', shots],
      ['panel', { main: shots.settings }],
    ];
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    for (const [i, [layout, images]] of plan.entries()) {
      await page.setContent(slideHtml(TEXT[locale][i], THEMES[i], layout, images));
      await page.evaluate(() => Promise.all([...document.images].map((img) => img.decode())));
      await page.screenshot({ path: path.join(outDir, `${SLIDES[i]}.png`) });
    }
    await page.close();
    // Raw UI captures, kept for reference only (git-ignored; the slides are what is published).
    for (const [name, buffer] of Object.entries(shots)) fs.writeFileSync(path.join(outDir, `ui-${name}.png`), buffer);
    console.log(`✓ docs/store/${locale}: ${SLIDES.length} slides`);
  }
} finally {
  await browser.close();
  server.close();
}
