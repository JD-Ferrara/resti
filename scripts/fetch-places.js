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
import { SEARCH_AREAS, PLACES_FIELD_MASK } from './places-config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, 'output');

const NEARBY_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchNearby';
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

async function fetchPage(apiKey, point, pageToken = null) {
  const body = {
    includedTypes: ['restaurant'],
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
      'X-Goog-FieldMask': PLACES_FIELD_MASK,
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
  let pageToken = null;
  let page = 1;

  while (page <= MAX_PAGES) {
    console.error(`     [${pointLabel}] Page ${page}/${MAX_PAGES}...`);

    if (pageToken) {
      await sleep(2000);
    }

    const data = await fetchPage(apiKey, point, pageToken);
    const places = data.places || [];

    console.error(`     [${pointLabel}] Found ${places.length} results`);
    pointPlaces.push(...places);

    if (!data.nextPageToken || places.length < MAX_RESULTS_PER_PAGE) {
      break;
    }

    pageToken = data.nextPageToken;
    page++;
  }

  return pointPlaces;
}

// ── Main ──────────────────────────────────────────────────

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

  const searchPoints = areaConfig.searchPoints;
  console.error(`\n📍 Fetching restaurants in ${areaConfig.name} (${searchPoints.length} search point${searchPoints.length > 1 ? 's' : ''})\n`);

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

  console.error(`\n✅ Total unique restaurants: ${allPlaces.length}\n`);
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
