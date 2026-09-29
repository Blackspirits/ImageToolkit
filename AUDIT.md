# Auditoria técnica — ImageToolkit v2.3.5

Data: 2026-09-28
Âmbito: todo o código em `main` @ `06d8d68` (background, offscreen, content, capture, popup, resize, manifest, `_locales`, documentação, validador).
Método: leitura integral do código, testes isolados das funções puras em Node, e verificação empírica no Chromium 141 (Playwright) do comportamento de `canvas.toBlob`/`toDataURL` com AVIF e do tamanho intrínseco de SVG. `npm run validate` passa (18 idiomas, 159 chaves, placeholders coerentes).

---

## 1. Sumário executivo

A base é sólida para uma extensão sem frameworks: MV3 limpo, sem scripts remotos, sem `innerHTML` com dados da página, nomes de ficheiro saneados, i18n completo com paridade de chaves. O problema principal não é segurança, é **correção do output**: em vários caminhos a extensão grava ficheiros com o conteúdo num formato e a extensão noutro, ou re-codifica quando promete "original".

Causas-raiz (3):

1. **O nome do ficheiro é calculado a partir do pedido, não do resultado.** O pipeline de conversão faz fallback silencioso (AVIF → WebP, formatos não suportados → PNG), mas `buildFilename` usa `instructions.format`.
2. **Não existe caminho "sem conversão".** "Original" passa sempre pelo canvas, logo perde animação (GIF), vetores (SVG) e qualidade (JPG).
3. **Não há testes nem guardas de entrada.** O validador só verifica sintaxe e paridade de chaves; nenhuma função pura está coberta, por isso regressões como a de `settings` passam despercebidas.

**Ação #1:** corrigir A1 + A2 (formato real = extensão real, e "Original" = bytes originais). É o núcleo da promessa do produto e são duas alterações pequenas.

| Severidade | N.º |
|---|---|
| Alta | 5 |
| Média | 10 |
| Baixa | 11 |
| Documentação / loja | 4 |
| Qualidade / dívida técnica | 4 |

### Estado das correções

| Estado | Itens |
|---|---|
| Corrigido | A1–A5, M1–M10, B1–B11, D1–D4, Q1–Q4 |
| Por fazer | — |

Notas por item:
- **A5** — o atalho `Alt+Shift+S` passou a ter comportamento real: captura de área.
- **M2** — cópia a partir do painel/editor escreve diretamente (página focada); a partir do menu de contexto, escreve a partir da página clicada. Offscreen fica só como último recurso.
- **M4** — passagem de imagens por IndexedDB (`lib/handoff.js`), com chave por janela e expiração a 30 min.
- **M7** — limites: 40 MB por imagem, 16384 px por lado, 100 MP por imagem.
- **B9** — cartões focáveis com navegação por teclado, anéis de foco, `lang`/`dir` dinâmicos (árabe em RTL), rótulos ARIA.
- **D4** — `activeTab` removido (redundante com `<all_urls>`). A troca para `optional_host_permissions` fica como decisão do autor: reduz o aviso na instalação, mas acrescenta um pedido de permissão na primeira utilização.
- **Q1** — `npm test` (14 testes unitários), `npm run test:e2e` (15 testes com a extensão real no Chromium) e workflow de CI.

Verificação: `npm run validate`, `npm test` e `npm run test:e2e` verdes no Chromium 141. O e2e cobre, entre outros: bytes idênticos no "Original" (GIF/SVG/PNG/sem extensão), AVIF→WebP com nome correto, letterbox transparente, limites de tamanho, esquemas recusados, scanner com reinjeção, recusa de ações privilegiadas a content scripts, páginas restritas, merge de definições, editor (abrir, recortar, guardar), clipboard a partir do painel e do menu de contexto, captura de área até ao editor e lote sem diálogos.

---

## 2. Achados de severidade alta

### A1 — "Formato original" re-codifica e grava com extensão errada
- **Onde:** `popup.js:505` (`buildIns`), `offscreen.js:256` (`getMimeType`), `background.js:721` (`buildFilename`).
- **O quê:** `buildIns('original')` devolve `{ format: img.type }`. Para `gif`, `svg`, `ico`, `bmp`, `tiff` ou `other`, `getMimeType` cai em `image/png`, mas o nome do ficheiro usa `img.type`.
- **Impacto:** `logo.svg` é gravado como `logo.svg` com bytes PNG (ficheiro inválido para qualquer editor vetorial). GIF animado perde animação e fica PNG com extensão `.gif`. Imagens sem extensão reconhecida saem como `*.other`. JPG "original" é re-comprimido a 85 %, o que degrada a qualidade.
- **Correção:** "Original" não deve passar pelo canvas.

```js
// popup.js — buildIns
function buildIns(fmt, img, s) {
  if (fmt === 'original') return { passthrough: true, originalType: img.type };
  return { format: fmt === 'jpg' ? 'jpeg' : fmt, quality: s.defaultQuality / 100 };
}

// background.js — início de processAndSave, depois de carregar settings
if (instructions.passthrough) {
  const ext = instructions.originalType && instructions.originalType !== 'other' ? instructions.originalType : null;
  const filename = buildFilename(imageUrl, { ...instructions, format: ext || 'bin' });
  triggerDownload(imageUrl, filename, instructions.saveAs ?? settings.saveAs);
  return { success: true, filename };
}
```
(Para `other`, o ideal é usar o tipo sondado por `probeImageTypes` ou o `Content-Type` do `fetch`.)

### A2 — "Guardar como AVIF" produz WebP ou PNG com extensão `.avif`
- **Onde:** `offscreen.js:88-98`, `background.js:591-592`, `resize.js:376-383`, e `zipNm` em `popup.js:753`.
- **Verificado:** no Chromium 141, `canvas.toBlob(cb, 'image/avif')` devolve `image/png` e `toDataURL('image/avif')` devolve `data:image/png`. O Chrome não codifica AVIF em canvas.
- **Impacto:** via menu de contexto/popup, o offscreen faz fallback para WebP mas o ficheiro chama-se `*.avif`. Na janela de recorte (`resize.js`) nem há fallback: grava PNG com extensão `.avif`. O README anuncia AVIF como funcionalidade.
- **Correção (duas partes):**

```js
// background.js — processAndSave / ZIP: usar o formato REAL
const result = await processImage(imageUrl, instructions);
const filename = buildFilename(imageUrl, { ...instructions, format: result.format });

// resize.js — deduzir o formato real a partir do data URL
const dataUrl = outputCanvas.toDataURL(mimeType, quality);
const realMime = dataUrl.slice(5, dataUrl.indexOf(';'));
const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' }[realMime] || 'png';
```
E esconder a opção AVIF quando não for suportada (deteção em runtime, 1 vez):
```js
const avifOk = await new Promise(r => { const c = document.createElement('canvas'); c.width = c.height = 1; c.toBlob(b => r(b?.type === 'image/avif'), 'image/avif'); });
```

### A3 — Transferência em lote abre um diálogo "Guardar como" por imagem
- **Onde:** `popup.js:497` → `background.js:594`.
- **O quê:** o modo não-ZIP chama `processAndSave` por imagem; o background usa `settings.saveAs`, cuja predefinição é `true`. Com notificações ativas, também dispara uma notificação por imagem.
- **Impacto:** selecionar 40 imagens = 40 diálogos + 40 notificações. No modo popup (sem painel lateral), o primeiro diálogo tira o foco, o popup fecha e o lote é interrompido.
- **Correção:** o lote força `saveAs: false` e suprime notificações individuais; mostra uma só notificação no fim.

```js
// popup.js — batchDl
ins.saveAs = false; ins.silent = true;
// background.js — processAndSave
triggerDownload(result.dataUrl, filename, instructions.saveAs ?? settings.saveAs);
if (settings.showNotification && !instructions.silent) showSaveNotification(...);
```

### A4 — Guardar qualquer definição apaga o "tamanho mínimo" guardado
- **Onde:** `popup.js:729-736` vs `popup.js:145-153`.
- **O quê:** `save()` escreve um objeto `settings` novo e completo, sem `savedAtLeastW`/`savedAtLeastH`. Qualquer alteração em Definições (tema, qualidade, idioma...) apaga-os. O botão de tema (`popup.js:91`) faz *merge* e não tem o problema, o que confirma que é acidental.
- **Correção:**

```js
const save = async () => {
  const cur = await getSettings();
  chrome.storage.sync.set({ settings: { ...cur, /* campos do formulário */ } });
};
```

### A5 — Atalho `Alt+Shift+S` declarado, mas sem implementação
- **Onde:** `manifest.json:44-52`; não existe `chrome.commands.onCommand` em nenhum ficheiro.
- **Impacto:** funcionalidade anunciada no README e no CHANGELOG (v2.0) que não faz nada. Ocupa ainda um atalho global do utilizador.
- **Correção:** implementar (por exemplo, guardar no formato predefinido a maior imagem visível da aba ativa) ou remover do manifest e da documentação. Recomendo remover já e reintroduzir quando houver um comportamento definido.

---

## 3. Achados de severidade média

| ID | Área | Onde | Problema | Correção |
|---|---|---|---|---|
| M1 | Segurança | `background.js:249` | `onMessage` não valida `sender`. Os content scripts correm no processo da página e podem pedir `fetchAsDataUrl` (com `credentials: 'include'`), `processAndSave`, `downloadBlob`, etc. Um renderer comprometido usa a extensão para ler respostas *cross-origin* com cookies (fuga ao Site Isolation). Requer exploit prévio, mas é a recomendação explícita da Google para extensões. | Allowlist por origem (ver snippet §6). |
| M2 | Funcional | `offscreen.js:112-144` | Copiar imagem a partir do menu de contexto ou da pré-visualização passa pelo documento offscreen. `navigator.clipboard.write` exige documento focado (o offscreen nunca está) e o fallback `execCommand('copy')` com um `<img>` selecionado copia HTML, não bitmap. **Provável** que colar no Slack/Discord/Figma falhe. Testar manualmente. | Na pré-visualização, copiar diretamente no popup/painel (focado) com `new ClipboardItem({'image/png': promessaDoBlob})`. Para o menu de contexto, abrir uma janela mínima focada ou documentar a limitação. |
| M3 | Funcional | `capture.js:389-403` | `cleanup()` remove o overlay e envia `captureSelection` no mesmo tick. `captureVisibleTab` pode apanhar o frame antes do *repaint*, e aí o escurecimento e o tracejado aparecem na captura. | `requestAnimationFrame(() => requestAnimationFrame(() => chrome.runtime.sendMessage(...)))`. |
| M4 | Fiabilidade | `background.js:384`, `:771` | Capturas (data URL PNG) guardadas em `chrome.storage.local` (quota de 10 MB sem `unlimitedStorage`). Uma captura HiDPI grande excede a quota; `set` falha em silêncio e a janela abre com "sem imagem". Duas janelas abertas em sequência competem pela mesma chave. | Chave única por janela (`_resize_<uuid>` passada na query string) + `chrome.storage.session` ou IndexedDB; verificar `lastError`. |
| M5 | Desempenho | `background.js:898-903`, `:940` | `probeRemoteSize` faz, em último recurso, um GET completo e `blob()`. O timeout de 4 s é limpo no `finally` antes do `blob()`, pelo que a transferência não tem limite. Aplica-se a até 100 URLs extraídos da página (que a página controla). | Não usar o fallback de GET completo; ou ler com `response.body.getReader()` e cancelar ao passar de N MB. |
| M6 | Funcional | `popup.html:165`, `offscreen.js:76` | A definição "Comportamento ao redimensionar" (Recorte/Ajustar) é guardada, mas nunca lida: `fitMode` nunca é enviado. A opção no UI não tem efeito. Em Ferramentas, com o cadeado desligado, a imagem é esticada. | Ligar `settings.resizeBehavior` → `fitMode`/`cropWidth` em `resizeTool`, ou remover a opção. |
| M7 | Robustez | `offscreen.js:57-110`, `background.js:536` | Sem limites de entrada: largura/altura arbitrárias, área de canvas (> ~268 MP falha), tamanho do ficheiro. A imagem viaja em base64 por 3 saltos de mensagens (SW → offscreen → SW → popup), o que dá ~4× a memória, com limite de 64 MiB por mensagem. | Validar `1 ≤ w,h ≤ 16384` no background; rejeitar ficheiros > 50 MB com mensagem clara; a prazo, fazer o `fetch` no offscreen e devolver só o resultado. |
| M8 | UX | `popup.js:489-502` | Erros do lote engolidos (`catch {}`); a barra mostra ✅ mesmo que todas as imagens falhem. | Contar sucessos/falhas e mostrar `n/total` + toast de erro. |
| M9 | Robustez | `background.js:521-532` | Se `createDocument` falhar com outro erro, `offscreenCreating` nunca volta a `null`: todas as chamadas seguintes esperam a mesma promessa rejeitada até o SW reiniciar. | `try { await offscreenCreating; } finally { offscreenCreating = null; }` |
| M10 | Desempenho | `content.js:219-261` | O `MutationObserver` nunca é desligado e envia mensagem a cada 500 ms em páginas com *infinite scroll* ou carrosséis, acordando o service worker indefinidamente, mesmo com o painel fechado. | Desligar após X minutos sem pedidos, ou só observar enquanto o painel está aberto (porta `runtime.connect`, desligar no `onDisconnect`). |

---

## 4. Achados de severidade baixa

| ID | Onde | Problema |
|---|---|---|
| B1 | `background.js:678` | Truncagem a 60 caracteres seguida de `replace(/[^a-zA-Z0-9]+$/)` apaga todo o texto não-ASCII no fim. **Verificado:** um nome japonês longo fica `image.png`. Usar `\p{L}\p{N}` com flag `u`. |
| B2 | `background.js:23,28`, `popup.js:24,30`, `resize.js:12,17` | `String.replace` com string de substituição interpreta `$&`/`$1` (verificado: `a$&b` → `a$FORMAT$b`); `/\$1/g` também apanha `$10`. Usar função de substituição. Em idioma forçado, chaves em falta caem para o idioma do browser, não para `en`. |
| B3 | `resize.js:394`, `popup.js:527,677` | `_('notifSavedAs').replace('$FORMAT$', ...)` não funciona pelo caminho `chrome.i18n` (o placeholder já foi substituído por vazio). Os toasts mostram "Guardado como " sem formato. Passar sempre `[FORMAT]` como substituição. |
| B4 | `background.js:338,353-394` | Sem feedback em páginas restritas (`chrome://`, Web Store, PDF): `startCapture` responde sempre `success: true`; `captureVisibleTab` não verifica `lastError`. `chrome.runtime.lastError` na linha 338 é código morto. |
| B5 | `content.js` | Sem guarda contra dupla injeção: `let`/`const` de topo lançam `SyntaxError` e duplicam listeners. Envolver numa IIFE com `if (window.__itkLoaded) return;`. |
| B6 | `content.js:51,123` | Não filtra esquemas: `javascript:`/`file:`/`blob:` de outra origem entram na grelha (o regex `\.png(\?|$)` aceita `javascript:...//x.png`). Aceitar só `http(s):` e `data:image/`. `offsetParent` ignora fundos em `position: fixed`; só o frame de topo é analisado. |
| B7 | `background.js:252-260` | Ação `openSidePanel` nunca é enviada (código morto) e falharia na mesma: `sidePanel.open` perde o gesto do utilizador após o `tabs.query` assíncrono. |
| B8 | `background.js:523` | Motivo `DOM_SCRAPING` no offscreen não corresponde a nenhum uso real. Pode ser questionado na revisão da Chrome Web Store. Ficar só com `BLOBS` + `CLIPBOARD`. |
| B9 | `popup.html`, `popup.css` | Acessibilidade: cartões são `div` clicáveis sem suporte de teclado, `outline: none` em inputs e range, `lang="en"` fixo, sem `dir="rtl"` quando o idioma é árabe. |
| B10 | `background.js:95,621,602` | "Mostrar notificação" é ignorado ao copiar e nos erros. Google Lens está ativo por predefinição (opt-out), mas o README e o PRIVACY descrevem-no como "opcional". |
| B11 | `_locales/*` | Chaves `presets` e `presetFree` não são usadas no código. |

---

## 5. Documentação, loja e permissões

- **D1 — README desatualizado:** diz "14 idiomas com traduções parciais" (o `TRANSLATION_AUDIT.md` diz 159/159 em todos); anuncia AVIF, "Resize behavior" e o atalho, que não funcionam como descrito (A2, M6, A5); a árvore de arquitetura omite `capture.js`.
- **D2 — PRIVACY incompleto:** não menciona a captura de ecrã (`captureVisibleTab`) nem o armazenamento temporário da imagem em `chrome.storage.local`. A Chrome Web Store exige que a política cubra o tratamento de conteúdo da página.
- **D3 — TRANSLATION_AUDIT:** o changelog interno repete "v2.3.4" três vezes com contagens diferentes (154/155/159).
- **D4 — Permissões:** `activeTab` é redundante com `<all_urls>`. `<all_urls>` obriga a revisão aprofundada na loja e mostra o aviso "ler e alterar todos os dados". Alternativa a avaliar: `optional_host_permissions: ["<all_urls>"]` pedida na primeira utilização do painel lateral, mantendo `activeTab` para popup e menu de contexto. Troca: +1 clique na primeira utilização, contra menos atrito na instalação e na revisão.

---

## 6. Segurança — snippet para M1

```js
// background.js — topo do onMessage
const EXT_ORIGIN = chrome.runtime.getURL('');
const CONTENT_SCRIPT_ACTIONS = new Set(['captureSelection', 'newImagesDetected']);

function isExtensionPage(sender) {
  return sender.id === chrome.runtime.id && (sender.url || '').startsWith(EXT_ORIGIN);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { action } = message || {};
  if (!isExtensionPage(sender) && !CONTENT_SCRIPT_ACTIONS.has(action)) return false;
  // ...resto inalterado
});
```
Em `captureSelection`, usar também `sender.tab.windowId` em vez de "aba ativa da janela atual".

O resto está bem: sem `eval`, sem `innerHTML` com dados da página (a grelha usa `textContent`), `downloadBlob` limita esquemas a `blob:`/`data:image|zip`, `sanitizeFilename` bloqueia `..` e nomes reservados do Windows (verificado: `../../etc` → `image/image/etc`), bibliotecas locais (Cropper.js 1.6.2, JSZip 3.10.1, sem CVE conhecidas relevantes para uso local).

---

## 7. Qualidade e dívida técnica

- **Q1 — Sem testes nem CI.** Não existe `.github/workflows`. O validador usa `new Function` (não apanha erros de módulo nem de runtime). As funções puras (`sanitizeFilename`, `buildFilename`, `calculateDimensions`, `normUrl`, `detectType`, `parseSrcset`, `extractBgUrls`) testam-se com `node:test` sem dependências.
- **Q2 — Duplicação:** helper i18n ×3 (background/popup/resize, com comportamentos ligeiramente diferentes), `mapLimit` ×2, `formatBytes` ×2, `detectAlpha` ×2. Extrair para `lib/shared.js` (carregado via `<script>` e `importScripts`).
- **Q3 — Legibilidade:** linhas "minificadas à mão" em `popup.js` (505, 527, 691-695, 753-754) dificultam revisão e *diffs*.
- **Q4 — Versão duplicada** em `manifest.json` e `package.json`: o validador devia verificar que coincidem.

---

## 8. Plano de ação

Máximo de 3 frentes em paralelo. Blocos pensados para sessões curtas.

| Fase | Itens | Esforço | Critério de fecho |
|---|---|---|---|
| **1 — Correção do output** (v2.3.6) | A1, A2, A3, A4, A5 (remover) | 2–3 sessões de ~1 h | Cada formato do menu gera um ficheiro cujo tipo real (`file --mime-type`) coincide com a extensão; lote de 20 imagens = 0 diálogos; guardar tema mantém o tamanho mínimo. |
| **2 — Robustez e segurança** (v2.4.0) | M1, M2, M3, M4, M7, M9 | 3–4 sessões | Mensagens de content script para ações privilegiadas são rejeitadas; captura sem overlay visível; captura 5K abre no editor; copiar cola no Discord. |
| **3 — Qualidade e loja** | Q1 (testes + workflow CI), D1–D4, M6, B1–B3 | 2–3 sessões | `npm test` com ≥ 15 casos nas funções puras a correr em PR; README/PRIVACY alinhados com o comportamento real. |

**Risco a 3–6 meses:** se o objetivo é publicar na Chrome Web Store, A2 e D2 são os mais expostos. Um utilizador que grava `.avif` e recebe um PNG deixa uma avaliação de 1 estrela, e uma política de privacidade que omite a captura de ecrã é motivo documentado de rejeição. Convém fechar a Fase 1 e o D2 antes da submissão.


---

## 9. Segunda ronda (auditoria externa ao `e0546d5` e `15acdb3`)

| # | Achado | Estado | Teste |
|---|---|---|---|
| 1 | Pré-visualização atuava sobre a imagem errada após reordenação | Corrigido — identidade por `src` | e2e |
| 2 | "Custom" após preset fixo deformava o output | Corrigido | e2e |
| 3 | Corrida ao guardar definições | Corrigido — escritas em série | e2e |
| 4 | Corrida ao trocar a imagem em Ferramentas | Corrigido — token + `FileReader.abort()` | e2e |
| 5 | Advisor cancelava análises de outras janelas | Corrigido — `AbortController` por documento | e2e |
| 6 | Dimensões de imagens anti-hotlink | Corrigido — fallback partilhado com as miniaturas | e2e |
| 7 | ZIP cancelado mostrava sucesso | Corrigido | e2e |
| 8 | Download sem `Content-Length` lido por inteiro | Corrigido — leitura em streaming com corte | e2e |
| 9 | Output/ficheiro local acima do limite | Corrigido — teto de 40 MB antes do base64 | e2e (ficheiro local) |
| 10 | `parseSrcset("a.jpg,b.jpg")` | **Não é bug** — o Chromium pede `/a.jpg,b.jpg`, como manda a especificação HTML | unitário |
| 11 | Âncora do Shift+clique por índice | Corrigido — âncora por `src` | e2e |
| 12 | Caixa do editor em panorâmicas | Corrigido — escala comum (`stageSize`) | unitário |
| A11y | `aria-selected` em `listitem`, tabs sem teclado, modal sem trap | Corrigido | e2e |
| PRIVACY | "apagadas após 30 min" impreciso | Corrigido — `get()` expira e texto rigoroso | — |
| Contraste | `text-3` sobre `bg-sunken` 4,42:1 | Corrigido, mais 3 pares encontrados (verde, vermelho e âmbar sobre fundos suaves) | `npm run check:contrast` no CI |
