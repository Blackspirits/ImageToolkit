// Checks WCAG contrast of the text/background token pairs used by the UI, in both
// themes, straight from lib/ui.css. Run: node scripts/contrast.mjs
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../lib/ui.css', import.meta.url), 'utf8');

function tokens(selector) {
  const block = css.slice(css.indexOf(selector)).match(/\{([^}]*)\}/)[1];
  return Object.fromEntries([...block.matchAll(/--([\w-]+):([^;]+);/g)].map(([, k, v]) => [k, v.trim()]));
}

function parse(color) {
  let m = /^#([0-9a-f]{6})$/i.exec(color);
  if (m) return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16), a: 1 };
  m = /^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/.exec(color);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] == null ? 1 : +m[4] };
  throw new Error(`Unparsed colour ${color}`);
}

const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
const lum = ({ r, g, b }) => [r, g, b].map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// [text token, surface token(s) stacked from bottom to top, minimum ratio]
const PAIRS = [
  ['text', ['bg'], 4.5], ['text', ['bg-elev'], 4.5], ['text', ['bg-sunken'], 4.5],
  ['text-2', ['bg'], 4.5], ['text-2', ['bg-elev'], 4.5], ['text-2', ['bg-sunken'], 4.5],
  ['text-3', ['bg'], 4.5], ['text-3', ['bg-elev'], 4.5], ['text-3', ['bg-sunken'], 4.5],
  ['accent-text', ['bg-elev'], 4.5], ['accent-text', ['bg-elev', 'accent-soft'], 4.5], ['accent-text', ['bg-sunken'], 4.5],
  ['success', ['bg-elev', 'success-soft'], 4.5], ['danger', ['bg-elev', 'danger-soft'], 4.5],
  ['warning', ['bg-elev', 'warning-soft'], 3], ['cyan', ['bg-elev', 'cyan-soft'], 3], // icons: non-text 3:1
];

let failures = 0;
for (const [theme, selector] of [['light', '.app,.app.light{'], ['dark', '.app.dark{']]) {
  const t = tokens(selector);
  for (const [fg, layers, min] of PAIRS) {
    const bg = layers.map((k) => parse(t[k])).reduce((acc, layer) => over(layer, acc), { r: 255, g: 255, b: 255, a: 1 });
    const value = ratio(parse(t[fg]), bg);
    const ok = value >= min;
    if (!ok) failures++;
    console.log(`${ok ? '✓' : '✗'} ${theme.padEnd(5)} ${fg.padEnd(11)} on ${layers.join(' + ').padEnd(24)} ${value.toFixed(2)}:1 (min ${min})`);
  }
}
if (failures) { console.error(`✗ ${failures} contrast pair(s) below WCAG AA`); process.exit(1); }
console.log('✓ contrast: all pairs meet WCAG AA');
