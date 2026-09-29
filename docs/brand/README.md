# ImageToolkit brand

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="lockup-dark.svg">
    <img src="lockup-light.svg" alt="ImageToolkit" width="360">
  </picture>
</p>

## Mark

A single continuous image frame that opens into an export arrow, on a cyan → indigo → violet tile.
Every cut has the same elements in the same place: frame, sun, mountain and arrow. Only the stroke weight and the finish change with size (optical sizing), so small icons stay crisp without changing the mark:

| Cut | File | Use | Stroke | Finish |
|---|---|---|---|---|
| Master | `logo.svg` | 64 px and up (exported at 128–1024 px) | 64 | Four-stop gradient, highlight, shade, inner edge, soft glyph shadow |
| Compact | `logo-compact.svg` | 24–63 px (32 and 48 px icons) | 88 | Four-stop gradient, lighter highlight and shade, no shadow |
| Micro | `logo-micro.svg` | Below 24 px (16 px icon) | 112 | Three-stop gradient, no effects |

`npm run build:icons` renders every PNG in `icons/` from these files. The 128 px `icon128.png` follows the Chrome Web Store layout: 96 px artwork with 16 px of transparent padding.

## Wordmark

`lockup-light.svg` and `lockup-dark.svg`: the Master mark next to **Image** in ink and **Toolkit** in the brand gradient (slightly deeper on light backgrounds). Inter Bold, −2.2 % tracking, outlined so it renders the same everywhere.

- Clear space: ¼ of the mark's height on every side.
- Minimum width: 140 px. Below that, use the mark alone.

## Colours

| Role | Value |
|---|---|
| Tile gradient | `#1FC8F2` → `#5A6BFF` → `#7F55F5` → `#A24DEE` |
| Ink (light / dark) | `#16162A` / `#F4F4FA` |
| "Toolkit" on light | `#2F7FE6` → `#4F5CEF` → `#6E4AE6` |
| "Toolkit" on dark | `#3A8DF5` → `#5A6BFF` → `#7B55F5` |

## Don't

- Recolour, stretch or rotate the tile.
- Put the mark inside another rounded container or add an outline.
- Add or remove elements in one cut only: all cuts share one drawing.
- Use the Master cut at 16/32 px, or the Micro cut above 24 px.
