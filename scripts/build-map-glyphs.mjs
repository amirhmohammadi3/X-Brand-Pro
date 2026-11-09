#!/usr/bin/env node
// scripts/build-map-glyphs.mjs — generates the self-hosted MapLibre glyph
// PBFs from the variable-font TTFs (I3.1). Run via `pnpm build:map:glyphs`.
//
// Fonts (AGENTS.md §2: Vazirmatn for Persian/Arabic script, Inter for Latin;
// self-hosted only, no CDN): the full variable TTFs (Arabic + Latin in one
// file, from the google/fonts OFL repo — same upstream as the @fontsource
// packages the web app ships) are pinned to one weight per fontstack:
//
//   Vazirmatn Regular (wght 400) / Medium (500) / Bold (700)
//   Inter Regular (wght 400) / Medium (500) / Bold (700)
//
// Ranges are the MapLibre 256-codepoint buckets that actually carry glyphs
// for our labels: Latin-1 (0–255), Latin Extended-A (256–511), Arabic +
// Arabic Supplement (1536–2047), Arabic Extended-A (2048–2303) and General
// Punctuation (8192–8447 — includes ZWNJ 0x200C, mandatory for Persian
// half-spaces). Output: infra/tiles/fonts/<fontstack>/<start>-<end>.pbf —
// exactly the `{fontstack}/{range}.pbf` layout the style's `glyphs` URL
// expects. The style layers use single-font stacks only, so the served
// layout stays predictable (DECISIONS 2026-11-09 I3.1).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateGlyphPbfFiles } from 'maplibre-font-maker-node';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

// Font sources are fetched once into scripts/map-fonts/ (see infra/tiles/
// README.md for the pinned provenance + checksums); the repo does not commit
// the ~1MB TTFs, but DOES commit the generated glyphs (a few hundred KB) so
// a fresh clone boots the map with zero external calls.
const fontDir = path.join(repoRoot, 'scripts', 'map-fonts');
const outDir = path.join(repoRoot, 'infra', 'tiles', 'fonts');

const RANGES = [
  [0, 255], // Basic Latin + Latin-1 (letters, digits, punctuation, «»)
  [256, 511], // Latin Extended-A / spacing modifier letters
  [1536, 1791], // Arabic (incl. Persian letters + Persian digits ۰-۹)
  [1792, 2047], // Arabic Supplement
  [2048, 2303], // Arabic Extended-A
  [8192, 8447], // General Punctuation (ZWNJ 0x200C, «» alternates)
];

const WEIGHTS = [
  ['Regular', 400],
  ['Medium', 500],
  ['Bold', 700],
];

const fontstacks = [
  ...WEIGHTS.map(([label, wght]) => ({
    fontstack: `Vazirmatn ${label}`,
    bytes: readFileSync(path.join(fontDir, 'Vazirmatn.ttf')),
    settings: { wght },
  })),
  ...WEIGHTS.map(([label, wght]) => ({
    fontstack: `Inter ${label}`,
    bytes: readFileSync(path.join(fontDir, 'Inter.ttf')),
    settings: { wght },
  })),
];

mkdirSync(outDir, { recursive: true });

let files = 0;
for (const stack of fontstacks) {
  // generateGlyphPbfFiles returns filenames WITH the fontstack prefix
  // (`"<fontstack>/<start>-<end>.pbf"`) — write them relative to the output
  // root, which is exactly the layout the `glyphs` URL template expects.
  const pbfFiles = await generateGlyphPbfFiles({
    fontstack: stack.fontstack,
    fonts: [{ name: stack.fontstack, bytes: stack.bytes, settings: stack.settings }],
    ranges: RANGES.map(([start, end]) => ({ start, end })),
  });
  mkdirSync(outDir, { recursive: true });
  for (const f of pbfFiles) {
    const target = path.join(outDir, f.filename);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, f.bytes);
    files += 1;
  }
  console.log(`build-map-glyphs: ${stack.fontstack} → ${pbfFiles.length} pbf ranges`);
}

console.log(`build-map-glyphs: wrote ${files} files under ${path.relative(repoRoot, outDir)}`);
