// ============================================================
// filter-places.js — Quality and chain filter for raw Places results
// ============================================================
// Takes an array of raw Google Places objects and returns two arrays:
//   kept:    places that pass all filters
//   excluded: places that were filtered out (with reason)
//
// Filtering rules (applied in order):
//   1. DESTINATION_QSR allowlist → always pass, skip remaining checks
//   2. EXCLUDED_CHAINS exact match → exclude
//   3. businessStatus === CLOSED_PERMANENTLY → exclude
//   4. rating < FILTERS.minRating → exclude
//   5. userRatingCount < FILTERS.minReviews → exclude

import { EXCLUDED_CHAINS, DESTINATION_QSR, FILTERS } from './places-config.js';

// ── Normalisation helpers ─────────────────────────────────

/**
 * Extract the plain display name from a Places API place object.
 * Google Places (New) wraps the name: { displayName: { text: "..." } }
 */
export function getDisplayName(place) {
  return place?.displayName?.text ?? place?.name ?? '';
}

/**
 * Map Google's PRICE_LEVEL enum to a 1–4 integer and a "$" string.
 * Google values: PRICE_LEVEL_FREE=0, INEXPENSIVE=1, MODERATE=2, EXPENSIVE=3, VERY_EXPENSIVE=4
 */
export function normalizePriceLevel(place) {
  const levelMap = {
    PRICE_LEVEL_FREE:         { level: 1, range: '$' },
    PRICE_LEVEL_INEXPENSIVE:  { level: 1, range: '$' },
    PRICE_LEVEL_MODERATE:     { level: 2, range: '$$' },
    PRICE_LEVEL_EXPENSIVE:    { level: 3, range: '$$$' },
    PRICE_LEVEL_VERY_EXPENSIVE:{ level: 4, range: '$$$$' },
  };
  const key = place.priceLevel;
  return levelMap[key] ?? { level: null, range: null };
}

// ── Core filter ───────────────────────────────────────────

/**
 * @param {Object[]} places - Raw array from Google Places API
 * @returns {{ kept: Object[], excluded: Object[] }}
 */
export function filterPlaces(places) {
  const kept = [];
  const excluded = [];

  for (const place of places) {
    const name = getDisplayName(place);
    const rating = place.rating ?? 0;
    const reviewCount = place.userRatingCount ?? 0;
    const status = place.businessStatus;

    // 1. Destination QSR allowlist — always keep
    if (DESTINATION_QSR.has(name)) {
      kept.push({ ...place, _filterNote: 'destination_qsr' });
      continue;
    }

    // 2. Chain exclusion — exact name match
    if (EXCLUDED_CHAINS.has(name)) {
      excluded.push({ place, reason: 'chain_excluded', detail: name });
      continue;
    }

    // 3. Permanently closed
    if (status === 'CLOSED_PERMANENTLY') {
      excluded.push({ place, reason: 'permanently_closed', detail: name });
      continue;
    }

    // 4. Rating threshold
    if (rating < FILTERS.minRating) {
      excluded.push({
        place,
        reason: 'low_rating',
        detail: `${name} — ${rating} (min ${FILTERS.minRating})`,
      });
      continue;
    }

    // 5. Review count threshold
    if (reviewCount < FILTERS.minReviews) {
      excluded.push({
        place,
        reason: 'too_few_reviews',
        detail: `${name} — ${reviewCount} reviews (min ${FILTERS.minReviews})`,
      });
      continue;
    }

    kept.push(place);
  }

  return { kept, excluded };
}

// ── CLI: pipe mode ────────────────────────────────────────
// Usage: node scripts/fetch-places.js --area hudson_yards | node scripts/filter-places.js

if (process.stdin.isTTY === false || process.argv[1]?.includes('filter-places')) {
  const chunks = [];
  process.stdin.on('data', (chunk) => chunks.push(chunk));
  process.stdin.on('end', () => {
    try {
      const raw = JSON.parse(Buffer.concat(chunks).toString());
      const { kept, excluded } = filterPlaces(raw);

      console.error(`\n🔍 Filter results:`);
      console.error(`   ✅ Kept:     ${kept.length}`);
      console.error(`   🚫 Excluded: ${excluded.length}`);

      if (excluded.length > 0) {
        console.error('\n   Excluded breakdown:');
        const byReason = {};
        for (const { reason, detail } of excluded) {
          byReason[reason] = byReason[reason] || [];
          byReason[reason].push(detail);
        }
        for (const [reason, items] of Object.entries(byReason)) {
          console.error(`   · ${reason}: ${items.join(', ')}`);
        }
      }

      process.stdout.write(JSON.stringify(kept, null, 2));
    } catch (err) {
      console.error(`❌ Error parsing input: ${err.message}`);
      process.exit(1);
    }
  });
}
