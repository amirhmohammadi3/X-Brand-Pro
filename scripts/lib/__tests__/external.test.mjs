import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findExternalUrls, isExternalExempted } from '../external.mjs';

test('flags third-party http(s) URLs', () => {
  const code = [
    `import 'https://cdn.example.com/x.js';`,
    `const tiles = 'https://tiles.example.com/{z}/{x}/{y}.pbf';`,
    `<link href="http://fonts.example.com/css" />`,
  ].join('\n');
  const found = findExternalUrls(code);
  assert.equal(found.length, 3);
  assert.equal(found[0].host, 'cdn.example.com');
});

test('localhost and loopback are allowed', () => {
  const code = [
    `fetch('http://localhost:4000/api/v1/health')`,
    `const API = 'http://127.0.0.1:4000';`,
    `new URL('http://0.0.0.0:8080/x')`,
  ].join('\n');
  assert.equal(findExternalUrls(code).length, 0);
});

test('relative and protocol-relative URLs are not flagged', () => {
  const code = [
    `fetch('/api/v1/search')`,
    `const src = '//cdn.example.com/x.js'; // protocol-relative is still external but handled by CSP; flagged only when spelled with scheme`,
    `const media = '/media/abc.webp'`,
  ].join('\n');
  assert.equal(findExternalUrls(code).length, 0);
});

test('external-ok marker exempts the line', () => {
  assert.equal(isExternalExempted(`// docs: see https://example.com/spec // external-ok`), true);
  const code = [
    `// Reference: https://maplibre.org/ // external-ok`,
    `const a = 'https://external.example.com/x';`,
  ].join('\n');
  const found = findExternalUrls(code);
  assert.equal(found.length, 1);
  assert.equal(found[0].line, 2);
});

test('a URL truncated at whitespace is still reported (with its host prefix)', () => {
  const found = findExternalUrls(`const x = 'https://bad url with spaces';`);
  assert.equal(found.length, 1);
  assert.equal(found[0].host, 'bad'); // 'https://bad' parses as a host — still flagged
});
