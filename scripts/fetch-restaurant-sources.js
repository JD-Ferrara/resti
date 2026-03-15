// ============================================================
// fetch-restaurant-sources.js — Tavily editorial discovery
// ============================================================
// Searches Tavily for editorial coverage (reviews, features,
// guides) for each restaurant in the curated list and upserts
// the discovered URLs into restaurant_sources.
//
// Strategy: one Tavily search per restaurant, targeting all
// editorial domains at once via include_domains. Results are
// mapped back to columns by hostname. Only verified,
// restaurant-specific URLs are written (list pages are skipped).
//
// Usage:
//   node scripts/fetch-restaurant-sources.js               # all restaurants, skip already-fetched
//   node scripts/fetch-restaurant-sources.js --id=24       # single restaurant by id
//   node scripts/fetch-restaurant-sources.js --force       # re-fetch all, overwrite existing
//   node scripts/fetch-restaurant-sources.js --dry-run     # preview only, no DB writes
//
// Prerequisites:
//   TAVILY_API_KEY           — Tavily dashboard → API Keys
//   VITE_SUPABASE_URL        — Supabase project URL
//   SUPABASE_SERVICE_ROLE_KEY — Supabase service role (write access)
//
// Rate limits (Tavily):
//   Starter: 1,000 searches/month  (~35 per full run)
//   Recommended: run weekly or when adding new restaurants

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

// ── Config ────────────────────────────────────────────────
const TAVILY_API_KEY   = process.env.TAVILY_API_KEY;
const SUPABASE_URL     = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY     = process.env.SUPABASE_SERVICE_ROLE_KEY;

const REQUEST_DELAY_MS = 700;  // ~85 searches/min — well within Tavily limits
const MAX_RESULTS      = 15;   // results per Tavily call

// ── Publication map ───────────────────────────────────────
// Maps restaurant_sources column name → domains that belong to it.
// Order matters for eater: ny.eater.com is preferred over eater.com.
const PUBLICATIONS = {
  infatuation:          ['theinfatuation.com'],
  eater:                ['ny.eater.com', 'eater.com'],
  timeout:              ['timeout.com'],
  new_york_times:       ['nytimes.com'],
  new_york_mag:         ['nymag.com', 'grubstreet.com'],
  michelin:             ['guide.michelin.com'],
  robb_report:          ['robbreport.com'],
  bon_appetit:          ['bonappetit.com'],
  vogue:                ['vogue.com'],
  wsj:                  ['wsj.com'],
  wwd:                  ['wwd.com'],
  resy_blog:            ['blog.resy.com'],
  food_and_wine:        ['foodandwine.com'],
  new_yorker:           ['newyorker.com'],
  tasting_table:        ['tastingtable.com'],
  conde_nast_traveler:  ['cntraveler.com', 'condenasttraveler.com'],
};

// Flat unique list of all domains — passed to Tavily include_domains
const ALL_DOMAINS = [...new Set(Object.values(PUBLICATIONS).flat())];

// ── Helpers ───────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Normalize a restaurant name into search-friendly tokens:
// "P.J. Clarke's" → ["pj", "clarkes"]
// "Russ & Daughters" → ["russ", "daughters"]
function nameTokens(name) {
  return name
    .toLowerCase()
    // remove noise: possessives, ampersands, slashes, punctuation
    .replace(/[''`]/g, '')
    .replace(/[&\/\\]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2);  // drop very short words like "a", "le"
}

// Returns the column name for a given URL, or null if unrecognised.
function urlToColumn(url) {
  let hostname;
  try { hostname = new URL(url).hostname.replace(/^www\./, ''); }
  catch { return null; }

  for (const [col, domains] of Object.entries(PUBLICATIONS)) {
    if (domains.some(d => hostname === d || hostname.endsWith('.' + d))) {
      return col;
    }
  }
  return null;
}

// Returns true if this Tavily result is specifically about THIS restaurant
// at THIS location (not a generic list page, and not a different location
// of the same name).
function isRestaurantSpecificResult(result, restaurant) {
  const nTokens = nameTokens(restaurant.name);
  const loc     = restaurant.area || restaurant.district || null;
  const hasSpecificLocation = !!loc;

  const urlPath     = (() => { try { return new URL(result.url).pathname.toLowerCase(); } catch { return ''; } })();
  const titleLower  = (result.title   || '').toLowerCase();
  const contentLower = (result.content || '').toLowerCase();

  // 1. Name must appear in URL path OR title (filters generic list pages)
  const nameInPath  = nTokens.some(t => urlPath.includes(t));
  const nameInTitle = nTokens.some(t => titleLower.includes(t));
  if (!nameInPath && !nameInTitle) return false;

  // 2. For restaurants with a specific neighborhood (Hudson Yards, Manhattan West,
  //    etc.) the location must appear somewhere in title OR content. This rejects
  //    results about the same restaurant name at a different address.
  if (hasSpecificLocation) {
    const locTokens = loc.toLowerCase().split(/\s+/).filter(t => t.length > 3);
    const locInTitle   = locTokens.some(t => titleLower.includes(t));
    const locInContent = locTokens.some(t => contentLower.includes(t));
    if (!locInTitle && !locInContent) return false;
  }


  return true;
}

// ── Tavily search ─────────────────────────────────────────

async function tavilySearch(query) {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key:         TAVILY_API_KEY,
      query,
      search_depth:    'basic',     // 'advanced' costs 2 credits; basic is fine here
      include_domains: ALL_DOMAINS,
      max_results:     MAX_RESULTS,
      include_answer:  false,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Tavily ${res.status}: ${body}`);
  }

  const data = await res.json();
  return data.results || [];
}

// ── Build search query for a restaurant ───────────────────
// Uses the structured area column (most specific sub-area, e.g.
// "Manhattan West") falling back to district ("Hudson Yards"),
// then to the generic city. Both name and location are quoted so
// Tavily requires both terms — anchoring results to this specific
// location rather than other branches or events with the same name.
function buildQuery(restaurant) {
  const loc = restaurant.area || restaurant.district;
  if (loc) {
    // e.g. → "BondST" "Hudson Yards" restaurant New York review
    return `"${restaurant.name}" "${loc}" restaurant New York review`;
  }
  return `"${restaurant.name}" restaurant New York City review feature`;
}

// ── Main ──────────────────────────────────────────────────

async function main() {
  // ── CLI flags ─────────────────────────────────────────
  const args      = process.argv.slice(2);
  const isDryRun  = args.includes('--dry-run');
  const isForce   = args.includes('--force');
  const idArg     = args.find(a => a.startsWith('--id='));
  const targetId  = idArg ? parseInt(idArg.split('=')[1], 10) : null;

  // ── Validate env ──────────────────────────────────────
  if (!TAVILY_API_KEY) {
    console.error('Missing TAVILY_API_KEY. Add it to your .env file.');
    process.exit(1);
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  console.log('fetch-restaurant-sources');
  console.log('  mode    :', isDryRun ? 'dry-run (no writes)' : 'live');
  console.log('  force   :', isForce ? 'yes (overwrite existing)' : 'no (skip already-fetched)');
  if (targetId) console.log('  target  : restaurant id', targetId);
  console.log();

  // ── Load restaurants ──────────────────────────────────
  let restaurantQuery = supabase
    .from('restaurants')
    .select('id, name, cuisine, address, area, district')
    .order('id');

  if (targetId) restaurantQuery = restaurantQuery.eq('id', targetId);

  const { data: restaurants, error: rErr } = await restaurantQuery;
  if (rErr) { console.error('Failed to load restaurants:', rErr.message); process.exit(1); }

  // ── Load existing sources ─────────────────────────────
  const { data: existingSources, error: sErr } = await supabase
    .from('restaurant_sources')
    .select('*');
  if (sErr) { console.error('Failed to load sources:', sErr.message); process.exit(1); }

  const sourcesMap = Object.fromEntries(
    (existingSources || []).map(s => [s.restaurant_id, s])
  );

  // ── Process each restaurant ───────────────────────────
  let totalUpdated = 0;
  let totalSkipped = 0;

  for (const restaurant of restaurants) {
    const existing = sourcesMap[restaurant.id] || {};

    // Skip restaurants that were already fetched recently (unless --force)
    if (!isForce && existing.tavily_fetched_at) {
      const fetchedAt = new Date(existing.tavily_fetched_at);
      const daysSince = (Date.now() - fetchedAt.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < 7) {
        console.log(`[${restaurant.id}] ${restaurant.name} — skipped (fetched ${Math.round(daysSince)}d ago)`);
        totalSkipped++;
        continue;
      }
    }

    const query = buildQuery(restaurant);
    console.log(`[${restaurant.id}] ${restaurant.name}`);
    console.log(`        query: ${query}`);

    let results;
    try {
      results = await tavilySearch(query);
    } catch (err) {
      console.error(`        ERROR: ${err.message}`);
      await sleep(REQUEST_DELAY_MS);
      continue;
    }

    // ── Map results → columns ────────────────────────────
    // For each result, determine which column it maps to, then keep the
    // first (highest-ranked) relevant URL per column.
    const discovered = {};  // column → url

    for (const result of results) {
      const col = urlToColumn(result.url);
      if (!col) continue;
      if (discovered[col]) continue;  // already have a URL for this column

      if (!isRestaurantSpecificResult(result, restaurant)) {
        console.log(`        skip  (list page?): [${col}] ${result.url}`);
        continue;
      }

      discovered[col] = result.url;
      console.log(`        found [${col}]: ${result.url}`);
    }

    if (Object.keys(discovered).length === 0) {
      console.log('        no new sources found');
    }

    // ── Build upsert payload ─────────────────────────────
    // When --force: overwrite all discovered columns.
    // Otherwise: only fill NULL columns; preserve manually-entered URLs.
    const upsertPayload = { restaurant_id: restaurant.id };

    for (const [col, url] of Object.entries(discovered)) {
      if (isForce || !existing[col]) {
        upsertPayload[col] = url;
      } else {
        console.log(`        kept  (already set): [${col}]`);
      }
    }

    upsertPayload.tavily_fetched_at = new Date().toISOString();
    upsertPayload.updated_at        = new Date().toISOString();

    if (!isDryRun) {
      const { error: uErr } = await supabase
        .from('restaurant_sources')
        .upsert(upsertPayload, { onConflict: 'restaurant_id' });

      if (uErr) {
        console.error(`        DB error: ${uErr.message}`);
      } else {
        totalUpdated++;
      }
    } else {
      console.log('        [dry-run] would upsert:', JSON.stringify(upsertPayload, null, 6));
      totalUpdated++;
    }

    console.log();
    await sleep(REQUEST_DELAY_MS);
  }

  // ── Summary ───────────────────────────────────────────
  console.log('────────────────────────────────────');
  console.log(`Done. ${totalUpdated} updated, ${totalSkipped} skipped.`);
  if (isDryRun) console.log('(dry-run: no changes written to database)');
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
