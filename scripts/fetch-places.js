// ============================================================
// fetch-places.js — Fetch restaurants from Google Places API (New)
// ============================================================
// Uses the Places API v1 Nearby Search endpoint.
// Paginates through up to 60 results per area (3 pages × 20).
//
// Usage:
//   node scripts/fetch-places.js --area hudson_yards
//   node scripts/fetch-places.js --area chelsea
//
// Output: JSON array of raw Place objects written to stdout,
//         or saved to scripts/output/<area>-raw.json

import 'dotenv/config';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SEARCH_AREAS, PLACES_DISCOVERY_FIELD_MASK } from './places-config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, 'output');

const NEARBY_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchNearby';
const TEXT_SEARCH_URL   = 'https://places.googleapis.com/v1/places:searchText';
const MAX_RESULTS_PER_PAGE = 20;
const MAX_PAGES = 3; // Google caps Nearby Search at 60 total results

// ── Helpers ───────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const areaIdx = args.indexOf('--area');
  const area = areaIdx !== -1 ? args[areaIdx + 1] : null;
  const saveFlag = args.includes('--save');
  return { area, save: saveFlag };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Core fetch ────────────────────────────────────────────

// Run two separate queries per circle — one for 'restaurant', one for 'bar'.
// A combined query would let bars and restaurants compete for the same 60-result
// quota, crowding out destination dining spots tagged as 'bar' (P.J. Clarke's,
// Bronx Brewery Kitchen, La Barra, Greywind/Spygold, etc.).
// Separate queries give each type its own 60-result budget.
const PLACE_TYPE_QUERIES = [['restaurant'], ['bar']];

async function fetchPage(apiKey, point, types, pageToken = null) {
  const body = {
    includedTypes: types,
    maxResultCount: MAX_RESULTS_PER_PAGE,
    locationRestriction: {
      circle: {
        center: {
          latitude: point.lat,
          longitude: point.lng,
        },
        radius: point.radius,
      },
    },
  };

  if (pageToken) {
    body.pageToken = pageToken;
  }

  const res = await fetch(NEARBY_SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': PLACES_DISCOVERY_FIELD_MASK,
    },
    body: JSON.stringify(body),
  });


  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Google Places API error ${res.status}: ${errorText}`);
  }

  return res.json();
}

// ── Per-point fetch ───────────────────────────────────────

async function fetchAllForPoint(apiKey, point, pointLabel) {
  const pointPlaces = [];

  for (const types of PLACE_TYPE_QUERIES) {
    const typeLabel = types.join('+');
    let pageToken = null;
    let page = 1;

    while (page <= MAX_PAGES) {
      console.error(`     [${pointLabel}/${typeLabel}] Page ${page}/${MAX_PAGES}...`);

      if (pageToken) {
        await sleep(2000);
      }

      const data = await fetchPage(apiKey, point, types, pageToken);
      const places = data.places || [];

      console.error(`     [${pointLabel}/${typeLabel}] Found ${places.length} results`);
      pointPlaces.push(...places);

      if (!data.nextPageToken || places.length < MAX_RESULTS_PER_PAGE) {
        break;
      }

      pageToken = data.nextPageToken;
      page++;
    }
  }

  return pointPlaces;
}

// ── Discovery text search ─────────────────────────────────
// searchNearby ranks by proximity/popularity and caps at 60 results per circle.
// Restaurants can be invisible regardless of radius tuning if Google's algorithm
// doesn't surface them. Text Search uses a completely different ranking model
// (text relevance within a strict geographic area) and regularly returns places
// that proximity search misses.
//
// We auto-generate queries from the area name + bounding box — no manual
// restaurant names needed. Runs after proximity search; dedup handles overlap.

async function fetchTextPage(apiKey, query, bounds, pageToken = null) {
  const body = {
    textQuery: query,
    maxResultCount: MAX_RESULTS_PER_PAGE,
    // Strict restriction (not just bias) — only returns results inside the box.
    // This means the bounding box does double duty: text search restriction +
    // post-filter in clipToBounds, so results are guaranteed geographic.
    locationRestriction: {
      rectangle: {
        low:  { latitude: bounds.south, longitude: bounds.west },
        high: { latitude: bounds.north, longitude: bounds.east },
      },
    },
  };

  if (pageToken) body.pageToken = pageToken;

  const res = await fetch(TEXT_SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': PLACES_DISCOVERY_FIELD_MASK,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Text Search error ${res.status}: ${err}`);
  }

  return res.json();
}

async function fetchDiscoveryQueries(apiKey, areaConfig) {
  const { name, bounds } = areaConfig;
  if (!bounds) return [];

  // Generic food/drink terms anchored to the area name.
  // Three queries × up to 60 results each = up to 180 additional unique candidates.
  const queries = [`restaurant ${name}`, `bar ${name}`, `dining ${name}`];
  const results = [];

  console.error(`\n   🔍 Discovery text search (${name})...`);

  for (const query of queries) {
    let pageToken = null;
    let page = 1;

    while (page <= MAX_PAGES) {
      if (pageToken) await sleep(2000);

      const data = await fetchTextPage(apiKey, query, bounds, pageToken);
      const places = data.places || [];

      console.error(`     ["${query}"] p${page}: ${places.length} results`);
      results.push(...places);

      if (!data.nextPageToken || places.length < MAX_RESULTS_PER_PAGE) break;
      pageToken = data.nextPageToken;
      page++;
    }
  }

  return results;
}

// ── Fine-grained grid generator ───────────────────────────
// The 60-result-per-query cap is the fundamental problem. Even with multiple
// circles and separate type queries, popular restaurants fill those 60 slots
// and specific places lose the ranking competition.
//
// Solution: generate a dense grid of tiny circles from the bounding box.
// With 150m radius circles spaced 150m apart, each contains ≤5 restaurants —
// the cap is never hit, so every restaurant in the box is guaranteed to appear.
//
// stepMeters controls grid density. 150m is optimal for a dense urban area
// like Hudson Yards. Larger values reduce API calls but risk missing restaurants.

const LAT_METERS_PER_DEG = 111_000;
const LNG_METERS_PER_DEG_NYC = 84_000; // at ~40.75° latitude

function generateGrid(bounds, stepMeters = 150) {
  const latStep = stepMeters / LAT_METERS_PER_DEG;
  const lngStep = stepMeters / LNG_METERS_PER_DEG_NYC;
  const radius  = Math.round(stepMeters * 1.2); // slight overlap to avoid gaps at edges

  const points = [];
  for (let lat = bounds.south; lat <= bounds.north + latStep; lat += latStep) {
    for (let lng = bounds.west; lng <= bounds.east + lngStep; lng += lngStep) {
      points.push({
        lat: Math.min(lat, bounds.north),
        lng: Math.min(lng, bounds.east),
        radius,
      });
    }
  }
  return points;
}

export async function fetchAllPlaces(areaKey) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_PLACES_API_KEY is not set in .env');
  }

  const areaConfig = SEARCH_AREAS[areaKey];
  if (!areaConfig) {
    const valid = Object.keys(SEARCH_AREAS).join(', ');
    throw new Error(`Unknown area "${areaKey}". Valid areas: ${valid}`);
  }

  const searchPoints = areaConfig.gridStepMeters
    ? generateGrid(areaConfig.bounds, areaConfig.gridStepMeters)
    : areaConfig.searchPoints;

  const gridNote = areaConfig.gridStepMeters
    ? `fine grid — ${searchPoints.length} cells × ${areaConfig.gridStepMeters}m`
    : `${searchPoints.length} point${searchPoints.length > 1 ? 's' : ''}`;
  console.error(`\n📍 Fetching restaurants in ${areaConfig.name} (${gridNote})\n`);

  const seen = new Set();
  const allPlaces = [];

  for (let i = 0; i < searchPoints.length; i++) {
    const point = searchPoints[i];
    const label = searchPoints.length > 1 ? `point ${i + 1}/${searchPoints.length} — ${point.lat},${point.lng} r=${point.radius}m` : `${point.lat},${point.lng} r=${point.radius}m`;
    console.error(`   → ${label}`);

    const places = await fetchAllForPoint(apiKey, point, `${i + 1}`);

    let newCount = 0;
    for (const place of places) {
      if (!seen.has(place.id)) {
        seen.add(place.id);
        allPlaces.push(place);
        newCount++;
      }
    }

    if (searchPoints.length > 1) {
      console.error(`     → ${newCount} new unique results (${places.length - newCount} duplicates)\n`);
    }
  }

  // Discovery text queries — catches places that proximity ranking misses
  const discoveryResults = await fetchDiscoveryQueries(apiKey, areaConfig);
  let discoveryNew = 0;
  for (const place of discoveryResults) {
    if (!seen.has(place.id)) {
      seen.add(place.id);
      allPlaces.push(place);
      discoveryNew++;
    }
  }
  if (discoveryNew > 0) console.error(`   → ${discoveryNew} new unique results from discovery search`);

  console.error(`\n✅ Total unique results: ${allPlaces.length}\n`);
  return allPlaces;
}

// ── Entry point (only runs when invoked directly) ─────────

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  const { area, save } = parseArgs();

  if (!area) {
    const valid = Object.keys(SEARCH_AREAS).join(', ');
    console.error(`Usage: node scripts/fetch-places.js --area <area> [--save]`);
    console.error(`Available areas: ${valid}`);
    process.exit(1);
  }

  try {
    const places = await fetchAllPlaces(area);

    if (save) {
      mkdirSync(OUTPUT_DIR, { recursive: true });
      const outPath = join(OUTPUT_DIR, `${area}-raw.json`);
      writeFileSync(outPath, JSON.stringify(places, null, 2));
      console.error(`💾 Saved to ${outPath}`);
    } else {
      // Write JSON to stdout so this script can be piped
      process.stdout.write(JSON.stringify(places, null, 2));
    }
  } catch (err) {
    console.error(`\n❌ Error: ${err.message}`);
    process.exit(1);
  }
}
