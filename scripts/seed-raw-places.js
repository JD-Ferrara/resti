// ============================================================
// seed-raw-places.js — Upsert filtered places into Supabase raw_places
// ============================================================
// Runs the full pipeline (fetch → filter → neighborhood → NTA clip) for one
// or more areas, then upserts results into the raw_places staging table.
//
// Requires SUPABASE_SERVICE_ROLE_KEY (not the anon key) for server-side writes.
// Uses upsert on google_place_id, so re-running is safe.
//
// Usage:
//   node scripts/seed-raw-places.js --area hudson_yards
//   node scripts/seed-raw-places.js --area hudson_yards,chelsea
//   node scripts/seed-raw-places.js --area all

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { fetchAllPlaces } from './fetch-places.js';
import { filterPlaces, getDisplayName, normalizePriceLevel } from './filter-places.js';
import { enrichWithNeighborhood } from './detect-neighborhood.js';
import { SEARCH_AREAS } from './places-config.js';

// ── Supabase client (service role for writes) ─────────────

function getSupabase() {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env\n' +
      'Note: Use SUPABASE_SERVICE_ROLE_KEY (not the anon key) for write access.'
    );
  }
  return createClient(url, key);
}

// ── Parse --area argument ─────────────────────────────────
// Supports: "all", a single key, or comma-separated keys.

function resolveAreaKeys(areaArg) {
  if (!areaArg) {
    const valid = Object.keys(SEARCH_AREAS).join(', ');
    console.error(`Usage: node scripts/seed-raw-places.js --area <area>`);
    console.error(`  Single:    --area hudson_yards`);
    console.error(`  Multiple:  --area hudson_yards,chelsea`);
    console.error(`  All:       --area all`);
    console.error(`  Available: ${valid}`);
    process.exit(1);
  }

  if (areaArg === 'all') {
    return Object.keys(SEARCH_AREAS);
  }

  const keys = areaArg.split(',').map((k) => k.trim());
  for (const key of keys) {
    if (!SEARCH_AREAS[key]) {
      console.error(`Unknown area "${key}". Valid: ${Object.keys(SEARCH_AREAS).join(', ')}`);
      process.exit(1);
    }
  }
  return keys;
}

// ── Bounding box clip ─────────────────────────────────────
// Primary geographic filter. Uses the raw lat/lng from Google Places — no
// GeoJSON fetch required. If an area has no bounds defined, all places pass.
// This runs before NTA clipping and is the authoritative geographic gate.

function clipToBounds(enriched, areaConfig) {
  const { bounds } = areaConfig;
  if (!bounds) return { clipped: enriched, outOfBounds: [] };

  const clipped = [];
  const outOfBounds = [];

  for (const place of enriched) {
    const lat = place.location?.latitude;
    const lng = place.location?.longitude;
    if (
      lat != null &&
      lng != null &&
      lat >= bounds.south &&
      lat <= bounds.north &&
      lng >= bounds.west &&
      lng <= bounds.east
    ) {
      clipped.push(place);
    } else {
      outOfBounds.push({
        place,
        reason: 'outside_bounds',
        detail: `${getDisplayName(place)} — (${lat?.toFixed(4)}, ${lng?.toFixed(4)}) outside ${areaConfig.name} bounding box`,
      });
    }
  }

  return { clipped, outOfBounds };
}

// ── Shape a Place into a raw_places row ───────────────────

function placeToRow(place, areaKey, { status = 'pending', exclusionReason = null } = {}) {
  const { level, range } = normalizePriceLevel(place);

  return {
    google_place_id:       place.id,
    name:                  getDisplayName(place),
    address:               place.formattedAddress ?? null,
    latitude:              place.location?.latitude ?? null,
    longitude:             place.location?.longitude ?? null,
    google_rating:         place.rating ?? null,
    google_review_count:   place.userRatingCount ?? null,
    price_level:           level,
    price_range:           range,
    phone:                 place.nationalPhoneNumber ?? null,
    website:               place.websiteUri ?? null,
    hours:                 place.regularOpeningHours ?? null,
    business_status:       place.businessStatus ?? null,
    has_outdoor_seating:   place.outdoorSeating ?? null,
    takes_reservations:    place.reservable ?? null,
    serves_beer:           place.servesBeer ?? null,
    serves_wine:           place.servesWine ?? null,
    serves_breakfast:      place.servesBreakfast ?? null,
    serves_lunch:          place.servesLunch ?? null,
    serves_dinner:         place.servesDinner ?? null,
    has_takeout:           place.takeout ?? null,
    has_delivery:          place.delivery ?? null,
    google_types:          place.types ?? null,
    editorial_summary:     place.editorialSummary?.text ?? null,
    district:              place.district ?? null,
    neighborhood_area:     place.neighborhood_area ?? null,
    search_area:           areaKey,
    is_permanently_closed: place.businessStatus === 'CLOSED_PERMANENTLY',
    last_pipeline_run:     new Date().toISOString(),
    status,
    exclusion_reason:      exclusionReason,
    raw_data:              place,
  };
}

// ── Run pipeline for a single area ────────────────────────

async function runArea(areaKey, supabase) {
  const areaConfig = SEARCH_AREAS[areaKey];

  console.log(`\n${'═'.repeat(56)}`);
  console.log(`  ${areaConfig.name}`);
  console.log(`${'═'.repeat(56)}`);

  // 1. Fetch
  console.log('\n[1/4] Fetching from Google Places...');
  const raw = await fetchAllPlaces(areaKey);

  // 2. Filter (chains, rating, review count)
  console.log(`\n[2/4] Filtering ${raw.length} results...`);
  const { kept, excluded } = filterPlaces(raw);
  console.log(`  ✅ Kept: ${kept.length}  |  🚫 Excluded: ${excluded.length}`);

  // 3. Neighborhood detection
  console.log(`\n[3/4] Detecting neighborhoods...`);
  const enriched = await enrichWithNeighborhood(kept);

  // 3b. Bounding box clip — drop anything outside the area's lat/lng bounds
  const { clipped, outOfBounds } = clipToBounds(enriched, areaConfig);
  if (outOfBounds.length > 0) {
    console.log(`  ✂️  Clipped ${outOfBounds.length} place(s) outside ${areaConfig.name} bounds`);
    for (const { detail } of outOfBounds) console.log(`     · ${detail}`);
  }

  // 4. Upsert to Supabase
  const keptRows     = clipped.map((place) => placeToRow(place, areaKey, { status: 'pending' }));
  const excludedRows = [
    ...excluded.map(({ place, reason }) => placeToRow(place, areaKey, { status: 'excluded', exclusionReason: reason })),
    ...outOfBounds.map(({ place, reason }) => placeToRow(place, areaKey, { status: 'excluded', exclusionReason: reason })),
  ];
  const rows = [...keptRows, ...excludedRows];

  console.log(`\n[4/4] Upserting ${rows.length} rows (${keptRows.length} pending, ${excludedRows.length} excluded)...`);

  const BATCH_SIZE = 50;
  let upserted = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from('raw_places')
      .upsert(batch, { onConflict: 'google_place_id' });

    if (error) throw new Error(`Supabase upsert failed: ${error.message}`);
    upserted += batch.length;
    console.log(`  Upserted ${upserted}/${rows.length}...`);
  }

  console.log(`\n  ✅ Done — ${keptRows.length} pending, ${excludedRows.length} excluded\n`);
  return { areaKey, pending: keptRows.length, excluded: excludedRows.length };
}

// ── Main ──────────────────────────────────────────────────

async function run() {
  const args = process.argv.slice(2);
  const areaIdx = args.indexOf('--area');
  const areaArg = areaIdx !== -1 ? args[areaIdx + 1] : null;
  const areaKeys = resolveAreaKeys(areaArg);

  const supabase = getSupabase();

  console.log(`\n🚀 Places pipeline — ${areaKeys.length} area(s): ${areaKeys.join(', ')}`);

  const results = [];
  for (const key of areaKeys) {
    const result = await runArea(key, supabase);
    results.push(result);
  }

  if (areaKeys.length > 1) {
    console.log(`\n${'═'.repeat(56)}`);
    console.log('  Summary');
    console.log(`${'═'.repeat(56)}`);
    let totalPending = 0, totalExcluded = 0;
    for (const { areaKey, pending, excluded } of results) {
      console.log(`  ${SEARCH_AREAS[areaKey].name}: ${pending} pending, ${excluded} excluded`);
      totalPending += pending;
      totalExcluded += excluded;
    }
    console.log(`  ─────────────────────`);
    console.log(`  Total: ${totalPending} pending, ${totalExcluded} excluded\n`);
  }
}

run().catch((err) => {
  console.error(`\n❌ Fatal error: ${err.message}`);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
