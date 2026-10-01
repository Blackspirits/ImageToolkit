# Privacy Policy — ImageToolkit

**Last updated:** 2026-10-01

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

### Automatic requests for previews and metadata

While the panel shows a page's images, the extension **contacts the hosts of those images automatically**, without a click, to show their type, file size, dimensions and thumbnails. These requests go only to the image URLs already used by the page you are viewing, and nothing about you or the page is sent beyond the request itself:

- **Lightweight first:** a `HEAD` request or a 1-byte range request, which returns headers only. Size and type checks are sent without cookies.
- **Limited reads when needed:** if a server gives no size in its headers, the extension reads the start of the image to count its size, at most 2 MB per image and 8 MB in total per request batch, then stops; past that, the size stays unknown.
- **Previews of protected images:** if a site refuses to show an image directly (hotlink protection), the extension downloads it to display the thumbnail and read its dimensions: at most 40 images, 8 MB each and 48 MB in total per scan. These downloads include your normal cookies for that host, like the user-triggered downloads above.
- At most 100 images per scan are checked for size and 30 for type.

These requests only read data; they are never used to send data anywhere. **Google Lens and the Ko-fi and author links are different**: they never run automatically and only open when you click them (see below).

## Page Content

- **Image scanner** — when you open the panel, a script is injected into the current tab to list its images (URLs, dimensions, alt text). The list stays in the panel; it is never stored or sent anywhere. Very large inline images are left out of the list to keep it fast. While the panel is in use, the script watches the page for newly loaded images and stops after a few idle minutes.
- **Screen capture** — only when you start a capture (button, toolbar menu, or keyboard shortcut), the visible part of the tab is captured and opened in the editor. Captures are not saved unless you save them.

## Local Storage

- **Settings** are stored with `chrome.storage.sync`, which Chrome may synchronize across your signed-in browsers. ImageToolkit can only read and write its own settings and has no access to your Google Account or other sync data.
- **Editor handoff** — when an image or capture is opened in the editor, it is kept in the extension's own IndexedDB so the editor window can load it. These entries expire after 30 minutes: an expired entry is never shown again and is deleted when it is next looked up or on the extension's next cleanup pass (at startup or when another image is opened in the editor).
- **Interface state** (grid layout, transparency background, whether filters are open) is kept in the extension's local storage.
- **Upgrades** — version 2.3.5 and earlier passed images to the editor through `chrome.storage.local`; any image left there is deleted when the extension updates or starts.

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
