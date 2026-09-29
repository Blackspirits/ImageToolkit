# Privacy Policy — ImageToolkit

**Last updated:** 2026-09-29

## Summary

ImageToolkit does **not** collect, store, sell, or share personal data. Image processing runs locally in your browser.

## Data Collection

This extension collects **zero** data. Specifically:

- **No personal information** is collected
- **No browsing history** is accessed or stored
- **No images are uploaded** to ImageToolkit servers (there are none)
- **No analytics or telemetry** of any kind
- **No cookies** are set by ImageToolkit
- **No remote scripts** are loaded

## Image Processing

All image conversion, resizing, cropping, and optimization happens **entirely locally** in your browser using the Canvas API.

When you use features that work with remote images, the extension fetches those image URLs directly from your browser so it can inspect, convert, copy, resize, or download them. Requests include your normal browser cookies for those image hosts, so images behind a login keep working; ImageToolkit never reads, stores, or transmits those cookies elsewhere.

To show file sizes and types in the image grid, the extension may send lightweight `HEAD` or 1-byte range requests to the image URLs found on the page, with strict limits on the number of requests and on how much data is read.

## Page Content

- **Image scanner** — when you open the panel, a script is injected into the current tab to list its images (URLs, dimensions, alt text). The list stays in the panel; it is never stored or sent anywhere. While the panel is in use, the script watches the page for newly loaded images and stops after a few idle minutes.
- **Screen capture** — only when you start a capture (button, toolbar menu, or keyboard shortcut), the visible part of the tab is captured and opened in the editor. Captures are not saved unless you save them.

## Local Storage

- **Settings** are stored with `chrome.storage.sync`, which Chrome may synchronize across your signed-in browsers. ImageToolkit can only read and write its own settings and has no access to your Google Account or other sync data.
- **Editor handoff** — when an image or capture is opened in the editor, it is kept in the extension's own IndexedDB so the editor window can load it. These entries expire after 30 minutes: an expired entry is never shown again and is deleted when it is next looked up or on the extension's next cleanup pass (at startup or when another image is opened in the editor).
- **Interface state** (grid layout, whether filters are open) is kept in the extension's local storage.

## Clipboard

The clipboard is only written when you ask to copy an image, a URL list, or an edited result. ImageToolkit never reads your clipboard: pasting into the panel uses the normal paste action you trigger with Ctrl/⌘+V.

## Optional External Services

ImageToolkit does not contact third-party services automatically. The following user-triggered actions may open external sites:

- **Google Lens** — off by default. If you enable it in Settings and click the search action, the image URL is opened with Google Lens in a new tab.
- **Ko-fi / BlackSpirits** — if you click the support or author links, those pages open in a new tab.

## Permissions Explained

| Permission | Why it's needed |
|---|---|
| `contextMenus` | Adds the "Save Image As…" right-click menu and toolbar-icon capture actions |
| `downloads` | Saves converted images and ZIP files to your computer |
| `storage` | Saves your preferences |
| `notifications` | Shows save/copy confirmations and errors for right-click actions (can be disabled) |
| `offscreen` | Runs the Canvas API for image conversion in the background |
| `clipboardWrite` | Copies images or image URLs to your clipboard when you ask |
| `scripting` | Injects the image scanner and the capture overlay, on demand only |
| `sidePanel` | Shows the extension UI as a docked side panel |
| `<all_urls>` | Scans pages and fetches images from any website for conversion, copying, and downloading; captures the visible tab |

## Third-Party Libraries

- **JSZip** (MIT License) — used locally to create ZIP files for batch downloads. No network requests.
- **Cropper.js** (MIT License) — used locally for the editor. No network requests.

## Contact

If you have questions about this privacy policy, please open an issue on the [GitHub repository](https://github.com/BlackSpirits/ImageToolkit).
