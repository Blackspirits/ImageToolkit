# 🖼️ ImageToolkit

> **The browser extension to save, convert, resize, inspect, and optimize images — 100% local, zero tracking.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square&labelColor=313244)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-green?style=flat-square&labelColor=313244)](https://developer.chrome.com/docs/extensions/mv3/)

---

## ✨ Features

### 🔄 Format Conversion
Right-click any image and instantly save it as **PNG**, **JPG**, **WebP**, or **AVIF**. Transparent images get a white background when converting to JPG — no more black artifacts. AVIF falls back to WebP on browsers that don't support it.

### 🖼️ Image Grid
Browse all images found on the current page in a visual grid with thumbnails, dimensions, file sizes, and type badges. Filter by **format**, **size range**, or **domain**. Select individual images or batch-select for download.

### 🔁 Duplicate Detection
URL-based heuristic deduplication identifies likely-duplicate images (same path, different cache-busting params). Duplicates are visually flagged and can be hidden with one click. Note: this is URL-based, not pixel-based — it catches most common duplicates but isn't perfect.

### 🧠 Smart Format Advisor
Paste an image URL and the extension analyzes the image, showing estimated file sizes for each format and recommending the best one. Detects transparency automatically.

### 📋 Copy to Clipboard
Skip the download — copy the converted image directly to your clipboard, ready to paste into Slack, Discord, Figma, or any other app.

### 📐 Resize & Social Media Presets
Resize images to custom dimensions with aspect ratio lock, or use built-in presets for Instagram (1080×1080), YouTube Thumbnails (1280×720), TikTok (1080×1920), X/Twitter, LinkedIn, and more.

### 📦 Batch Download
Select images from the grid and download them individually, convert to a different format, or package everything into a single ZIP file.

### ⚙️ Customizable Settings
- **Quality slider** (10–100%) for lossy formats
- **Default format** selection
- **Save As dialog** toggle
- **Resize behavior**: Center Crop or Fit (Letterbox)
- **Notification** toggle
- **Dark/Light/Auto** theme

### ⌨️ Keyboard Shortcut
Quick-save with `Alt+Shift+S` (customizable in `chrome://extensions/shortcuts`).

### 🌍 Multilingual
English, Português (PT), Português (BR), and Français are fully translated. 14 additional languages have partial translations.

---

## 🔒 Privacy

- **Zero data collection** — all processing happens locally in your browser
- **No analytics, no tracking, no external API calls**
- **No remote scripts** — everything is bundled
- **`host_permissions: <all_urls>`** — required for scanning page images and fetching cross-origin images for conversion (standard for image downloader extensions)

See [PRIVACY.md](PRIVACY.md) for the full privacy policy.

---

## 🚀 Installation

### From Chrome Web Store
*(Coming soon)*

### Manual (Developer Mode)
1. Download or clone this repository
2. Open `chrome://extensions/`
3. Enable **Developer mode**
4. Click **Load unpacked**
5. Select the project folder

---

## 🏗️ Architecture

```
ImageToolkit/
├── manifest.json        MV3 manifest with host_permissions
├── background.js        Service worker: menus, routing, downloads, type probing
├── offscreen.html/js    Canvas engine: conversion, resize, crop
├── content.js           Image scanner (injected on-demand, TreeWalker-based)
├── popup.html/css/js    3-tab UI: Images, Convert, Settings
├── resize.html/css/js   Custom resize popup window
├── _locales/            18 language packs
├── icons/               Extension icons
├── lib/                 JSZip for batch ZIP downloads
├── PRIVACY.md           Privacy policy
├── CHANGELOG.md         Version history
└── LICENSE              MIT License
```

### Design Decisions

- **Offscreen Document** for Canvas operations — no code injected into pages for conversion
- **On-demand content script** — image scanner only injected when the user opens the popup or triggers a scan
- **TreeWalker-based scanner** — single DOM pass collects `<img>` elements and shadow roots simultaneously, targeted CSS background scan (not `querySelectorAll('*')`)
- **Type probing** — images with unrecognizable URL extensions are probed via HEAD request (with GET Range fallback) to detect real Content-Type
- **`host_permissions: <all_urls>`** — required for side panel to inject content scripts and fetch images from any page
- **No React, no frameworks** — pure JS/CSS for minimal footprint (~100KB including JSZip)

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the **MIT License** — see [LICENSE](LICENSE) for details.

---

## 💖 Support

If you find this extension useful, consider supporting development:

[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support-FF5E5B?style=flat-square&logo=ko-fi&logoColor=white&labelColor=313244)](https://ko-fi.com/blackspirits)

---

<p align="center">
  Made with ❤️ by <a href="https://blackspirits.github.io">BlackSpirits</a>
</p>
