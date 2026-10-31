import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findRtlViolations, isExempted } from '../rtl.mjs';

test('flags physical spacing, inset, text-align, border and rounded classes', () => {
  const code = [
    `<div className="ml-2 pr-4">x</div>`,
    `<div className="hover:-ml-1 md:pr-4">x</div>`,
    `<div className="text-left">x</div>`,
    `<div className="border-r rounded-tl-lg">x</div>`,
    `<div style={{ left: 0 }}>x</div>`,
    `.maplibregl-ctrl { left: 4px; }`,
  ].join('\n');
  const found = findRtlViolations(code);
  assert.equal(found.length, 9);
  assert.deepEqual(
    found.map((f) => f.match).sort(),
    [
      '-ml-1',
      'border-r',
      'left',
      'left',
      'ml-2',
      'pr-4',
      'pr-4',
      'rounded-tl-lg',
      'text-left',
    ].sort(),
  );
});

test('logical utilities never match', () => {
  const code = [
    `<div className="ms-2 me-3 ps-4 pe-5">x</div>`,
    `<div className="start-0 end-2 text-start text-end">x</div>`,
    `<div className="border-s border-e rounded-s-full rounded-e">x</div>`,
    `left-1/2 in prose is still flagged (looks like a class)`,
  ].join('\n');
  const found = findRtlViolations(code);
  assert.equal(found.length, 1);
  assert.equal(found[0].match, 'left-1/2');
});

test('variants and arbitrary values are caught', () => {
  const code = `<div className="lg:left-[10px] rtl:right-0">x</div>`;
  const found = findRtlViolations(code);
  assert.equal(found.length, 2);
});

test('rtl-ok marker exempts the line', () => {
  assert.equal(
    isExempted('/* maplibre control needs physical left */ .ctrl { left: 0; } /* rtl-ok */'),
    true,
  );
  assert.equal(isExempted('no marker here'), false);
  const code = `.ctrl { left: 0; } /* rtl-ok */\n.ctrl-b { left: 4px; }`;
  const found = findRtlViolations(code);
  assert.equal(found.length, 1);
  assert.equal(found[0].line, 2);
});

test('word boundaries prevent false positives on identifiers', () => {
  const code = [
    `const marginLeft = 4; // identifier, not a class`,
    `const url = '/api/v1/nav'; // no directional stem in the path`,
    `// prose: "use ms-2 instead of ml-2" in a comment is still flagged?`,
  ].join('\n');
  const found = findRtlViolations(code);
  // identifiers with no dash-prefix pattern are safe; the comment IS flagged
  // (comments mentioning a real class usage look identical to usage — that
  // is intentional: fix the comment or mark it rtl-ok).
  assert.deepEqual(
    found.map((f) => f.match),
    ['ml-2'],
  );
});
