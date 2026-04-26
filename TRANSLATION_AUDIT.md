# Translation Audit — v2.3.4

Total keys: 159  
Audit date: 2026-04-26

## Coverage

All 18 locale packs have 159/159 keys present (0 missing).

| Locale | Keys | Identical to EN | Breakdown |
|--------|------|-----------------|-----------|
| ar | 159 | 2 | 1 brand name, 1 universal |
| de | 159 | 24 | 2 universal, 22 legitimate loanwords |
| en | 159 | — | base locale |
| es | 159 | 15 | 1 universal, 14 legitimate |
| fr | 159 | 14 | 2 universal, 12 legitimate |
| it | 159 | 13 | 1 universal, 12 legitimate |
| ja | 159 | 4 | 1 universal, 3 legitimate |
| ko | 159 | 4 | 1 universal, 3 legitimate |
| nl | 159 | 13 | 2 universal, 11 legitimate |
| pl | 159 | 9 | 1 universal, 8 legitimate |
| pt_BR | 159 | 13 | 1 universal, 12 legitimate |
| pt_PT | 159 | 13 | 1 universal, 12 legitimate |
| ru | 159 | 5 | 1 universal, 4 legitimate |
| tr | 159 | 12 | 1 universal, 11 legitimate |
| uk | 159 | 5 | 1 universal, 4 legitimate |
| vi | 159 | 8 | 1 universal, 7 legitimate |
| zh_CN | 159 | 2 | 1 brand name, 1 universal |
| zh_TW | 159 | 2 | 1 brand name, 1 universal |

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

- v2.3.4: 159 keys. Added Google Lens setting labels, Google Lens disabled warning, inline data URL warning, and clearer privacy/footer wording for optional external actions.
- v2.3.4: 155 keys. Documentation updated after patch release. Locale override now also applies to background notifications, capture hints, and context menus.
- v2.3.4-b4: 154 keys (+39 vs v2.0). Added preset labels (19), size filter labels (11), tooltip hints (2), transform tools (7). Removed 3 dead keys. All strings translated in all 18 locales. FR/DE polish: `imagesFound` rewritten. PT: Poster→Cartaz, Cinema→Cinemagraph. Toast dark-mode fix. Converter copy button removed. Resize sidebar compacted. Rotate/flip tools added.
- v2.3.4-b3: 118 keys. Scanner improvements, no locale changes.
- v2.3.4: Initial 18-locale release.
