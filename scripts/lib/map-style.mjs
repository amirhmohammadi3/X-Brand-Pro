// scripts/lib/map-style.mjs — the pure basemap style builder (I3.1).
//
// One layer list, two palettes (light/dark), zero external references: the
// output style points at the SELF-HOSTED tiles stack only — the vector source
// is a `pmtiles://` URL against the tile server origin (baked at generate
// time from TILES_PUBLIC_URL), while glyphs/sprite stay RELATIVE to the style
// URL so the same style file works on any origin (nginx serves all four from
// one place; see infra/tiles/nginx.conf).
//
// Basemap data schema: Protomaps Basemap **Version 4** (docs.protomaps.com/
// basemaps/layers) — layers `boundaries`, `buildings`, `earth`, `landcover`,
// `landuse`, `places`, `pois`, `roads`, `transit`, `water`; common tags
// `name`/`name:*`, `min_zoom`, `sort_rank`. A layer that references a
// source-layer/field the deployed build does not carry renders nothing —
// it never breaks the map (MapLibre warns once). DECISIONS 2026-11-09 (I3.1)
// records why v4 and how the tiles get built.
//
// Palette: derived from the `modern` theme pack tokens (docs/DESIGN.md §2 —
// cool neutrals, indigo primary) per DESIGN "map-style=light|dark following
// mode"; the map component (F3.1) swaps style.light/style.dark per mode.
// Text is Persian-first: every label uses the self-hosted Vazirmatn glyph
// stacks (AGENTS.md §2 — Vazirmatn for Persian/Arabic script) and prefers
// `name:fa` when the build carries localized names.

/**
 * @param {'light' | 'dark'} mode
 */
export function basemapPalette(mode) {
  const light = {
    background: '#F6F7FB', // modern.bg
    landcoverUrban: '#EDF0F7', // modern.surfaceAlt
    landcoverGreen: '#E3EAE0',
    landcoverSand: '#EFEAE0',
    landuse: '#EBF0EA',
    water: '#C9DDF0',
    waterDark: '#B6CFE6',
    building: '#E6E9F0',
    roadCasing: '#FFFFFF',
    roadMinor: '#FFFFFF',
    roadMajor: '#F3EFE6',
    roadHighway: '#F6DFA6',
    roadPath: '#E7E9EE',
    boundary: '#C6CCDA',
    text: '#475569', // modern.muted
    textStrong: '#0F172A', // modern.text
    textHalo: '#F6F7FB',
    rail: '#C3C9D6',
  };
  const dark = {
    background: '#0B1020', // modern.bg (dark)
    landcoverUrban: '#141B30', // modern.surfaceAlt (dark)
    landcoverGreen: '#12230F',
    landcoverSand: '#241F16',
    landuse: '#101A2C',
    water: '#0E2238',
    waterDark: '#0A1A2C',
    building: '#161E36',
    roadCasing: '#0B1020',
    roadMinor: '#1C2540',
    roadMajor: '#26304F',
    roadHighway: '#3A3A28',
    roadPath: '#141B30',
    boundary: '#2A3452', // modern.borderSubtle (dark)
    text: '#A6B0CC', // modern.muted (dark)
    textStrong: '#E8ECF8', // modern.text (dark)
    textHalo: '#0B1020',
    rail: '#232C49',
  };
  return mode === 'dark' ? dark : light;
}

/** Self-hosted font stacks only (AGENTS.md §2 — Vazirmatn for Persian/Arabic
 * script, Inter for Latin). Single-font stacks: MapLibre resolves the glyph
 * URL per stack, and one-stack-per-layer keeps the served layout
 * `/fonts/<stack>/<range>.pbf` predictable. */
export const FONT_REGULAR = ['Vazirmatn Regular'];
export const FONT_MEDIUM = ['Vazirmatn Medium'];
export const FONT_BOLD = ['Vazirmatn Bold'];

/** Persian-first label expression: prefer `name:fa` (localized builds), fall
 * back to the local `name` (Persian for Iran tiles). */
export const LABEL_FIELD = ['coalesce', ['get', 'name:fa'], ['get', 'name']];

/**
 * Build the MapLibre style object for one mode.
 * @param {{ mode: 'light' | 'dark', tilesUrl: string, name?: string }} opts
 *   `tilesUrl` — the tile-server public origin (e.g. http://localhost:8080);
 *   the vector source becomes `pmtiles://<tilesUrl>/tiles/iran.pmtiles`.
 */
export function buildStyle({ mode, tilesUrl, name }) {
  const p = basemapPalette(mode);
  const suffix = mode === 'dark' ? ' Dark' : '';
  const tilesOrigin = tilesUrl.replace(/\/+$/, '');
  return {
    version: 8,
    name: name ?? `X-Brand Basemap${suffix}`,
    // Relative glyphs/sprite URLs resolve against the style URL — the style,
    // tiles, fonts and sprites are all served by the same self-hosted nginx
    // (infra/tiles), so the style file works on any deployment origin.
    glyphs: '/fonts/{fontstack}/{range}.pbf',
    sprite: '/sprites/sprite',
    sources: {
      iran: {
        type: 'vector',
        url: `pmtiles://${tilesOrigin}/tiles/iran.pmtiles`,
      },
    },
    layers: [
      // ── base ────────────────────────────────────────────────────────────
      { id: 'background', type: 'background', paint: { 'background-color': p.background } },

      // ── landcover (Protomaps v4 `landcover`, z0–7 polygons) ────────────
      {
        id: 'landcover-urban',
        type: 'fill',
        source: 'iran',
        'source-layer': 'landcover',
        filter: ['==', ['get', 'kind'], 'urban_area'],
        paint: { 'fill-color': p.landcoverUrban, 'fill-opacity': 0.6 },
      },
      {
        id: 'landcover-green',
        type: 'fill',
        source: 'iran',
        'source-layer': 'landcover',
        filter: ['in', ['get', 'kind'], ['literal', ['forest', 'grassland']]],
        paint: { 'fill-color': p.landcoverGreen, 'fill-opacity': 0.45 },
      },
      {
        id: 'landcover-sand',
        type: 'fill',
        source: 'iran',
        'source-layer': 'landcover',
        filter: ['in', ['get', 'kind'], ['literal', ['barren', 'farmland', 'scrub']]],
        paint: { 'fill-color': p.landcoverSand, 'fill-opacity': 0.4 },
      },

      // ── landuse (Protomaps v4 `landuse`, z13+ OSM polygons) ────────────
      {
        id: 'landuse-green',
        type: 'fill',
        source: 'iran',
        'source-layer': 'landuse',
        minzoom: 13,
        filter: [
          'in',
          ['get', 'kind'],
          ['literal', ['park', 'garden', 'cemetery', 'pitch', 'recreation_ground']],
        ],
        paint: { 'fill-color': p.landuse, 'fill-opacity': 0.5 },
      },

      // ── water (Protomaps v4 `water`) ───────────────────────────────────
      {
        id: 'water-poly',
        type: 'fill',
        source: 'iran',
        'source-layer': 'water',
        paint: {
          'fill-color': ['case', ['==', ['get', 'brunnel'], 'tunnel'], p.waterDark, p.water],
        },
      },
      {
        id: 'waterway-line',
        type: 'line',
        source: 'iran',
        'source-layer': 'water',
        minzoom: 8,
        filter: ['!=', ['get', 'brunnel'], 'tunnel'],
        paint: {
          'line-color': p.water,
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 12, 1.4, 16, 3.2],
        },
      },

      // ── buildings (Protomaps v4 `buildings`) ───────────────────────────
      {
        id: 'buildings',
        type: 'fill',
        source: 'iran',
        'source-layer': 'buildings',
        minzoom: 14,
        filter: ['!=', ['get', 'kind'], 'address'],
        paint: { 'fill-color': p.building, 'fill-opacity': 0.9 },
      },

      // ── roads (Protomaps v4 `roads`) — casing under fill per class ─────
      road('highway-casing', 'highway', true, 5, {
        color: p.roadCasing,
        widths: [
          [5, 1.6],
          [9, 3.5],
          [14, 9],
          [18, 22],
        ],
      }),
      road('highway', 'highway', false, 5, {
        color: p.roadHighway,
        widths: [
          [5, 1.0],
          [9, 2.2],
          [14, 7],
          [18, 18],
        ],
      }),
      road('major-casing', 'major_road', true, 9, {
        color: p.roadCasing,
        widths: [
          [9, 1.2],
          [14, 5],
          [18, 13],
        ],
      }),
      road('major', 'major_road', false, 9, {
        color: p.roadMajor,
        widths: [
          [9, 0.8],
          [14, 3.5],
          [18, 10],
        ],
      }),
      road('minor-casing', 'minor_road', true, 12.5, {
        color: p.roadCasing,
        widths: [
          [12.5, 0.8],
          [16, 3.5],
          [18, 7],
        ],
      }),
      road('minor', 'minor_road', false, 12.5, {
        color: p.roadMinor,
        widths: [
          [12.5, 0.5],
          [16, 2.5],
          [18, 5.5],
        ],
      }),
      road('path', 'path', false, 15, {
        color: p.roadPath,
        widths: [
          [15, 0.5],
          [18, 2],
        ],
      }),
      {
        id: 'rail',
        type: 'line',
        source: 'iran',
        'source-layer': 'roads',
        minzoom: 10,
        filter: ['==', ['get', 'kind'], 'rail'],
        paint: {
          'line-color': p.rail,
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.4, 16, 1.6],
        },
      },

      // ── boundaries (Protomaps v4 `boundaries`) ─────────────────────────
      {
        id: 'boundary-country',
        type: 'line',
        source: 'iran',
        'source-layer': 'boundaries',
        minzoom: 3,
        filter: ['==', ['get', 'kind'], 'country'],
        paint: {
          'line-color': p.boundary,
          'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.6, 8, 1.6],
        },
      },

      // ── road labels (name along the line, Persian-first) ───────────────
      {
        id: 'road-labels',
        type: 'symbol',
        source: 'iran',
        'source-layer': 'roads',
        minzoom: 14,
        filter: ['has', ['get', 'name']],
        layout: {
          'symbol-placement': 'line',
          'text-field': LABEL_FIELD,
          'text-font': FONT_REGULAR,
          'text-size': 11,
        },
        paint: {
          'text-color': p.text,
          'text-halo-color': p.textHalo,
          'text-halo-width': 1.4,
        },
      },

      // ── place labels (Protomaps v4 `places`, Tilezen kinds) ────────────
      placeLabel('place-country', ['==', ['get', 'kind'], 'country'], 2.5, {
        font: FONT_BOLD,
        size: 13,
        color: p.textStrong,
        transform: 'uppercase',
        spacing: 0.35,
        halo: p.textHalo,
        haloWidth: 1.6,
        letterSpacing: 0.08,
      }),
      placeLabel(
        'place-city',
        ['all', ['==', ['get', 'kind'], 'locality'], ['<=', ['get', 'min_zoom'], 8]],
        4,
        {
          font: FONT_BOLD,
          size: 12,
          color: p.textStrong,
          halo: p.textHalo,
          haloWidth: 1.4,
        },
      ),
      placeLabel(
        'place-town',
        [
          'all',
          ['==', ['get', 'kind'], 'locality'],
          ['>', ['get', 'min_zoom'], 8],
          ['<=', ['get', 'min_zoom'], 10.5],
        ],
        8,
        {
          font: FONT_MEDIUM,
          size: 11,
          color: p.text,
          halo: p.textHalo,
          haloWidth: 1.2,
        },
      ),
      placeLabel(
        'place-village',
        ['all', ['==', ['get', 'kind'], 'locality'], ['>', ['get', 'min_zoom'], 10.5]],
        11,
        {
          font: FONT_REGULAR,
          size: 10,
          color: p.text,
          halo: p.textHalo,
          haloWidth: 1.2,
        },
      ),
      placeLabel(
        'place-neighbourhood',
        ['in', ['get', 'kind'], ['literal', ['neighbourhood', 'macrohood']]],
        12,
        {
          font: FONT_REGULAR,
          size: 10,
          color: p.text,
          halo: p.textHalo,
          haloWidth: 1.2,
          letterSpacing: 0.05,
        },
      ),
    ],
  };
}

/** A road line layer (casing or fill) for one Protomaps road kind. Field
 * filters stay minimal (kind only) — tunnel/bridge differentiation is left
 * to the deployed build's tags, and a missing field simply renders normally. */
function road(id, kind, casing, minzoom, { color, widths }) {
  return {
    id,
    type: 'line',
    source: 'iran',
    'source-layer': 'roads',
    minzoom,
    filter: ['==', ['get', 'kind'], kind],
    paint: {
      'line-color': color,
      'line-width': ['interpolate', ['linear'], ['zoom'], ...widths.flatMap(([z, w]) => [z, w])],
    },
    ...(kind === 'path' ? { layout: { 'line-cap': 'round' } } : {}),
  };
}

/** A place label symbol layer with the shared Persian-first text settings. */
function placeLabel(
  id,
  filter,
  minzoom,
  { font, size, color, halo, haloWidth, transform, letterSpacing },
) {
  return {
    id,
    type: 'symbol',
    source: 'iran',
    'source-layer': 'places',
    minzoom,
    filter,
    layout: {
      'text-field': LABEL_FIELD,
      'text-font': font,
      'text-size': size,
      ...(transform ? { 'text-transform': transform } : {}),
      ...(letterSpacing ? { 'text-letter-spacing': letterSpacing } : {}),
    },
    paint: {
      'text-color': color,
      'text-halo-color': halo,
      'text-halo-width': haloWidth,
    },
  };
}
