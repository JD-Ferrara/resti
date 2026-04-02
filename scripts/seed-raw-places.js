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
import { SEARCH_AREAS, PLACES_DETAILS_ENRICHMENT_FIELD_MASK } from './places-config.js';

const BATCH_SIZE = 50; // rows per Supabase upsert / delete batch

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

// Fetches editorialSummary + regularOpeningHours for a single place.
// Both are Enterprise tier — fetching them together in one call costs the same
// as fetching editorialSummary alone (billing is per request, not per field).
async function fetchPlaceEnrichment(apiKey, placeId) {
  const res = await fetch(`${PLACE_DETAILS_BASE_URL}/${placeId}`, {
    headers: {
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': PLACES_DETAILS_ENRICHMENT_FIELD_MASK,
    },
  });

  if (!res.ok) {
    const err = await res.text();
    console.warn(`  ⚠️  Place Details error for ${placeId} (${res.status}): ${err.slice(0, 120)}`);
    return { editorial: null, hours: null };
  }

  const data = await res.json();
  return {
    editorial: data.editorialSummary?.text ?? null,
    hours:     data.regularOpeningHours ?? null,
  };
}

async function enrichPlaceDetails(places, apiKey) {
  if (places.length === 0) return new Map();

  console.log(`\n[3c/4] Fetching Place Details (editorial + hours) for ${places.length} filtered places...`);
  const enrichment = new Map();

  for (let i = 0; i < places.length; i++) {
    const place = places[i];
    // 50ms delay → ~20 req/s, well within rate limits
    if (i > 0) await new Promise((r) => setTimeout(r, 50));

    const data = await fetchPlaceEnrichment(apiKey, place.id);
    enrichment.set(place.id, data);

    if ((i + 1) % 25 === 0 || i + 1 === places.length) {
      console.log(`  [${i + 1}/${places.length}] enriched`);
    }
  }

  const withEditorial = [...enrichment.values()].filter(e => e.editorial).length;
  const withHours     = [...enrichment.values()].filter(e => e.hours).length;
  console.log(`  ✅ ${withEditorial}/${places.length} have editorial summary, ${withHours}/${places.length} have hours`);
  return enrichment;
}

// ── Shape a Place into a raw_places row ───────────────────
// Used for genuinely new places (full insert including editorial + hours).

function placeToRow(place, areaKey) {
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
    status:                'pending',
    exclusion_reason:      null,
    raw_data:              place,
  };
}

// ── Shape a monitoring-only update for an existing place ──
// Updates only the fields that reflect real-world changes between runs
// (rating, review count, business status, types). Does NOT overwrite
// editorial_summary or hours — those come from Place Details and never
// need to be re-fetched unless the place is genuinely new.

function placeToMonitoringUpdate(place) {
  const { level, range } = normalizePriceLevel(place);

  return {
    google_place_id:       place.id,
    name:                  getDisplayName(place),   // NOT NULL — required for safe upsert
    google_rating:         place.rating ?? null,
    google_review_count:   place.userRatingCount ?? null,
    price_level:           level,
    price_range:           range,
    business_status:       place.businessStatus ?? null,
    is_permanently_closed: place.businessStatus === 'CLOSED_PERMANENTLY',
    google_types:          place.types ?? null,
    last_pipeline_run:     new Date().toISOString(),
    status:                'pending',
    exclusion_reason:      null,
  };
}

// ── Look up which of the given place IDs already exist in DB ─

async function fetchExistingIds(supabase, placeIds) {
  if (placeIds.length === 0) return new Set();
  const { data, error } = await supabase
    .from('raw_places')
    .select('google_place_id')
    .in('google_place_id', placeIds);
  if (error) throw new Error(`Failed to look up existing place IDs: ${error.message}`);
  return new Set((data ?? []).map((r) => r.google_place_id));
}

// ── Run pipeline for a single area ────────────────────────

async function runArea(areaKey, supabase, { skipEditorial = false } = {}) {
  const areaConfig = SEARCH_AREAS[areaKey];

  console.log(`\n${'═'.repeat(56)}`);
  console.log(`  ${areaConfig.name}`);
  console.log(`${'═'.repeat(56)}`);

  // 1. Fetch (Basic/Advanced tier — no Enterprise fields)
  console.log('\n[1/5] Fetching from Google Places...');
  const raw = await fetchAllPlaces(areaKey);

  // 2. Filter (chains, closed status, rating, review count)
  console.log(`\n[2/5] Filtering ${raw.length} results...`);
  const { kept, excluded } = filterPlaces(raw);
  console.log(`  ✅ Kept: ${kept.length}  |  🚫 Excluded: ${excluded.length}`);

  // 3. Neighborhood detection + polygon clip
  console.log(`\n[3/5] Detecting neighborhoods...`);
  const enriched = await enrichWithNeighborhood(kept);

  const { clipped, outOfBounds } = clipToPolygon(enriched, areaConfig);
  if (outOfBounds.length > 0) {
    console.log(`  ✂️  Clipped ${outOfBounds.length} place(s) outside ${areaConfig.name} geofence`);
    for (const { detail } of outOfBounds) console.log(`     · ${detail}`);
  }
  const customDistrictMatched = clipped.filter((p) => p.custom_district).length;
  console.log(`  🗺  Custom district matched: ${customDistrictMatched}/${clipped.length}`);

  // 4. Place Details enrichment (Enterprise tier) — editorialSummary + regularOpeningHours.
  //    Only called for places NOT already in raw_places. Existing rows keep their stored
  //    editorial_summary and hours, so re-runs cost nothing for places already in the DB.
  console.log(`\n[4/5] Place Details enrichment (new places only)...`);
  const clippedIds = clipped.map((p) => p.id);
  const existingIds = await fetchExistingIds(supabase, clippedIds);
  const newPlaces      = clipped.filter((p) => !existingIds.has(p.id));
  const existingPlaces = clipped.filter((p) =>  existingIds.has(p.id));
  console.log(`  ${existingPlaces.length} existing (monitoring refresh)  |  ${newPlaces.length} new (Place Details required)`);

  let newPlacesWithDetails = newPlaces;
  if (!skipEditorial && newPlaces.length > 0) {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) throw new Error('Missing GOOGLE_PLACES_API_KEY in .env. Use --skip-editorial to bypass.');
    const enrichmentMap = await enrichPlaceDetails(newPlaces, apiKey);
    newPlacesWithDetails = newPlaces.map((place) => {
      const det = enrichmentMap.get(place.id);
      return {
        ...place,
        editorialSummary:    det?.editorial ? { text: det.editorial } : undefined,
        regularOpeningHours: det?.hours ?? undefined,
      };
    });
  } else if (skipEditorial) {
    console.log('  Place Details SKIPPED (--skip-editorial)');
  }

  // 5. Sync to database
  //    a) Monitoring refresh for existing places — partial upsert preserving
  //       editorial_summary, hours, and other fields not in the discovery response.
  //    b) Full insert for new places.
  //    c) Delete stale rows — anything in raw_places for this area that is no longer
  //       in the current kept set (temp-closed, permanently closed, newly filtered out,
  //       or simply not returned by Google this run). Runs in the same pass so the
  //       table reflects the current state of the world after every run.
  const totalExcluded = excluded.length + outOfBounds.length;
  console.log(`\n[5/5] Syncing to database...`);

  // 5a. Monitoring refresh for existing places
  if (existingPlaces.length > 0) {
    const monitoringRows = existingPlaces.map(placeToMonitoringUpdate);
    for (let i = 0; i < monitoringRows.length; i += BATCH_SIZE) {
      const batch = monitoringRows.slice(i, i + BATCH_SIZE);
      const { error } = await supabase
        .from('raw_places')
        .upsert(batch, { onConflict: 'google_place_id' });
      if (error) throw new Error(`Supabase monitoring upsert failed: ${error.message}`);
    }
    console.log(`  ✅ Refreshed monitoring fields for ${existingPlaces.length} existing place(s)`);
  }

  // 5b. Full insert for new places
  if (newPlacesWithDetails.length > 0) {
    const newRows = newPlacesWithDetails.map((p) => placeToRow(p, areaKey));
    for (let i = 0; i < newRows.length; i += BATCH_SIZE) {
      const batch = newRows.slice(i, i + BATCH_SIZE);
      const { error } = await supabase
        .from('raw_places')
        .upsert(batch, { onConflict: 'google_place_id' });
      if (error) throw new Error(`Supabase new places upsert failed: ${error.message}`);
    }
    console.log(`  ✅ Inserted ${newPlacesWithDetails.length} new place(s)`);
  }

  // 5c. Delete stale rows for this area not in the current kept set
  if (clippedIds.length > 0) {
    const keptSet = new Set(clippedIds);
    const { data: allAreaRows, error: fetchErr } = await supabase
      .from('raw_places')
      .select('google_place_id')
      .eq('search_area', areaKey);
    if (fetchErr) throw new Error(`Failed to fetch area rows for stale check: ${fetchErr.message}`);

    const staleIds = (allAreaRows ?? [])
      .map((r) => r.google_place_id)
      .filter((id) => !keptSet.has(id));

    if (staleIds.length > 0) {
      for (let i = 0; i < staleIds.length; i += BATCH_SIZE) {
        const batch = staleIds.slice(i, i + BATCH_SIZE);
        const { error } = await supabase
          .from('raw_places')
          .delete()
          .in('google_place_id', batch);
        if (error) throw new Error(`Supabase stale delete failed: ${error.message}`);
      }
      console.log(`  🗑  Removed ${staleIds.length} stale row(s) no longer in current results`);
    }
  }

  console.log(`\n  ✅ Done — ${clipped.length} active (${existingPlaces.length} refreshed, ${newPlacesWithDetails.length} new), ${totalExcluded} filtered out\n`);
  return { areaKey, active: clipped.length, newCount: newPlacesWithDetails.length, excluded: totalExcluded };
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
    let totalActive = 0, totalNew = 0, totalExcluded = 0;
    for (const { areaKey, active, newCount, excluded } of results) {
      console.log(`  ${SEARCH_AREAS[areaKey].name}: ${active} active (${newCount} new), ${excluded} filtered out`);
      totalActive += active;
      totalNew += newCount;
      totalExcluded += excluded;
    }
    console.log(`  ─────────────────────`);
    console.log(`  Total: ${totalActive} active (${totalNew} new), ${totalExcluded} filtered out\n`);
  }
}

run().catch((err) => {
  console.error(`\n❌ Fatal error: ${err.message}`);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
