// ============================================================
// fetch-restaurant-links.js — website / instagram / reservation
// ============================================================
// Populates the website, instagram, and reservation columns on
// the restaurants table using the most reliable source for each:
//
//   website     — Google Places API (websiteUri from Business profile)
//   instagram   — Tavily (instagram.com, profile page validation)
//   reservation — Tavily (resy.com / opentable.com / tock.com / sevenrooms.com)
//
// Usage:
//   node scripts/fetch-restaurant-links.js               # all restaurants, skip populated
//   node scripts/fetch-restaurant-links.js --id=24       # single restaurant by id
//   node scripts/fetch-restaurant-links.js --force       # re-fetch all, overwrite existing
//   node scripts/fetch-restaurant-links.js --dry-run     # preview only, no DB writes
//   node scripts/fetch-restaurant-links.js --field=instagram  # one field only
//
// Prerequisites:
//   TAVILY_API_KEY            — Tavily dashboard → API Keys
//   GOOGLE_PLACES_API_KEY     — Google Cloud Console
//   VITE_SUPABASE_URL         — Supabase project URL
//   SUPABASE_SERVICE_ROLE_KEY — Supabase service role (write access)
//
// Rate limits:
//   Tavily Starter: 1,000 searches/month. Full run uses up to ~52 calls (2 per restaurant).
//   Google Places: website lookups use raw_places cache first (free), only API if miss.
//
// --force behaviour (intentionally differs from fetch-restaurant-sources.js):
//   Found    → write new value
//   Not found → PRESERVE existing value (search failure ≠ stale/dead link)
//   Rationale: restaurant websites and Instagram handles are stable; a Tavily miss
//   is more likely a query quality issue than a dead URL.

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

// ── Config ────────────────────────────────────────────────
const TAVILY_API_KEY        = process.env.TAVILY_API_KEY;
const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const SUPABASE_URL          = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY          = process.env.SUPABASE_SERVICE_ROLE_KEY;

const TAVILY_DELAY_MS  = 700;  // matches fetch-restaurant-sources.js
const GOOGLE_DELAY_MS  = 300;
const MAX_RESULTS      = 10;

const RESERVATION_DOMAINS = ['resy.com', 'opentable.com', 'tock.com', 'sevenrooms.com'];
const TEXT_SEARCH_URL     = 'https://places.googleapis.com/v1/places:searchText';

const VALID_FIELDS = ['website', 'instagram', 'reservation'];

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
    .replace(/[''`]/g, '')
    .replace(/[&\/\\]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2);
}

// ── Validators ────────────────────────────────────────────

// Returns true if url is an Instagram profile page for this restaurant.
function isValidInstagram(url, restaurant) {
  let parsed;
  try { parsed = new URL(url); } catch { return false; }

  if (!parsed.hostname.includes('instagram.com')) return false;

  // Extract first path segment — this is the profile slug
  const slug = parsed.pathname.split('/').filter(Boolean)[0] || '';

  // Reject non-profile pages (posts, reels, explore, stories, etc.)
  const NON_PROFILE_SEGMENTS = ['p', 'reel', 'reels', 'explore', 'stories', 'tv', 'accounts', 'directory'];
  if (NON_PROFILE_SEGMENTS.includes(slug)) return false;

  // Slug must be a plausible profile handle (≥3 chars, no hash-like short strings)
  if (slug.length < 3) return false;

  // At least one name token must appear in the slug
  const tokens = nameTokens(restaurant.name);
  return tokens.some(t => slug.toLowerCase().includes(t));
}

// Returns true if url is a valid reservation booking page for this restaurant.
function isValidReservation(url, restaurant) {
  let parsed;
  try { parsed = new URL(url); } catch { return false; }

  const hostname = parsed.hostname.replace(/^www\./, '');
  if (!RESERVATION_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d))) return false;

  const urlPath = parsed.pathname.toLowerCase();
  const segments = urlPath.split('/').filter(Boolean);

  // Reject top-level / shallow pages (search results, homepages)
  if (segments.length < 2) return false;

  // Name tokens must appear in the URL path (venue slug)
  const tokens = nameTokens(restaurant.name);
  return tokens.some(t => urlPath.includes(t));
}

// ── API callers ───────────────────────────────────────────

// Calls Tavily with a specific include_domains list.
async function tavilySearch(query, includeDomains) {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key:         TAVILY_API_KEY,
      query,
      search_depth:    'basic',
      include_domains: includeDomains,
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

// Calls Google Places Text Search and returns websiteUri for the best match.
async function googlePlacesTextSearch(name, address) {
  const res = await fetch(TEXT_SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type':   'application/json',
      'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
      'X-Goog-FieldMask': 'places.websiteUri,places.displayName',
    },
    body: JSON.stringify({
      textQuery: `${name} ${address}`,
      maxResultCount: 1,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Google Places ${res.status}: ${body}`);
  }

  const data = await res.json();
  const place = (data.places || [])[0];
  if (!place) return null;

  // Basic sanity check: display name should share at least one token with the restaurant name
  const displayName = (place.displayName?.text || '').toLowerCase();
  const tokens = nameTokens(name);
  if (!tokens.some(t => displayName.includes(t))) return null;

  return place.websiteUri || null;
}

// ── Query builders ────────────────────────────────────────

function buildInstagramQuery(restaurant) {
  const loc = restaurant.area || restaurant.district;
  if (loc) {
    return `"${restaurant.name}" "${loc}" restaurant instagram`;
  }
  return `"${restaurant.name}" restaurant New York instagram`;
}

function buildReservationQuery(restaurant) {
  const loc = restaurant.area || restaurant.district;
  if (loc) {
    return `"${restaurant.name}" "${loc}" New York reservation`;
  }
  return `"${restaurant.name}" New York City reservation`;
}

// ── Main ──────────────────────────────────────────────────

async function main() {
  // ── CLI flags ─────────────────────────────────────────
  const args        = process.argv.slice(2);
  const isDryRun    = args.includes('--dry-run');
  const isForce     = args.includes('--force');
  const idArg       = args.find(a => a.startsWith('--id='));
  const targetId    = idArg ? parseInt(idArg.split('=')[1], 10) : null;
  const fieldArg    = args.find(a => a.startsWith('--field='));
  const targetField = fieldArg ? fieldArg.split('=')[1] : null;

  if (targetField && !VALID_FIELDS.includes(targetField)) {
    console.error(`Invalid --field value. Must be one of: ${VALID_FIELDS.join(', ')}`);
    process.exit(1);
  }

  const doWebsite     = !targetField || targetField === 'website';
  const doInstagram   = !targetField || targetField === 'instagram';
  const doReservation = !targetField || targetField === 'reservation';

  // ── Validate env ──────────────────────────────────────
  if (doInstagram || doReservation) {
    if (!TAVILY_API_KEY) {
      console.error('Missing TAVILY_API_KEY. Add it to your .env file.');
      process.exit(1);
    }
  }
  if (doWebsite && !GOOGLE_PLACES_API_KEY) {
    console.error('Missing GOOGLE_PLACES_API_KEY. Add it to your .env file.');
    process.exit(1);
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  const activeFields = [
    doWebsite     && 'website',
    doInstagram   && 'instagram',
    doReservation && 'reservation',
  ].filter(Boolean);

  console.log('fetch-restaurant-links');
  console.log('  mode    :', isDryRun ? 'dry-run (no writes)' : 'live');
  console.log('  force   :', isForce ? 'yes (re-fetch; preserve if not found)' : 'no (skip already-set)');
  console.log('  fields  :', activeFields.join(', '));
  if (targetId) console.log('  target  : restaurant id', targetId);
  console.log();

  // ── Load restaurants ──────────────────────────────────
  let rQuery = supabase
    .from('restaurants')
    .select('id, name, address, area, district, website, instagram, reservation, links_fetched_at')
    .order('id');

  if (targetId) rQuery = rQuery.eq('id', targetId);

  const { data: restaurants, error: rErr } = await rQuery;
  if (rErr) { console.error('Failed to load restaurants:', rErr.message); process.exit(1); }

  // ── Load raw_places website cache ─────────────────────
  // raw_places.website is populated from place.websiteUri during seed-raw-places.
  // Using it avoids a Google Places API call (and billing) for already-known websites.
  const { data: rawPlaces } = await supabase
    .from('raw_places')
    .select('matched_restaurant_id, website')
    .not('matched_restaurant_id', 'is', null)
    .not('website', 'is', null);

  const rawWebsiteMap = Object.fromEntries(
    (rawPlaces || []).map(r => [r.matched_restaurant_id, r.website])
  );

  // ── Process each restaurant ───────────────────────────
  let totalUpdated = 0;
  let totalSkipped = 0;

  for (const restaurant of restaurants) {
    // Skip recently fetched restaurants (unless --force)
    if (!isForce && restaurant.links_fetched_at) {
      const daysSince = (Date.now() - new Date(restaurant.links_fetched_at).getTime()) / 86400000;
      if (daysSince < 30) {
        console.log(`[${restaurant.id}] ${restaurant.name} — skipped (fetched ${Math.round(daysSince)}d ago)`);
        totalSkipped++;
        continue;
      }
    }

    // Skip if all target fields are already set (and not --force)
    if (!isForce) {
      const allSet = activeFields.every(f => restaurant[f]);
      if (allSet) {
        console.log(`[${restaurant.id}] ${restaurant.name} — skipped (all fields set)`);
        totalSkipped++;
        continue;
      }
    }

    console.log(`[${restaurant.id}] ${restaurant.name}`);

    const updates = {};
    let madeGoogleCall = false;
    let madeTavilyCall = false;

    // ── website ──────────────────────────────────────
    if (doWebsite) {
      if (!isForce && restaurant.website) {
        console.log(`      website  : skip (already set): ${restaurant.website}`);
      } else {
        // Step 1: raw_places cache
        const cached = rawWebsiteMap[restaurant.id];
        if (cached) {
          updates.website = cached;
          console.log(`      website  : found (raw_places cache): ${cached}`);
        } else {
          // Step 2: Google Places API
          try {
            const url = await googlePlacesTextSearch(restaurant.name, restaurant.address || '');
            madeGoogleCall = true;
            if (url) {
              updates.website = url;
              console.log(`      website  : found (Google Places): ${url}`);
            } else if (isForce && restaurant.website) {
              console.log(`      website  : force-kept (not found): ${restaurant.website}`);
            } else {
              console.log('      website  : not found');
            }
          } catch (err) {
            console.error(`      website  : ERROR: ${err.message}`);
          }
        }
      }
    }

    // ── instagram ────────────────────────────────────
    if (doInstagram) {
      if (!isForce && restaurant.instagram) {
        console.log(`      instagram: skip (already set): ${restaurant.instagram}`);
      } else {
        const query = buildInstagramQuery(restaurant);
        try {
          const results = await tavilySearch(query, ['instagram.com']);
          madeTavilyCall = true;
          const match = results.find(r => isValidInstagram(r.url, restaurant));
          if (match) {
            updates.instagram = match.url;
            console.log(`      instagram: found: ${match.url}`);
          } else if (isForce && restaurant.instagram) {
            console.log(`      instagram: force-kept (not found): ${restaurant.instagram}`);
          } else {
            console.log('      instagram: not found');
          }
        } catch (err) {
          console.error(`      instagram: ERROR: ${err.message}`);
        }
        await sleep(TAVILY_DELAY_MS);
      }
    }

    // ── reservation ───────────────────────────────────
    if (doReservation) {
      if (!isForce && restaurant.reservation) {
        console.log(`      reservation: skip (already set): ${restaurant.reservation}`);
      } else {
        const query = buildReservationQuery(restaurant);
        try {
          const results = await tavilySearch(query, RESERVATION_DOMAINS);
          madeTavilyCall = true;
          const match = results.find(r => isValidReservation(r.url, restaurant));
          if (match) {
            updates.reservation = match.url;
            console.log(`      reservation: found: ${match.url}`);
          } else if (isForce && restaurant.reservation) {
            console.log(`      reservation: force-kept (not found): ${restaurant.reservation}`);
          } else {
            console.log('      reservation: not found');
          }
        } catch (err) {
          console.error(`      reservation: ERROR: ${err.message}`);
        }
        await sleep(TAVILY_DELAY_MS);
      }
    }

    // ── Write to DB ───────────────────────────────────
    const hasUpdates = Object.keys(updates).length > 0;

    if (hasUpdates || madeTavilyCall || madeGoogleCall) {
      updates.links_fetched_at = new Date().toISOString();

      if (!isDryRun) {
        const { error: uErr } = await supabase
          .from('restaurants')
          .update(updates)
          .eq('id', restaurant.id);

        if (uErr) {
          console.error(`      DB error: ${uErr.message}`);
        } else {
          totalUpdated++;
        }
      } else {
        if (hasUpdates) {
          console.log('      [dry-run] would update:', JSON.stringify(updates, null, 6));
        }
        totalUpdated++;
      }
    } else {
      totalSkipped++;
    }

    console.log();

    // Only delay if we didn't already sleep after a Tavily call
    if (!madeTavilyCall && madeGoogleCall) {
      await sleep(GOOGLE_DELAY_MS);
    }
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
