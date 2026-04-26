# Privacy Policy — ImageToolkit

**Last updated:** 2025

## Summary

ImageToolkit does **not** collect, store, transmit, or share any user data. Period.

## Data Collection

This extension collects **zero** data. Specifically:

- **No personal information** is collected
- **No browsing history** is accessed or stored
- **No images are uploaded** to any server
- **No analytics or telemetry** of any kind
- **No cookies** are set or read
- **No third-party services** are contacted

## Image Processing

All image conversion, resizing, and optimization happens **entirely locally** in your browser using the Canvas API. Images are never sent to any external server.

## Permissions Explained

| Permission | Why it's needed |
|---|---|
| `contextMenus` | Adds "Save Image As..." right-click menu |
| `downloads` | Saves converted images to your computer |
| `storage` | Saves your preferences (quality, format, theme) |
| `notifications` | Shows save confirmation (can be disabled) |
| `offscreen` | Runs Canvas API for image conversion |
| `activeTab` | Accesses current tab for batch image scanning |
| `tabs` | Queries active tab from side panel context |
| `scripting` | Injects image scanner into current page (on-demand only) |
| `sidePanel` | Renders the extension UI as a docked side panel |
| `<all_urls>` | Fetches and scans images on any website for conversion and downloading |

## Third-Party Libraries

- **JSZip** (MIT License) — used locally for creating ZIP files during batch downloads. No network requests.

## Contact

If you have questions about this privacy policy, please open an issue on the [GitHub repository](https://github.com/BlackSpirits/ImageToolkit).
