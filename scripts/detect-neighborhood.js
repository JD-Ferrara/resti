// ============================================================
// detect-neighborhood.js — turf.js point-in-polygon neighborhood detection
// ============================================================
// For each Place, checks its lat/lng against:
//   1. scripts/data/custom-districts.geojson — custom V1 district polygons.
//      Returns custom_district (the district Name from the GeoJSON).
//   2. NYC Open Data NTA GeoJSON boundaries (cached) — returns:
//      · district         — fine-grained NTA name (e.g. "Chelsea")
//      · neighborhood_area — broader grouping (e.g. "Chelsea / Midtown West")
//
// NYC GeoJSON is fetched once from NYC Open Data and cached locally at
// scripts/cache/nyc-neighborhoods.geojson to avoid repeated network calls.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point } from '@turf/helpers';
import { NEIGHBORHOOD_AREA_MAP } from './places-config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Custom districts GeoJSON (local) ─────────────────────

const CUSTOM_DISTRICTS_PATH = join(__dirname, 'data', 'custom-districts.geojson');

let _customDistrictsCache = null;

export function getCustomDistrictsGeoJSON() {
  if (_customDistrictsCache) return _customDistrictsCache;
  try {
    _customDistrictsCache = JSON.parse(readFileSync(CUSTOM_DISTRICTS_PATH, 'utf-8'));
    return _customDistrictsCache;
  } catch (err) {
    console.error(`   ⚠️  Could not load custom districts GeoJSON: ${err.message}`);
    return null;
  }
}

/**
 * Detect which custom district a lat/lng falls within.
 * Uses scripts/data/custom-districts.geojson — local file, no network call.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {Object} customGeojson - FeatureCollection from custom-districts.geojson
 * @returns {string|null} The district Name (e.g. "Hudson Yards"), or null if outside all polygons
 */
export function detectCustomDistrict(lat, lng, customGeojson) {
  if (!customGeojson) return null;

  const pt = point([lng, lat]); // turf uses [lng, lat] (GeoJSON order)

  for (const feature of customGeojson.features) {
    try {
      if (booleanPointInPolygon(pt, feature)) {
        return feature.properties.Name ?? null;
      }
    } catch {
      // Skip malformed features
    }
  }

  return null;
}

// ── NYC NTA GeoJSON (remote, cached) ─────────────────────

const CACHE_DIR = join(__dirname, 'cache');
const CACHE_PATH = join(CACHE_DIR, 'nyc-neighborhoods.geojson');

// Multiple candidate URLs — tried in order until one succeeds.
// NYC Open Data changes their export endpoints periodically.
const NYC_GEOJSON_URLS = [
  // 2010 NTA — Socrata resource endpoint
  'https://data.cityofnewyork.us/resource/cpf4-rkhq.geojson?$limit=5000',
  // 2020 NTA — updated dataset
  'https://data.cityofnewyork.us/resource/9nt8-h7nd.geojson?$limit=5000',
];

async function loadNycGeoJSON() {
  if (existsSync(CACHE_PATH)) {
    console.error('   📂 Using cached NYC neighborhood GeoJSON');
    return JSON.parse(readFileSync(CACHE_PATH, 'utf-8'));
  }

  console.error(`   🌐 Fetching NYC neighborhood GeoJSON...`);

  for (const url of NYC_GEOJSON_URLS) {
    try {
      console.error(`   → Trying: ${url}`);
      const res = await fetch(url);
      if (!res.ok) {
        console.error(`     ✗ ${res.status} ${res.statusText}`);
        continue;
      }
      const geojson = await res.json();
      if (!geojson.features?.length) {
        console.error(`     ✗ Empty response`);
        continue;
      }
      mkdirSync(CACHE_DIR, { recursive: true });
      writeFileSync(CACHE_PATH, JSON.stringify(geojson));
      console.error(`   💾 Cached to ${CACHE_PATH} (${geojson.features.length} features)`);
      return geojson;
    } catch (err) {
      console.error(`     ✗ ${err.message}`);
    }
  }

  // All URLs failed — proceed without neighborhood detection rather than crashing.
  console.error(`   ⚠️  All GeoJSON sources failed. Neighborhood detection will be skipped.`);
  console.error(`      Places will still be seeded; district/neighborhood_area will be null.`);
  return null;
}

// ── NTA neighborhood lookup ───────────────────────────────

/**
 * Extract NTA name from a GeoJSON feature's properties.
 * NYC Open Data NTA features use the "ntaname" property.
 */
function getNtaName(feature) {
  const props = feature.properties || {};
  // Try multiple property name conventions used by different NYC Open Data exports
  return props.ntaname || props.NTAName || props.neighborhood || props.name || null;
}

/**
 * Find the NYC neighborhood for a lat/lng coordinate.
 * Returns { district, neighborhood_area } — both may be null if outside NYC.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {Object} geojson - NYC NTA FeatureCollection
 * @returns {{ district: string|null, neighborhood_area: string|null }}
 */
export function detectNeighborhood(lat, lng, geojson) {
  const pt = point([lng, lat]); // turf uses [lng, lat] (GeoJSON order)

  for (const feature of geojson.features) {
    try {
      if (booleanPointInPolygon(pt, feature)) {
        const ntaName = getNtaName(feature);
        const neighborhoodArea = ntaName ? (NEIGHBORHOOD_AREA_MAP[ntaName] ?? ntaName) : null;
        return {
          district: ntaName,
          neighborhood_area: neighborhoodArea,
        };
      }
    } catch {
      // Skip malformed features
    }
  }

  return { district: null, neighborhood_area: null };
}

/**
 * Enrich an array of filtered Places with neighborhood data.
 * Sets district, neighborhood_area (from NYC Open Data NTA) and
 * custom_district (from scripts/data/custom-districts.geojson).
 *
 * @param {Object[]} places - Filtered places from filter-places.js
 * @returns {Promise<Object[]>} Places with district, neighborhood_area, and custom_district added
 */
export async function enrichWithNeighborhood(places) {
  const geojson = await loadNycGeoJSON();
  const customGeojson = getCustomDistrictsGeoJSON();

  return places.map((place) => {
    const lat = place.location?.latitude;
    const lng = place.location?.longitude;

    if (!lat || !lng) {
      return { ...place, district: null, neighborhood_area: null, custom_district: null };
    }

    const { district, neighborhood_area } = geojson
      ? detectNeighborhood(lat, lng, geojson)
      : { district: null, neighborhood_area: null };

    const custom_district = detectCustomDistrict(lat, lng, customGeojson);

    return { ...place, district, neighborhood_area, custom_district };
  });
}

// ── CLI: pipe mode ────────────────────────────────────────
// Usage: ... | node scripts/filter-places.js | node scripts/detect-neighborhood.js

if (process.stdin.isTTY === false || process.argv[1]?.includes('detect-neighborhood')) {
  const chunks = [];
  process.stdin.on('data', (c) => chunks.push(c));
  process.stdin.on('end', async () => {
    try {
      const places = JSON.parse(Buffer.concat(chunks).toString());
      console.error(`\n🗺  Detecting neighborhoods for ${places.length} places...`);
      const enriched = await enrichWithNeighborhood(places);

      const found = enriched.filter((p) => p.district).length;
      const customFound = enriched.filter((p) => p.custom_district).length;
      console.error(`   ✅ NTA matched:            ${found}/${enriched.length} places`);
      console.error(`   ✅ Custom district matched: ${customFound}/${enriched.length} places\n`);

      process.stdout.write(JSON.stringify(enriched, null, 2));
    } catch (err) {
      console.error(`❌ Error: ${err.message}`);
      process.exit(1);
    }
  });
}
