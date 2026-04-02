// ============================================================
// filter-places.js — Quality and chain filter for raw Places results
// ============================================================
// Takes an array of raw Google Places objects and returns two arrays:
//   kept:    places that pass all filters
//   excluded: places that were filtered out (with reason)
//
// Filtering rules (applied in order, driven by place_exclusion_rules DB table):
//   1. allowlist (place_allowlist) → always pass, skip remaining checks
//   2. chain_name rules → exclude on exact name match
//   3. business_status rules → exclude if status matches (CLOSED_PERMANENTLY, CLOSED_TEMPORARILY, etc.)
//   4. min_rating rule → exclude if rating below threshold
//   5. min_reviews rule → exclude if review count below threshold

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
 * @param {Object}   rules  - Fetched from place_exclusion_rules + place_allowlist
 * @param {Set<string>} rules.allowlist        - Names that always pass (place_allowlist)
 * @param {Set<string>} rules.excludedChains   - Exact names to exclude (chain_name rules)
 * @param {Set<string>} rules.excludedStatuses - businessStatus values to exclude (business_status rules)
 * @param {number}      rules.minRating        - Minimum rating threshold (min_rating rule)
 * @param {number}      rules.minReviews       - Minimum review count threshold (min_reviews rule)
 * @returns {{ kept: Object[], excluded: Object[] }}
 */
export function filterPlaces(places, rules) {
  const { allowlist, excludedChains, excludedStatuses, minRating, minReviews } = rules;
  const kept = [];
  const excluded = [];

  for (const place of places) {
    const name = getDisplayName(place);
    const rating = place.rating ?? 0;
    const reviewCount = place.userRatingCount ?? 0;
    const status = place.businessStatus;

    // 1. Allowlist — always keep
    if (allowlist.has(name)) {
      kept.push({ ...place, _filterNote: 'allowlist' });
      continue;
    }

    // 2. Chain exclusion — exact name match
    if (excludedChains.has(name)) {
      excluded.push({ place, reason: 'chain_excluded', detail: name });
      continue;
    }

    // 3. Business status (covers CLOSED_PERMANENTLY, CLOSED_TEMPORARILY, any future values)
    if (status && excludedStatuses.has(status)) {
      excluded.push({ place, reason: status.toLowerCase(), detail: name });
      continue;
    }

    // 4. Rating threshold
    if (minRating > 0 && rating < minRating) {
      excluded.push({
        place,
        reason: 'low_rating',
        detail: `${name} — ${rating} (min ${minRating})`,
      });
      continue;
    }

    // 5. Review count threshold
    if (minReviews > 0 && reviewCount < minReviews) {
      excluded.push({
        place,
        reason: 'too_few_reviews',
        detail: `${name} — ${reviewCount} reviews (min ${minReviews})`,
      });
      continue;
    }

    kept.push(place);
  }

  return { kept, excluded };
}

// ── CLI: pipe mode ────────────────────────────────────────
// Usage: node scripts/fetch-places.js --area hudson_yards | node scripts/filter-places.js
// Requires VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env

if (process.stdin.isTTY === false || process.argv[1]?.includes('filter-places')) {
  const { default: dotenv } = await import('dotenv');
  dotenv.config();

  const { createClient } = await import('@supabase/supabase-js');
  const { fetchFilterRules } = await import('./filter-rules.js');

  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('❌ Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(1);
  }
  const supabase = createClient(url, key);
  const rules = await fetchFilterRules(supabase);

  const chunks = [];
  process.stdin.on('data', (chunk) => chunks.push(chunk));
  process.stdin.on('end', () => {
    try {
      const raw = JSON.parse(Buffer.concat(chunks).toString());
      const { kept, excluded } = filterPlaces(raw, rules);

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
