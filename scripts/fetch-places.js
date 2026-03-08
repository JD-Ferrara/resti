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

async function fetchPage(apiKey, areaConfig, pageToken = null) {
  const body = {
    includedTypes: ['restaurant'],
    maxResultCount: MAX_RESULTS_PER_PAGE,
    locationRestriction: {
      circle: {
        center: {
          latitude: areaConfig.lat,
          longitude: areaConfig.lng,
        },
        radius: areaConfig.radius,
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

  console.error(`\n📍 Fetching restaurants near ${areaConfig.name}`);
  console.error(`   Coordinates: ${areaConfig.lat}, ${areaConfig.lng}`);
  console.error(`   Radius: ${areaConfig.radius}m\n`);

  const allPlaces = [];
  let pageToken = null;
  let page = 1;

  while (page <= MAX_PAGES) {
    console.error(`   → Page ${page}/${MAX_PAGES}...`);

    // Google requires a short delay before using a nextPageToken
    if (pageToken) {
      await sleep(2000);
    }

    const data = await fetchPage(apiKey, areaConfig, pageToken);
    const places = data.places || [];

    console.error(`     Found ${places.length} results`);
    allPlaces.push(...places);

    if (!data.nextPageToken || places.length < MAX_RESULTS_PER_PAGE) {
      console.error(`   → No more pages.`);
      break;
    }

    pageToken = data.nextPageToken;
    page++;
  }

  console.error(`\n✅ Total fetched: ${allPlaces.length} restaurants\n`);
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
