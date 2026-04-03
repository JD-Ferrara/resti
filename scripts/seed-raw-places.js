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
import { fetchFilterRules } from './filter-rules.js';

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

// ── Shape an exclusion update for an existing place that now fails filters ──
// Used when a place is already in raw_places but Google's current data causes
// it to fail quality filters (e.g., temporarily closed, rating dropped).
// Preserves editorial_summary and hours — does NOT overwrite them.
// Sets status → 'excluded' so the record is retained for audit but filtered
// out of downstream pipelines.

function placeToExclusionUpdate(place, reason) {
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
    status:                'excluded',
    exclusion_reason:      reason,
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

// ── Re-check existing places against Google (Basic tier) ──────
// For every non-excluded place already in raw_places for this area, fetches
// fresh data from Google by place ID using a Basic-tier field mask. Applies
// the filter rules (loaded from place_exclusion_rules) to the current Google
// data. No hardcoded logic — rules come entirely from the DB.
//   • Still passes  → monitoring fields refreshed, status stays pending
//   • Now fails     → tagged status='excluded' with reason, row kept for audit
// Returns { refreshedIds, excludedIds } — both Sets of google_place_id.

const PLACE_MONITORING_FIELD_MASK = 'id,displayName,businessStatus,rating,userRatingCount,types';

async function recheckExistingWithGoogle(supabase, areaKey, rules, apiKey) {
  const { allowlist, excludedChains, excludedStatuses, minRating, minReviews } = rules;

  const { data: existingRows, error } = await supabase
    .from('raw_places')
    .select('google_place_id, name')
    .eq('search_area', areaKey)
    .neq('status', 'excluded');

  if (error) throw new Error(`Failed to load existing places for recheck: ${error.message}`);
  if (!existingRows?.length) {
    console.log('  No existing places to re-check');
    return { refreshedIds: new Set(), excludedIds: new Set() };
  }

  console.log(`  Re-checking ${existingRows.length} existing place(s) against Google...`);

  const toRefresh = [];
  const toExclude = [];

  for (let i = 0; i < existingRows.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 50)); // ~20 req/s

    const row = existingRows[i];
    const res = await fetch(`${PLACE_DETAILS_BASE_URL}/${row.google_place_id}`, {
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': PLACE_MONITORING_FIELD_MASK,
      },
    });

    if (!res.ok) {
      if (res.status !== 404) {
        console.warn(`  ⚠️  Recheck error for ${row.google_place_id} (${res.status}) — skipping`);
      }
      continue;
    }

    const fresh  = await res.json();
    const name   = fresh.displayName?.text ?? row.name ?? '';
    const status = fresh.businessStatus ?? null;

    // Apply rules in the same order as filterPlaces() — all values come from the DB
    let exclusionReason = null;
    if (!allowlist.has(name)) {
      if (excludedChains.has(name)) {
        exclusionReason = 'chain_excluded';
      } else if (status && excludedStatuses.has(status)) {
        exclusionReason = status.toLowerCase();
      } else if (minRating > 0 && (fresh.rating ?? 0) < minRating) {
        exclusionReason = 'low_rating';
      } else if (minReviews > 0 && (fresh.userRatingCount ?? 0) < minReviews) {
        exclusionReason = 'too_few_reviews';
      }
    }

    const base = {
      google_place_id:       row.google_place_id,
      name,
      business_status:       status,
      is_permanently_closed: status === 'CLOSED_PERMANENTLY',
      google_rating:         fresh.rating ?? null,
      google_review_count:   fresh.userRatingCount ?? null,
      google_types:          fresh.types ?? null,
      last_pipeline_run:     new Date().toISOString(),
    };

    if (exclusionReason) {
      toExclude.push({ ...base, status: 'excluded', exclusion_reason: exclusionReason });
    } else {
      toRefresh.push({ ...base, status: 'pending', exclusion_reason: null });
    }

    if ((i + 1) % 25 === 0 || i + 1 === existingRows.length) {
      console.log(`  [${i + 1}/${existingRows.length}] checked`);
    }
  }

  for (let i = 0; i < toRefresh.length; i += BATCH_SIZE) {
    const { error: upsertErr } = await supabase
      .from('raw_places')
      .upsert(toRefresh.slice(i, i + BATCH_SIZE), { onConflict: 'google_place_id' });
    if (upsertErr) throw new Error(`Recheck monitoring upsert failed: ${upsertErr.message}`);
  }

  if (toExclude.length > 0) {
    for (const { exclusion_reason: reason, name } of toExclude) {
      console.log(`     · ${reason}: ${name}`);
    }
    for (let i = 0; i < toExclude.length; i += BATCH_SIZE) {
      const { error: upsertErr } = await supabase
        .from('raw_places')
        .upsert(toExclude.slice(i, i + BATCH_SIZE), { onConflict: 'google_place_id' });
      if (upsertErr) throw new Error(`Recheck exclusion upsert failed: ${upsertErr.message}`);
    }
  }

  console.log(`  ✅ ${toRefresh.length} still valid  |  🚫 ${toExclude.length} newly excluded`);
  return {
    refreshedIds: new Set(toRefresh.map((r) => r.google_place_id)),
    excludedIds:  new Set(toExclude.map((r) => r.google_place_id)),
  };
}

// ── Run pipeline for a single area ────────────────────────

async function runArea(areaKey, supabase, rules, { skipEditorial = false } = {}) {
  const areaConfig = SEARCH_AREAS[areaKey];

  console.log(`\n${'═'.repeat(56)}`);
  console.log(`  ${areaConfig.name}`);
  console.log(`${'═'.repeat(56)}`);

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) throw new Error('Missing GOOGLE_PLACES_API_KEY in .env.');

  // 1. Re-check every existing non-excluded place via Google (Basic tier).
  //    Fetches fresh businessStatus, rating, userRatingCount, and types by place ID.
  //    Applies filter rules from place_exclusion_rules — no hardcoded logic here.
  //    Passes → monitoring fields updated, status stays pending.
  //    Fails  → tagged status='excluded' with reason, row kept for audit trail.
  console.log('\n[1/5] Re-checking existing places against Google (Basic tier)...');
  const recheck = await recheckExistingWithGoogle(supabase, areaKey, rules, apiKey);

  // 2. Fetch new candidates via Nearby Search (Basic/Advanced tier)
  console.log('\n[2/5] Fetching from Google Places (Nearby Search)...');
  const raw = await fetchAllPlaces(areaKey);

  // 3. Filter (chains, closed status, rating, review count — driven by place_exclusion_rules)
  console.log(`\n[3/5] Filtering ${raw.length} results...`);
  const { kept, excluded } = filterPlaces(raw, rules);
  console.log(`  ✅ Kept: ${kept.length}  |  🚫 Excluded: ${excluded.length}`);

  // 4. Neighborhood detection + polygon clip
  console.log(`\n[4/5] Detecting neighborhoods...`);
  const enriched = await enrichWithNeighborhood(kept);
  const { clipped, outOfBounds } = clipToPolygon(enriched, areaConfig);
  if (outOfBounds.length > 0) {
    console.log(`  ✂️  Clipped ${outOfBounds.length} place(s) outside ${areaConfig.name} geofence`);
    for (const { detail } of outOfBounds) console.log(`     · ${detail}`);
  }
  console.log(`  🗺  Custom district matched: ${clipped.filter((p) => p.custom_district).length}/${clipped.length}`);

  // 5. Sync to database
  console.log(`\n[5/5] Syncing to database...`);
  const totalExcluded = excluded.length + outOfBounds.length;

  const clippedIds  = clipped.map((p) => p.id);
  const excludedIds = excluded.map((e) => e.place.id);
  const existingIds = await fetchExistingIds(supabase, [...clippedIds, ...excludedIds]);

  // New places = not in DB at all. Existing places returned by search that step 1
  // already recheckked are skipped (avoid redundant write with older search data).
  const newPlaces = clipped.filter((p) => !existingIds.has(p.id));
  // Previously excluded places now passing filters (came back as operational)
  const recoveredPlaces = clipped.filter(
    (p) => existingIds.has(p.id) && !recheck.refreshedIds.has(p.id)
  );
  // Existing places from search that fail filters but weren't caught by step 1
  const searchExcluded = excluded.filter(
    (e) => existingIds.has(e.place.id) && !recheck.excludedIds.has(e.place.id)
  );

  console.log(
    `  ${recheck.refreshedIds.size} rechecked  |  ` +
    `${recoveredPlaces.length} recovered  |  ` +
    `${newPlaces.length} new`
  );

  // 5a. Monitoring refresh for recovered places (previously excluded, now operational)
  if (recoveredPlaces.length > 0) {
    for (let i = 0; i < recoveredPlaces.length; i += BATCH_SIZE) {
      const batch = recoveredPlaces.slice(i, i + BATCH_SIZE).map(placeToMonitoringUpdate);
      const { error } = await supabase.from('raw_places').upsert(batch, { onConflict: 'google_place_id' });
      if (error) throw new Error(`Supabase recovery upsert failed: ${error.message}`);
    }
    console.log(`  ♻️  Restored ${recoveredPlaces.length} previously-excluded place(s) to pending`);
  }

  // 5b. Full insert for new places (Place Details for editorial + hours, Enterprise tier)
  let newPlacesWithDetails = newPlaces;
  if (newPlaces.length > 0) {
    if (!skipEditorial) {
      const enrichmentMap = await enrichPlaceDetails(newPlaces, apiKey);
      newPlacesWithDetails = newPlaces.map((place) => {
        const det = enrichmentMap.get(place.id);
        return {
          ...place,
          editorialSummary:    det?.editorial ? { text: det.editorial } : undefined,
          regularOpeningHours: det?.hours ?? undefined,
        };
      });
    } else {
      console.log('  Place Details SKIPPED (--skip-editorial)');
    }
    for (let i = 0; i < newPlacesWithDetails.length; i += BATCH_SIZE) {
      const batch = newPlacesWithDetails.slice(i, i + BATCH_SIZE).map((p) => placeToRow(p, areaKey));
      const { error } = await supabase.from('raw_places').upsert(batch, { onConflict: 'google_place_id' });
      if (error) throw new Error(`Supabase new places upsert failed: ${error.message}`);
    }
    console.log(`  ✅ Inserted ${newPlacesWithDetails.length} new place(s)`);
  }

  // 5c. Tag existing places from search that fail filters (not already caught by step 1)
  if (searchExcluded.length > 0) {
    for (let i = 0; i < searchExcluded.length; i += BATCH_SIZE) {
      const batch = searchExcluded.slice(i, i + BATCH_SIZE).map(({ place, reason }) => placeToExclusionUpdate(place, reason));
      const { error } = await supabase.from('raw_places').upsert(batch, { onConflict: 'google_place_id' });
      if (error) throw new Error(`Supabase search-exclusion upsert failed: ${error.message}`);
    }
    for (const { reason, detail } of searchExcluded) console.log(`     · ${reason}: ${detail}`);
    console.log(`  🚫 Tagged ${searchExcluded.length} additional place(s) as excluded (search)`);
  }

  // 5d. Delete rows no longer surfaced by Google at all.
  //     status='excluded' rows are never deleted — preserved as audit trail.
  const activeIds = new Set([
    ...recheck.refreshedIds,
    ...recheck.excludedIds,
    ...clippedIds,
    ...searchExcluded.map((e) => e.place.id),
  ]);
  if (activeIds.size > 0) {
    const { data: allAreaRows, error: fetchErr } = await supabase
      .from('raw_places')
      .select('google_place_id')
      .eq('search_area', areaKey)
      .neq('status', 'excluded');
    if (fetchErr) throw new Error(`Failed to fetch area rows for stale check: ${fetchErr.message}`);

    const staleIds = (allAreaRows ?? [])
      .map((r) => r.google_place_id)
      .filter((id) => !activeIds.has(id));

    if (staleIds.length > 0) {
      for (let i = 0; i < staleIds.length; i += BATCH_SIZE) {
        const batch = staleIds.slice(i, i + BATCH_SIZE);
        const { error } = await supabase.from('raw_places').delete().in('google_place_id', batch);
        if (error) throw new Error(`Supabase stale delete failed: ${error.message}`);
      }
      console.log(`  🗑  Removed ${staleIds.length} stale row(s) no longer found in Google`);
    }
  }

  const totalNewlyExcluded = recheck.excludedIds.size + searchExcluded.length;
  console.log(
    `\n  ✅ Done — ${recheck.refreshedIds.size} rechecked OK, ` +
    `${newPlacesWithDetails.length} new, ${recoveredPlaces.length} recovered, ` +
    `${totalNewlyExcluded} excluded this run\n`
  );
  return { areaKey, active: recheck.refreshedIds.size + newPlacesWithDetails.length, newCount: newPlacesWithDetails.length, excluded: totalExcluded };
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

  console.log('\n   Loading filter rules from DB...');
  const rules = await fetchFilterRules(supabase);
  console.log(`   ✅ ${rules.excludedChains.size} chain rules, ${rules.excludedStatuses.size} status rules, allowlist: ${rules.allowlist.size} entries`);

  const results = [];
  for (const key of areaKeys) {
    const result = await runArea(key, supabase, rules, { skipEditorial });
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
