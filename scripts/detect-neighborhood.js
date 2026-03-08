// ============================================================
// detect-neighborhood.js — turf.js point-in-polygon neighborhood detection
// ============================================================
// For each Place, checks its lat/lng against NYC Open Data's
// Neighborhood Tabulation Area (NTA) GeoJSON boundaries to determine:
//   · district         — fine-grained NTA name (e.g. "Chelsea")
//   · neighborhood_area — broader grouping (e.g. "Chelsea / Midtown West")
//
// GeoJSON is fetched once from NYC Open Data and cached locally at
// scripts/cache/nyc-neighborhoods.geojson to avoid repeated network calls.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point } from '@turf/helpers';
import { NYC_GEOJSON_URL, NEIGHBORHOOD_AREA_MAP } from './places-config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, 'cache');
const CACHE_PATH = join(CACHE_DIR, 'nyc-neighborhoods.geojson');

// ── GeoJSON loading ───────────────────────────────────────

async function loadNycGeoJSON() {
  if (existsSync(CACHE_PATH)) {
    console.error('   📂 Using cached NYC neighborhood GeoJSON');
    return JSON.parse(readFileSync(CACHE_PATH, 'utf-8'));
  }

  console.error(`   🌐 Fetching NYC neighborhood GeoJSON from NYC Open Data...`);
  const res = await fetch(NYC_GEOJSON_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch NYC GeoJSON: ${res.status} ${res.statusText}`);
  }

  const geojson = await res.json();
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(CACHE_PATH, JSON.stringify(geojson));
  console.error(`   💾 Cached to ${CACHE_PATH}`);

  return geojson;
}

// ── Neighborhood lookup ───────────────────────────────────

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
 *
 * @param {Object[]} places - Filtered places from filter-places.js
 * @returns {Promise<Object[]>} Places with district + neighborhood_area added
 */
export async function enrichWithNeighborhood(places) {
  const geojson = await loadNycGeoJSON();

  return places.map((place) => {
    const lat = place.location?.latitude;
    const lng = place.location?.longitude;

    if (!lat || !lng) {
      return { ...place, district: null, neighborhood_area: null };
    }

    const { district, neighborhood_area } = detectNeighborhood(lat, lng, geojson);
    return { ...place, district, neighborhood_area };
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
      console.error(`   ✅ Matched: ${found}/${enriched.length} places to a neighborhood\n`);

      process.stdout.write(JSON.stringify(enriched, null, 2));
    } catch (err) {
      console.error(`❌ Error: ${err.message}`);
      process.exit(1);
    }
  });
}
