// Static checks for the extension: manifest, file references, JS syntax and i18n.
// Dependency-free so it runs anywhere Node runs: `npm run validate`.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const args = new Set(process.argv.slice(2));
const jsOnly = args.has('--js-only');
const i18nOnly = args.has('--i18n-only');

const JS_FILES = ['background.js', 'content.js', 'offscreen.js', 'popup.js', 'resize.js', 'capture.js', 'lib/core.js', 'lib/i18n.js', 'lib/ui.js', 'lib/handoff.js'];
const I18N_SOURCES = ['background.js', 'capture.js', 'popup.js', 'resize.js', 'popup.html', 'resize.html', 'manifest.json'];

const errors = [];
const fail = (message) => errors.push(message);
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

function checkManifest() {
  const manifest = readJson('manifest.json');
  const pkg = readJson('package.json');
  if (manifest.manifest_version !== 3) fail('manifest_version must be 3');
  if (!manifest.version) fail('manifest.version is missing');
  if (pkg.version !== manifest.version) fail(`package.json version ${pkg.version} != manifest ${manifest.version}`);

  const referenced = [
    manifest.background?.service_worker,
    manifest.action?.default_popup,
    manifest.side_panel?.default_path?.split('?')[0],
    ...Object.values(manifest.icons || {}),
    ...Object.values(manifest.action?.default_icon || {}),
  ].filter(Boolean);
  for (const file of referenced) if (!existsSync(file)) fail(`manifest references missing file: ${file}`);

  // Files loaded at runtime by the service worker and pages.
  const sw = readFileSync('background.js', 'utf8');
  for (const [, list] of sw.matchAll(/importScripts\(([^)]*)\)/g)) {
    for (const [, file] of list.matchAll(/'([^']+)'/g)) if (!existsSync(file)) fail(`importScripts missing file: ${file}`);
  }
  for (const [, file] of sw.matchAll(/files:\s*\[[^\]]*?'([^']+\.js)'/g)) if (!existsSync(file)) fail(`executeScript missing file: ${file}`);
  for (const html of ['popup.html', 'resize.html', 'offscreen.html']) {
    const source = readFileSync(html, 'utf8');
    for (const [, file] of source.matchAll(/(?:src|href)="([^":#?]+\.(?:js|css|png|gif|svg))"/g)) {
      if (!existsSync(file)) fail(`${html} references missing file: ${file}`);
    }
  }
  console.log('✓ manifest and file references');
}

function checkJsSyntax() {
  for (const file of JS_FILES) {
    try {
      // Parse without executing: keeps validation dependency-free.
      new Function(readFileSync(file, 'utf8'));
    } catch (err) {
      fail(`JS syntax error in ${file}: ${err.message}`);
    }
  }
  console.log(`✓ JS syntax (${JS_FILES.length} files)`);
}

function placeholderNames(entry) {
  return Object.keys(entry.placeholders || {}).map((n) => n.toLowerCase()).sort().join(',');
}

function messageTokens(entry) {
  return (entry.message.match(/\$[A-Za-z0-9_]+\$|\{[a-z]+\}/g) || []).map((s) => s.toLowerCase()).sort().join(',');
}

function checkI18n() {
  const localesDir = '_locales';
  const locales = readdirSync(localesDir).filter((name) => existsSync(join(localesDir, name, 'messages.json'))).sort();
  const reference = readJson(join(localesDir, 'en', 'messages.json'));
  const referenceKeys = Object.keys(reference).sort();

  for (const locale of locales) {
    const data = readJson(join(localesDir, locale, 'messages.json'));
    const keys = Object.keys(data);
    const missing = referenceKeys.filter((key) => !(key in data));
    const extra = keys.filter((key) => !(key in reference));
    if (missing.length || extra.length) fail(`Locale ${locale}: missing [${missing.join(', ')}] extra [${extra.join(', ')}]`);

    for (const key of referenceKeys) {
      const entry = data[key];
      if (!entry) continue;
      if (typeof entry.message !== 'string' || !entry.message.trim()) fail(`Locale ${locale}: empty message for ${key}`);
      if (placeholderNames(entry) !== placeholderNames(reference[key])) fail(`Locale ${locale}: placeholders differ for ${key}`);
      if (messageTokens(entry) !== messageTokens(reference[key])) fail(`Locale ${locale}: $TOKENS$ differ for ${key}: "${entry.message}"`);
    }
  }

  const source = I18N_SOURCES.map((file) => readFileSync(file, 'utf8')).join('\n');
  const used = new Set();
  for (const [, key] of source.matchAll(/(?:\bt\(|getMessage\(|data-i18n(?:-title|-placeholder|-aria)?=)\s*["']([A-Za-z0-9_]+)/g)) used.add(key);
  for (const [, key] of source.matchAll(/__MSG_(\w+)__/g)) used.add(key);
  const undefinedKeys = [...used].filter((key) => !(key in reference));
  const unusedKeys = referenceKeys.filter((key) => !used.has(key));
  if (undefinedKeys.length) fail(`i18n keys used but not defined: ${undefinedKeys.join(', ')}`);
  if (unusedKeys.length) fail(`i18n keys defined but never used: ${unusedKeys.join(', ')}`);

  console.log(`✓ i18n: ${locales.length} locales, ${referenceKeys.length} keys, placeholders and usage checked`);
}

if (!i18nOnly) {
  if (!jsOnly) checkManifest();
  checkJsSyntax();
}
if (!jsOnly) checkI18n();

if (errors.length) {
  console.error(`✗ validation failed (${errors.length}):\n  - ${errors.join('\n  - ')}`);
  process.exit(1);
}
console.log('✓ validation passed');
