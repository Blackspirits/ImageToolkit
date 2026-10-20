# Translation Audit — Unreleased (after v2.3.5)

Total keys: 162  
Audit date: 2026-09-29

## Coverage

All 18 locale packs have 162/162 keys present (0 missing). `npm run validate` enforces key parity, identical placeholders and `$TOKENS$` in every locale, and fails on keys that are defined but unused or used but undefined.

| Locale | Keys | Identical to EN |
|--------|------|-----------------|
| ar | 162 | 2 |
| de | 162 | 23 |
| en | 162 | — |
| es | 162 | 13 |
| fr | 162 | 12 |
| it | 162 | 13 |
| ja | 162 | 4 |
| ko | 162 | 4 |
| nl | 162 | 14 |
| pl | 162 | 8 |
| pt_BR | 162 | 11 |
| pt_PT | 162 | 11 |
| ru | 162 | 2 |
| tr | 162 | 9 |
| uk | 162 | 2 |
| vi | 162 | 8 |
| zh_CN | 162 | 2 |
| zh_TW | 162 | 2 |

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

- Unreleased: 162 keys. Added 13 keys for the redesigned UI (capture visible page, copy image/URLs, paste hint, filters, batch result, restricted-page and capture errors, empty-state hint, capture shortcut) in all 18 locales. Translated the theme labels that were still in English in ru, uk and tr, and the automatic theme label in pl. Removed 10 unused keys (`cmdQuickSave`, `presets`, `presetFree`, `resize`, `errorOnSaving`, `lockRatio`, `pTransform`, `pRotate`, `pHorizontal`, `pVertical`).
- v2.3.4: 159 keys. Added Google Lens setting labels, Google Lens disabled warning, inline data URL warning, and clearer privacy/footer wording for optional external actions.
- v2.3.4: 155 keys. Documentation updated after patch release. Locale override now also applies to background notifications, capture hints, and context menus.
- v2.3.4-b4: 154 keys (+39 vs v2.0). Added preset labels (19), size filter labels (11), tooltip hints (2), transform tools (7). Removed 3 dead keys. All strings translated in all 18 locales. FR/DE polish: `imagesFound` rewritten. PT: Poster→Cartaz, Cinema→Cinemagraph. Toast dark-mode fix. Converter copy button removed. Resize sidebar compacted. Rotate/flip tools added.
- v2.3.4-b3: 118 keys. Scanner improvements, no locale changes.
- v2.3.4: Initial 18-locale release.
