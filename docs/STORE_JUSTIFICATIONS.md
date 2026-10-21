# Chrome Web Store — permission justifications

Ready to paste into the *Privacy practices* tab of the developer dashboard.

## Single purpose

ImageToolkit finds, converts, edits and saves the images of the pages you visit: it lists a page's images, converts and resizes them locally, captures the screen, and lets you crop and annotate the result before saving.

## Permission justifications

**`<all_urls>` (host permission)**
The user can use ImageToolkit on any website: it lists the images of the page the user opens it on, and fetches an image the user asks to save, convert, copy or edit, wherever it is hosted (images are often on CDNs other than the page's own domain). It also captures the visible tab for screenshots. Narrowing it to `activeTab` would break the side panel (which follows tab changes), the "All tabs" scope, images inside cross-origin iframes and downloads from image CDNs. No data is sent anywhere: everything is processed locally.

**`scripting`**
Injects, on demand only, the image scanner into the page (and its frames) when the panel is opened, the area-selection overlay when a capture starts, and the scrolling helper for "Load all images" and full-page capture. No remote code: every injected script ships in the package.

**`downloads`**
Saves converted images, edited images and ZIP files to the user's Downloads folder.

**`contextMenus`**
Adds the "Save image as…" right-click menu on images and the capture actions on the toolbar icon.

**`storage`**
Saves the user's preferences (`chrome.storage.sync`) and short-lived state (`chrome.storage.session`).

**`offscreen`**
Runs the Canvas API in the background for conversion, stitching full-page captures and writing to the clipboard from a service worker.

**`clipboardWrite`**
Copies an image or a list of image URLs when the user asks.

**`notifications`**
Confirms saves and copies started from the right-click menu, and reports errors (can be turned off in Settings).

**`sidePanel`**
Shows the extension as a docked side panel.

## Remote code

No. All JavaScript is included in the package; nothing is loaded from the network.

## Data usage

ImageToolkit collects no user data. Tick none of the data categories. Certify: not sold, not used for unrelated purposes, not used for creditworthiness.
