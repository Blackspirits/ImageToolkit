// Checks WCAG contrast in both themes, straight from the stylesheets:
//  - text/background token pairs (1.4.3, 4.5:1);
//  - non-text pairs (1.4.11, 3:1): control boundaries, switch track and knob, the selected
//    segment, the checked switch;
//  - that the controls which need a visible boundary actually use the boundary token.
// Run: node scripts/contrast.mjs
import { readFileSync } from 'node:fs';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const css = read('lib/ui.css');

function tokens(selector) {
  const block = css.slice(css.indexOf(selector)).match(/\{([^}]*)\}/)[1];
  return Object.fromEntries([...block.matchAll(/--([\w-]+):([^;]+);/g)].map(([, k, v]) => [k, v.trim()]));
}

function parse(color) {
  if (color === undefined) throw new Error('Missing colour token');
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

// Non-text (WCAG 1.4.11). Literal colours (#…) are allowed on either side.
const NON_TEXT = [
  // fields, outlined buttons, chips, switch track (off), range track: against every surface
  ['control-line', ['bg'], 3], ['control-line', ['bg-elev'], 3], ['control-line', ['bg-sunken'], 3],
  // white switch knob and range thumb against the off track
  ['#ffffff', ['control-line'], 3],
  // selected segment ring and focused field border
  ['accent', ['bg-elev'], 3], ['accent', ['bg-sunken'], 3],
  // checked switch (primary gradient ends) against the card, and its knob
  ['#6d4dff', ['bg-elev'], 3], ['#5a54f0', ['bg-elev'], 3], ['#ffffff', ['#5a54f0'], 3],
];

// Controls whose boundary or state indicator must use the tokens checked above.
const USES = [
  ['lib/ui.css', '.input,.select{', 'var(--control-line)'],
  ['lib/ui.css', '.btn-ghost{', 'var(--control-line)'],
  ['lib/ui.css', '.switch span{', 'var(--control-line)'],
  ['lib/ui.css', '.range{', 'var(--control-line)'],
  ['lib/ui.css', '.seg.active{', 'var(--accent)'],
  ['popup.css', '.chip{', 'var(--control-line)'],
  ['popup.css', '.search input{', 'var(--control-line)'],
  ['resize.css', '.chip-btn{', 'var(--control-line)'],
  ['resize.css', '.bg-btn{', 'var(--control-line)'],
];

let failures = 0;
for (const [theme, selector] of [['light', '.app,.app.light{'], ['dark', '.app.dark{']]) {
  const t = tokens(selector);
  const colour = (k) => parse(k.startsWith('#') ? k : t[k]);
  for (const [kind, list] of [['text', PAIRS], ['non-text', NON_TEXT]]) {
    for (const [fg, layers, min] of list) {
      const bg = layers.map(colour).reduce((acc, layer) => over(layer, acc), { r: 255, g: 255, b: 255, a: 1 });
      const value = ratio(colour(fg), bg);
      const ok = value >= min;
      if (!ok) failures++;
      console.log(`${ok ? '✓' : '✗'} ${theme.padEnd(5)} ${kind.padEnd(8)} ${fg.padEnd(12)} on ${layers.join(' + ').padEnd(24)} ${value.toFixed(2)}:1 (min ${min})`);
    }
  }
}

for (const [file, selector, token] of USES) {
  const source = read(file);
  const at = source.indexOf(`\n${selector}`);
  const rule = at < 0 ? '' : source.slice(at, source.indexOf('}', at));
  const ok = rule.includes(token);
  if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗'} ${file} ${selector.slice(0, -1)} uses ${token}`);
}

if (failures) { console.error(`✗ ${failures} contrast check(s) below WCAG AA`); process.exit(1); }
console.log('✓ contrast: all text and non-text pairs meet WCAG AA');
