#!/usr/bin/env node
// scripts/check-tiles.mjs — consistency gate for the self-hosted basemap
// stack (I3.1). Fails when the committed style/fonts/sprite/nginx artifacts
// drift apart; warns (no failure) for machine-local artifacts that a fresh
// clone legitimately lacks (the PMTiles archive). Run via `pnpm check:tiles`
// (part of `pnpm verify`).
//
// Checks:
//  1. style.json + style.dark.json: parse, spec version 8, self-hosted
//     relative glyphs/sprite URLs, one vector source with a pmtiles:// URL
//     pointing at /tiles/iran.pmtiles, unique layer ids, every symbol layer
//     uses font stacks that exist under infra/tiles/fonts/
//  2. fonts: the six fontstack folders (Vazirmatn/Inter × Regular/Medium/
//     Bold) each carry ≥1 .pbf
//  3. sprites: sprite.json parse + entry shape, PNG magic bytes, @2x pair
//     with pixelRatio 2
//  4. nginx.conf: range/CORS/cache directives present, listens on 8080
//  5. font provenance: scripts/map-fonts/*.ttf match the pinned SHA-256
//     checksums recorded in infra/tiles/README.md (OFL-licensed sources)
//  6. (warn) infra/tiles/data/tiles/iran.pmtiles — machine-local archive

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const tilesDir = path.join(repoRoot, 'infra', 'tiles');

const problems = [];
const warnings = [];

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

// ── 1. styles ────────────────────────────────────────────────────────────────
const EXPECTED_GLYPHS = '/fonts/{fontstack}/{range}.pbf';
const EXPECTED_SPRITE = '/sprites/sprite';
const styleFiles = ['style.json', 'style.dark.json'];
let fontStacksUsed = new Set();

for (const name of styleFiles) {
  const layerIds = new Set();
  const file = path.join(tilesDir, name);
  if (!existsSync(file)) {
    problems.push(`${name}: missing — run \`pnpm build:map:style\``);
    continue;
  }
  let style;
  try {
    style = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    problems.push(`${name}: invalid JSON (${e.message})`);
    continue;
  }
  if (style.version !== 8) problems.push(`${name}: version must be 8, got ${style.version}`);
  if (style.glyphs !== EXPECTED_GLYPHS)
    problems.push(`${name}: glyphs must be ${EXPECTED_GLYPHS}, got ${style.glyphs}`);
  if (style.sprite !== EXPECTED_SPRITE)
    problems.push(`${name}: sprite must be ${EXPECTED_SPRITE}, got ${style.sprite}`);
  const sources = Object.entries(style.sources ?? {});
  if (sources.length !== 1 || sources[0][1]?.type !== 'vector') {
    problems.push(`${name}: expected exactly one vector source`);
  } else {
    const url = sources[0][1].url ?? '';
    if (!url.startsWith('pmtiles://')) {
      problems.push(`${name}: source url must be pmtiles://…, got ${url}`);
    } else if (!url.endsWith('/tiles/iran.pmtiles')) {
      problems.push(`${name}: source url must end with /tiles/iran.pmtiles, got ${url}`);
    }
  }
  for (const layer of style.layers ?? []) {
    if (!layer.id || !layer.type) {
      problems.push(`${name}: layer without id/type`);
      continue;
    }
    if (layerIds.has(layer.id)) problems.push(`${name}: duplicate layer id ${layer.id}`);
    layerIds.add(layer.id);
    const fonts = layer.layout?.['text-font'];
    if (layer.type === 'symbol') {
      if (!Array.isArray(fonts) || fonts.length !== 1) {
        problems.push(`${name}: layer ${layer.id} must use a single-font text-font stack`);
      } else {
        fontStacksUsed = fontStacksUsed.union(new Set(fonts));
      }
    }
  }
}

// ── 2. fonts ─────────────────────────────────────────────────────────────────
const fontsDir = path.join(tilesDir, 'fonts');
const EXPECTED_STACKS = [
  'Vazirmatn Regular',
  'Vazirmatn Medium',
  'Vazirmatn Bold',
  'Inter Regular',
  'Inter Medium',
  'Inter Bold',
];
if (!existsSync(fontsDir)) {
  problems.push('infra/tiles/fonts/: missing — run `pnpm build:map:glyphs`');
} else {
  for (const stack of EXPECTED_STACKS) {
    const dir = path.join(fontsDir, stack);
    if (!existsSync(dir)) {
      problems.push(`fonts/${stack}: missing — run \`pnpm build:map:glyphs\``);
      continue;
    }
    const pbfs = readdirSync(dir).filter((f) => f.endsWith('.pbf'));
    if (pbfs.length === 0) problems.push(`fonts/${stack}: no .pbf files`);
  }
  for (const stack of fontStacksUsed) {
    if (!EXPECTED_STACKS.includes(stack)) {
      problems.push(`style references unknown font stack "${stack}" (not in fonts/)`);
    }
  }
}

// ── 3. sprites ───────────────────────────────────────────────────────────────
const spritesDir = path.join(tilesDir, 'sprites');
for (const [jsonFile, pngFile, expectedRatio] of [
  ['sprite.json', 'sprite.png', 1],
  ['sprite@2x.json', 'sprite@2x.png', 2],
]) {
  const jp = path.join(spritesDir, jsonFile);
  const pp = path.join(spritesDir, pngFile);
  if (!existsSync(jp) || !existsSync(pp)) {
    problems.push(`sprites/${jsonFile}+${pngFile}: missing — run \`pnpm build:map:sprite\``);
    continue;
  }
  let index;
  try {
    index = JSON.parse(readFileSync(jp, 'utf8'));
  } catch (e) {
    problems.push(`sprites/${jsonFile}: invalid JSON (${e.message})`);
    continue;
  }
  for (const [icon, box] of Object.entries(index)) {
    for (const key of ['width', 'height', 'x', 'y', 'pixelRatio']) {
      if (typeof box[key] !== 'number')
        problems.push(`sprites/${jsonFile}: ${icon}.${key} missing`);
    }
    if (box.pixelRatio !== expectedRatio)
      problems.push(`sprites/${jsonFile}: ${icon}.pixelRatio must be ${expectedRatio}`);
  }
  const magic = readFileSync(pp).subarray(0, 8);
  const isPng = magic[0] === 0x89 && magic.subarray(1, 4).toString('ascii') === 'PNG';
  if (!isPng) problems.push(`sprites/${pngFile}: not a PNG`);
}

// ── 4. nginx.conf ────────────────────────────────────────────────────────────
const nginxFile = path.join(tilesDir, 'nginx.conf');
if (!existsSync(nginxFile)) {
  problems.push('infra/tiles/nginx.conf: missing');
} else {
  const conf = readFileSync(nginxFile, 'utf8');
  for (const needle of [
    'listen 8080',
    'Accept-Ranges bytes',
    'Access-Control-Allow-Origin',
    'root /usr/share/nginx/html',
  ]) {
    if (!conf.includes(needle)) problems.push(`nginx.conf: missing "${needle}"`);
  }
  if (!/location \/fonts\/[\s\S]*?Cache-Control "public, max-age=31536000, immutable"/.test(conf)) {
    problems.push('nginx.conf: /fonts/ must be immutable-cached');
  }
  if (
    !/location \/sprites\/[\s\S]*?Cache-Control "public, max-age=31536000, immutable"/.test(conf)
  ) {
    problems.push('nginx.conf: /sprites/ must be immutable-cached');
  }
  if (!conf.includes('location ~* ^/style') || !conf.includes('Cache-Control "no-cache"')) {
    problems.push('nginx.conf: styles must be no-cache');
  }
}

// ── 5. font provenance (pinned checksums — see infra/tiles/README.md) ───────
const FONT_CHECKSUMS = {
  'Vazirmatn.ttf': '696249a2c74b39ffdef55de4df2809c5b639d3ff80d618d8160a095d2fd49dca',
  'Inter.ttf': '29160a80ff49ddcab2c97711247e08b1fab27a484a329ce8b813d820dc559031',
};
const mapFontsDir = path.join(repoRoot, 'scripts', 'map-fonts');
for (const [name, expected] of Object.entries(FONT_CHECKSUMS)) {
  const file = path.join(mapFontsDir, name);
  if (!existsSync(file)) {
    problems.push(`scripts/map-fonts/${name}: missing — see infra/tiles/README.md (provenance)`);
    continue;
  }
  const actual = sha256(file);
  if (actual !== expected) {
    problems.push(
      `scripts/map-fonts/${name}: checksum drift\n  expected ${expected}\n  actual   ${actual}`,
    );
  }
}

// ── 6. machine-local archive (warn only) ─────────────────────────────────────
const pmtiles = path.join(tilesDir, 'data', 'tiles', 'iran.pmtiles');
if (!existsSync(pmtiles)) {
  warnings.push(
    'infra/tiles/data/tiles/iran.pmtiles not present — the basemap archive is machine-local (see infra/tiles/README.md); styles/fonts/sprites still serve',
  );
} else if (statSync(pmtiles).size < 1_000_000) {
  warnings.push('infra/tiles/data/tiles/iran.pmtiles looks truncated (<1MB)');
}

if (problems.length > 0) {
  console.error(`check:tiles: FAIL (${problems.length} problem(s), ${warnings.length} warning(s))`);
  for (const p of problems) console.error(`  - ${p}`);
  for (const w of warnings) console.warn(`  ⚠ ${w}`);
  process.exit(1);
}
console.log(
  `check:tiles: OK (2 styles, ${EXPECTED_STACKS.length} font stacks, 2 sprite scales, nginx.conf)`,
);
for (const w of warnings) console.warn(`check:tiles: warning — ${w}`);
