// ============================================================
// seed-raw-places.js — Step 1: Discover + Filter → raw_places
// ============================================================
// Runs the discovery pipeline (fetch → filter → neighborhood → polygon clip)
// for one or more areas, then upserts only the qualifying rows into raw_places
// with status = 'pending'. Excluded places are NOT stored.
//
// Step 2: run build-filtered-places.js to Claude-classify the pending rows
// and populate filtered_places for human review before import to restaurants.
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
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point } from '@turf/helpers';
import { fetchAllPlaces } from './fetch-places.js';
import { filterPlaces, getDisplayName, normalizePriceLevel } from './filter-places.js';
import { enrichWithNeighborhood, getCustomDistrictsGeoJSON } from './detect-neighborhood.js';
import { SEARCH_AREAS, PLACES_DETAILS_EDITORIAL_FIELD_MASK } from './places-config.js';

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

// ── Polygon clip ──────────────────────────────────────────
// Primary geographic filter. Uses the custom district geofence polygon from
// scripts/data/custom-districts.geojson for authoritative geographic gating.
// Falls back to bounding box clipping if no polygon is found for the area.

function clipToPolygon(enriched, areaConfig) {
  const { districtName, name, bounds } = areaConfig;
  const customGeojson = getCustomDistrictsGeoJSON();

  // Find the matching polygon feature
  const feature = customGeojson?.features?.find(
    (f) => f.properties.Name === districtName
  );

  if (!feature) {
    // Polygon not found — fall back to bounding box
    if (bounds) {
      console.log(`  ⚠️  No geofence polygon found for "${districtName}". Falling back to bounding box.`);
      return clipToBounds(enriched, areaConfig);
    }
    // No bounds either — pass everything through
    console.log(`  ⚠️  No geofence polygon or bounds for "${districtName}". Skipping geographic clip.`);
    return { clipped: enriched, outOfBounds: [] };
  }

  const clipped = [];
  const outOfBounds = [];

  for (const place of enriched) {
    const lat = place.location?.latitude;
    const lng = place.location?.longitude;

    if (lat == null || lng == null) {
      outOfBounds.push({
        place,
        reason: 'no_coordinates',
        detail: `${getDisplayName(place)} — missing coordinates`,
      });
      continue;
    }

    const pt = point([lng, lat]);
    let inside = false;
    try {
      inside = booleanPointInPolygon(pt, feature);
    } catch {
      // If polygon check throws, don't drop the place
      inside = true;
    }

    if (inside) {
      clipped.push(place);
    } else {
      outOfBounds.push({
        place,
        reason: 'outside_polygon',
        detail: `${getDisplayName(place)} — (${lat.toFixed(4)}, ${lng.toFixed(4)}) outside ${name} geofence`,
      });
    }
  }

  return { clipped, outOfBounds };
}

// ── Bounding box clip (fallback) ──────────────────────────

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

// ── Editorial summary enrichment ──────────────────────────
// Fetches editorialSummary via Place Details (New) for a filtered set of places.
// This is called AFTER quality + geographic filtering so we only pay the
// Preferred (Atmosphere) tier rate for the ~100-150 survivors, not all ~572
// discovery results. At scale across 19 neighborhoods the savings are ~4x.

const PLACE_DETAILS_BASE_URL = 'https://places.googleapis.com/v1/places';

async function fetchEditorialSummary(apiKey, placeId) {
  const res = await fetch(`${PLACE_DETAILS_BASE_URL}/${placeId}`, {
    headers: {
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': PLACES_DETAILS_EDITORIAL_FIELD_MASK,
    },
  });

  if (!res.ok) {
    const err = await res.text();
    console.warn(`  ⚠️  Place Details error for ${placeId} (${res.status}): ${err.slice(0, 120)}`);
    return null;
  }

  const data = await res.json();
  return data.editorialSummary?.text ?? null;
}

async function enrichEditorialSummaries(places, apiKey) {
  if (places.length === 0) return new Map();

  console.log(`\n[3c/4] Fetching editorial summaries for ${places.length} filtered places...`);
  const summaries = new Map();

  for (let i = 0; i < places.length; i++) {
    const place = places[i];
    // Small delay to avoid rate limits — 50ms keeps throughput at ~20 req/s
    if (i > 0) await new Promise((r) => setTimeout(r, 50));

    const text = await fetchEditorialSummary(apiKey, place.id);
    summaries.set(place.id, text);

    if ((i + 1) % 25 === 0 || i + 1 === places.length) {
      console.log(`  [${i + 1}/${places.length}] editorial summaries fetched`);
    }
  }

  const withSummary = [...summaries.values()].filter(Boolean).length;
  console.log(`  ✅ ${withSummary}/${places.length} places have an editorial summary`);
  return summaries;
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
    google_maps_uri:       place.googleMapsUri ?? null,
    hours:                 place.regularOpeningHours ?? null,
    business_status:       place.businessStatus ?? null,
    google_types:          place.types ?? null,
    editorial_summary:     place.editorialSummary?.text ?? null,
    district:              place.district ?? null,
    neighborhood_area:     place.neighborhood_area ?? null,
    custom_district:       place.custom_district ?? null,
    search_area:           areaKey,
    is_permanently_closed: place.businessStatus === 'CLOSED_PERMANENTLY',
    last_pipeline_run:     new Date().toISOString(),
    status,
    exclusion_reason:      exclusionReason,
    raw_data:              place,
  };
}

// ── Run pipeline for a single area ────────────────────────

async function runArea(areaKey, supabase, { skipEditorial = false } = {}) {
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

  // 3. Neighborhood detection (NTA + custom district polygon)
  console.log(`\n[3/4] Detecting neighborhoods...`);
  const enriched = await enrichWithNeighborhood(kept);

  // 3b. Polygon clip — drop anything outside the area's custom geofence polygon
  const { clipped, outOfBounds } = clipToPolygon(enriched, areaConfig);
  if (outOfBounds.length > 0) {
    console.log(`  ✂️  Clipped ${outOfBounds.length} place(s) outside ${areaConfig.name} geofence`);
    for (const { detail } of outOfBounds) console.log(`     · ${detail}`);
  }

  const customDistrictMatched = clipped.filter((p) => p.custom_district).length;
  console.log(`  🗺  Custom district matched: ${customDistrictMatched}/${clipped.length}`);

  // 3c. Editorial summary enrichment (Preferred/Atmosphere tier via Place Details).
  //     Only called for places that survived quality + polygon filtering (~100–150),
  //     not the full discovery set (~500–600), keeping Preferred-tier call volume low.
  //     Skip with --skip-editorial for fast/cheap pipeline runs.
  let clippedWithEditorial;
  if (skipEditorial) {
    console.log('\n[3c/4] Editorial summary enrichment SKIPPED (--skip-editorial)');
    clippedWithEditorial = clipped;
  } else {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) throw new Error('Missing GOOGLE_PLACES_API_KEY in .env (required for editorial summary enrichment). Use --skip-editorial to bypass.');
    const editorialMap = await enrichEditorialSummaries(clipped, apiKey);
    clippedWithEditorial = clipped.map((place) => ({
      ...place,
      editorialSummary: editorialMap.get(place.id)
        ? { text: editorialMap.get(place.id) }
        : undefined,
    }));
  }

  // 4. Upsert pending rows + purge excluded rows from the table.
  //    Excluded places are not written to raw_places — this keeps the table
  //    clean for Step 2 enrichment. Any stale excluded rows from prior runs
  //    for this area are deleted so they don't accumulate.
  const keptRows = clippedWithEditorial.map((place) => placeToRow(place, areaKey, { status: 'pending' }));
  const totalExcluded = excluded.length + outOfBounds.length;

  // Delete any previously-excluded rows for this area (cleanup from prior runs)
  console.log(`\n[4/4] Purging stale excluded rows for ${areaConfig.name}...`);
  const { error: deleteError } = await supabase
    .from('raw_places')
    .delete()
    .eq('search_area', areaKey)
    .eq('status', 'excluded');
  if (deleteError) throw new Error(`Supabase delete failed: ${deleteError.message}`);

  // Upsert only the pending rows
  console.log(`  Upserting ${keptRows.length} pending rows (${totalExcluded} excluded — not stored)...`);

  const BATCH_SIZE = 50;
  let upserted = 0;

  for (let i = 0; i < keptRows.length; i += BATCH_SIZE) {
    const batch = keptRows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from('raw_places')
      .upsert(batch, { onConflict: 'google_place_id' });

    if (error) throw new Error(`Supabase upsert failed: ${error.message}`);
    upserted += batch.length;
    console.log(`  Upserted ${upserted}/${keptRows.length}...`);
  }

  console.log(`\n  ✅ Done — ${keptRows.length} pending (ready for Step 2 enrichment), ${totalExcluded} excluded (discarded)\n`);
  return { areaKey, pending: keptRows.length, excluded: totalExcluded };
}

// ── Main ──────────────────────────────────────────────────

async function run() {
  const args = process.argv.slice(2);
  const areaIdx = args.indexOf('--area');
  const areaArg = areaIdx !== -1 ? args[areaIdx + 1] : null;
  const areaKeys = resolveAreaKeys(areaArg);
  const skipEditorial = args.includes('--skip-editorial');

  const supabase = getSupabase();

  console.log(`\n🚀 Places pipeline — ${areaKeys.length} area(s): ${areaKeys.join(', ')}`);
  if (skipEditorial) console.log('   Editorial summary enrichment: SKIPPED (--skip-editorial)');

  const results = [];
  for (const key of areaKeys) {
    const result = await runArea(key, supabase, { skipEditorial });
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
