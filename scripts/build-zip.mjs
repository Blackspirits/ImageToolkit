// Builds the Chrome Web Store bundle: only the files the extension loads at runtime.
// Usage: npm run build  →  dist/imagetoolkit-<version>.zip

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const JSZip = require('../lib/jszip.min.js');

const RUNTIME = [
  'manifest.json',
  'background.js', 'content.js', 'capture.js',
  'offscreen.html', 'offscreen.js',
  'popup.html', 'popup.css', 'popup.js',
  'resize.html', 'resize.css', 'resize.js',
  'lib', '_locales',
  'icons/icon16.png', 'icons/icon32.png', 'icons/icon48.png', 'icons/icon128.png',
  'LICENSE',
];

function walk(path) {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path).sort().flatMap((name) => walk(join(path, name)));
}

const { version } = JSON.parse(readFileSync('manifest.json', 'utf8'));
const zip = new JSZip();
const files = RUNTIME.flatMap(walk);
// Fixed timestamps keep the archive reproducible.
for (const file of files) zip.file(file.split('\\').join('/'), readFileSync(file), { date: new Date('2020-01-01T00:00:00Z') });

const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
mkdirSync('dist', { recursive: true });
const out = `dist/imagetoolkit-${version}.zip`;
writeFileSync(out, buffer);
console.log(`✓ ${out} (${files.length} files, ${(buffer.length / 1024).toFixed(1)} KB)`);
