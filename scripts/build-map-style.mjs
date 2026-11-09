#!/usr/bin/env node
// scripts/build-map-style.mjs — generates the two MapLibre basemap styles
// (light + dark) into infra/tiles/ (I3.1). Run via `pnpm build:map:style`.
//
// The vector source URL is baked from TILES_PUBLIC_URL (default
// http://localhost:8080 — the dev tile server port per AGENTS.md). On a real
// deployment the public tile origin changes, so regenerate:
//   TILES_PUBLIC_URL=https://tiles.example.com pnpm build:map:style
//
// Glyphs/sprite stay RELATIVE (`/fonts/...`, `/sprites/sprite`) — the style,
// tiles, fonts and sprites are all served by the same self-hosted nginx, so
// those references are origin-agnostic by design.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStyle } from './lib/map-style.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const outDir = path.join(repoRoot, 'infra', 'tiles');

const tilesUrl = process.env.TILES_PUBLIC_URL ?? 'http://localhost:8080';
new URL(tilesUrl); // throws on a malformed origin — fail loudly, don't bake garbage

mkdirSync(outDir, { recursive: true });
for (const mode of ['light', 'dark']) {
  const style = buildStyle({ mode, tilesUrl });
  const file = path.join(outDir, mode === 'dark' ? 'style.dark.json' : 'style.json');
  writeFileSync(file, `${JSON.stringify(style, null, 2)}\n`, 'utf8');
  const layers = style.layers.length;
  console.log(
    `build-map-style: ${path.relative(repoRoot, file)} (${layers} layers, source ${style.sources.iran.url})`,
  );
}
