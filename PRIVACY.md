# Privacy Policy — ImageToolkit

**Last updated:** 2026-04-26

## Summary

ImageToolkit does **not** collect, store, sell, or share personal data. Image processing runs locally in your browser.

## Data Collection

This extension collects **zero** data. Specifically:

- **No personal information** is collected
- **No browsing history** is accessed or stored
- **No images are uploaded** to ImageToolkit servers
- **No analytics or telemetry** of any kind
- **No cookies** are set by ImageToolkit
- **No remote scripts** are loaded

## Image Processing

All image conversion, resizing, cropping, and optimization happens **entirely locally** in your browser using the Canvas API. Images are not sent to ImageToolkit servers.

When you choose features that work with remote images, the extension may fetch those image URLs directly from your browser so it can inspect, convert, copy, resize, or download them. Some authenticated websites may receive your normal browser cookies for their own image URLs when this is required to access the image. ImageToolkit does not read, store, or transmit those cookies elsewhere.

## Optional External Services

ImageToolkit does not contact third-party services automatically for tracking or analytics. The following user-triggered actions may open or contact external services:

- **Google Lens** — if enabled in Settings and you click the search-similar action, the image URL may be opened with Google Lens.
- **Ko-fi** — if you click the support button, a Ko-fi page opens in a new tab.
- **Remote image hosts/CDNs** — when scanning, probing, converting, copying, or downloading images from a page, your browser may request those image URLs directly from their original hosts.

## Permissions Explained

| Permission | Why it's needed |
|---|---|
| `contextMenus` | Adds "Save Image As..." right-click menu |
| `downloads` | Saves converted images to your computer |
| `storage` | Saves your preferences (quality, format, theme, optional Google Lens setting) |
| `notifications` | Shows save confirmation (can be disabled) |
| `offscreen` | Runs Canvas API for image conversion |
| `clipboardWrite` | Copies converted images or image URLs to your clipboard |
| `activeTab` | Accesses current tab for batch image scanning |
| `scripting` | Injects image scanner into current page (on-demand only) |
| `sidePanel` | Renders the extension UI as a docked side panel |
| `<all_urls>` | Fetches and scans images on any website for conversion and downloading |

## Third-Party Libraries

- **JSZip** (MIT License) — used locally for creating ZIP files during batch downloads. No network requests.
- **Cropper.js** (MIT License) — used locally for the custom crop/resize interface. No network requests.

## Contact

If you have questions about this privacy policy, please open an issue on the [GitHub repository](https://github.com/BlackSpirits/ImageToolkit).

### Chrome sync storage

User preferences are stored with `chrome.storage.sync`, which Chrome may synchronize across the user's signed-in browsers. ImageToolkit can only read and write its own extension settings and does not have access to the user's Google Account or Chrome sync data.
