# Translation Audit — v2.1.1
Total keys: 155
Audit date: 2026-04-26

## Coverage

All 18 locale packs have 155/155 keys present (0 missing).

| Locale | Keys | Identical to EN | Breakdown |
|--------|------|-----------------|-----------|
| ar | 155 | 2 | 1 brand name, 1 universal |
| de | 155 | 24 | 2 universal, 22 legitimate loanwords |
| en | 155 | — | base locale |
| es | 155 | 15 | 1 universal, 14 legitimate |
| fr | 155 | 14 | 2 universal, 12 legitimate |
| it | 155 | 13 | 1 universal, 12 legitimate |
| ja | 155 | 4 | 1 universal, 3 legitimate |
| ko | 155 | 4 | 1 universal, 3 legitimate |
| nl | 155 | 13 | 2 universal, 11 legitimate |
| pl | 155 | 9 | 1 universal, 8 legitimate |
| pt_BR | 155 | 13 | 1 universal, 12 legitimate |
| pt_PT | 155 | 13 | 1 universal, 12 legitimate |
| ru | 155 | 5 | 1 universal, 4 legitimate |
| tr | 155 | 12 | 1 universal, 11 legitimate |
| uk | 155 | 5 | 1 universal, 4 legitimate |
| vi | 155 | 8 | 1 universal, 7 legitimate |
| zh_CN | 155 | 2 | 1 brand name, 1 universal |
| zh_TW | 155 | 2 | 1 brand name, 1 universal |

## Why "identical to EN" ≠ "untranslated"

Strings marked identical fall into these categories:

- **Universal (brand/dimensions)**: `extShortName` ("ImageToolkit"), `placeholderHeight` ("H"), pixel dimensions
- **Legitimate linguistic matches**: words that happen to be the same in the target language (e.g. French "images" = English "images", German "Format" = English "Format", "Transparent", "Position", "Original")
- **Adopted loanwords**: tech/media terms used as-is in the target language (e.g. German uses "Social Media", "Post", "Story", "Banner", "Cover", "Header", "Poster" — these are standard German vocabulary in digital contexts)

### DE detail (21 legitimate)

German extensively adopts English terms for tech/media. All of the following are standard German: Format, Transparent, Domain, Layout, Original, Position, Auto (System), Social Media, Post, Story, Cover, Thumb, Header, Banner, Pin, Poster, Still, Cinema, Ep HD, Ep SD.

### FR detail (10 legitimate)

French shares Latin roots with English: Transparent, Format, Original, Position, Images ("$COUNT$ images"), and uses social media loanwords: Post, Story, Still.

## Non-i18n text (by design)

The following items in `resize.html` are **not** routed through `messages.json`:

- **Brand names**: "TMDB", "TheTVDB" (section labels — proper nouns)
- **TheTVDB artwork type names**: "ClearArt", "ClearLogo" (official platform terminology, not routed through i18n)
- **Resolution labels**: "4K", "2K", "FHD", "HD", "800×600", "512²" (universal technical notation)
- **Aspect ratios**: "1:1", "4:5", "16:9", etc. (mathematical notation)

## Changelog

- v2.1.1: 155 keys. Documentation updated after patch release. Locale override now also applies to background notifications, capture hints, and context menus.
- v2.1.0-b4: 154 keys (+39 vs v2.0). Added preset labels (19), size filter labels (11), tooltip hints (2), transform tools (7). Removed 3 dead keys. All strings translated in all 18 locales. FR/DE polish: `imagesFound` rewritten. PT: Poster→Cartaz, Cinema→Cinemagraph. Toast dark-mode fix. Converter copy button removed. Resize sidebar compacted. Rotate/flip tools added.
- v2.1.0-b3: 118 keys. Scanner improvements, no locale changes.
- v2.0.0: Initial 18-locale release.
