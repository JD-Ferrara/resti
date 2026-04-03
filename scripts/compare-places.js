// ============================================================
// compare-places.js — Diff Google Places vs. existing DB
// ============================================================
// Fetches restaurants from Google Places for a configured area,
// applies filters, detects neighborhoods, then compares results against
// restaurants in the database for that search_area (by google_place_id).
//
// Output categories:
//   ✅ MATCHED     — in Google AND in our DB (by google_place_id)
//   🆕 NEW FINDS   — in Google, NOT in our DB (potential additions)
//   ❓ NOT IN GOOGLE — in our DB, not found in this Google fetch
//   🚫 EXCLUDED    — filtered out (with reason)
//
// Usage:
//   node scripts/compare-places.js --area hudson_yards
//   node scripts/compare-places.js --area hudson_yards --save   (also writes JSON report)

import 'dotenv/config';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

import { fetchAllPlaces } from './fetch-places.js';
import { filterPlaces, getDisplayName, normalizePriceLevel } from './filter-places.js';
import { enrichWithNeighborhood } from './detect-neighborhood.js';
import { fetchFilterRules } from './filter-rules.js';
import { SEARCH_AREAS } from './places-config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, 'output');

function parseArgs() {
  const args = process.argv.slice(2);
  const areaIdx = args.indexOf('--area');
  const areaKey = areaIdx !== -1 ? args[areaIdx + 1]?.trim() : null;
  const save = args.includes('--save');
  return { areaKey, save };
}

function resolveAreaKey(areaArg) {
  if (!areaArg) {
    const valid = Object.keys(SEARCH_AREAS).join(', ');
    console.error('Usage: node scripts/compare-places.js --area <area_key> [--save]');
    console.error(`  Available areas: ${valid}`);
    process.exit(1);
  }
  if (!SEARCH_AREAS[areaArg]) {
    console.error(`Unknown area "${areaArg}". Valid: ${Object.keys(SEARCH_AREAS).join(', ')}`);
    process.exit(1);
  }
  return areaArg;
}

// ── Formatting helpers ────────────────────────────────────

function priceStr(place) {
  const { range } = normalizePriceLevel(place);
  return range ?? '?';
}

function formatPlace(place) {
  const name = getDisplayName(place);
  const rating = place.rating ? `⭐ ${place.rating}` : 'no rating';
  const reviews = place.userRatingCount ? `(${place.userRatingCount.toLocaleString()} reviews)` : '';
  const price = priceStr(place);
  const addr = place.formattedAddress ?? '';
  const neighborhood = place.district ? `[${place.district}]` : '';
  return `  · ${name}  ${price}  ${rating} ${reviews}  ${neighborhood}\n    ${addr}`;
}

// ── Main ──────────────────────────────────────────────────

async function run() {
  const { areaKey: areaArg, save } = parseArgs();
  const areaKey = resolveAreaKey(areaArg);
  const areaLabel = SEARCH_AREAS[areaKey].name;

  console.log('\n══════════════════════════════════════════════════════');
  console.log(`  ${areaLabel} — Google Places vs. Existing DB Diff`);
  console.log('══════════════════════════════════════════════════════\n');

  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
  const rules = await fetchFilterRules(supabase);

  const { data: existingRestaurants, error: existingErr } = await supabase
    .from('restaurants')
    .select('id, name, google_place_id')
    .eq('search_area', areaKey);

  if (existingErr) throw new Error(`Failed to load restaurants: ${existingErr.message}`);

  const existingList = existingRestaurants ?? [];
  const existingById = new Map(
    existingList.filter((r) => r.google_place_id).map((r) => [r.google_place_id, r])
  );

  // 1. Fetch
  console.log('Step 1/3: Fetching from Google Places...');
  const raw = await fetchAllPlaces(areaKey);

  // 2. Filter
  console.log('\nStep 2/3: Applying filters...');
  const { kept, excluded } = filterPlaces(raw, rules);
  console.log(`  Kept: ${kept.length}  |  Excluded: ${excluded.length}`);

  // 3. Neighborhood detection
  console.log('\nStep 3/3: Detecting NYC neighborhoods...');
  const enriched = await enrichWithNeighborhood(kept);

  // 4. Compare (by google_place_id / place.id)
  const googleById = new Map(enriched.map((p) => [p.id, p]));

  const matched = [];
  const newFinds = [];
  const notInGoogle = [];

  for (const place of enriched) {
    if (existingById.has(place.id)) {
      matched.push({ existing: existingById.get(place.id), place });
    } else {
      newFinds.push(place);
    }
  }

  for (const existing of existingList) {
    const gid = existing.google_place_id;
    if (gid == null || !googleById.has(gid)) {
      notInGoogle.push(existing);
    }
  }

  // Sort new finds by rating desc
  newFinds.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));

  // ── Print report ──────────────────────────────────────────

  console.log('\n══════════════════════════════════════════════════════');
  console.log(`✅ MATCHED — in Google + already in our DB (${matched.length})`);
  console.log('══════════════════════════════════════════════════════');
  for (const { existing, place } of matched) {
    console.log(`  · [ID ${existing.id}] ${existing.name}  →  Google: "${getDisplayName(place)}"  ⭐${place.rating ?? '?'}`);
  }

  console.log('\n══════════════════════════════════════════════════════');
  console.log(`🆕 NEW FINDS — in Google, NOT in our DB (${newFinds.length})`);
  console.log('══════════════════════════════════════════════════════');
  if (newFinds.length === 0) {
    console.log('  (none — all Google results are already in the DB)');
  } else {
    for (const place of newFinds) {
      console.log(formatPlace(place));
    }
  }

  console.log('\n══════════════════════════════════════════════════════');
  console.log(`❓ NOT FOUND IN GOOGLE — in our DB, no Google match (${notInGoogle.length})`);
  console.log('══════════════════════════════════════════════════════');
  if (notInGoogle.length === 0) {
    console.log('  (all existing restaurants found in Google results)');
  } else {
    for (const r of notInGoogle) {
      console.log(`  · [ID ${r.id}] ${r.name}`);
    }
    console.log('\n  Note: These may be outside the 800m search radius, or listed');
    console.log('  under a different name in Google Maps.');
  }

  console.log('\n══════════════════════════════════════════════════════');
  console.log(`🚫 EXCLUDED — filtered out (${excluded.length})`);
  console.log('══════════════════════════════════════════════════════');
  const byReason = {};
  for (const { reason, detail } of excluded) {
    byReason[reason] = byReason[reason] || [];
    byReason[reason].push(detail);
  }
  for (const [reason, items] of Object.entries(byReason)) {
    console.log(`\n  ${reason}:`);
    for (const item of items) console.log(`    · ${item}`);
  }

  console.log('\n══════════════════════════════════════════════════════');
  console.log('  Summary');
  console.log('══════════════════════════════════════════════════════');
  console.log(`  Raw from Google:     ${raw.length}`);
  console.log(`  After filtering:     ${enriched.length}`);
  console.log(`  Matched to our DB:   ${matched.length}/${existingList.length}`);
  console.log(`  New potential adds:  ${newFinds.length}`);
  console.log(`  Our DB, no match:    ${notInGoogle.length}`);
  console.log(`  Excluded:            ${excluded.length}\n`);

  // ── Save JSON report ──────────────────────────────────────

  if (save) {
    const report = {
      generated_at: new Date().toISOString(),
      area: areaKey,
      summary: {
        raw_count: raw.length,
        filtered_count: enriched.length,
        matched_count: matched.length,
        new_finds_count: newFinds.length,
        not_in_google_count: notInGoogle.length,
        excluded_count: excluded.length,
      },
      matched: matched.map(({ existing, place }) => ({
        db_id: existing.id,
        db_name: existing.name,
        google_name: getDisplayName(place),
        google_place_id: place.id,
        rating: place.rating,
        review_count: place.userRatingCount,
        district: place.district,
      })),
      new_finds: newFinds.map((place) => ({
        name: getDisplayName(place),
        google_place_id: place.id,
        address: place.formattedAddress,
        rating: place.rating,
        review_count: place.userRatingCount,
        price_level: normalizePriceLevel(place),
        website: place.websiteUri,
        phone: place.nationalPhoneNumber,
        district: place.district,
        neighborhood_area: place.neighborhood_area,
        types: place.types,
        hours: place.regularOpeningHours,
        business_status: place.businessStatus,
        has_outdoor_seating: place.outdoorSeating,
        takes_reservations: place.reservable,
        serves_beer: place.servesBeer,
        serves_wine: place.servesWine,
        serves_dinner: place.servesDinner,
        editorial_summary: place.editorialSummary?.text ?? null,
      })),
      not_in_google: notInGoogle,
      excluded: excluded.map(({ reason, detail }) => ({ reason, detail })),
    };

    mkdirSync(OUTPUT_DIR, { recursive: true });
    const outPath = join(OUTPUT_DIR, `${areaKey}-compare.json`);
    writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.log(`💾 Full JSON report saved to ${outPath}\n`);
  }
}

run().catch((err) => {
  console.error(`\n❌ Fatal error: ${err.message}`);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
