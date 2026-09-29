# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).


## [Unreleased]

### Added
- **Redesigned interface** for the popup, side panel and editor: new design system (light/dark/auto), segmented tabs, collapsible filters, image cards with hover actions, floating selection bar, skeleton loading, toasts and an SVG icon set. System fonts only, no network.
- **Three grid layouts** (grid, compact, list), search that also matches alt text, and a filter indicator with one-click reset.
- **Keyboard support**: arrow-key navigation, Enter to preview, Space to select, Shift-click ranges, Ctrl/⌘-click toggles, `/` to search, Ctrl/⌘+A to select all, Esc to clear; ← / → to browse in the preview.
- **Preview navigation** between the filtered images, with copy, edit, open and Google Lens actions.
- **Copy image** from any card, the preview and the editor; **Copy URLs** for the whole selection.
- **Paste to open**: Ctrl/⌘+V with an image or image URL loads it in Tools; images can also be dragged in from web pages.
- **Capture visible page**, a 10-second capture delay, capture actions on the toolbar icon's right-click menu, and a working `Alt+Shift+S` shortcut for area capture.
- The side panel **follows the active tab** and rescans after page loads.
- **Editor**: floating transform bar, sticky footer (format, quality, Copy, Save), collapsible preset sections, exact crop sizes, proportional output size, `Ctrl/⌘+S` / `Ctrl/⌘+C`, and a fixed Instagram Story preset (1080×1920).
- **Format Advisor** shows the original size next to PNG/JPG/WebP as bars and preselects the best format.
- Hotlink-protected thumbnails are loaded through the extension instead of showing a broken image.
- Google Lens appears in the image right-click menu when enabled.
- Right-to-left layout for Arabic and correct `lang` for screen readers.
- `npm test` (unit), `npm run test:e2e` (Playwright, real extension), `npm run build` (reproducible Web Store ZIP) and a GitHub Actions workflow.

### Fixed
- "Original" downloads now keep the exact source bytes instead of re-encoding through the canvas. SVGs are no longer saved as PNG data with a `.svg` extension, GIFs keep their animation and JPEGs are not recompressed.
- Saved files are named after the format actually produced. AVIF requests (not encodable by Chrome's canvas) fall back to WebP and are saved as `.webp` instead of `.avif`; the crop editor no longer writes PNG data to `.avif` files.
- Batch downloads no longer open one Save As dialog and one notification per image, and now report how many images failed.
- Changing any setting no longer erases the saved "at least" size filter.
- Copying an image from the right-click menu now puts a real PNG on the clipboard (it used to depend on a document that never has focus).
- Large screenshots no longer fail silently when opened in the editor (IndexedDB handoff instead of the 10 MB `storage.local`), and several editor windows no longer overwrite each other's image.
- The "Resize Behavior" setting (crop/fit) is now applied in Tools; fit mode keeps transparency instead of painting black bars.
- The editor no longer overflows the window and the Save button is always visible.
- Card actions are no longer clipped in the grid; dark-theme text colours are applied consistently.
- Scanning or capturing browser pages now shows a clear message instead of doing nothing.
- The capture overlay is removed from the screen before the screenshot is taken, the selection keeps tracking outside the window, and it is clamped to the captured bitmap.
- Background images on `position: fixed` elements are found; `javascript:`, `file:` and `blob:` URLs are no longer listed; srcset URLs containing commas are parsed correctly.
- Re-injecting the scanner no longer throws or duplicates listeners; the page observer stops when idle.
- Size probing no longer downloads whole files without limit.
- Long non-Latin filenames (e.g. Japanese) are no longer reduced to `image`.
- "Saved as" messages now show the real output format; substitutions containing `$` are no longer mangled.
- Download options (subfolder, file name pattern) now also apply to right-click saves.
- A failed offscreen document creation no longer blocks every later conversion until the browser restarts.
- The Format Advisor downloads and decodes the image once for all formats (it used to fetch it three times), and a newer image supersedes a pending analysis.
- Downloads that Chrome does not start are reported as errors, and closing the Save As dialog no longer shows "Saved".

### Changed
- Google Lens is now opt-in (off by default).
- Oversized outputs (more than 16384 px per side or 100 MP) and inputs above 40 MB are rejected with a clear error.
- Shared code moved to `lib/` (`core.js`, `i18n.js`, `ui.js`, `ui.css`, `handoff.js`); the validator now also checks file references, placeholders, unused and undefined i18n keys, and version parity.

### Security
- The background service worker and offscreen document only accept privileged messages from extension pages; content scripts are limited to the capture and new-images notifications.
- Instructions received by the service worker are validated (formats, sizes, quality, colours).
- The sender check no longer depends only on `MessageSender.url` (an optional field): it falls back to `origin`, and refuses anything it cannot prove is an extension page.

### Removed
- The unused `activeTab` permission (covered by the existing host permission).
- The Ko-fi GIF (replaced by an icon) and unused i18n keys.

## [2.3.5] - 2026-04-27

### Fixed
- Fixed the action popup layout when the Side Panel option is disabled.
- Added explicit popup vs side-panel mode detection for the shared popup UI.
- Re-applied Side Panel click behaviour when the background service worker starts.

## [2.3.4] - 2026-04-26

### Changed
- Shortened `extDescription` in all locales to stay within the Chrome manifest description limit.
- Removed the redundant `tabs` permission to reduce install-time permission warnings.
- Updated privacy documentation for `chrome.storage.sync`.
- Prepared a cleaner Chrome Web Store runtime bundle excluding development files and unused brand assets.

## [2.3.3] - 2026-04-26

### Changed

- Refined the toolbar icon with a more zoomed-in app-style variant for better visibility at small sizes.
- Increased the rounded-corner treatment of the icon assets for a more modern browser-toolbar look.
- Kept the crop/resize UI improvements from v2.3.2 unchanged.

## [2.3.2] - 2026-04-26

### Changed

- Enlarged the custom crop/resize window again to provide a noticeably larger workspace and reduce the need for scrolling.
- Increased the visible workspace margins around the cropper and tuned the initial crop size so controls are no longer glued to the edges.
- Hid unnecessary horizontal overflow in the editor and improved sidebar fitting.
- Refined transform buttons so the rotate icon is no longer clipped.
- Regenerated the extension icon set with a tighter zoom so the mark is clearer at small browser-toolbar sizes.

## [2.3.1] - 2026-04-26

### Changed

- Enlarged the custom crop/resize window for a larger image workspace and better control visibility.
- Added extra workspace padding around the cropper so resize/rotate handles are no longer clipped or glued to the window edge.
- Restored the previous ImageToolkit brush/logo concept and regenerated the icon set with a larger, more visible app-style mark.
- Updated extension version to 2.3.1.

## [2.3.0] - 2026-04-26

### Added

- Added the new original ImageToolkit logo and refreshed extension icon set.
- Added source logo assets for GitHub, releases, and Chrome Web Store preparation.

### Changed

- Updated extension version to 2.3.0.
- Updated README branding section.
- Updated MIT license copyright year to 2026.

## [2.2.0] - 2026-04-26

### Added

- Added a user setting to enable or disable the Google Lens external search action.
- Added a lightweight validation script for manifest, JavaScript syntax, and i18n key parity.

### Changed

- Remote type and size probes now use a small in-memory cache to reduce repeat network requests during a session.
- Resize URL tool code is now easier to read and debug without changing behaviour.
- Settings footer and privacy wording now make user-triggered external actions clearer.

### Fixed

- Google Lens action now shows localized warnings when disabled or when the image is an inline data URL.

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
