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
// current businessStatus, rating, and userRatingCount directly from Google by
// place ID (Basic tier — same cost tier as Nearby Search field data, ~$0.005/call).
// Applies filter rules to that fresh data:
//   • Still passes → monitoring refresh (rating, status, types updated, status=pending)
//   • Now fails    → tagged status='excluded' with reason, row preserved for audit
// This is the authoritative "did anything change?" pass. It catches closures and
// quality drops even for places Google no longer surfaces in Nearby Search results.
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
  if (!existingRows || existingRows.length === 0) {
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
      // 404 = place removed from Google; other errors = transient — skip, leave unchanged
      if (res.status !== 404) {
        console.warn(`  ⚠️  Recheck error for ${row.google_place_id} (${res.status}) — skipping`);
      }
      continue;
    }

    const fresh  = await res.json();
    const name   = fresh.displayName?.text ?? row.name ?? '';
    const status = fresh.businessStatus ?? null;

    // Apply filter rules in the same order as filterPlaces()
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

  // Upsert monitoring refreshes (places that still pass)
  for (let i = 0; i < toRefresh.length; i += BATCH_SIZE) {
    const batch = toRefresh.slice(i, i + BATCH_SIZE);
    const { error: upsertErr } = await supabase
      .from('raw_places')
      .upsert(batch, { onConflict: 'google_place_id' });
    if (upsertErr) throw new Error(`Recheck monitoring upsert failed: ${upsertErr.message}`);
  }

  // Upsert exclusions (places that now fail)
  if (toExclude.length > 0) {
    for (const { exclusion_reason: reason, name } of toExclude) {
      console.log(`     · ${reason}: ${name}`);
    }
    for (let i = 0; i < toExclude.length; i += BATCH_SIZE) {
      const batch = toExclude.slice(i, i + BATCH_SIZE);
      const { error: upsertErr } = await supabase
        .from('raw_places')
        .upsert(batch, { onConflict: 'google_place_id' });
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

  // API key — needed for step 1 (recheck) and step 5 (editorial enrichment).
  const apiKey = process.env.GOOGLE_PLACES_API_KEY ?? null;
  if (!apiKey) throw new Error('Missing GOOGLE_PLACES_API_KEY in .env.');

  // 1. Re-check existing places via Google (Basic tier, ~$0.005/call).
  //    For every non-excluded place already in raw_places for this area, fetches
  //    current businessStatus, rating, and userRatingCount directly from Google by
  //    place ID. Applies filter rules to that fresh data:
  //      • Still passes → monitoring fields refreshed, status stays pending
  //      • Now fails    → tagged status='excluded' with reason, row preserved for audit
  //    This catches closures and quality drops even for places Google no longer surfaces
  //    in Nearby Search results (CLOSED_TEMPORARILY places may not appear in search).
  console.log('\n[1/6] Re-checking existing places against Google (Basic tier)...');
  const recheckResult = await recheckExistingWithGoogle(supabase, areaKey, rules, apiKey);

  // 2. Fetch new candidates (Basic/Advanced tier — no Enterprise fields)
  console.log('\n[2/6] Fetching from Google Places (Nearby Search)...');
  const raw = await fetchAllPlaces(areaKey);

  // 3. Filter (chains, closed status, rating, review count)
  console.log(`\n[3/6] Filtering ${raw.length} results...`);
  const { kept, excluded } = filterPlaces(raw, rules);
  console.log(`  ✅ Kept: ${kept.length}  |  🚫 Excluded: ${excluded.length}`);

  // 4. Neighborhood detection + polygon clip
  console.log(`\n[4/6] Detecting neighborhoods...`);
  const enriched = await enrichWithNeighborhood(kept);

  const { clipped, outOfBounds } = clipToPolygon(enriched, areaConfig);
  if (outOfBounds.length > 0) {
    console.log(`  ✂️  Clipped ${outOfBounds.length} place(s) outside ${areaConfig.name} geofence`);
    for (const { detail } of outOfBounds) console.log(`     · ${detail}`);
  }
  const customDistrictMatched = clipped.filter((p) => p.custom_district).length;
  console.log(`  🗺  Custom district matched: ${customDistrictMatched}/${clipped.length}`);

  // 5. Place Details enrichment (Enterprise tier) — editorialSummary + regularOpeningHours.
  //    Only called for places NOT already in raw_places (new places only). Existing rows
  //    were already handled in step 1; their editorial_summary and hours are preserved.
  console.log(`\n[5/6] Place Details enrichment (new places only)...`);
  const clippedIds  = clipped.map((p) => p.id);
  const excludedIds = excluded.map((e) => e.place.id);
  const existingIds = await fetchExistingIds(supabase, [...clippedIds, ...excludedIds]);

  // New places = not yet in DB at all (step 1 recheck covered all existing non-excluded rows)
  const newPlaces = clipped.filter((p) => !existingIds.has(p.id));
  // Previously excluded places now passing filters (came back as operational)
  const recoveredPlaces = clipped.filter(
    (p) => existingIds.has(p.id) && !recheckResult.refreshedIds.has(p.id)
  );
  // Existing places from search that were already refreshed by recheck — skip to avoid redundant write
  const alreadyRechecked = clipped.filter((p) => recheckResult.refreshedIds.has(p.id));

  console.log(
    `  ${alreadyRechecked.length} already rechecked  |  ` +
    `${recoveredPlaces.length} recovered (were excluded)  |  ` +
    `${newPlaces.length} new (Place Details required)`
  );

  let newPlacesWithDetails = newPlaces;
  if (!skipEditorial && newPlaces.length > 0) {
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

  // 6. Sync to database
  //    a) Monitoring refresh for recovered places (were excluded, now operational again).
  //       Existing places already handled by step 1 are intentionally skipped here.
  //    b) Full insert for genuinely new places.
  //    c) Tag places from Nearby Search that fail filters but exist in DB (belt+suspenders
  //       for anything step 1 may have missed, e.g. a search-only status signal).
  //    d) Delete stale rows — rows in raw_places not touched by step 1 OR step 2/3/4 AND
  //       not already tagged excluded. Never deletes status='excluded' rows.
  const totalExcluded = excluded.length + outOfBounds.length;
  console.log(`\n[6/6] Syncing to database...`);

  // 6a. Monitoring refresh for recovered places (previously excluded, now pass filters)
  if (recoveredPlaces.length > 0) {
    const recoveryRows = recoveredPlaces.map(placeToMonitoringUpdate);
    for (let i = 0; i < recoveryRows.length; i += BATCH_SIZE) {
      const batch = recoveryRows.slice(i, i + BATCH_SIZE);
      const { error } = await supabase
        .from('raw_places')
        .upsert(batch, { onConflict: 'google_place_id' });
      if (error) throw new Error(`Supabase recovery upsert failed: ${error.message}`);
    }
    console.log(`  ♻️  Restored ${recoveredPlaces.length} previously-excluded place(s) to pending`);
  }

  // 6b. Full insert for genuinely new places
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

  // 6c. Tag existing places from Nearby Search that now fail filters (belt+suspenders)
  const existingExcluded = excluded.filter(
    (e) => existingIds.has(e.place.id) && !recheckResult.excludedIds.has(e.place.id)
  );
  if (existingExcluded.length > 0) {
    const exclusionRows = existingExcluded.map(({ place, reason }) =>
      placeToExclusionUpdate(place, reason)
    );
    for (let i = 0; i < exclusionRows.length; i += BATCH_SIZE) {
      const batch = exclusionRows.slice(i, i + BATCH_SIZE);
      const { error } = await supabase
        .from('raw_places')
        .upsert(batch, { onConflict: 'google_place_id' });
      if (error) throw new Error(`Supabase search-exclusion tag upsert failed: ${error.message}`);
    }
    console.log(`  🚫 Tagged ${existingExcluded.length} additional place(s) as excluded (from search)`);
  }

  // 6d. Delete stale rows — rows for this area that were NOT touched by:
  //     step 1 (recheck), step 2 search (clipped or nearby-excluded), or already excluded.
  //     status='excluded' rows are explicitly protected from deletion so the audit trail
  //     is preserved across runs. Only rows with no Google signal at all get removed.
  const activeIds = new Set([
    ...recheckResult.refreshedIds,
    ...recheckResult.excludedIds,
    ...clippedIds,
    ...existingExcluded.map((e) => e.place.id),
  ]);
  if (activeIds.size > 0) {
    const { data: allAreaRows, error: fetchErr } = await supabase
      .from('raw_places')
      .select('google_place_id')
      .eq('search_area', areaKey)
      .neq('status', 'excluded');  // never delete rows already tagged excluded
    if (fetchErr) throw new Error(`Failed to fetch area rows for stale check: ${fetchErr.message}`);

    const staleIds = (allAreaRows ?? [])
      .map((r) => r.google_place_id)
      .filter((id) => !activeIds.has(id));

    if (staleIds.length > 0) {
      for (let i = 0; i < staleIds.length; i += BATCH_SIZE) {
        const batch = staleIds.slice(i, i + BATCH_SIZE);
        const { error } = await supabase
          .from('raw_places')
          .delete()
          .in('google_place_id', batch);
        if (error) throw new Error(`Supabase stale delete failed: ${error.message}`);
      }
      console.log(`  🗑  Removed ${staleIds.length} stale row(s) no longer found in Google`);
    }
  }

  const recheckExcludedCount = recheckResult.excludedIds.size;
  console.log(
    `\n  ✅ Done — ${recheckResult.refreshedIds.size} rechecked OK, ` +
    `${newPlacesWithDetails.length} new, ${recoveredPlaces.length} recovered, ` +
    `${recheckExcludedCount + existingExcluded.length} excluded this run\n`
  );
  return { areaKey, active: recheckResult.refreshedIds.size + newPlacesWithDetails.length, newCount: newPlacesWithDetails.length, excluded: totalExcluded };
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
