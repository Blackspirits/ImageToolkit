# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).


## [2.5.0] - 2026-10-21

### Added
- **Full-page capture**: scrolls and captures the page screen by screen and stitches it locally. Fixed and sticky elements (headers, chat buttons, cookie bars) appear once instead of on every slice, the scrollbar is left out, animations pause, lazy images load, and the page returns to where you were. Progress shows on the toolbar icon and Esc cancels. Very tall pages are scaled down (to 50%) before being cut. From the panel, the toolbar-icon menu or an assignable shortcut.
- **Annotate in the editor**: **redact** with opaque colour (the way to hide data for sure), pixelate (true block averages) and blur, draw boxes, arrows, outlined text and highlights; six colours, three thicknesses, undo/redo and one-key shortcuts. Pixel blocks and blur grow with the area covered. Works on the image as rotated/flipped and changes nothing until Apply (Ctrl+Enter).
- **Images inside iframes**, same-origin and cross-origin, are listed with the page's own (and outlined there when selected).
- **All tabs at once**: a scan scope that lists the images of every web page in the window, without duplicates, with a Tab filter. Each image keeps its page's site and title.
- **Load all images**: scrolls the page (or the scrolling area of app-like pages) to the end, wakes lazy images, waits for infinite scroll and collects images at every step, so feeds that unload old items lose nothing. Progress bar and Stop.
- **Copy image link** from a card or the preview (web images only).
- **File name templates**: `{name}` `{site}` `{domain}` `{title}` `{index}` `{width}` `{height}` `{format}` `{date}` `{time}`, `/` for folders (never outside Downloads), clickable variables and a live preview. Used by single downloads, batches, ZIP entries (never colliding) and the editor.

### Fixed
- Tabs left open from an earlier version are scanned correctly after the update (an old scanner left in the page no longer blocks the new one).
- Full-page capture can no longer hang: every step has a time limit and the whole capture a deadline; a page that stops scrolling ends it (with a notice that it may be incomplete); app-like pages are captured through their inner scrolling area; the page restores itself even if the extension stops midway.
- Captures stop if another tab comes to the front (even briefly) or the page navigates or reloads, so a screenshot never mixes in another page; a full-page capture talks only to the document it started in. The visible-tab capture brings its tab to the front first.
- Full-page capture never picks a hidden or off-screen scrolling panel, and a slice outside the screenshot is an error instead of a blank result; abandoned stitching canvases free themselves after five minutes.
- "Hide duplicates" no longer merges different pictures: only the host's case, the parameter order and tracking tags (`utm_*`, `fbclid`…) are ignored; the origin, the exact path and every other parameter count (`?id=1`/`?id=2`, `/Photo.png`/`/photo.png`, two ports, two timestamps stay apart).
- Two inline images with the same length and ending are both listed.
- All tabs: an image shown on several pages belongs to each of them, in the Tab filter and for `{site}`/`{title}`.
- Stop ends auto-scroll in the tab it runs in, even after switching tabs.
- The editor knows the page an image or screenshot came from, so `{site}` and `{title}` work there, and screenshots no longer get a made-up `local` domain.
- Long file names keep their extension when shortened.
- Editor: while annotating, everything behind the layer is inert (no Tab, click or screen reader reaches Save or Copy), and Save/Copy refuse to run until Apply or Cancel: an image could otherwise be exported without the redaction shown on screen.
- **Load all images** reaches the real bottom of the page on systems with classic scrollbars (Windows): a horizontal scrollbar used to stop it 15–17 px short, so infinite feeds never loaded their next batch. The end-to-end tests now run with real scrollbars, like those systems.
- All tabs + **Load all images** keeps the images a feed unloaded while scrolling, as the single-tab scope already did.
- A failed preview download is charged for the bytes it really received, so the per-scan preview budget caps traffic even when downloads fail.
- Editor: the stage takes the shape of a rotated, annotated image; a click outside a text field only confirms it; memory of full-resolution copies is freed at once.

### Changed
- The header theme button flips between light and dark; **Automatic** (follows Windows/macOS or Chrome) is chosen in Settings. The icon shows the theme on screen.
- Transparency background in the image grid: **checkerboard** (follows the theme), **white**, **grey** or **black**, like the editor's; the button shows the one in use.
- Editor: with PNG (lossless) the quality row stays in place, disabled and labelled **Lossless**, instead of disappearing and moving the buttons below.
- The editor opens with the whole image selected, so saving a capture straight away never trims its edges.
- **AVIF is offered as an output only where the browser can write it** (Chrome cannot yet: it used to silently produce WebP). It appears by itself the day it can. Reading, listing, filtering and downloading AVIF images as they are is unchanged; a saved "AVIF" default becomes WebP.
- The capture delay also applies to **Capture visible page** (time to open a menu or hover something) and counts down on the toolbar icon.
- **Esc** cancels a full-page capture from the side panel too; from the toolbar popup, the popup closes so Esc reaches the page.
- Full-page captures of chats and virtual lists (Discord, Slack…) never contain empty bands: the capture stops where the page jumps and the image is trimmed to what was captured, with the "may be incomplete" notice.
- The panel's count, duplicates, background and layout bar stays under the search bar while the images scroll.
- Nothing the extension loads by itself carries cookies or can set them: thumbnails, previews, size and type checks and the hotlink fallback (a `declarativeNetRequest` rule limited to the extension's own image requests, plus `credentials: 'omit'` on its automatic fetches). The panel shows no thumbnail before that rule is in place (if Chrome refuses it, thumbnails come only through the cookie-less download). Only the actions you ask for send cookies. Every image download has a total and an idle time limit.
- The offscreen document answers only the service worker, through direct replies; requests time out instead of waiting forever.
- Every screen capture respects Chrome's rate limit (two per second), queued, and retries once when refused.
- Large images handed to the editor travel as Blobs and are shown through `blob:` URLs, without a base64 copy; an open editor keeps its image for up to 12 hours.

## [2.4.1] - 2026-10-20

### Added
- **Editor presets in Settings**: show or hide each preset group (aspect ratios, social media, common sizes, TMDB, TheTVDB) and add up to 24 sizes of your own, which appear first in the editor as "My presets". Synced with your other settings, in all 18 languages.

### Fixed
- Drop-down lists open as rounded menus in the theme's colours (Chrome 135+), the capture delay included, instead of a square white system list.
- Selected images are no longer left outlined on the page after the panel closes or moves to another tab.
- The image handed to the editor (a screenshot can be private) is deleted as soon as the editor window closes, instead of up to 30 minutes later.
- Large ZIPs and edited images no longer depend on the page that started them: the action popup closing on Save As can no longer cut the download.
- The selection bar fits every panel width (down to Chrome's 320 px side panel); the header and toolbar no longer overlap or overflow there, and the last row of images is never hidden under the bar.
- A page with no images (or one the browser does not let extensions read) now shows 0 images, and "Select all" no longer acts on the previous page.
- Files opened from disk in Tools keep their own name when converted or resized (e.g. `holiday.webp`, not `image.webp`); `blob:` images no longer get a random id as their name.

### Changed
- English interface text uses sentence case throughout, like Chrome's own menus.
- Format names read the same everywhere (`WebP`, not `WEBP`); the Format advisor no longer uses an emoji.
- Unchecked selection boxes on image cards are easier to see on the light theme.
- Portuguese (Portugal): consistent "tu" form, sentence case, "Cinzento", "Esc".

## [2.4.0] - 2026-10-01

### Added
- **Accessible controls**: segmented choices (format, theme) are proper radio groups with a name, one Tab stop and arrow keys; the image grid is a single Tab stop with arrow-key navigation inside it (card actions stay available in the preview); icon buttons are labelled in every language.
- The live "new images" notice also recognises inline SVG, `<picture>` sources and inline-style backgrounds added after the scan.
- **Transparency background switch** in the image grid (automatic, light or dark), so dark icons stay visible on the dark theme and light ones on the light theme.
- **New logo**: a continuous image frame that opens into an export arrow, on the brand gradient tile. Vector sources, usage rules and a light/dark wordmark live in `docs/brand`, with three cuts (Master, Compact for 32/48 px, Micro for 16 px), a 128 px store icon with the Web Store's 16 px padding, and `npm run build:icons` to re-render the PNG set.
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
- Colour contrast meets WCAG AA for every text/background token pair in both themes (secondary text on every surface, status colours on their tinted backgrounds, white on the primary button and badges), enforced in CI by `npm run check:contrast`.
- `npm test` (unit), `npm run test:e2e` (Playwright, real extension), `npm run build` (reproducible Web Store ZIP) and a GitHub Actions workflow.

### Fixed
- Context menu "Save as…", "Copy", "Resize" and "Open in editor" work again on images a page builds with its own script (`blob:http(s)://…` URLs), which this release had started refusing with "Unsupported image URL". Only blob URLs of web pages are accepted, only for the image the user acts on; the scanner and every other scheme (`file:`, `javascript:`, `chrome:`, `chrome-extension:`…) stay excluded.
- Inline SVG icons are listed at the size the page renders them (or their absolute width/height), not at their viewBox: a 24 px icon with `viewBox="0 -960 960 960"` was shown as 960×960, sorted above real photos and counted as "large". Hidden sprite sheets are no longer listed.
- Resize sizes over 16384 px are refused with an error (in the panel and in the service worker) instead of being dropped, which saved the original image and reported success.
- Editor: after typing an output size, changing the crop (or unlocking a fixed preset) kept stale numbers and saved a different size; the typed side is now kept, the other follows the crop, and the file is exactly the size shown, never stretched.
- Area capture no longer falls back to the whole screenshot when cropping fails; it reports the error. Selections are validated.
- Transparency in a small area of a large image (a few pixels) is detected, so the Format Advisor no longer recommends JPG for it.
- Size probing reads the full size of ranged (206) answers instead of the 1-byte slice.
- Format Advisor: a new source hides the previous figures and cancels the previous analysis immediately.
- Bounded resources: one scan's message (8 MiB per inline image, 24 MiB in total), size probes (2 MiB per image, 8 MiB per batch), preview/dimension downloads (40 images, 48 MiB per scan, reserved before each download starts so parallel downloads cannot exceed it, reset on every scan) and ZIPs (256 MiB, checked before and during the batch, kept as bytes rather than base64).
- Files saved from the editor and ZIP archives larger than ~36 MiB are handed to Chrome as a blob URL, released when the download finishes, instead of a base64 message. Images converted by the service worker are capped at 40 MiB, whose base64 (~53 MiB) still fits one 64 MiB message.
- Non-text contrast (WCAG 1.4.11): fields, outlined buttons, chips, switches when off and the selected segment reach 3:1 in both themes; `npm run check:contrast` now checks these pairs and that the controls use them.
- Upgrades remove the editor hand-off image that 2.3.5 could leave in `chrome.storage.local`.
- Plurals ("1 image", "1 new image found"), the "Automatic (browser)" language option, the subfolder note naming the real "Ask save location" option, and the editor's "Quality" label are translated in all 18 languages; pt-PT and pt-BR use sentence case and "ex.:".
- Inline SVG icons keep the colours the page paints them with (currentColor and CSS fills) instead of turning black.
- The "new images" banner counts only images the panel has not listed yet, instead of every re-render on the page.
- Editor: the crop size and the output size use the same rounding, so they no longer differ by one pixel; with the ratio locked, typing one crop side fills in the other.
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
- The preview acts on the image it shows, even if late size probes re-sort the grid underneath it.
- "Custom" in the editor lets the output size follow the crop again after a fixed-size preset (it used to stretch the new crop).
- Quick successive setting changes no longer overwrite each other.
- In Tools, a slow earlier image (URL or file) can no longer replace a newer one.
- The Format Advisor in one window no longer cancels another window's analysis; a new request in the same window aborts the old download.
- Hotlink-protected images get their dimensions (and thumbnails) through the extension, so size filters no longer hide them.
- Closing Save As for a ZIP ends quietly instead of reporting success.
- Downloads without Content-Length stop at the 40 MB cap instead of being read in full first; encoded results and local files over the cap are refused before being expanded to base64.
- Shift-click ranges use the anchor image, not a position that filtering may have changed.
- The editor stage keeps the image proportions for extreme panoramas.
- Tabs follow the WAI-ARIA pattern (arrow keys, roving tabindex), the preview dialog traps focus and makes the background inert, and selection state is exposed on a real checkbox.
- "Original" detects SVG by its content, so SVGs served as `text/plain` or XML are saved correctly; other unknown types fall back to the URL extension, while HTML error pages are still refused.

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
