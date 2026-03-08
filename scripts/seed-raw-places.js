// ============================================================
// seed-raw-places.js — Upsert filtered places into Supabase raw_places
// ============================================================
// Runs the full pipeline (fetch → filter → neighborhood) for a given area,
// then upserts results into the raw_places staging table.
//
// Requires SUPABASE_SERVICE_ROLE_KEY (not the anon key) for server-side writes.
// Uses upsert on google_place_id, so re-running is safe.
//
// Usage:
//   node scripts/seed-raw-places.js --area hudson_yards
//   node scripts/seed-raw-places.js --area chelsea

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

// ── Shape a Place into a raw_places row ───────────────────

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
    status:                'pending',
    raw_data:              place,
  };
}

// ── Main ──────────────────────────────────────────────────

async function run() {
  const args = process.argv.slice(2);
  const areaIdx = args.indexOf('--area');
  const areaKey = areaIdx !== -1 ? args[areaIdx + 1] : null;

  if (!areaKey) {
    const valid = Object.keys(SEARCH_AREAS).join(', ');
    console.error(`Usage: node scripts/seed-raw-places.js --area <area>`);
    console.error(`Available areas: ${valid}`);
    process.exit(1);
  }

  if (!SEARCH_AREAS[areaKey]) {
    console.error(`Unknown area "${areaKey}". Valid: ${Object.keys(SEARCH_AREAS).join(', ')}`);
    process.exit(1);
  }

  const supabase = getSupabase();

  console.log(`\n🚀 Seeding raw_places for area: ${SEARCH_AREAS[areaKey].name}`);

  // 1. Fetch
  console.log('\n[1/4] Fetching from Google Places...');
  const raw = await fetchAllPlaces(areaKey);

  // 2. Filter
  console.log(`\n[2/4] Filtering ${raw.length} results...`);
  const { kept, excluded } = filterPlaces(raw);
  console.log(`  ✅ Kept: ${kept.length}  |  🚫 Excluded: ${excluded.length}`);

  // 3. Neighborhood detection
  console.log(`\n[3/4] Detecting neighborhoods...`);
  const enriched = await enrichWithNeighborhood(kept);

  // 4. Upsert to Supabase
  console.log(`\n[4/4] Upserting ${enriched.length} rows into raw_places...`);

  const rows = enriched.map((place) => placeToRow(place, areaKey));

  // Batch upserts in chunks of 50
  const BATCH_SIZE = 50;
  let upserted = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from('raw_places')
      .upsert(batch, { onConflict: 'google_place_id' });

    if (error) {
      throw new Error(`Supabase upsert failed: ${error.message}`);
    }
    upserted += batch.length;
    console.log(`  Upserted ${upserted}/${rows.length}...`);
  }

  console.log(`\n✅ Done. ${upserted} rows upserted to raw_places.`);
  console.log(`   Area: ${SEARCH_AREAS[areaKey].name}`);
  console.log(`   Status: pending (ready for review + Claude enrichment)\n`);
}

run().catch((err) => {
  console.error(`\n❌ Fatal error: ${err.message}`);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
