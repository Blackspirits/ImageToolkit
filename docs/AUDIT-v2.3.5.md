# Auditoria técnica — ImageToolkit v2.3.5

Data: 2026-10-20 · Âmbito: todo o código em `main` (MV3, ~4,2k linhas próprias + libs vendorizadas)
Método: leitura integral de `background.js`, `offscreen.js`, `content.js`, `capture.js`, `popup.js`, `resize.js`, HTML/manifest, locales e docs; testes pontuais com Node (`buildFilename`, paridade i18n, placeholders).

## Resumo

| Severidade | N.º | Natureza |
|---|---|---|
| Alta | 4 | Ficheiros guardados com conteúdo/extensão errados; funcionalidades anunciadas que não funcionam |
| Média | 10 | Perda de definições, diálogos em massa, falhas permanentes do offscreen, captura, desempenho |
| Segurança | 4 | Sem XSS. Falta defesa em profundidade no router de mensagens; permissões largas |
| Baixa | ~15 | Erros silenciosos, dívida técnica, a11y/RTL, empacotamento |
| i18n pt-PT | 6 | Registo tu/você misto, inconsistências de rótulos |

**Ação #1:** corrigir A2 + A3 (integridade dos ficheiros). É o único problema que entrega ao utilizador um ficheiro *errado* sem aviso — gera avaliações de 1 estrela na CWS.

### Pontos fortes

- MV3 limpo, sem código remoto, sem `eval`, sem `web_accessible_resources`.
- Nenhum sink de XSS: dados da página vão sempre para `textContent`; `innerHTML` só com SVG estático.
- `sanitizeFilename` sólido (nomes reservados do Windows, caracteres de controlo, `..`).
- i18n: 18 locales × 159 chaves, paridade total e placeholders consistentes (verificado por script).
- Libs atualizadas: JSZip 3.10.1, Cropper.js 1.6.2 (sem CVE conhecidas).
- `PRIVACY.md` corresponde ao comportamento real.

---

## Alta

### A1 — Atalho `Alt+Shift+S` não faz nada
`manifest.json:44-52` declara `commands.quick-save-default` e o README (`README.md:52`) anuncia-o, mas não existe `chrome.commands.onCommand` em lado nenhum. O utilizador carrega na tecla e nada acontece.

**Recomendação:** remover o comando do manifest e do README até haver uma semântica clara (não há “imagem atual” num atalho de teclado). Robustez > promessa.

### A2 — “Original” não é original (e mente na extensão)
`popup.js:505` (`buildIns`) envia `format: img.type` para o canvas. Em `offscreen.js:256-259`, `getMimeType` só conhece png/jpeg/webp/avif e devolve `image/png` para tudo o resto. Resultado, confirmado com `buildFilename`:

| Origem | Ficheiro guardado | Conteúdo real |
|---|---|---|
| `photo.gif` (animado) | `photo.gif` | PNG estático (animação perdida) |
| `logo.svg` | `logo.svg` | PNG rasterizado |
| `.ico` / `.bmp` | `.ico` / `.bmp` | PNG |
| tipo desconhecido | `x.other` | PNG |
| `foto.jpg` | `foto.jpg` | JPEG recodificado a 85% (perda de qualidade) |

Afeta `dlOne`, `batchDl` (incl. ZIP via `zipNm`) e `pvDl`.

**Correção:** quando `fmt === 'original'` (e sem `convertOnDl`), não passar pelo canvas — descarregar os bytes de origem.

```js
// background.js — nova ação
if (action === 'downloadOriginal') {
  const filename = buildFilename(message.imageUrl, {
    ...message.instructions,
    format: message.ext || 'bin', // extensão real detetada (img.type)
  });
  triggerDownload(message.imageUrl, filename, message.saveAs ?? true);
  sendResponse({ success: true });
  return false;
}
```

Para ZIP em modo original, usar `fetchAsDataUrl` (bytes intactos) em vez de `processAndReturnData`.

### A3 — AVIF: ficheiros `.avif` com conteúdo WebP/PNG
- `offscreen.js:88-99` faz fallback para WebP e devolve `format: 'webp'`, mas `background.js:592` constrói o nome com `instructions.format` → `.avif` com bytes WebP.
- `resize.js:376-383`: `toDataURL('image/avif')` devolve PNG quando o encoder não existe → `.avif` com PNG.
- `popup.js:753` (`zipNm`) tem o mesmo problema.

```js
// background.js:591-592
const result = await processImage(imageUrl, instructions);
const filename = buildFilename(imageUrl, { ...instructions, format: result.format || instructions.format });

// resize.js — após toDataURL
const actualMime = dataUrl.slice(5, dataUrl.indexOf(';'));
const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' }[actualMime] || 'png';
```

Mostrar também um toast quando há fallback (“AVIF indisponível — guardado como WebP”).

### A4 — Definição “Comportamento do redimensionamento” sem efeito
`resizeBehavior` é guardado (`popup.js:730`) mas nunca lido. Nenhum chamador envia `cropWidth`/`fitMode`, pelo que `drawFitMode` e o ramo de recorte em `offscreen.js:76-79,173-194` são código morto. O README (`README.md:46`) anuncia a funcionalidade.

**Recomendação:** ligar a definição ao fluxo de redimensionamento com altura fixa (`resizeTool` com cadeado desligado → `cropWidth/cropHeight/fitMode`) ou remover a opção e o código morto.

---

## Média

### M1 — Alterar qualquer definição apaga o “tamanho mínimo” guardado
`popup.js:729-736` reescreve o objeto `settings` inteiro e não inclui `savedAtLeastW/H` (gravados em `popup.js:148-153`).

```js
const save = async () => {
  const { settings: prev = {} } = await chrome.storage.sync.get('settings');
  await chrome.storage.sync.set({ settings: { ...prev, /* campos do formulário */ } });
};
```

### M2 — Download em lote abre um diálogo “Guardar como” por imagem
`saveAs: true` é a predefinição (`background.js:89`) e `batchDl` (`popup.js:497`) chama `processAndSave` por imagem → 50 imagens = 50 diálogos.
**Correção:** em lote forçar `saveAs: false` (`processAndSave` passa a respeitar `instructions.saveAs ?? settings.saveAs`).

### M3 — Falha na criação do offscreen fica “presa” até o service worker reiniciar
`background.js:521-532`: se `createDocument` rejeitar, `await offscreenCreating` lança antes de `offscreenCreating = null`; todas as chamadas seguintes esperam a mesma promessa rejeitada.

```js
if (!offscreenCreating) {
  offscreenCreating = chrome.offscreen.createDocument({ /* ... */ })
    .catch((err) => { if (!String(err?.message).includes('Only a single offscreen')) throw err; })
    .finally(() => { offscreenCreating = null; });
}
await offscreenCreating;
```

### M4 — Nomes de ficheiro lixo para data: URLs
`buildFilename` (`background.js:693-699`) aplicado a `data:` devolve, por exemplo, `png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAD.webp`. Afeta SVG inline e **todos os ficheiros largados no separador Ferramentas** (o nome original do ficheiro perde-se).
**Correção:** `if (/^(data|blob):/.test(imageUrl)) baseName = 'image'` e passar `file.name` como `instructions.baseName` a partir do popup.

### M5 — Captura de área: overlay pode sair na imagem; janela errada
- `capture.js:96-100` remove o overlay e envia a mensagem no mesmo frame → `captureVisibleTab` pode apanhar o véu escuro.
- `background.js:377-379` usa `currentWindow` (no SW = última janela focada) em vez de `sender.tab.windowId`; com várias janelas captura a errada. Falhas são silenciosas.

```js
// capture.js
cleanup();
if (rect.width < 10 || rect.height < 10) return;
requestAnimationFrame(() => requestAnimationFrame(() =>
  chrome.runtime.sendMessage({ action: 'captureSelection', rect })));

// background.js
chrome.tabs.captureVisibleTab(sender.tab?.windowId ?? null, { format: 'png' }, (dataUrl) => { /* ... */ });
```

### M6 — MutationObserver eterno acorda o service worker
`content.js:219-261`: após a primeira abertura do painel, o observer fica ativo para sempre e envia `newImagesDetected` a cada 500 ms em páginas com scroll infinito — mesmo com o painel fechado. Cada mensagem acorda o SW.
**Correção:** o painel abre `chrome.tabs.connect(tabId, { name: 'imagetoolkit' })`; o content script só observa enquanto a porta está ligada e desliga em `onDisconnect`.

### M7 — Pipeline em data URLs: memória ×4 e limite de mensagens
SW faz fetch → base64 → mensagem → decode → canvas → blob → base64 → mensagem → download. Com base64 (+33%) uma imagem de ~48 MB ultrapassa o limite de 64 MiB por mensagem. Não há limite de dimensões: `resize-1080` faz *upscale* de imagens pequenas e uma largura enorme no separador Ferramentas rebenta o canvas.
**Correção:** o offscreen faz o fetch diretamente (tem as mesmas host permissions), trabalha com `Blob` e devolve um `blob:` URL para `chrome.downloads`. Limitar a `min(pedido, 16384)` e não fazer *upscale* no 1080.

### M8 — Comportamento inconsistente com imagens autenticadas
`fetchAsDataUrl` usa `credentials: 'include'` (`background.js:283`), `processImage` não (`background.js:537`). A imagem aparece na pré-visualização/recorte mas falha ao converter/guardar/copiar. Unificar num único helper.

### M9 — Modo popup: ZIP e lote morrem quando o popup fecha
Com o painel lateral desativado, o diálogo “Guardar como” do ZIP rouba o foco → o popup fecha → o `blob:` (`popup.js:754`) é revogado e o ciclo `batchDl` é interrompido. Mover a geração do ZIP para o offscreen (ou abrir o painel lateral para operações em lote).

### M10 — Assistente de formato demasiado pesado
`popup.js:560` corre `runAdvisor` a cada pausa de 500 ms na escrita e volta a correr em `setSource` (`popup.js:587`): 3 fetch+encode completos por invocação, duplicados. Correr só uma vez por URL carregado e reutilizar o blob.

---

## Segurança

Sem XSS, sem injeção de HTML, sem path traversal nos downloads. Achados de defesa em profundidade:

### S1 — Router de mensagens não valida o remetente (Média-baixa)
`background.js:249` aceita qualquer ação de qualquer contexto da extensão, incluindo content scripts que correm em páginas arbitrárias. Um renderer comprometido poderia pedir `fetchAsDataUrl` com cookies (`credentials: 'include'`) para qualquer URL e ler a resposta.

```js
const fromExtensionPage = sender.id === chrome.runtime.id && sender.url?.startsWith(chrome.runtime.getURL(''));
const CONTENT_ACTIONS = new Set(['captureSelection', 'newImagesDetected']);
if (sender.id !== chrome.runtime.id) return false;
if (!fromExtensionPage && !CONTENT_ACTIONS.has(action)) return false;
```

### S2 — `<all_urls>` permanente (estratégico)
Gera o aviso “Ler e alterar todos os dados em todos os sites” e revisão manual mais lenta na CWS. Com `activeTab` já presente, avaliar `optional_host_permissions` pedidas na primeira ação cross-origin. Horizonte: próxima versão minor.

### S3 — Esquemas de URL não filtrados no scanner (Baixa)
`content.js:51` aceita `javascript:`, `file:`, `blob:`… Filtrar para `http(s):` e `data:image/`.

### S4 — `String.replace` com valores do utilizador (Baixa)
`background.js:23,28`, `popup.js:24,30`, `resize.js:12,17`: um valor com `$&` ou `$1` é interpretado. Usar replacer em função: `msg.replace(re, () => str)`.

---

## Baixa / dívida técnica

- `resize.js:398-401`: erros ao guardar são engolidos; canvas “tainted” (tentativa 3 em `resize.js:136`) falha em silêncio.
- `resize.js:394`, `popup.js:527,677`: `notifSavedAs` sem formato → “Guardado como ” vazio (o `.replace('$FORMAT$')` não funciona com `chrome.i18n`).
- `popup.js:498`: `batchDl` engole erros e mostra sempre ✅. Mostrar `n falhadas`.
- `background.js:686`: o filtro `'..'` nunca atua (já foi transformado em `image`) → `../../etc` vira `image/image/etc`. Descartar o segmento.
- `background.js:678`: `substring(0, 60)` pode partir emoji/pares substitutos.
- `background.js:338`: `chrome.runtime.lastError` verificado após `await` — sem efeito.
- `probeRemoteSize` (`background.js:898-906`): fallback descarrega a imagem completa sem timeout no corpo.
- Offscreen nunca é fechado; fechar após inatividade.
- Tema “auto” não reage a mudanças do sistema (popup e resize).
- Árabe sem RTL: `<html lang="en">` fixo, sem `dir` (usar `chrome.i18n.getMessage('@@bidi_dir')` e `@@ui_locale`).
- Toast sem `role="status"`/`aria-live`.
- Código morto: `initResizeUrl`, chave `presetFree`, parâmetro `filename` em `showSaveNotification`, `tab` em `processAndCopy`.
- Duplicação: helper i18n ×3, `mapLimit` ×2, `fmtBytes` ×2, `detectAlpha` ×2.
- `content.js:93-109`: cada ícone SVG inline vira uma “imagem” (ruído; sprites com `<use>` ficam vazios). Ignorar SVG < 24 px ou só com `<use>`.

## Projeto / processo

- Sem CI, lint ou testes. Mínimo: GitHub Action com `npm run validate` + ESLint (`eslint-plugin-chrome`/globals `chrome`).
- `scripts/validate-extension.mjs`: acrescentar verificação de placeholders, chaves não usadas e ficheiros referenciados no manifest/HTML.
- Sem script de empacotamento, apesar de o CHANGELOG 2.3.4 o referir. `icons/` tem ~3 MB de ativos não usados (`logo.png` = `logo1024.png`, `logo256*`, `logo512*`, `logo.svg`). Criar `scripts/package.mjs` com allowlist.
- Sem tags git por versão. `TRANSLATION_AUDIT.md` repete “v2.3.4” em três entradas diferentes.

---

## i18n — pt-PT

| Chave | Atual | Proposta | Motivo |
|---|---|---|---|
| `captureHint` | Desenhe um retângulo para capturar · ESC para cancelar | Desenha um retângulo para capturar · Esc para cancelar | Resto da UI usa “tu” (Arrasta, clicas, por ti) |
| `settingSubfolderNote` | Funciona melhor com 'Pedir localização' desativado | Funciona melhor com «Perguntar onde guardar» desativado | Rótulo real da opção |
| `bgGray` | Cinza | Cinzento | pt-PT |
| `settingsTitle` | Preferências | Definições | Igual ao separador |
| `bgPreview`, `cropArea`, `outputSize`, `downloadOptions`, `settingCrop`, `presetCommon`, `presetSocial`, `filterXLargeLabel` | Title Case | Pré-visualizar fundo, Área de recorte, Tamanho final, Opções de transferência, Recorte central, Tamanhos comuns, Redes sociais, Extra grande | Maiúsculas de frase em pt-PT |
| `titleToggleLayout` | Alternar layout | Alternar disposição | Evitar anglicismo desnecessário |

---

## Plano (máx. 3 frentes em paralelo)

1. **v2.3.6 — integridade** (A2, A3, M4): ficheiros certos com nomes certos. ~3–4 h.
2. **v2.3.7 — promessas e estabilidade** (A1, A4, M1, M2, M3, M5): remover/ligar o que está anunciado; sem diálogos em massa. ~4 h.
3. **v2.4.0 — arquitetura** (M6–M9, S1, S2, CI + empacotamento): pipeline em `Blob`, porta para o observer, permissões opcionais. ~1–2 fins de semana.

Risco a 3–12 meses: avaliações negativas na CWS por A2/A3 e pelo atalho morto; a revisão manual pode exigir justificar `<all_urls>`.
