// ============================================================
// enrich-raw-places.js — Step 3: Enrich Claude-approved places via Place Details (New)
// ============================================================
// Reads google_place_ids from filtered_places (the Claude-approved set),
// calls the Place Details (New) API for each, and updates the corresponding
// raw_places rows with atmosphere + contact data.
//
// Why run AFTER Claude classification (not before):
//   Claude's classifier uses only: name, address, google_types, editorial_summary,
//   price_level, rating, and review_count. All of these are already present in
//   raw_places from Step 1. The atmosphere fields (outdoor seating, serves_beer,
//   hours, phone, etc.) are NOT used by Claude's decision — enriching them before
//   classification would waste Place Details calls on places Claude will exclude.
//
// Pipeline order:
//   Step 1 — seed-raw-places.js:       discover + local filter → raw_places (pending)
//   Step 2 — build-filtered-places.js: Claude classify → filtered_places
//   Step 3 — this script:              enrich raw_places for approved IDs only
//
// After enrichment, raw_places rows for approved places will have all atmosphere
// data populated, ready for import into restaurants.
//
// Usage:
//   node scripts/enrich-raw-places.js --area hudson_yards
//   node scripts/enrich-raw-places.js --area hudson_yards,chelsea
//   node scripts/enrich-raw-places.js --area all

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { SEARCH_AREAS, PLACES_ENRICH_FIELD_MASK } from './places-config.js';
import { normalizePriceLevel } from './filter-places.js';

const PLACE_DETAILS_URL = 'https://places.googleapis.com/v1/places';

// ── Supabase client ───────────────────────────────────────

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

function resolveAreaKeys(areaArg) {
  if (!areaArg) {
    const valid = Object.keys(SEARCH_AREAS).join(', ');
    console.error(`Usage: node scripts/enrich-raw-places.js --area <area>`);
    console.error(`  Single:    --area hudson_yards`);
    console.error(`  Multiple:  --area hudson_yards,chelsea`);
    console.error(`  All:       --area all`);
    console.error(`  Available: ${valid}`);
    process.exit(1);
  }

  if (areaArg === 'all') return Object.keys(SEARCH_AREAS);

  const keys = areaArg.split(',').map((k) => k.trim());
  for (const key of keys) {
    if (!SEARCH_AREAS[key]) {
      console.error(`Unknown area "${key}". Valid: ${Object.keys(SEARCH_AREAS).join(', ')}`);
      process.exit(1);
    }
  }
  return keys;
}

// ── Call Place Details (New) for a single place ───────────

async function fetchPlaceDetails(apiKey, googlePlaceId) {
  const url = `${PLACE_DETAILS_URL}/${googlePlaceId}`;
  const res = await fetch(url, {
    headers: {
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': PLACES_ENRICH_FIELD_MASK,
    },
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Place Details API error ${res.status} for ${googlePlaceId}: ${errorText}`);
  }

  return res.json();
}

// ── Map Place Details response to raw_places update ───────
// Note: editorialSummary and priceLevel are intentionally excluded —
// they were already fetched in Step 1 and should not be overwritten.

function buildEnrichmentUpdate(details) {
  const { level, range } = normalizePriceLevel(details);

  return {
    // Only overwrite price if Step 1 left it null (belt-and-suspenders)
    ...(level !== null ? { price_level: level, price_range: range } : {}),
    phone:               details.nationalPhoneNumber ?? null,
    website:             details.websiteUri ?? null,
    hours:               details.regularOpeningHours ?? null,
    has_outdoor_seating: details.outdoorSeating ?? null,
    takes_reservations:  details.reservable ?? null,
    serves_beer:         details.servesBeer ?? null,
    serves_wine:         details.servesWine ?? null,
    serves_breakfast:    details.servesBreakfast ?? null,
    serves_lunch:        details.servesLunch ?? null,
    serves_dinner:       details.servesDinner ?? null,
    has_takeout:         details.takeout ?? null,
    has_delivery:        details.delivery ?? null,
    raw_data:            details,
    fetched_at:          new Date().toISOString(),
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Enrich Claude-approved candidates for one area ────────

async function enrichArea(areaKey, supabase, apiKey) {
  const areaConfig = SEARCH_AREAS[areaKey];

  console.log(`\n${'═'.repeat(56)}`);
  console.log(`  ${areaConfig.name}`);
  console.log(`${'═'.repeat(56)}`);

  // 1. Get Claude-approved IDs for this area from filtered_places.
  //    filtered_places uses google_places_id (note the 's') as its column name.
  console.log('\n[1/2] Fetching Claude-approved candidates from filtered_places...');
  const { data: approved, error: approvedErr } = await supabase
    .from('filtered_places')
    .select('google_places_id, name')
    .eq('source_status', 'ai_candidate');

  if (approvedErr) throw new Error(`filtered_places fetch failed: ${approvedErr.message}`);

  if (!approved || approved.length === 0) {
    console.log(`  ⚠️  No ai_candidate rows in filtered_places. Run build-filtered-places.js first.`);
    return { areaKey, enriched: 0, failed: 0 };
  }

  // Cross-reference with raw_places to limit to this area
  const approvedIds = approved.map((r) => r.google_places_id);
  const { data: areaRows, error: areaErr } = await supabase
    .from('raw_places')
    .select('google_place_id, name')
    .in('google_place_id', approvedIds)
    .eq('search_area', areaKey);

  if (areaErr) throw new Error(`raw_places lookup failed: ${areaErr.message}`);

  if (!areaRows || areaRows.length === 0) {
    console.log(`  ⚠️  No approved candidates found in raw_places for ${areaConfig.name}.`);
    return { areaKey, enriched: 0, failed: 0 };
  }

  console.log(`  Found ${areaRows.length} Claude-approved candidate(s) to enrich.`);

  // 2. Fetch Place Details for each and update raw_places
  console.log(`\n[2/2] Enriching via Place Details (New) API...`);
  let enriched = 0;
  let failed = 0;

  for (let i = 0; i < areaRows.length; i++) {
    const { google_place_id, name } = areaRows[i];
    const label = `[${i + 1}/${areaRows.length}] ${name}`;

    try {
      // Polite rate limiting — avoid burst throttling on Place Details endpoint
      if (i > 0) await sleep(200);

      const details = await fetchPlaceDetails(apiKey, google_place_id);
      const update = buildEnrichmentUpdate(details);

      const { error: updateError } = await supabase
        .from('raw_places')
        .update(update)
        .eq('google_place_id', google_place_id);

      if (updateError) throw new Error(updateError.message);

      console.log(`  ✅ ${label}`);
      enriched++;
    } catch (err) {
      console.error(`  ❌ ${label} — ${err.message}`);
      failed++;
    }
  }

  console.log(`\n  ✅ Done — ${enriched} enriched, ${failed} failed\n`);
  return { areaKey, enriched, failed };
}

// ── Main ──────────────────────────────────────────────────

async function run() {
  const args = process.argv.slice(2);
  const areaIdx = args.indexOf('--area');
  const areaArg = areaIdx !== -1 ? args[areaIdx + 1] : null;
  const areaKeys = resolveAreaKeys(areaArg);

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_PLACES_API_KEY is not set in .env');

  const supabase = getSupabase();

  console.log(`\n🔬 Enrichment pipeline — ${areaKeys.length} area(s): ${areaKeys.join(', ')}`);
  console.log(`   Targeting Claude-approved candidates in filtered_places only.\n`);

  const results = [];
  for (const key of areaKeys) {
    const result = await enrichArea(key, supabase, apiKey);
    results.push(result);
  }

  if (areaKeys.length > 1) {
    console.log(`\n${'═'.repeat(56)}`);
    console.log('  Summary');
    console.log(`${'═'.repeat(56)}`);
    let totalEnriched = 0, totalFailed = 0;
    for (const { areaKey, enriched, failed } of results) {
      console.log(`  ${SEARCH_AREAS[areaKey].name}: ${enriched} enriched, ${failed} failed`);
      totalEnriched += enriched;
      totalFailed += failed;
    }
    console.log(`  ─────────────────────`);
    console.log(`  Total: ${totalEnriched} enriched, ${totalFailed} failed\n`);
  }
}

run().catch((err) => {
  console.error(`\n❌ Fatal error: ${err.message}`);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
