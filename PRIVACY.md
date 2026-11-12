# Privacy Policy — ImageToolkit

**Last updated:** 2026-10-22

## Summary

ImageToolkit works on the pages you open it on: it reads the images of those pages, and the screenshots you take, which can contain personal information (names, messages, account details…). **All of this is handled locally in your browser.** Nothing is sent to the author: ImageToolkit has no servers, no account, no analytics and no telemetry, and it does not sell or share data.

What does leave your browser are the requests to the **image addresses found in the page** (to show and save them), described below, and the pages you choose to open (Google Lens, links).

## What is handled, and where

- **Page content** — image addresses, dimensions and alt text of the pages you scan, and the screenshots you take. Kept in the extension's memory while you use it; screenshots and images opened in the editor are also stored **temporarily** in the extension's local storage (see *Local Storage*) until the editor closes.
- **Files you save** — written to your Downloads folder only when you save, copy or download.
- **Settings** — your preferences, synced by Chrome if you use Chrome Sync.
- **Never** — your browsing history, form data, passwords or cookies are not read or stored. No remote code is loaded, and ImageToolkit sets no cookies of its own.

## Image Processing

All image conversion, resizing, cropping, and optimization happens **entirely locally** in your browser using the Canvas API.

When you **ask** for something done with a remote image (save, convert, copy, open in the editor), the extension fetches that image URL directly from your browser. These requests include your normal browser cookies for that image host, so images behind a login keep working; ImageToolkit never reads, stores, or transmits those cookies elsewhere. Every download has a time limit, so a server that stops answering cannot keep it waiting.

### Automatic requests for previews and metadata

While the panel shows a page's images, the extension **contacts the hosts of those images automatically**, without a click, to show their type, file size, dimensions and thumbnails. These requests go only to image addresses **found in the page you are scanning**: the images it shows, but also ones it only references and may never have downloaded itself (other sizes in `srcset`/`<picture>`, `og:image` and Twitter card images, preloads, icons, links to image files). They may therefore reach hosts the page had not contacted. Nothing about you or the page is sent beyond the request itself:

- **Lightweight first:** a `HEAD` request or a 1-byte range request, which returns headers only.
- **Limited reads when needed:** if a server gives no size in its headers, the extension reads the start of the image to count its size, at most 2 MB per image and 8 MB in total per request batch, then stops; past that, the size stays unknown.
- **Previews of protected images:** if a site refuses to show an image directly (hotlink protection), the extension downloads it to display the thumbnail and read its dimensions: at most 40 images, 8 MB each and 48 MB in total per scan, 20 seconds each. These downloads are sent **without cookies**.
- **No automatic request carries your cookies or can set any.** This covers the thumbnails and previews the panel shows, size and type checks and the fallback downloads: Chrome would otherwise attach your cookies for those hosts to the extension's requests, so ImageToolkit removes them (and any `Set-Cookie` in the answers) with a browser rule limited to its own image requests. The panel waits for that rule before showing any thumbnail; if Chrome ever refuses it, thumbnails are only downloaded the cookie-less way instead. Only the actions you ask for (above) send cookies.
- At most 100 images per scan are checked for size and 30 for type.

These requests only read data; they are never used to send data anywhere. **Google Lens and the Ko-fi and author links are different**: they never run automatically and only open when you click them (see below).

## Page Content

- **Image scanner** — when you open the panel, a script is injected into the current tab (and its frames) to list its images (URLs, dimensions, alt text). Only if you choose **All tabs**, the same happens in every web page open in that window; browser pages and sleeping tabs are skipped. The list stays in the panel; it is never stored or sent anywhere. Very large inline images are left out of the list to keep it fast. While the panel is in use, the script watches the page for newly loaded images and stops after a few idle minutes.
- **Load all images** — only when you click it, the page is scrolled to its end to load lazy images and then scrolled back; nothing is clicked or submitted.
- **Screen capture** — only when you start a capture (button, toolbar menu, or keyboard shortcut), the visible part of the tab is captured and opened in the capture viewer, in a new tab. A full-page capture scrolls the page, captures it screen by screen and stitches the result locally, temporarily hiding fixed elements, then restores the page. A capture is never written to your files unless you save it; while its tab is open it is kept in the extension's local storage (see *Editor handoff*).
- **Capture checks** — a capture belongs to the tab it started in: if another tab comes to the front or the page navigates, it stops, so a screenshot never mixes in another page.
- **Annotations** made in the editor are drawn locally on your copy of the image. To hide information for sure, use **Redact** (opaque colour): pixelate and blur are visual effects and may leave large text recognisable.

## Local Storage

- **Settings** are stored with `chrome.storage.sync`, which Chrome may synchronize across your signed-in browsers. ImageToolkit can only read and write its own settings and has no access to your Google Account or other sync data.
- **Editor handoff** — when an image or capture is opened in the capture viewer or the editor, it is kept in the extension's own IndexedDB so that tab can load it (and reload it, or go from the viewer to the editor). It is deleted as soon as that tab closes or leaves for another page. As a safety net, an editor entry older than 12 hours (any other entry: 30 minutes) is never shown again and is removed on the next cleanup pass (at startup or when another image is opened in the editor).
- **Large downloads** — files too large to pass between the extension's pages in one message (big ZIPs or edited images) are kept briefly in the same IndexedDB store and removed as soon as the download has started.
- **Interface state** (grid layout, transparency background, whether filters are open, scan scope) is kept in the extension's local storage.
- **Upgrades** — version 2.3.5 and earlier passed images to the editor through `chrome.storage.local`; any image left there is deleted when the extension updates or starts.

## Clipboard

The clipboard is only written when you ask to copy an image, a URL list, or an edited result. ImageToolkit never reads your clipboard: pasting into the panel uses the normal paste action you trigger with Ctrl/⌘+V.

## Optional External Services

Apart from the image hosts described above, ImageToolkit contacts no other service automatically. The following actions, only when you click them, open external sites:

- **Google Lens** — off by default. If you enable it in Settings and click the search action, the **full image URL** (including any query string it carries, which on some sites holds an access token) is opened with Google Lens in a new tab, so Google receives it. The image itself is not uploaded by ImageToolkit.
- **Ko-fi / BlackSpirits** — if you click the support or author links, those pages open in a new tab.

## Permissions Explained

| Permission | Why it's needed |
|---|---|
| `contextMenus` | Adds the "Save image as…" right-click menu and toolbar-icon capture actions |
| `downloads` | Saves converted images and ZIP files to your computer |
| `storage` | Saves your preferences |
| `notifications` | Shows save/copy confirmations and errors for right-click actions (can be disabled) |
| `offscreen` | Runs the Canvas API for image conversion in the background |
| `clipboardWrite` | Copies images or image URLs to your clipboard when you ask |
| `declarativeNetRequestWithHostAccess` | One rule that removes cookies from the images the extension's own pages load by themselves (thumbnails, previews); it never touches web pages' own requests |
| `scripting` | Injects the image scanner and the capture overlay, on demand only |
| `sidePanel` | Shows the extension UI as a docked side panel |
| `<all_urls>` | Scans pages and fetches images from any website for conversion, copying, and downloading; captures the visible tab |

## Third-Party Libraries

- **JSZip** (MIT License) — used locally to create ZIP files for batch downloads. No network requests.
- **Cropper.js** (MIT License) — used locally for the editor. No network requests.

## Contact

If you have questions about this privacy policy, please open an issue on the [GitHub repository](https://github.com/BlackSpirits/ImageToolkit).
