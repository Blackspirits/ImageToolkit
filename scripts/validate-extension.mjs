import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const args = new Set(process.argv.slice(2));
const jsOnly = args.has('--js-only');
const i18nOnly = args.has('--i18n-only');

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function checkManifest() {
  const manifest = readJson('manifest.json');
  if (manifest.manifest_version !== 3) throw new Error('manifest_version must be 3');
  if (!manifest.version) throw new Error('manifest.version is missing');
  if (!manifest.background?.service_worker) throw new Error('background.service_worker is missing');
  console.log('✓ manifest.json valid');
}

function checkJsSyntax() {
  const files = ['background.js', 'content.js', 'offscreen.js', 'popup.js', 'resize.js', 'capture.js'];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    // Parse without executing. This keeps validation dependency-free and avoids spawning browsers/build tools.
    new Function(source);
    console.log('✓ JS syntax:', file);
  }
}

function checkI18n() {
  const localesDir = '_locales';
  const locales = readdirSync(localesDir).filter((name) => existsSync(join(localesDir, name, 'messages.json'))).sort();
  const reference = readJson(join(localesDir, 'en', 'messages.json'));
  const referenceKeys = Object.keys(reference).sort();

  for (const locale of locales) {
    const file = join(localesDir, locale, 'messages.json');
    const data = readJson(file);
    const keys = Object.keys(data).sort();
    const missing = referenceKeys.filter((key) => !keys.includes(key));
    const extra = keys.filter((key) => !referenceKeys.includes(key));
    if (missing.length || extra.length) {
      throw new Error(
        `Locale ${locale} mismatch. Missing: ${missing.join(', ') || '-'} Extra: ${extra.join(', ') || '-'}`
      );
    }
  }
  console.log(`✓ i18n key parity: ${locales.length} locales, ${referenceKeys.length} keys each`);
}

try {
  if (!i18nOnly) {
    if (!jsOnly) checkManifest();
    checkJsSyntax();
  }
  if (!jsOnly) checkI18n();
  console.log('✓ validation passed');
} catch (err) {
  console.error('✗ validation failed:', err.message);
  process.exit(1);
}
