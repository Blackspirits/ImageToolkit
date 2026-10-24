# Chrome Web Store images

Rendered from the real extension by `npm run store:shots`, on a demo gallery with fictional characters ([`demo/`](demo)).

```bash
npm run store:shots            # all 18 languages + promo tiles
npm run store:shots -- ja ko   # only the languages named
```

| Output | Size | Use |
|---|---|---|
| `<locale>/01-find.png` … `05-privacy.png` | 1280×800, PNG without alpha | Screenshots, in this order (the first one is the listing's cover) |
| `promo/small-440x280.png` | 440×280 | Small promo tile |
| `promo/marquee-1400x560.png` | 1400×560 | Marquee promo tile |

English and Portuguese (Portugal) are kept in the repository for the README; the other languages are generated on demand (git-ignored).

## Uploading

In the Developer Dashboard, **Store listing** → pick the language at the top → **Localized screenshots** → upload that folder's five slides in order. Each folder matches the extension's `_locales` folder:

`en` English · `pt_PT` Portuguese (Portugal) · `pt_BR` Portuguese (Brazil) · `es` Spanish · `fr` French · `it` Italian · `de` German · `nl` Dutch · `pl` Polish · `tr` Turkish · `ru` Russian · `uk` Ukrainian · `vi` Vietnamese · `ja` Japanese · `ko` Korean · `zh_CN` Chinese (China) · `zh_TW` Chinese (Taiwan) · `ar` Arabic

The promo tiles cannot be localized, so there is one English set. Rendering Japanese, Korean, Chinese and Arabic needs their fonts installed (e.g. `fonts-noto-cjk` and `fonts-noto-core` on Debian/Ubuntu).
