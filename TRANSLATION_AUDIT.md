# Translation Audit — v2.1.0 (build 4)
Total keys: 154
Audit date: 2026-03-28

## Coverage

All 18 locale packs have 154/154 keys present (0 missing).

| Locale | Keys | Identical to EN | Breakdown |
|--------|------|-----------------|-----------|
| ar | 154 | 1 | 1 brand name |
| de | 154 | 23 | 2 universal, 21 legitimate loanwords |
| en | 154 | — | base locale |
| es | 154 | 13 | 1 universal, 12 legitimate |
| fr | 154 | 12 | 2 universal, 10 legitimate |
| it | 154 | 13 | 1 universal, 12 legitimate |
| ja | 154 | 3 | 1 universal, 2 legitimate |
| ko | 154 | 3 | 1 universal, 2 legitimate |
| nl | 154 | 13 | 2 universal, 11 legitimate |
| pl | 154 | 9 | 1 universal, 8 legitimate |
| pt_BR | 154 | 13 | 1 universal, 12 legitimate |
| pt_PT | 154 | 13 | 1 universal, 12 legitimate |
| ru | 154 | 4 | 1 universal, 3 legitimate |
| tr | 154 | 11 | 1 universal, 10 legitimate |
| uk | 154 | 4 | 1 universal, 3 legitimate |
| vi | 154 | 8 | 1 universal, 7 legitimate |
| zh_CN | 154 | 1 | 1 brand name |
| zh_TW | 154 | 1 | 1 brand name |

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

- v2.1.0-b4: 154 keys (+39 vs v2.0). Added preset labels (19), size filter labels (11), tooltip hints (2), transform tools (7). Removed 3 dead keys. All strings translated in all 18 locales. FR/DE polish: `imagesFound` rewritten. PT: Poster→Cartaz, Cinema→Cinemagraph. Toast dark-mode fix. Converter copy button removed. Resize sidebar compacted. Rotate/flip tools added.
- v2.1.0-b3: 118 keys. Scanner improvements, no locale changes.
- v2.0.0: Initial 18-locale release.
