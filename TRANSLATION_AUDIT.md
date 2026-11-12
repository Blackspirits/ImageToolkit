# Translation Audit — 2.5.0

Total keys: 255  
Audit date: 2026-10-24

## Coverage

All 18 locale packs have 255/255 keys present (0 missing). `npm run validate` enforces key parity, identical placeholders and `$TOKENS$` in every locale, and fails on keys that are defined but unused or used but undefined.

| Locale | Keys | Identical to EN |
|--------|------|-----------------|
| ar | 255 | 2 |
| de | 255 | 25 |
| en | 255 | — |
| es | 255 | 13 |
| fr | 255 | 15 |
| it | 255 | 13 |
| ja | 255 | 4 |
| ko | 255 | 4 |
| nl | 255 | 14 |
| pl | 255 | 9 |
| pt_BR | 255 | 11 |
| pt_PT | 255 | 11 |
| ru | 255 | 2 |
| tr | 255 | 9 |
| uk | 255 | 2 |
| vi | 255 | 10 |
| zh_CN | 255 | 2 |
| zh_TW | 255 | 2 |

## Why "identical to EN" ≠ "untranslated"

Strings marked identical fall into these categories:

- **Universal (brand/dimensions)**: `extShortName` ("ImageToolkit"), `placeholderHeight` ("H"), pixel dimensions
- **Legitimate linguistic matches**: words that happen to be the same in the target language (e.g. French "images" = English "images", German "Format" = English "Format", "Transparent", "Position", "Original")
- **Adopted loanwords**: tech/media terms used as-is in the target language (e.g. German uses "Social Media", "Post", "Story", "Banner", "Cover", "Header", "Poster" — these are standard German vocabulary in digital contexts)

### DE detail

German extensively adopts English terms for tech/media. The unchanged strings are mostly standard German digital vocabulary: Format, Transparent, Domain, Layout, Original, Position, Auto (System), Social Media, Post, Story, Cover, Thumb, Header, Banner, Pin, Poster, Still, Cinema, Ep HD, Ep SD.

### FR detail

French shares Latin roots with English: Transparent, Format, Original, Position, Images ("$COUNT$ images"), and uses social media loanwords such as Post, Story and Still.

## Non-i18n text (by design)

The following items in `resize.html` are **not** routed through `messages.json`:

- **Brand names**: "TMDB", "TheTVDB" (section labels — proper nouns)
- **TheTVDB artwork type names**: "ClearArt", "ClearLogo" (official platform terminology, not routed through i18n)
- **Resolution labels**: "4K", "2K", "FHD", "HD", "800×600", "512²" (universal technical notation)
- **Aspect ratios**: "1:1", "4:5", "16:9", etc. (mathematical notation)

## Changelog

- v2.5.0: 255 keys (+66). Full-page capture, annotate tools (pixelate, blur, box, arrow, text, highlight, colour, thickness, undo/redo), all-tabs scan scope and tab filter, auto-scroll, file name templates and their variables, capture viewer (fit to window, crop, annotate, back to screenshot), support dialog, redact tool, transparency backgrounds, copy link, lossless quality label, all translated in the 18 locales.
- v2.4.1: 189 keys (+10). Editor presets in Settings (groups, own presets). English switched to sentence case; Portuguese (Portugal) consistent "tu" form, sentence case, "Cinzento", "Esc".
- v2.4.0: 162 keys. Added 13 keys for the redesigned UI (capture visible page, copy image/URLs, paste hint, filters, batch result, restricted-page and capture errors, empty-state hint, capture shortcut) in all 18 locales. Translated the theme labels that were still in English in ru, uk and tr, and the automatic theme label in pl. Removed 10 unused keys (`cmdQuickSave`, `presets`, `presetFree`, `resize`, `errorOnSaving`, `lockRatio`, `pTransform`, `pRotate`, `pHorizontal`, `pVertical`).
- v2.3.4: 159 keys. Added Google Lens setting labels, Google Lens disabled warning, inline data URL warning, and clearer privacy/footer wording for optional external actions.
- v2.3.4: 155 keys. Documentation updated after patch release. Locale override now also applies to background notifications, capture hints, and context menus.
- v2.3.4-b4: 154 keys (+39 vs v2.0). Added preset labels (19), size filter labels (11), tooltip hints (2), transform tools (7). Removed 3 dead keys. All strings translated in all 18 locales. FR/DE polish: `imagesFound` rewritten. PT: Poster→Cartaz, Cinema→Cinemagraph. Toast dark-mode fix. Converter copy button removed. Resize sidebar compacted. Rotate/flip tools added.
- v2.3.4-b3: 118 keys. Scanner improvements, no locale changes.
- v2.3.4: Initial 18-locale release.
