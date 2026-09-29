// Unit tests for lib/core.js (pure helpers shared by every extension context).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../lib/core.js');

const bytes = (...parts) => new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : [p])));

test('sniffImageType recognises common signatures', () => {
  assert.equal(core.sniffImageType(bytes(0x89, 'PNG', 0x0d, 0x0a)), 'png');
  assert.equal(core.sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0)), 'jpg');
  assert.equal(core.sniffImageType(bytes('GIF89a')), 'gif');
  assert.equal(core.sniffImageType(bytes('RIFF', 0, 0, 0, 0, 'WEBP')), 'webp');
  assert.equal(core.sniffImageType(bytes(0, 0, 0, 0x20, 'ftypavif')), 'avif');
  assert.equal(core.sniffImageType(bytes('BM', 0, 0)), 'bmp');
  assert.equal(core.sniffImageType(bytes('II*', 0)), 'tiff');
  assert.equal(core.sniffImageType(bytes(0, 0, 1, 0)), 'ico');
  assert.equal(core.sniffImageType(bytes('<svg')), null);
  assert.equal(core.sniffImageType(bytes('<!DOCTYPE html>')), null);
});

test('type detection from MIME, extension and data URLs', () => {
  assert.equal(core.mimeToType('image/jpeg; charset=binary'), 'jpg');
  assert.equal(core.mimeToType('text/html'), null);
  assert.equal(core.extensionToType('https://a.test/x/photo.JPEG?w=10'), 'jpg');
  assert.equal(core.extensionToType('https://a.test/x/photo'), null);
  assert.equal(core.detectType('data:image/svg+xml;base64,AAAA'), 'svg');
  assert.equal(core.detectType('data:image/webp,AAAA'), 'webp');
  assert.equal(core.detectType('https://a.test/img'), 'other');
});

test('output formats map to real MIME types and labels', () => {
  assert.equal(core.outputMime('jpeg'), 'image/jpeg');
  assert.equal(core.outputMime('avif'), 'image/avif');
  assert.equal(core.outputMime('gif'), 'image/png');
  assert.equal(core.formatFromMime('image/webp'), 'webp');
  assert.equal(core.extensionFor('jpeg'), 'jpg');
  assert.equal(core.formatLabel('jpeg'), 'JPG');
});

test('isAllowedImageSrc only accepts fetchable schemes', () => {
  assert.ok(core.isAllowedImageSrc('https://a.test/x.png'));
  assert.ok(core.isAllowedImageSrc('data:image/png;base64,AAAA'));
  assert.ok(!core.isAllowedImageSrc('javascript:alert(1)//x.png'));
  assert.ok(!core.isAllowedImageSrc('file:///etc/passwd'));
  assert.ok(!core.isAllowedImageSrc('blob:https://a.test/uuid'));
  assert.ok(!core.isAllowedImageSrc('data:text/html,<b>x</b>'));
});

test('parseSrcset keeps commas inside URLs', () => {
  assert.deepEqual(core.parseSrcset('a.jpg 1x, b.jpg 2x'), ['a.jpg', 'b.jpg']);
  assert.deepEqual(core.parseSrcset('a.jpg 1x,b.jpg 2x'), ['a.jpg', 'b.jpg']);
  assert.deepEqual(core.parseSrcset('https://cdn.test/w_100,h_100/a.jpg 100w, https://cdn.test/w_200,h_200/a.jpg 200w'),
    ['https://cdn.test/w_100,h_100/a.jpg', 'https://cdn.test/w_200,h_200/a.jpg']);
  assert.deepEqual(core.parseSrcset(''), []);
});

test('extractBgUrls handles quotes and multiple layers', () => {
  assert.deepEqual(core.extractBgUrls('url("a.png"), linear-gradient(red, blue), url(b.jpg)'), ['a.png', 'b.jpg']);
  assert.deepEqual(core.extractBgUrls("url('it''s.png')").length, 1);
  assert.deepEqual(core.extractBgUrls('none'), []);
});

test('dedupeKey ignores cache-busting but keeps size parameters', () => {
  assert.equal(core.dedupeKey('https://a.test/img.jpg?v=1'), core.dedupeKey('https://a.test/img.jpg?v=2'));
  assert.notEqual(core.dedupeKey('https://a.test/img.jpg?w=100'), core.dedupeKey('https://a.test/img.jpg?w=200'));
});

test('sanitizeFilename strips unsafe characters and keeps Unicode', () => {
  assert.equal(core.sanitizeFilename('a<b>:c|d?.png'), 'abcd.png');
  assert.equal(core.sanitizeFilename('..'), 'image');
  assert.equal(core.sanitizeFilename('CON'), 'image');
  assert.equal(core.sanitizeFilename('../../etc', true), 'image/image/etc');
  const long = '日本語の非常に長いファイル名'.repeat(6);
  const cleaned = core.sanitizeFilename(long);
  assert.ok(cleaned.startsWith('日本語'));
  assert.ok([...cleaned].length <= 60);
});

test('buildFilename uses the real format and options', () => {
  assert.equal(core.buildFilename('https://a.test/p/photo.jpg', { format: 'webp' }), 'photo.webp');
  assert.equal(core.buildFilename('https://a.test/p/photo.jpg', { format: 'jpeg', resizeWidth: 1080 }), 'photo_1080px.jpg');
  assert.equal(core.buildFilename('https://a.test/p/photo.jpg', { format: 'png', cropWidth: 100, cropHeight: 50 }), 'photo_100x50.png');
  assert.equal(core.buildFilename('https://a.test/p/photo.jpg', { format: 'png', subfolder: 'shots/' }), 'shots/photo.png');
  assert.equal(core.buildFilename('https://a.test/p/photo.jpg', { format: 'png', filenamePattern: 'custom', filenamePrefix: 'x_' }), 'x_photo.png');
  assert.equal(core.buildFilename('https://a.test/p/photo.jpg', { format: 'png', filenamePattern: 'system' }, 42), 'imagetoolkit_42.png');
  assert.equal(core.buildFilename('data:image/png;base64,AAAA', { format: 'png' }), 'image.png');
});

test('calculateDimensions covers crop, fit and resize', () => {
  assert.deepEqual(core.calculateDimensions(400, 200, {}), { outWidth: 400, outHeight: 200, sx: 0, sy: 0, sw: 400, sh: 200 });
  assert.deepEqual(core.calculateDimensions(400, 200, { resizeWidth: 100 }), { outWidth: 100, outHeight: 50, sx: 0, sy: 0, sw: 400, sh: 200 });
  assert.deepEqual(core.calculateDimensions(400, 200, { width: 100, height: 100 }), { outWidth: 100, outHeight: 100, sx: 0, sy: 0, sw: 400, sh: 200 });
  const crop = core.calculateDimensions(400, 200, { cropWidth: 100, cropHeight: 100 });
  assert.deepEqual(crop, { outWidth: 100, outHeight: 100, sx: 100, sy: 0, sw: 200, sh: 200 });
  const fit = core.calculateDimensions(400, 200, { cropWidth: 100, cropHeight: 100, fitMode: true });
  assert.equal(fit.outWidth, 100);
  assert.deepEqual(core.letterboxRect(400, 200, 100, 100), { x: 0, y: 25, w: 100, h: 50 });
});

test('checkOutputSize rejects absurd canvases', () => {
  assert.doesNotThrow(() => core.checkOutputSize(1920, 1080));
  assert.throws(() => core.checkOutputSize(0, 10));
  assert.throws(() => core.checkOutputSize(20000, 10));
  assert.throws(() => core.checkOutputSize(16000, 16000));
});

test('formatMessage matches chrome.i18n semantics', () => {
  const entry = { message: 'Saved as $FORMAT$', placeholders: { FORMAT: { content: '$1' } } };
  assert.equal(core.formatMessage(entry, ['PNG']), 'Saved as PNG');
  assert.equal(core.formatMessage(entry, ['a$&b']), 'Saved as a$&b');
  assert.equal(core.formatMessage({ message: '$1 of $2 · $$5' }, ['3', '4']), '3 of 4 · $5');
  const two = { message: '$DONE$ of $TOTAL$', placeholders: { DONE: { content: '$1' }, TOTAL: { content: '$2' } } };
  assert.equal(core.formatMessage(two, ['9', '10']), '9 of 10');
  assert.equal(core.formatMessage(undefined, []), null);
  assert.equal(core.fillTokens('{format} ({size})', { format: 'WEBP', size: '$1' }), 'WEBP ($1)');
});

test('parseSizeFromHeaders reads length and range', () => {
  const headers = (h) => ({ get: (k) => h[k] ?? null });
  assert.equal(core.parseSizeFromHeaders(headers({ 'content-length': '1234' })), 1234);
  assert.equal(core.parseSizeFromHeaders(headers({ 'content-range': 'bytes 0-0/98765' })), 98765);
  assert.equal(core.parseSizeFromHeaders(headers({})), 0);
});

test('formatBytes and mapLimit', async () => {
  assert.equal(core.formatBytes(512), '512 B');
  assert.equal(core.formatBytes(2048), '2.0 KB');
  assert.equal(core.formatBytes(3 * 1048576), '3.00 MB');
  let active = 0, peak = 0;
  const seen = [];
  await core.mapLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
    active++; peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    seen.push(n); active--;
  });
  assert.equal(peak, 2);
  assert.deepEqual(seen.sort(), [1, 2, 3, 4, 5, 6]);
});

test('isExtensionSender trusts only this extension, even without sender.url', () => {
  const id = 'abc', origin = 'chrome-extension://abc/';
  assert.ok(core.isExtensionSender({ id, url: 'chrome-extension://abc/popup.html' }, id, origin));
  assert.ok(core.isExtensionSender({ id, origin: 'chrome-extension://abc' }, id, origin));
  assert.ok(core.isExtensionSender({ id }, id, origin), 'service worker without url');
  assert.ok(!core.isExtensionSender({ id, url: 'https://evil.test/', tab: { id: 1 } }, id, origin), 'content script');
  assert.ok(!core.isExtensionSender({ id, tab: { id: 1 } }, id, origin), 'unprovable sender in a tab');
  assert.ok(!core.isExtensionSender({ id, url: 'chrome-extension://abcd/x.html' }, id, origin), 'prefix of another id');
  assert.ok(!core.isExtensionSender({ id: 'other', url: 'chrome-extension://abc/popup.html' }, id, origin));
  assert.ok(!core.isExtensionSender(undefined, id, origin));
});

test('looksLikeSvg recognises SVG text regardless of the declared type', () => {
  assert.ok(core.looksLikeSvg('<svg xmlns="http://www.w3.org/2000/svg"/>'));
  assert.ok(core.looksLikeSvg('﻿<?xml version="1.0"?>\n<!-- c -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x">\n<svg>'));
  assert.ok(!core.looksLikeSvg('<!doctype html><svg></svg>'));
  assert.ok(!core.looksLikeSvg('<html><body><svg></svg>'));
  assert.ok(!core.looksLikeSvg('<svgfoo>'));
  assert.ok(!core.looksLikeSvg(''));
});
