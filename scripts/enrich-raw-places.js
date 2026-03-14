// ============================================================
// enrich-raw-places.js — Step 2: Enrich pending rows via Place Details (New)
// ============================================================
// Reads all raw_places rows with status = 'pending' for the given area(s),
// calls the Place Details (New) API for each, and updates the row with the
// full atmosphere + contact data.
//
// This is Step 2 of a two-step pipeline:
//   Step 1 (seed-raw-places.js): fetch minimal fields, apply local filters.
//   Step 2 (this script):        enrich surviving rows with full Place Details.
//
// By calling Place Details only for the ~30-40% of places that pass Step 1
// filters, we avoid paying for enrichment data on places that would be excluded.
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

function buildEnrichmentUpdate(details) {
  const { level, range } = normalizePriceLevel(details);

  return {
    price_level:         level,
    price_range:         range,
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
    editorial_summary:   details.editorialSummary?.text ?? null,
    raw_data:            details,
    fetched_at:          new Date().toISOString(),
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Enrich all pending rows for one area ─────────────────

async function enrichArea(areaKey, supabase, apiKey) {
  const areaConfig = SEARCH_AREAS[areaKey];

  console.log(`\n${'═'.repeat(56)}`);
  console.log(`  ${areaConfig.name}`);
  console.log(`${'═'.repeat(56)}`);

  // 1. Fetch pending rows for this area
  console.log('\n[1/2] Fetching pending rows from Supabase...');
  const { data: rows, error: fetchError } = await supabase
    .from('raw_places')
    .select('google_place_id, name')
    .eq('search_area', areaKey)
    .eq('status', 'pending');

  if (fetchError) throw new Error(`Supabase fetch failed: ${fetchError.message}`);

  if (!rows || rows.length === 0) {
    console.log(`  ⚠️  No pending rows found for ${areaConfig.name}. Run seed-raw-places.js first.`);
    return { areaKey, enriched: 0, failed: 0 };
  }

  console.log(`  Found ${rows.length} pending row(s).`);

  // 2. Fetch Place Details for each and update
  console.log(`\n[2/2] Enriching via Place Details (New) API...`);
  let enriched = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const { google_place_id, name } = rows[i];
    const label = `[${i + 1}/${rows.length}] ${name}`;

    try {
      // Polite rate limiting — Place Details doesn't paginate but avoid burst throttling
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
