# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [2.1.1] - 2026-04-26

### Fixed

- Language override now applies to background notifications, capture hints, and context menu labels.
- Context menus are rebuilt when the language setting changes.
- Translation audit updated to the current 155-key locale packs.
- Privacy and README wording now reflect user-triggered external actions such as Google Lens and Ko-fi.

### Changed

- Removed obsolete social preset context-menu code and the unused `enableSocialPresets` setting.
- Merged the side-panel message handler into the main background message listener.
- Limited remote size probing to 100 URLs per scan to reduce request spikes on image-heavy pages.
- Improved subfolder filename sanitization to avoid unsafe path segments.
- Highlight traversal no longer uses `querySelectorAll('*')` on the main document.

### Removed

- Removed unused `loadImageAsDataUrl()` helper from `resize.js`.

## [2.1.0] - 2026-03-24

### Added

- **Scroll Detection**: MutationObserver monitors DOM for new images (lazy load, infinite scroll) with animated banner and Refresh button
- **Download Options**: subfolder, filename pattern (original/system/custom prefix), convert on download, ZIP by default
- **Google Lens**: per-card search similar button opens `lens.google.com/uploadbyurl`
- **Capture Delay**: 0s / 3s / 5s timer before screenshot overlay injection
- **Language Selector**: override browser language in Settings (18 locales available)
- `data:image/` collection: SVG base64, PNG inline with dedup and file size estimation

### Changed

- All toolbar icons replaced with inline SVGs (moon/sun, refresh, select all, layout, DUP, capture, lock/unlock)
- `detectType` now handles `data:image/*` URLs correctly
- `batchDl` now applies Download Options (subfolder, filename, convert)
- `loadDimsFromUrl` has 8s timeout to prevent infinite hangs
- Theme save uses spread operator to prevent race conditions

### Fixed

- Clipboard "Document is not focused" — offscreen.js uses `execCommand('copy')` fallback
- Toast readability in dark mode with explicit background colors
- Header buttons (Ko-fi + theme) now equal 34×34px

## [2.0.0] - 2026-03-22

### Added

- **Capture Area**: screenshot tool with visual selection overlay (draw rectangle on page, crop via offscreen canvas, opens in resize tool)
- **Image Highlight on Page**: selecting images in the panel highlights them on the page with a purple outline border
- Highlight syncs with Select All / Deselect All
- `capture.js` content script for selection overlay UI
- `offscreen-crop` pipeline for screenshot cropping

### Changed

- All remaining hardcoded English titles now use `data-i18n-title` (Ko-fi, White/Gray/Black, Lock ratio)
- Capture button uses inline SVG matching toolbar style
- Highlight border: 2px solid, 1px offset (thinner, more defined)

### Fixed

- Version aligned across `manifest.json`, `popup.html`, and `CHANGELOG.md`

## [1.0.2] - 2026-03-22

### Changed

- Improved metadata enrichment so width × height backfills more reliably, including a fetch-to-data-URL fallback for stubborn cross-origin images
- Kept image-card action SVGs on the same outline icon system used across the rest of the UI
- Refreshed icon assets and logo again for a cleaner, more product-like identity
- Updated the translation audit to reflect current locale-pack coverage

## [1.0.1] - 2026-03-22

### Changed

- Replaced the extension logo and refreshed icon assets for a cleaner, more modern look
- Unified image-card action icons with the same outline style used across the UI
- Improved clipboard copy flow by routing data URL copies through the offscreen document instead of relying on popup focus
- Added extra metadata enrichment so missing image dimensions are backfilled more aggressively
- Added a translation audit and polished pt-PT / pt-BR wording in key strings

## [1.0.0] - 2026-03-21

### Added

- **Format conversion**: Save images as PNG, JPG, WebP, or AVIF via right-click context menu
- **Image grid**: Visual grid of all page images with thumbnails, dimensions, type badges
- **Filters**: Filter by format type, size range (≥500px / 100–499px / <100px), and domain
- **Duplicate detection**: URL-based heuristic dedup with visual DUP badge and hide toggle
- **Type probing**: Async HEAD/GET probe for images with unrecognizable URL extensions
- **Smart Format Advisor**: Analyzes images and recommends the best format with estimated sizes
- **Copy to Clipboard**: Copy converted images directly to clipboard (PNG)
- **Preview modal**: Click any image in the grid for an enlarged preview with download/copy/resize actions
- **Custom resize**: Resize images to any dimension with aspect ratio lock
- **Social media presets**: Instagram Post/Story, YouTube Thumbnail, TikTok, X/Twitter, LinkedIn Banner, HD Wallpaper
- **Batch download**: Select images from the grid, download individually or as ZIP, with format conversion
- **Quality control**: Adjustable quality slider (10–100%) for lossy formats
- **JPG transparency handling**: White background fill when converting transparent images to JPG
- **AVIF fallback**: Automatic fallback to WebP on browsers without AVIF support
- **Dark/Light/Auto theme**: Follows system preference or manual override
- **Side panel**: Open as a docked side panel for persistent access
- **Keyboard shortcut**: `Alt+Shift+S` for quick save in default format
- **18 locale packs (4 fully translated, 14 partial)**: en, pt_PT, pt_BR, fr, es, de, it, ar, ja, ko, ru, zh_CN, zh_TW, vi, nl, pl, tr, uk
- **Privacy-first**: 100% local processing, zero data collection
- **Filename sanitization**: Unicode-safe, Windows reserved name handling, UTF-8 safe truncation
- **Save notification**: Shows original vs. new file size with compression percentage

### Architecture

- Manifest V3 with `host_permissions`
- Offscreen document for Canvas-based conversion (no page injection for conversion)
- On-demand content script with TreeWalker-based scanner
- Single DOM pass collects `<img>`, shadow roots, and targeted CSS background images
- JSZip bundled locally for ZIP creation
