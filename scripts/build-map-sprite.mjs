#!/usr/bin/env node
// scripts/build-map-sprite.mjs — builds the MapLibre sprite sheet from inline
// SVG sources into infra/tiles/sprites/ (I3.1). Run via `pnpm build:map:sprite`.
//
// The basemap style's layers reference no icon images (the basemap is
// lines/fills/labels only), but the sprite pipeline must exist and serve
// valid assets: MapLibre fetches `<sprite>.json`/`<sprite>.png` (and @2x)
// when a style declares `sprite`. The seed set is the app marker pin used by
// the map components (F3.1); new icons are appended as inline SVG sources in
// `SOURCES` below and the sprite regenerates deterministically (index sorted
// by name — stable diffs).
//
// Rendering: sharp (already the media pipeline's rasterizer) rasterizes each
// SVG at 1x and 2x, composites onto a tightly-packed grid and emits
// sprite.json + sprite.png + sprite@2x.png.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const outDir = path.join(repoRoot, 'infra', 'tiles', 'sprites');

/** Inline SVG icon sources (single source of truth for the sprite). Colors
 * follow the modern theme pack (docs/DESIGN.md §2): primary indigo, white
 * glyph — the basemap carries no business markers; the pin is here for the
 * F3.x map components' static-symbol needs. */
const SOURCES = [
  {
    name: 'marker',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="30" viewBox="0 0 22 30">
  <path d="M11 1C5.5 1 1 5.4 1 10.9C1 18 11 29 11 29C11 29 21 18 21 10.9C21 5.4 16.5 1 11 1Z" fill="#4338CA" stroke="#FFFFFF" stroke-width="1.5"/>
  <circle cx="11" cy="10.9" r="3.6" fill="#FFFFFF"/>
</svg>`,
  },
  {
    name: 'marker-active',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="36" viewBox="0 0 26 36">
  <path d="M13 1C6.4 1 1 6.3 1 12.8C1 21 13 34 13 34C13 34 25 21 25 12.8C25 6.3 19.6 1 13 1Z" fill="#0E7490" stroke="#FFFFFF" stroke-width="2"/>
  <circle cx="13" cy="12.8" r="4.2" fill="#FFFFFF"/>
</svg>`,
  },
];

/** Icon pixel size — sprite icons may differ per icon; the JSON index carries
 * each icon's own size (MapLibre reads it from sprite.json). */
async function renderOne(svg, scale) {
  const svg2 = svg.replace(/<svg /, `<svg x="0" y="0" `);
  const sharpStream = sharp(Buffer.from(svg2));
  const meta = await sharpStream.metadata();
  const w = Math.ceil((meta.width ?? 22) * scale);
  const h = Math.ceil((meta.height ?? 30) * scale);
  const buf = await sharp(Buffer.from(svg2), { density: 72 * scale })
    .resize(w, h)
    .png()
    .toBuffer();
  return { w, h, buf };
}

/** Simple shelf packing: rows of fixed max width, sorted by height desc —
 * deterministic for a stable icon list, and sprite sheets stay tiny. */
function pack(items, maxW) {
  const placed = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const it of [...items].sort((a, b) => b.h - a.h || (a.name < b.name ? -1 : 1))) {
    if (x + it.w > maxW) {
      y += rowH;
      x = 0;
      rowH = 0;
    }
    placed.push({ ...it, x, y });
    x += it.w;
    rowH = Math.max(rowH, it.h);
  }
  return { placed, width: Math.max(1, x), height: Math.max(1, y + rowH) };
}

mkdirSync(outDir, { recursive: true });

async function build(scale) {
  const suffix = scale === 2 ? '@2x' : '';
  const rendered = [];
  for (const src of SOURCES) {
    const { w, h, buf } = await renderOne(src.svg, scale);
    rendered.push({ name: src.name + suffix, w, h, buf });
  }
  const maxW = Math.max(...rendered.map((r) => r.w)) * SOURCES.length;
  const { placed, width, height } = pack(rendered, maxW);
  const composite = placed.map((p) => ({ input: p.buf, left: p.x, top: p.y }));
  const png = await sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(composite)
    .png()
    .toBuffer();
  const index = {};
  for (const p of placed) {
    index[p.name] = { width: p.w, height: p.h, x: p.x, y: p.y, pixelRatio: scale };
  }
  const file = path.join(outDir, `sprite${suffix}`);
  writeFileSync(`${file}.png`, png);
  writeFileSync(`${file}.json`, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  console.log(
    `build-map-sprite: sprite${suffix}.png ${width}x${height} with ${Object.keys(index).length} icon(s)`,
  );
}

await build(1);
await build(2);
