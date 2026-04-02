// ============================================================
// compare-hudson-yards.js — Diff Google Places vs. existing DB
// ============================================================
// Fetches restaurants from Google Places for the hudson_yards area,
// applies filters, detects neighborhoods, then compares results against
// the 27 existing Hudson Yards restaurants in the database.
//
// Output categories:
//   ✅ MATCHED     — in Google AND in our DB (by normalized name)
//   🆕 NEW FINDS   — in Google, NOT in our DB (potential additions)
//   ❓ NOT IN GOOGLE — in our DB, not found in this Google fetch
//   🚫 EXCLUDED    — filtered out (with reason)
//
// Usage:
//   node scripts/compare-hudson-yards.js
//   node scripts/compare-hudson-yards.js --save   (also writes JSON report)

import 'dotenv/config';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

import { fetchAllPlaces } from './fetch-places.js';
import { filterPlaces, getDisplayName, normalizePriceLevel } from './filter-places.js';
import { enrichWithNeighborhood } from './detect-neighborhood.js';
import { fetchFilterRules } from './filter-rules.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, 'output');

// ── Existing restaurant data ──────────────────────────────
// Hardcoded from supabase-seed.sql so no Supabase connection is needed
// to run this comparison. Update if the seed data changes.
const EXISTING_RESTAURANTS = [
  { id: 1,  name: 'Queensyard' },
  { id: 2,  name: "Zou Zou's" },
  { id: 3,  name: 'Estiatorio Milos' },
  { id: 4,  name: 'Peak with Priceless' },
  { id: 5,  name: 'Greywind' },
  { id: 6,  name: 'Spygold' },
  { id: 7,  name: 'Electric Lemon' },
  { id: 8,  name: 'BondST' },
  { id: 9,  name: "P.J. Clarke's" },
  { id: 10, name: 'Mercado Little Spain' },
  { id: 11, name: 'La Barra' },
  { id: 12, name: 'Miznon' },
  { id: 13, name: 'Bronx Brewery Kitchen' },
  { id: 14, name: 'Shake Shack' },
  { id: 15, name: 'Limusina' },
  { id: 16, name: 'Kyma' },
  { id: 17, name: 'NIZUC' },
  { id: 18, name: 'Russ & Daughters' },
  { id: 19, name: 'Oyamel' },
  { id: 20, name: 'ANA Bar and Eatery' },
  { id: 21, name: 'Eataly' },
  { id: 22, name: 'Fuku' },
  { id: 23, name: 'Ci Siamo' },
  { id: 24, name: 'Papa San' },
  { id: 25, name: 'Locanda Verde' },
  { id: 26, name: 'Saverne' },
  { id: 27, name: 'Jajaja Mexicana' },
];

// ── Name normalization ────────────────────────────────────
// Strips punctuation and lowercases for fuzzy matching.
// "P.J. Clarke's" → "pj clarkes", "Zou Zou's" → "zou zous"
function normalizeName(name) {
  return name
    .toLowerCase()
    .replace(/[''`]/g, '')       // remove apostrophes
    .replace(/[^a-z0-9\s]/g, '') // remove remaining punctuation
    .replace(/\s+/g, ' ')        // collapse whitespace
    .trim();
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
  const save = process.argv.includes('--save');

  console.log('\n══════════════════════════════════════════════════════');
  console.log('  Hudson Yards — Google Places vs. Existing DB Diff');
  console.log('══════════════════════════════════════════════════════\n');

  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
  const rules = await fetchFilterRules(supabase);

  // 1. Fetch
  console.log('Step 1/3: Fetching from Google Places...');
  const raw = await fetchAllPlaces('hudson_yards');

  // 2. Filter
  console.log('\nStep 2/3: Applying filters...');
  const { kept, excluded } = filterPlaces(raw, rules);
  console.log(`  Kept: ${kept.length}  |  Excluded: ${excluded.length}`);

  // 3. Neighborhood detection
  console.log('\nStep 3/3: Detecting NYC neighborhoods...');
  const enriched = await enrichWithNeighborhood(kept);

  // 4. Compare
  const existingByNorm = new Map(
    EXISTING_RESTAURANTS.map((r) => [normalizeName(r.name), r])
  );
  const googleByNorm = new Map(
    enriched.map((p) => [normalizeName(getDisplayName(p)), p])
  );

  const matched = [];
  const newFinds = [];
  const notInGoogle = [];

  // Find matched and new finds
  for (const [normName, place] of googleByNorm.entries()) {
    if (existingByNorm.has(normName)) {
      matched.push({ existing: existingByNorm.get(normName), place });
    } else {
      newFinds.push(place);
    }
  }

  // Find restaurants in our DB not found in Google results
  for (const [normName, existing] of existingByNorm.entries()) {
    if (!googleByNorm.has(normName)) {
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
  console.log(`  Matched to our DB:   ${matched.length}/${EXISTING_RESTAURANTS.length}`);
  console.log(`  New potential adds:  ${newFinds.length}`);
  console.log(`  Our DB, no match:    ${notInGoogle.length}`);
  console.log(`  Excluded:            ${excluded.length}\n`);

  // ── Save JSON report ──────────────────────────────────────

  if (save) {
    const report = {
      generated_at: new Date().toISOString(),
      area: 'hudson_yards',
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
    const outPath = join(OUTPUT_DIR, 'hudson-yards-compare.json');
    writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.log(`💾 Full JSON report saved to ${outPath}\n`);
  }
}

run().catch((err) => {
  console.error(`\n❌ Fatal error: ${err.message}`);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
