// Builds the Chrome Web Store screenshots (1280×800) from the real extension UI, used on the
// demo gallery in docs/store/demo (fictional characters, no real brand or person).
// Usage: npm run store:shots [-- locale…]  →  docs/store/<locale>/01-find.png … 05-privacy.png
// and docs/store/promo (small tile and marquee, English only: the store does not localize them).

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = process.cwd();
const { chromium } = createRequire(path.join(ROOT, 'package.json'))('playwright');

// One entry per locale: five slides as [pill label, title (*accent*), subtitle], the bullets of
// the last slide, and the note written next to the redaction.
const TEXT = {
  en: {
    slides: [
      ['ImageToolkit', '*Find* images', 'Every image on the page — even lazy-loaded ones, inside frames or across all your tabs.'],
      ['Filters', '*Filter* & select', 'By size, type, shape, site or tab. Download one, a selection or a ZIP.'],
      ['Editor', '*Crop* & resize', 'Presets for social media, TMDB and TheTVDB. Save as PNG, JPG or WebP.'],
      ['Capture', '*Capture* & redact', 'Full-page screenshots, then hide private details with solid colour before you share.'],
      ['Privacy', '*Private* by design', 'Images and screenshots stay in your browser.'],
    ],
    list: ['Processed in your browser', 'No tracking, no analytics', 'No cookies on automatic requests', 'Open source'],
    note: 'Private',
  },
  pt_PT: {
    slides: [
      ['ImageToolkit', '*Encontrar* imagens', 'Todas as imagens da página — mesmo as que carregam ao deslizar, dentro de frames ou em todos os separadores.'],
      ['Filtros', '*Filtrar* e selecionar', 'Por tamanho, tipo, formato, site ou separador. Transfere uma, várias ou um ZIP.'],
      ['Editor', '*Recortar* e redimensionar', 'Tamanhos para redes sociais, TMDB e TheTVDB. Guarda em PNG, JPG ou WebP.'],
      ['Captura', '*Capturar* e ocultar', 'Capturas da página inteira; depois esconde dados privados com cor sólida antes de partilhar.'],
      ['Privacidade', '*Privacidade* de raiz', 'As imagens e capturas ficam no teu navegador.'],
    ],
    list: ['Processado no teu navegador', 'Sem rastreio nem estatísticas', 'Sem cookies nos pedidos automáticos', 'Código aberto'],
    note: 'Privado',
  },
  pt_BR: {
    slides: [
      ['ImageToolkit', '*Encontre* imagens', 'Todas as imagens da página — até as de carregamento lento, dentro de frames ou em todas as abas.'],
      ['Filtros', '*Filtre* e selecione', 'Por tamanho, tipo, formato, site ou aba. Baixe uma, várias ou um ZIP.'],
      ['Editor', '*Recorte* e redimensione', 'Tamanhos para redes sociais, TMDB e TheTVDB. Salve em PNG, JPG ou WebP.'],
      ['Captura', '*Capture* e oculte', 'Capturas da página inteira; depois esconda dados privados com cor sólida antes de compartilhar.'],
      ['Privacidade', '*Privacidade* desde o início', 'As imagens e capturas ficam no seu navegador.'],
    ],
    list: ['Processado no seu navegador', 'Sem rastreamento nem estatísticas', 'Sem cookies nas solicitações automáticas', 'Código aberto'],
    note: 'Privado',
  },
  es: {
    slides: [
      ['ImageToolkit', '*Encuentra* imágenes', 'Todas las imágenes de la página: incluso las de carga diferida, dentro de marcos o en todas tus pestañas.'],
      ['Filtros', '*Filtra* y selecciona', 'Por tamaño, tipo, forma, sitio o pestaña. Descarga una, varias o un ZIP.'],
      ['Editor', '*Recorta* y redimensiona', 'Tamaños para redes sociales, TMDB y TheTVDB. Guarda en PNG, JPG o WebP.'],
      ['Captura', '*Captura* y oculta', 'Capturas de página completa; después oculta los datos privados con color sólido antes de compartir.'],
      ['Privacidad', '*Privacidad* por diseño', 'Las imágenes y capturas se quedan en tu navegador.'],
    ],
    list: ['Procesado en tu navegador', 'Sin rastreo ni estadísticas', 'Sin cookies en las peticiones automáticas', 'Código abierto'],
    note: 'Privado',
  },
  fr: {
    slides: [
      ['ImageToolkit', '*Trouvez* les images', 'Toutes les images de la page, même celles chargées à la demande, dans les cadres ou dans tous vos onglets.'],
      ['Filtres', '*Filtrez* et sélectionnez', 'Par taille, type, forme, site ou onglet. Téléchargez-en une, une sélection ou un ZIP.'],
      ['Éditeur', '*Recadrez* et redimensionnez', 'Formats pour les réseaux sociaux, TMDB et TheTVDB. Enregistrez en PNG, JPG ou WebP.'],
      ['Capture', '*Capturez* et masquez', 'Captures de page entière, puis masquez les données privées d’une couleur unie avant de partager.'],
      ['Confidentialité', '*Confidentialité* dès la conception', 'Les images et captures restent dans votre navigateur.'],
    ],
    list: ['Traitement dans votre navigateur', 'Aucun pistage, aucune statistique', 'Aucun cookie sur les requêtes automatiques', 'Open source'],
    note: 'Privé',
  },
  it: {
    slides: [
      ['ImageToolkit', '*Trova* le immagini', 'Tutte le immagini della pagina, anche quelle caricate in differita, nei frame o in tutte le schede.'],
      ['Filtri', '*Filtra* e seleziona', 'Per dimensione, tipo, forma, sito o scheda. Scarica una, una selezione o uno ZIP.'],
      ['Editor', '*Ritaglia* e ridimensiona', 'Formati per i social, TMDB e TheTVDB. Salva in PNG, JPG o WebP.'],
      ['Cattura', '*Cattura* e oscura', 'Screenshot della pagina intera, poi nascondi i dati privati con un colore pieno prima di condividere.'],
      ['Privacy', '*Privacy* fin dalla progettazione', 'Immagini e screenshot restano nel tuo browser.'],
    ],
    list: ['Elaborazione nel browser', 'Nessun tracciamento né statistiche', 'Nessun cookie nelle richieste automatiche', 'Open source'],
    note: 'Privato',
  },
  de: {
    slides: [
      ['ImageToolkit', 'Bilder *finden*', 'Jedes Bild der Seite – auch nachgeladene, in Frames oder in allen Tabs.'],
      ['Filter', '*Filtern* & auswählen', 'Nach Größe, Typ, Form, Website oder Tab. Eines, eine Auswahl oder als ZIP herunterladen.'],
      ['Editor', '*Zuschneiden* & skalieren', 'Vorlagen für Social Media, TMDB und TheTVDB. Speichern als PNG, JPG oder WebP.'],
      ['Aufnahme', '*Aufnehmen* & schwärzen', 'Screenshots der ganzen Seite – private Daten vor dem Teilen mit einer Volltonfarbe abdecken.'],
      ['Datenschutz', '*Privat* von Grund auf', 'Bilder und Screenshots bleiben im Browser.'],
    ],
    list: ['Verarbeitung im Browser', 'Kein Tracking, keine Statistiken', 'Keine Cookies bei automatischen Anfragen', 'Open Source'],
    note: 'Privat',
  },
  nl: {
    slides: [
      ['ImageToolkit', '*Vind* afbeeldingen', 'Elke afbeelding op de pagina, ook die later laden, in frames of in al je tabbladen.'],
      ['Filters', '*Filter* en selecteer', 'Op grootte, type, vorm, site of tabblad. Download er één, een selectie of een ZIP.'],
      ['Editor', '*Bijsnijden* en schalen', 'Formaten voor sociale media, TMDB en TheTVDB. Opslaan als PNG, JPG of WebP.'],
      ['Vastleggen', '*Vastleggen* en afschermen', 'Schermafbeeldingen van de hele pagina; scherm daarna privégegevens af met een effen kleur voordat je deelt.'],
      ['Privacy', '*Privacy* voorop', 'Afbeeldingen en schermafbeeldingen blijven in je browser.'],
    ],
    list: ['Verwerkt in je browser', 'Geen tracking, geen statistieken', 'Geen cookies bij automatische verzoeken', 'Open source'],
    note: 'Privé',
  },
  pl: {
    slides: [
      ['ImageToolkit', '*Znajdź* obrazy', 'Każdy obraz na stronie — także ładowane później, w ramkach lub we wszystkich kartach.'],
      ['Filtry', '*Filtruj* i zaznaczaj', 'Według rozmiaru, typu, kształtu, witryny lub karty. Pobierz jeden, kilka lub ZIP.'],
      ['Edytor', '*Kadruj* i skaluj', 'Rozmiary dla mediów społecznościowych, TMDB i TheTVDB. Zapisz jako PNG, JPG lub WebP.'],
      ['Zrzut ekranu', '*Rób zrzuty* i zakrywaj', 'Zrzuty całej strony, a potem zakryj prywatne dane jednolitym kolorem przed udostępnieniem.'],
      ['Prywatność', '*Prywatność* od podstaw', 'Obrazy i zrzuty zostają w Twojej przeglądarce.'],
    ],
    list: ['Przetwarzanie w przeglądarce', 'Bez śledzenia i statystyk', 'Bez ciasteczek w automatycznych żądaniach', 'Otwarty kod źródłowy'],
    note: 'Prywatne',
  },
  tr: {
    slides: [
      ['ImageToolkit', 'Görselleri *bul*', 'Sayfadaki tüm görseller: sonradan yüklenenler, çerçevelerdekiler ve tüm sekmelerdekiler dahil.'],
      ['Filtreler', '*Filtrele* ve seç', 'Boyuta, türe, şekle, siteye veya sekmeye göre. Birini, bir seçimi veya ZIP olarak indir.'],
      ['Düzenleyici', '*Kırp* ve boyutlandır', 'Sosyal medya, TMDB ve TheTVDB için hazır boyutlar. PNG, JPG veya WebP olarak kaydet.'],
      ['Yakalama', '*Yakala* ve gizle', 'Tam sayfa ekran görüntüsü al, paylaşmadan önce özel bilgileri düz renkle gizle.'],
      ['Gizlilik', '*Gizlilik* odaklı', 'Görseller ve ekran görüntüleri tarayıcında kalır.'],
    ],
    list: ['Tarayıcıda işlenir', 'İzleme yok, istatistik yok', 'Otomatik isteklerde çerez yok', 'Açık kaynak'],
    note: 'Gizli',
  },
  ru: {
    slides: [
      ['ImageToolkit', '*Находите* изображения', 'Все изображения на странице — даже с отложенной загрузкой, во фреймах и во всех вкладках.'],
      ['Фильтры', '*Фильтруйте* и выбирайте', 'По размеру, типу, форме, сайту или вкладке. Скачайте одно, несколько или ZIP.'],
      ['Редактор', '*Обрезайте* и масштабируйте', 'Размеры для соцсетей, TMDB и TheTVDB. Сохранение в PNG, JPG или WebP.'],
      ['Снимок', '*Снимайте* и скрывайте', 'Снимки всей страницы, а затем скрытие личных данных сплошным цветом перед отправкой.'],
      ['Приватность', '*Приватность* по умолчанию', 'Изображения и снимки остаются в вашем браузере.'],
    ],
    list: ['Обработка в браузере', 'Без отслеживания и аналитики', 'Без cookie в автоматических запросах', 'Открытый исходный код'],
    note: 'Личное',
  },
  uk: {
    slides: [
      ['ImageToolkit', '*Знаходьте* зображення', 'Усі зображення на сторінці — навіть із відкладеним завантаженням, у фреймах і в усіх вкладках.'],
      ['Фільтри', '*Фільтруйте* й вибирайте', 'За розміром, типом, формою, сайтом або вкладкою. Завантажте одне, кілька або ZIP.'],
      ['Редактор', '*Обрізайте* й масштабуйте', 'Розміри для соцмереж, TMDB і TheTVDB. Збереження в PNG, JPG або WebP.'],
      ['Знімок', '*Знімайте* й приховуйте', 'Знімки всієї сторінки, а потім приховування особистих даних суцільним кольором перед надсиланням.'],
      ['Приватність', '*Приватність* за замовчуванням', 'Зображення та знімки залишаються у вашому браузері.'],
    ],
    list: ['Обробка в браузері', 'Без стеження й аналітики', 'Без cookie в автоматичних запитах', 'Відкритий код'],
    note: 'Приватне',
  },
  vi: {
    slides: [
      ['ImageToolkit', '*Tìm* hình ảnh', 'Mọi hình ảnh trên trang — kể cả ảnh tải chậm, trong khung hoặc trên mọi thẻ.'],
      ['Bộ lọc', '*Lọc* và chọn', 'Theo kích thước, loại, hình dạng, trang web hoặc thẻ. Tải một ảnh, nhiều ảnh hoặc tệp ZIP.'],
      ['Trình chỉnh sửa', '*Cắt* và đổi cỡ', 'Kích thước cho mạng xã hội, TMDB và TheTVDB. Lưu dưới dạng PNG, JPG hoặc WebP.'],
      ['Chụp', '*Chụp* và che', 'Chụp toàn trang, rồi che thông tin riêng tư bằng màu đặc trước khi chia sẻ.'],
      ['Quyền riêng tư', '*Quyền riêng tư* là trên hết', 'Hình ảnh và ảnh chụp ở lại trong trình duyệt của bạn.'],
    ],
    list: ['Xử lý trong trình duyệt', 'Không theo dõi, không thống kê', 'Không cookie trong yêu cầu tự động', 'Mã nguồn mở'],
    note: 'Riêng tư',
  },
  ja: {
    slides: [
      ['ImageToolkit', '画像を*見つける*', '遅延読み込みの画像も、フレーム内やすべてのタブの画像も、ページ上の画像をすべて一覧に。'],
      ['フィルター', '*絞り込んで*選択', 'サイズ、種類、形、サイト、タブで絞り込み。1枚ずつ、まとめて、またはZIPでダウンロード。'],
      ['エディター', '*切り抜き*とリサイズ', 'SNS、TMDB、TheTVDB向けのプリセット。PNG、JPG、WebPで保存。'],
      ['キャプチャ', '*キャプチャ*して隠す', 'ページ全体をキャプチャし、共有の前に個人情報を塗りつぶして隠せます。'],
      ['プライバシー', '*プライバシー*第一', '画像もキャプチャもブラウザの中で完結します。'],
    ],
    list: ['ブラウザ内で処理', 'トラッキング・解析なし', '自動リクエストでCookieを送らない', 'オープンソース'],
    note: '非公開',
  },
  ko: {
    slides: [
      ['ImageToolkit', '이미지 *찾기*', '지연 로딩 이미지, 프레임 속 이미지, 모든 탭의 이미지까지 페이지의 모든 이미지를 찾습니다.'],
      ['필터', '*필터링*하고 선택', '크기, 형식, 모양, 사이트, 탭별로 필터링. 하나씩, 여러 개 또는 ZIP으로 다운로드.'],
      ['편집기', '*자르기*와 크기 조정', 'SNS, TMDB, TheTVDB용 프리셋. PNG, JPG, WebP로 저장.'],
      ['캡처', '*캡처*하고 가리기', '전체 페이지를 캡처하고, 공유하기 전에 개인 정보를 단색으로 가리세요.'],
      ['개인정보', '*개인정보 보호* 중심 설계', '이미지와 캡처는 브라우저 안에만 머뭅니다.'],
    ],
    list: ['브라우저에서 처리', '추적·분석 없음', '자동 요청에 쿠키 없음', '오픈 소스'],
    note: '비공개',
  },
  zh_CN: {
    slides: [
      ['ImageToolkit', '*查找*图片', '页面上的所有图片——包括延迟加载的、框架内的，以及所有标签页中的。'],
      ['筛选', '*筛选*与选择', '按尺寸、类型、形状、网站或标签页筛选。下载单张、多张或 ZIP。'],
      ['编辑器', '*裁剪*与调整大小', '社交媒体、TMDB 和 TheTVDB 预设。保存为 PNG、JPG 或 WebP。'],
      ['截图', '*截图*并遮盖', '截取整个页面，分享前用纯色遮盖隐私信息。'],
      ['隐私', '*隐私*优先', '图片和截图都留在你的浏览器中。'],
    ],
    list: ['在浏览器中处理', '无跟踪、无统计', '自动请求不带 Cookie', '开源'],
    note: '隐私',
  },
  zh_TW: {
    slides: [
      ['ImageToolkit', '*尋找*圖片', '頁面上的所有圖片——包括延遲載入的、框架內的，以及所有分頁中的。'],
      ['篩選', '*篩選*與選取', '依尺寸、類型、形狀、網站或分頁篩選。下載單張、多張或 ZIP。'],
      ['編輯器', '*裁切*與調整大小', '社群媒體、TMDB 和 TheTVDB 預設。儲存為 PNG、JPG 或 WebP。'],
      ['擷取', '*擷取*並遮蔽', '擷取整個頁面，分享前以純色遮蔽隱私資訊。'],
      ['隱私', '*隱私*優先', '圖片和擷取畫面都留在你的瀏覽器中。'],
    ],
    list: ['在瀏覽器中處理', '無追蹤、無統計', '自動請求不帶 Cookie', '開放原始碼'],
    note: '隱私',
  },
  ar: {
    slides: [
      ['ImageToolkit', '*اعثر* على الصور', 'كل صور الصفحة — حتى المحمّلة لاحقًا، وداخل الإطارات، وفي جميع علامات التبويب.'],
      ['التصفية', '*صفِّ* واختر', 'حسب الحجم أو النوع أو الشكل أو الموقع أو علامة التبويب. نزّل صورة أو مجموعة أو ملف ZIP.'],
      ['المحرر', '*اقتصّ* وغيّر الحجم', 'مقاسات جاهزة لوسائل التواصل وTMDB وTheTVDB. احفظ بصيغة PNG أو JPG أو WebP.'],
      ['الالتقاط', '*التقط* وأخفِ', 'لقطات للصفحة كاملة، ثم أخفِ البيانات الخاصة بلون صلب قبل المشاركة.'],
      ['الخصوصية', '*الخصوصية* أولًا', 'تبقى الصور واللقطات داخل متصفحك.'],
    ],
    list: ['المعالجة داخل متصفحك', 'لا تتبّع ولا إحصاءات', 'لا ملفات تعريف ارتباط في الطلبات التلقائية', 'مفتوح المصدر'],
    note: 'خاص',
  },
};
// Only these sets are generated unless locales are named: node scripts/store-shots.mjs ja ko.
const LOCALES = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(TEXT);
const HTML_LANG = (locale) => locale.replace('_', '-');
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
// Headless Chromium can, rarely, tile a page into a screenshot right after it is resized: a capture
// counts only when the next one is identical.
// Every other page gets its size at 2× through its own emulation (Playwright's viewport would be
// 1× in a context without one).
// The sessions are kept: an override ends with its session.
const emulations = [];
async function at2x(page, width, height) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false });
  emulations.push(cdp);
}

async function stableShot(page) {
  let last = await page.screenshot();
  for (let i = 0; i < 8; i++) {
    await wait(300);
    const next = await page.screenshot();
    if (next.equals(last)) return next;
    last = next;
  }
  throw new Error('The page never settled for a screenshot');
}

async function captureUi(locale) {
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'itk-store-')), {
    channel: 'chromium', headless: true, viewport: null,
    // A real 2× display and a window the size of the demo page: the extension's own screenshots
    // (full page) see the window itself, not Playwright's emulated viewport, which they would
    // rescale (and misalign the slices of).
    args: ['--force-device-scale-factor=2', '--screen-info={2600x1800}', '--window-size=1180,899', `--host-resolver-rules=MAP ${DEMO_HOST} 127.0.0.1`, `--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`],
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
  await demo.goto(DEMO);
  // The window's own frame differs between Chromium builds: sized until the page is 1180×760.
  for (let i = 0; i < 5; i++) {
    const [w, h] = await demo.evaluate(() => [innerWidth, innerHeight]);
    if (w === 1180 && h === 760) break;
    await sw.evaluate(async ([dw, dh]) => {
      const win = await chrome.windows.getCurrent();
      await chrome.windows.update(win.id, { width: win.width + dw, height: win.height + dh });
    }, [1180 - w, 760 - h]);
    await wait(300);
  }
  await demo.waitForFunction(() => [...document.images].every((img) => img.complete));
  await demo.bringToFront();
  await wait(500);
  shots.demo = await stableShot(demo);
  const demoTab = await sw.evaluate((url) => chrome.tabs.query({ url }).then((t) => t[0]), DEMO);

  // Panel: a real scan of the demo page.
  const panel = await ctx.newPage();
  await at2x(panel, 400, 760);
  await panel.goto(`chrome-extension://${id}/popup.html?mode=sidepanel`);
  await panel.waitForSelector('#app[data-ready="true"]');
  await panel.evaluate(async (tab) => { state.tabId = tab.id; state.windowId = tab.windowId; setHost(tab.url, tab.title); await scan(); }, demoTab);
  await panel.waitForFunction(() => document.querySelectorAll('.gcard img').length >= 6 && [...document.querySelectorAll('.gcard img')].slice(0, 6).every((i) => i.complete && i.naturalWidth));
  await wait(400);
  await at2x(panel, 400, 760); // re-applied after the page loaded
  await wait(300);
  await panel.waitForFunction(() => [...document.querySelectorAll('.gcard img')].slice(0, 6).every((i) => i.complete && i.naturalWidth));
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
  await at2x(panel, 400, 760); // re-applied: a click on the panel can reset it
  await wait(200);
  shots.filters = await panel.screenshot();
  await panel.click('#btn-filters');

  // Editor: a portrait with the Instagram 4:5 preset.
  let known = new Set(ctx.pages());
  await sw.evaluate(({ url, tab, site }) => openEditor(url, { opener: tab, site, title: tab.title }), { url: `${DEMO}post-10.jpg`, tab: demoTab, site: DEMO_HOST });
  const editor = await waitFor(async () => newPages(known).find((p) => p.url().includes('resize.html')));
  await at2x(editor, 1200, 740);
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
  await at2x(viewer, 1200, 740);
  await viewer.waitForSelector('#app[data-ready="true"]');
  await wait(300);
  shots.viewer = await viewer.screenshot();
  // The capture itself, whole: the slide shows the full page top to bottom.
  const full = await viewer.evaluate(async () => {
    const img = document.getElementById('shot');
    const blob = await (await fetch(img.src)).blob();
    const data = await new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(blob); });
    return { data: data.split(',')[1] };
  });
  shots.fullpage = Buffer.from(full.data, 'base64');
  await viewer.close();

  // Annotate the profile as it shows on screen (the clean page screenshot, opened in the
  // viewer like a capture), where the redaction reads at a glance.
  known = new Set(ctx.pages());
  await sw.evaluate(({ url, site, title }) => openViewer(url, { site, title }), { url: `data:image/png;base64,${shots.demo.toString('base64')}`, site: DEMO_HOST, title: demoTab.title });
  const shot = await waitFor(async () => newPages(known).find((p) => p.url().includes('view.html')));
  await at2x(shot, 1200, 740);
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
  // Arrow and note to the right of the bar, where the page is empty (not over the avatars).
  const mid = (target.y1 + target.y2) / 2;
  await drag(target.x2 + 170, mid, target.x2 + 16, mid);
  await shot.click('.annot-tool[data-tool="text"]');
  await shot.click('.annot-size[data-size="thick"]');
  // Text starts at the click, or ends there in a right-to-left UI.
  await shot.mouse.click(...await at(target.x2 + (locale === 'ar' ? 300 : 182), mid - 14));
  await shot.waitForSelector('.annot-text');
  // The field takes the focus on the next frame: typing earlier loses the first letters.
  await shot.waitForFunction(() => document.activeElement?.classList.contains('annot-text'));
  await shot.keyboard.type(TEXT[locale].note);
  await shot.keyboard.press('Enter'); // places the text
  await wait(300);
  shots.annotate = await shot.screenshot();
  await shot.close();

  // Settings.
  await panel.bringToFront();
  await panel.evaluate(() => document.querySelector('.tab[data-tab="settings"]').click());
  // In the light theme: the other slides already show the dark one.
  await panel.click('#setting-theme .seg[data-value="light"]');
  await panel.evaluate(() => document.querySelectorAll('*').forEach((el) => { if (el.scrollTop) el.scrollTop = 0; }));
  await wait(400);
  await at2x(panel, 400, 760); // re-applied: a click on the panel can reset it
  await wait(200);
  shots.settings = await panel.screenshot();
  // Reference only (not on a slide): the Tools tab, to review every part of the UI per language.
  await panel.evaluate(() => document.querySelector('.tab[data-tab="tools"]').click());
  await wait(300);
  await at2x(panel, 400, 760); // re-applied: a click on the panel can reset it
  await wait(200);
  shots.tools = await panel.screenshot();

  await ctx.close();
  return shots;
}

// ---------- Slides ----------
const png = (buffer) => `data:image/png;base64,${buffer.toString('base64')}`;

function slideHtml(locale, index, theme, layout, shots) {
  const [label, title, sub] = TEXT[locale].slides[index];
  const rtl = locale === 'ar';
  // Titles without spaces (Japanese, Chinese) or short ones (Korean) stay on one line and shrink.
  const cjk = ['ja', 'ko', 'zh_CN', 'zh_TW'].includes(locale) ? ` class="cjk ${locale}"` : '';
  const dark = theme === 'dark';
  const frames = {
    pair: () => `<img class="frame" style="left:46px;top:150px;width:560px" src="${png(shots.demo)}"><img class="frame" style="left:470px;top:110px;width:300px" src="${png(shots.panel)}">`,
    // The full-page capture at a third of its size (faces stay legible), fading out where the
    // page goes on, behind the editor redacting it.
    capture: () => `<div class="frame page" style="left:40px;top:40px;width:400px;height:720px"><img src="${png(shots.fullpage)}"><i></i></div><img class="frame" style="left:236px;top:262px;width:584px" src="${png(shots.annotate)}">`,
    panel: () => `<img class="frame" style="left:150px;top:56px;width:376px" src="${png(shots.main)}">`,
    wide: () => `<img class="frame" style="left:46px;top:150px;width:760px" src="${png(shots.main)}">`,
  }[layout]();
  const list = index === 4 ? `<ul>${TEXT[locale].list.map((item) => `<li>${item}</li>`).join('')}</ul>` : '';
  const heading = title.replace(/\*(.+?)\*/, '<em>$1</em>');
  const copyLeft = layout === 'panel' ? 620 : 840;
  return `<!doctype html><html lang="${HTML_LANG(locale)}"><head><meta charset="utf-8"><style>
    *{box-sizing:border-box;margin:0}
    body{width:1280px;height:800px;overflow:hidden;font-family:Inter,"Segoe UI",system-ui,sans-serif;
      background:${dark ? 'radial-gradient(1000px 700px at 85% 10%,#3b1f6b 0%,transparent 60%),radial-gradient(900px 600px at 10% 100%,#10324a 0%,transparent 60%),#0a0a12' : 'radial-gradient(900px 700px at 90% 0%,#e9dcff 0%,transparent 60%),radial-gradient(800px 600px at 0% 100%,#ffe4f1 0%,transparent 55%),#f6f5fb'};
      color:${dark ? '#fff' : '#1b1b29'}}
    .frame{position:absolute;border-radius:22px;border:1px solid ${dark ? 'rgba(255,255,255,.35)' : 'rgba(20,20,40,.12)'};box-shadow:0 30px 70px -20px rgba(0,0,0,${dark ? '.75' : '.35'})}
    .copy{position:absolute;left:${copyLeft}px;right:${layout === 'panel' ? 120 : 44}px;top:50%;transform:translateY(-50%)}
    .cjk h1{white-space:nowrap}
    .ko p,.ko li{word-break:keep-all}
    .page{overflow:hidden;background:#0b0b10}
    .page img{display:block;width:100%}
    .page i{position:absolute;left:0;right:0;bottom:0;height:160px;background:linear-gradient(transparent,#0b0b10)}
    .copy[dir="rtl"] li{flex-direction:row}
    .pill{display:inline-block;padding:10px 26px;border-radius:999px;background:#fff;color:#8b5cf6;font-weight:700;font-size:16px;box-shadow:0 6px 20px rgba(0,0,0,.12)}
    h1{margin-top:34px;font-size:58px;line-height:1.05;font-weight:800;letter-spacing:-.02em}
    h1 em{font-style:normal;color:#e93aa8}
    p{margin-top:20px;font-size:21px;line-height:1.45;color:${dark ? 'rgba(255,255,255,.82)' : '#4a4a62'}}
    ul{margin-top:26px;padding:24px 28px;list-style:none;border-radius:22px;background:#fff;color:#22223a;box-shadow:0 14px 40px rgba(0,0,0,.18)}
    li{display:flex;align-items:center;gap:14px;font-size:19px;font-weight:700;padding:6px 0}
    li::before{content:"";width:14px;height:14px;border-radius:50%;background:#22c55e;flex:none}
  </style></head><body${cjk}>${frames}<div class="copy"${rtl ? ' dir="rtl"' : ''}><span class="pill">${label}</span><h1>${heading}</h1><p>${sub}</p>${list}</div></body></html>`;
}

// Long words (German, French, Russian…) shrink the title until it fits its column, and the
// whole text block until it fits the slide.
function fitCopy() {
  const copy = document.querySelector('.copy');
  const h1 = copy.querySelector('h1');
  const p = copy.querySelector('p');
  for (let size = 58; size > 34 && (h1.scrollWidth > h1.clientWidth || copy.offsetHeight > 720); size -= 2) h1.style.fontSize = `${size - 2}px`;
  for (let size = 21; size > 16 && copy.offsetHeight > 720; size -= 1) p.style.fontSize = `${size - 1}px`;
}

// ---------- Promo tiles (one set for every language: the store does not localize them) ----------
const jpg = (name) => `data:image/jpeg;base64,${fs.readFileSync(path.join(ROOT, 'docs/store/demo', name)).toString('base64')}`;
const svg = (file) => `data:image/svg+xml;base64,${fs.readFileSync(path.join(ROOT, file)).toString('base64')}`;
const TILE_CSS = `*{box-sizing:border-box;margin:0}
  body{overflow:hidden;font-family:Inter,"Segoe UI",system-ui,sans-serif;color:#fff;
    background:radial-gradient(700px 500px at 90% 0%,#3b1f6b 0%,transparent 65%),radial-gradient(600px 400px at 0% 100%,#10324a 0%,transparent 60%),#0a0a12}
  .card{position:absolute;border-radius:14px;border:1px solid rgba(255,255,255,.3);object-fit:cover;box-shadow:0 20px 40px -12px rgba(0,0,0,.8)}
  .frame{position:absolute;border-radius:16px;border:1px solid rgba(255,255,255,.35);box-shadow:0 30px 60px -20px rgba(0,0,0,.8)}
  em{font-style:normal;color:#e93aa8}`;

async function promoTiles(shots) {
  const outDir = path.join(ROOT, 'docs/store/promo');
  fs.mkdirSync(outDir, { recursive: true });
  const tiles = {
    'small-440x280': [440, 280, `
      <img src="${svg('docs/brand/lockup-dark.svg')}" style="position:absolute;left:24px;top:30px;width:190px">
      <div style="position:absolute;left:26px;top:104px;width:190px;font-size:23px;font-weight:800;line-height:1.15;letter-spacing:-.01em">Find, save, <em>edit</em> &amp; capture images</div>
      <img class="card" src="${jpg('post-16.jpg')}" style="left:226px;top:46px;width:124px;height:155px;transform:rotate(-8deg)">
      <img class="card" src="${jpg('post-17.jpg')}" style="left:300px;top:70px;width:124px;height:155px;transform:rotate(7deg)">
      <img class="card" src="${jpg('post-10.jpg')}" style="left:256px;top:96px;width:132px;height:165px">`],
    'marquee-1400x560': [1400, 560, `
      <img src="${svg('docs/brand/lockup-dark.svg')}" style="position:absolute;left:80px;top:150px;width:320px">
      <div style="position:absolute;left:84px;top:262px;width:480px;font-size:46px;font-weight:800;line-height:1.08;letter-spacing:-.02em"><em>Every image</em> on the page, saved your way</div>
      <div style="position:absolute;left:86px;top:388px;width:470px;font-size:19px;line-height:1.45;color:rgba(255,255,255,.8)">Find, convert, crop, capture and redact — all in your browser.</div>
      <img class="frame" src="${png(shots.demo)}" style="left:640px;top:70px;width:640px">
      <img class="frame" src="${png(shots.panel)}" style="left:1060px;top:40px;width:260px">`],
  };
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const [name, [width, height, body]] of Object.entries(tiles)) {
    await page.setViewportSize({ width, height });
    await page.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${TILE_CSS}</style></head><body>${body}</body></html>`);
    await page.evaluate(() => Promise.all([...document.images].map((img) => img.decode())));
    await page.screenshot({ path: path.join(outDir, `${name}.png`) });
  }
  await page.close();
  console.log('✓ docs/store/promo: small tile and marquee');
}

const browser = await chromium.launch({ channel: 'chromium', headless: true });
try {
  for (const locale of LOCALES) {
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
      await page.setContent(slideHtml(locale, i, THEMES[i], layout, images));
      await page.evaluate(() => Promise.all([...document.images].map((img) => img.decode())));
      await page.evaluate(fitCopy);
      await page.screenshot({ path: path.join(outDir, `${SLIDES[i]}.png`) });
    }
    await page.close();
    // Raw UI captures, kept for reference only (git-ignored; the slides are what is published).
    for (const [name, buffer] of Object.entries(shots)) if (Buffer.isBuffer(buffer)) fs.writeFileSync(path.join(outDir, `ui-${name}.png`), buffer);
    console.log(`✓ docs/store/${locale}: ${SLIDES.length} slides`);
    if (locale === 'en') await promoTiles(shots);
  }
} finally {
  await browser.close();
  server.close();
}
