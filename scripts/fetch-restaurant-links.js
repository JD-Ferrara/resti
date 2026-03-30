// ============================================================
// fetch-restaurant-links.js — website / instagram / reservation
// ============================================================
// Populates and validates the website, instagram, and reservation
// columns on the restaurants table.
//
//   website     — Google Places API (websiteUri from Business profile)
//   instagram   — Tavily (instagram.com, profile page validation)
//   reservation — Tavily (resy.com / opentable.com / tock.com / sevenrooms.com)
//
// Validation (runs before skipping any already-set field):
//   instagram   — URL slug must contain current restaurant name tokens
//   reservation — URL path must contain current restaurant name tokens
//   website     — HTTP GET; current restaurant name must appear in <title>/og:title
//
// This catches two classes of stale data:
//   1. Dead links   — URL 404s or times out
//   2. Wrong restaurant — link points to old/renamed restaurant (e.g. Nizuc → Talavera)
//
// When validation fails and re-discovery also finds nothing, the field
// is set to null (known-bad link is cleared). Use --skip-validate to
// restore the old fast-skip behaviour and trust all existing values.
//
// Usage:
//   node scripts/fetch-restaurant-links.js               # all restaurants, validate + fill gaps
//   node scripts/fetch-restaurant-links.js --id=24       # single restaurant by id
//   node scripts/fetch-restaurant-links.js --force       # re-discover all, preserve if not found
//   node scripts/fetch-restaurant-links.js --dry-run     # preview only, no DB writes
//   node scripts/fetch-restaurant-links.js --field=instagram  # one field only
//   node scripts/fetch-restaurant-links.js --skip-validate    # trust existing values, only fill nulls
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
// --force behaviour:
//   Found    → write new value
//   Not found → PRESERVE existing value (force = best-effort update, not a sweep)

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

const VALID_FIELDS    = ['website', 'instagram', 'reservation'];
const VALIDATE_TIMEOUT_MS = 5000;  // per-URL HTTP check timeout

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

// Validates an already-stored link for correctness and liveness.
//
// Strategy per field type:
//   instagram   — structural: slug must still match current name tokens
//                 (catches renames without an HTTP call); then GET for liveness
//   reservation — structural: path must still match current name tokens;
//                 then GET for liveness
//   website     — GET + current restaurant name must appear in <title>/og:title
//                 (structural check insufficient — website URLs don't embed names)
//
// Returns { valid: true } or { valid: false, reason: string }
async function validateLink(url, restaurant, fieldType) {
  // ── Structural check (instagram + reservation) ─────────
  if (fieldType === 'instagram' && !isValidInstagram(url, restaurant)) {
    return { valid: false, reason: 'URL slug does not match current restaurant name' };
  }
  if (fieldType === 'reservation' && !isValidReservation(url, restaurant)) {
    return { valid: false, reason: 'URL path does not match current restaurant name' };
  }

  // Instagram: structural check is all we need — skip HTTP entirely.
  // Instagram blocks bots with 429/403, making liveness checks unreliable and
  // causing valid stored URLs to appear stale.
  if (fieldType === 'instagram') return { valid: true };

  // ── HTTP liveness + content check ─────────────────────
  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RestaurantBot/1.0)' },
      signal: AbortSignal.timeout(VALIDATE_TIMEOUT_MS),
      redirect: 'follow',
    });
  } catch (err) {
    return { valid: false, reason: err.name === 'TimeoutError' ? 'timeout' : 'connection failed' };
  }

  if (!res.ok) {
    return { valid: false, reason: `HTTP ${res.status}` };
  }

  const html = (await res.text().catch(() => '')).slice(0, 10000).toLowerCase();

  // Normalise text the same way nameTokens normalises names:
  // strip apostrophes/backticks then replace remaining punctuation with spaces.
  // Without this, "clarkes" (from nameTokens) won't match "clarke's" in a title.
  const normalise = s => s.replace(/[''`\u2018\u2019]/g, '').replace(/[^a-z0-9\s]/g, ' ');

  const titleMatch = html.match(/<title[^>]*>([^<]{1,200})<\/title>/);
  const title      = titleMatch ? normalise(titleMatch[1]) : '';

  // For website: restaurant name must appear in page title / og:title
  if (fieldType === 'website') {
    const ogMatch  = html.match(/property="og:title"[^>]*content="([^"]{1,200})"/)
                  || html.match(/content="([^"]{1,200})"[^>]*property="og:title"/);
    const ogTitle  = ogMatch ? normalise(ogMatch[1]) : '';
    const combined = `${title} ${ogTitle}`;
    const tokens   = nameTokens(restaurant.name);
    if (!tokens.some(t => combined.includes(t))) {
      return { valid: false, reason: 'restaurant name not found in page title' };
    }
  }

  // For reservation: location must be confirmed in the page title + URL path.
  // Uses AND logic for multi-word locations — prevents "P.J. Clarke's on the Hudson"
  // (has "hudson") from passing as "Hudson Yards" (requires "hudson" AND "yards").
  if (fieldType === 'reservation') {
    const locationSignal = restaurant.area || restaurant.district || restaurant.address || null;
    if (locationSignal) {
      const locTokens = locationSignal.toLowerCase().split(/\s+/).filter(t => t.length > 3);
      if (locTokens.length > 0) {
        const urlPath  = (() => { try { return new URL(url).pathname.toLowerCase(); } catch { return ''; } })();
        const combined = `${urlPath} ${title}`;
        const passes   = locTokens.length > 1
          ? locTokens.every(t => combined.includes(t))   // AND — all tokens required
          : locTokens.some(t => combined.includes(t));   // OR — single token
        if (!passes) {
          return { valid: false, reason: `location "${locationSignal}" not confirmed — wrong venue?` };
        }
      }
    }
  }

  return { valid: true };
}

// Scrapes a restaurant's own website HTML for a self-linked Instagram profile.
// This is the most reliable Instagram discovery method: restaurants link to their
// own account, so no name-matching ambiguity, no Tavily crawler limitations.
//
// Falls back to Tavily only when no website is available or no link is found.
async function findInstagramFromWebsite(websiteUrl, restaurant) {
  let res;
  try {
    res = await fetch(websiteUrl, {
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RestaurantBot/1.0)' },
      signal: AbortSignal.timeout(VALIDATE_TIMEOUT_MS),
      redirect: 'follow',
    });
  } catch { return null; }

  if (!res.ok) return null;

  const html = await res.text().catch(() => '');

  // Extract all instagram.com hrefs from the page
  const matches = [...html.matchAll(/https?:\/\/(?:www\.)?instagram\.com\/([a-zA-Z0-9._]{1,60})\/?/g)];
  const NON_PROFILE = new Set(['p', 'reel', 'reels', 'explore', 'stories', 'tv', 'accounts', 'directory', 'shoppingcart']);

  for (const match of matches) {
    const slug = match[1].split('?')[0].replace(/\/$/, '');  // strip query params / trailing slash
    if (slug.length < 3) continue;
    if (NON_PROFILE.has(slug)) continue;
    // Normalise to canonical profile URL
    const profileUrl = `https://www.instagram.com/${slug}/`;
    if (isValidInstagram(profileUrl, restaurant)) return profileUrl;
  }

  return null;
}

// ── API callers ───────────────────────────────────────────

// Calls Tavily. Pass an empty includeDomains array (default) for a broad global search.
async function tavilySearch(query, includeDomains = []) {
  const body = {
    api_key:        TAVILY_API_KEY,
    query,
    search_depth:   'basic',
    max_results:    MAX_RESULTS,
    include_answer: false,
  };
  // Only add include_domains when non-empty — omitting it searches everything
  if (includeDomains.length > 0) body.include_domains = includeDomains;

  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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

// Validates a Tavily reservation result using both URL structure AND result content.
// Extends isValidReservation() to catch same-chain different-location results
// (e.g. "P.J. Clarke's on the Hudson" when we want the Hudson Yards location).
//
// For multi-word location signals, ALL tokens must appear somewhere in
// the combined URL path + result title + result content. This AND logic is the
// key: "Hudson Yards" requires both "hudson" AND "yards", so "on the Hudson"
// (which has "hudson" but not "yards") is correctly rejected.
function isValidReservationResult(result, restaurant) {
  if (!isValidReservation(result.url, restaurant)) return false;

  // Derive location signal: prefer area (most specific), then district, then address
  const locationSignal = restaurant.area || restaurant.district || restaurant.address || null;
  if (!locationSignal) return true;  // no location data — URL check is enough

  const locTokens = locationSignal.toLowerCase().split(/\s+/).filter(t => t.length > 3);
  if (locTokens.length === 0) return true;

  const urlPath  = (() => { try { return new URL(result.url).pathname.toLowerCase(); } catch { return ''; } })();
  const combined = `${urlPath} ${(result.title || '').toLowerCase()} ${(result.content || '').toLowerCase()}`;

  if (locTokens.length > 1) {
    // AND logic: every token must appear — prevents partial location matches
    return locTokens.every(t => combined.includes(t));
  } else {
    return locTokens.some(t => combined.includes(t));
  }
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
  // No area/district set (e.g. restaurants seeded before pipeline enrichment).
  // Use the street address as the location signal to disambiguate multi-location
  // chains (e.g. "P.J. Clarke's" at "4 Hudson Yards" vs "on the Hudson").
  if (restaurant.address) {
    return `"${restaurant.name}" "${restaurant.address}" New York reservation`;
  }
  return `"${restaurant.name}" New York City reservation`;
}

// ── Main ──────────────────────────────────────────────────

async function main() {
  // ── CLI flags ─────────────────────────────────────────
  const args         = process.argv.slice(2);
  const isDryRun     = args.includes('--dry-run');
  const isForce      = args.includes('--force');
  const skipValidate = args.includes('--skip-validate');
  const idArg        = args.find(a => a.startsWith('--id='));
  const targetId     = idArg ? parseInt(idArg.split('=')[1], 10) : null;
  const fieldArg     = args.find(a => a.startsWith('--field='));
  const targetField  = fieldArg ? fieldArg.split('=')[1] : null;

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
  console.log('  mode     :', isDryRun ? 'dry-run (no writes)' : 'live');
  console.log('  force    :', isForce ? 'yes (re-discover all; preserve if not found)' : 'no');
  console.log('  validate :', isForce ? 'skipped (--force)' : skipValidate ? 'skipped (--skip-validate)' : 'yes (check existing links before skipping)');
  console.log('  fields   :', activeFields.join(', '));
  if (targetId) console.log('  target   : restaurant id', targetId);
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
    console.log(`[${restaurant.id}] ${restaurant.name}`);

    const updates = {};
    let madeGoogleCall = false;
    let madeTavilyCall = false;

    // ── Per-field helper ──────────────────────────────
    // Determines whether a field needs (re)discovery.
    // Returns: 'discover' | 'keep' | 'keep-validated'
    // Also logs the decision and queues a null update if validation fails
    // and we know the stored value is bad.
    async function fieldStatus(fieldName, existing) {
      if (!existing) return 'discover';         // null/empty → always discover
      if (isForce)   return 'discover';         // --force → always re-discover
      if (skipValidate) {
        console.log(`      ${fieldName.padEnd(11)}: skip (already set): ${existing}`);
        return 'keep';
      }
      // Validate the stored link
      const check = await validateLink(existing, restaurant, fieldName);
      if (check.valid) {
        console.log(`      ${fieldName.padEnd(11)}: ok (validated): ${existing}`);
        return 'keep-validated';
      }
      console.log(`      ${fieldName.padEnd(11)}: stale (${check.reason}) — re-discovering`);
      return 'discover';
    }

    // ── website ──────────────────────────────────────
    if (doWebsite) {
      const status = await fieldStatus('website', restaurant.website);
      if (status === 'discover') {
        let found = false;

        // Step 1: raw_places cache — validate before trusting.
        // The cache may be stale if the restaurant was renamed (e.g. Nizuc → Talavera):
        // the old website would pass the restaurant_id lookup but fail the name check.
        const cached = rawWebsiteMap[restaurant.id];
        if (cached) {
          if (skipValidate) {
            updates.website = cached;
            console.log(`      website    : found (raw_places cache): ${cached}`);
            found = true;
          } else {
            const cacheCheck = await validateLink(cached, restaurant, 'website');
            if (cacheCheck.valid) {
              updates.website = cached;
              console.log(`      website    : found (raw_places cache, validated): ${cached}`);
              found = true;
            } else {
              console.log(`      website    : raw_places cache stale (${cacheCheck.reason}) — trying Google Places`);
            }
          }
        }

        // Step 2: Google Places API
        if (!found) {
          try {
            const url = await googlePlacesTextSearch(restaurant.name, restaurant.address || '');
            madeGoogleCall = true;
            if (url) {
              updates.website = url;
              console.log(`      website    : found (Google Places): ${url}`);
              found = true;
            }
          } catch (err) {
            console.error(`      website    : Google Places ERROR: ${err.message}`);
          }
        }

        // Step 3: Tavily web search as final fallback.
        // Handles cases where the Google Places listing lags behind a restaurant
        // rename (e.g. still indexed as "NIZUC" when searching "Talavera").
        if (!found) {
          // Domains that are never the restaurant's own website
          const NON_WEBSITE_DOMAINS = [
            'yelp.com', 'tripadvisor.com', 'opentable.com', 'resy.com', 'tock.com',
            'exploretock.com', 'sevenrooms.com', 'instagram.com', 'facebook.com',
            'twitter.com', 'x.com', 'google.com', 'maps.google.com',
            'eater.com', 'ny.eater.com', 'theinfatuation.com', 'nytimes.com',
            'timeout.com', 'grubhub.com', 'doordash.com', 'ubereats.com',
            'seamless.com', 'guide.michelin.com', 'bonappetit.com', 'vogue.com',
          ];
          const loc = restaurant.area || restaurant.district || restaurant.address;
          const wsQuery = loc
            ? `"${restaurant.name}" restaurant "${loc}" official website`
            : `"${restaurant.name}" restaurant New York City official website`;
          try {
            const results = await tavilySearch(wsQuery);
            madeTavilyCall = true;
            const normalise = s => s.replace(/[''`\u2018\u2019]/g, '').replace(/[^a-z0-9\s]/g, ' ');
            const tokens = nameTokens(restaurant.name);
            for (const result of results) {
              let hostname;
              try { hostname = new URL(result.url).hostname.replace(/^www\./, ''); } catch { continue; }
              if (NON_WEBSITE_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d))) continue;
              const titleNorm = normalise((result.title || '').toLowerCase());
              if (!tokens.some(t => titleNorm.includes(t))) continue;
              updates.website = result.url;
              console.log(`      website    : found (Tavily): ${result.url}`);
              found = true;
              break;
            }
          } catch (err) {
            console.error(`      website    : Tavily ERROR: ${err.message}`);
          }
        }

        if (!found) {
          if (isForce && restaurant.website) {
            console.log(`      website    : force-kept (not found): ${restaurant.website}`);
          } else if (restaurant.website) {
            updates.website = null;
            console.log('      website    : not found — clearing stale value');
          } else {
            console.log('      website    : not found');
          }
        }
      }
    }

    // ── instagram ────────────────────────────────────
    if (doInstagram) {
      const status = await fieldStatus('instagram', restaurant.instagram);
      if (status === 'discover') {
        let igUrl = null;

        // Step 1: Scrape the restaurant's own website for an Instagram link.
        // This is more reliable than Tavily — Instagram blocks crawlers, but
        // restaurants link to their own account from their website footer/nav.
        const knownWebsite = updates.website || restaurant.website;
        if (knownWebsite) {
          igUrl = await findInstagramFromWebsite(knownWebsite, restaurant);
          if (igUrl) console.log(`      instagram  : found (website scrape): ${igUrl}`);
        }

        // Step 2: Broad Tavily search as fallback.
        // Using no include_domains filter so Tavily searches everything — review
        // sites, Google My Business snippets, and news articles frequently mention
        // Instagram handles even when Instagram.com itself is not indexed. We scan
        // both the result URLs and the content snippets for instagram.com links.
        if (!igUrl) {
          const query = buildInstagramQuery(restaurant);
          try {
            const results = await tavilySearch(query);  // no domain filter
            madeTavilyCall = true;

            // Check result URLs first (direct instagram.com hits)
            for (const r of results) {
              if (r.url.includes('instagram.com') && isValidInstagram(r.url, restaurant)) {
                igUrl = r.url;
                break;
              }
            }

            // Then scan content snippets for instagram.com mentions
            if (!igUrl) {
              const NON_PROFILE = new Set(['p', 'reel', 'reels', 'explore', 'stories', 'tv', 'accounts', 'directory']);
              for (const r of results) {
                const text = `${r.url} ${r.title || ''} ${r.content || ''}`;
                const matches = [...text.matchAll(/instagram\.com\/([a-zA-Z0-9._]{3,60})\/?/g)];
                for (const m of matches) {
                  const slug = m[1].split('?')[0].replace(/\/$/, '');
                  if (NON_PROFILE.has(slug)) continue;
                  const profileUrl = `https://www.instagram.com/${slug}/`;
                  if (isValidInstagram(profileUrl, restaurant)) {
                    igUrl = profileUrl;
                    break;
                  }
                }
                if (igUrl) break;
              }
            }

            if (igUrl) console.log(`      instagram  : found (Tavily): ${igUrl}`);
          } catch (err) {
            console.error(`      instagram  : Tavily ERROR: ${err.message}`);
          }
          await sleep(TAVILY_DELAY_MS);
        }

        if (igUrl) {
          updates.instagram = igUrl;
        } else if (isForce && restaurant.instagram) {
          console.log(`      instagram  : force-kept (not found): ${restaurant.instagram}`);
        } else {
          updates.instagram = null;
          console.log('      instagram  : not found — clearing stale value');
        }
      }
    }

    // ── reservation ───────────────────────────────────
    if (doReservation) {
      const status = await fieldStatus('reservation', restaurant.reservation);
      if (status === 'discover') {
        const query = buildReservationQuery(restaurant);
        try {
          const results = await tavilySearch(query, RESERVATION_DOMAINS);
          madeTavilyCall = true;
          const match = results.find(r => isValidReservationResult(r, restaurant));
          if (match) {
            updates.reservation = match.url;
            console.log(`      reservation: found: ${match.url}`);
          } else if (isForce && restaurant.reservation) {
            console.log(`      reservation: force-kept (not found): ${restaurant.reservation}`);
          } else {
            updates.reservation = null;  // known-bad, nothing found → clear it
            console.log('      reservation: not found — clearing stale value');
          }
        } catch (err) {
          console.error(`      reservation: ERROR: ${err.message}`);
        }
        await sleep(TAVILY_DELAY_MS);
      }
    }

    // ── Write to DB ───────────────────────────────────
    // Always write links_fetched_at to record that this restaurant was checked,
    // even if all existing links validated fine and nothing changed.
    updates.links_fetched_at = new Date().toISOString();

    if (!isDryRun) {
      const { error: uErr } = await supabase
        .from('restaurants')
        .update(updates)
        .eq('id', restaurant.id);

      if (uErr) {
        console.error(`      DB error: ${uErr.message}`);
        totalSkipped++;
      } else {
        totalUpdated++;
      }
    } else {
      const fieldUpdates = Object.entries(updates).filter(([k]) => k !== 'links_fetched_at');
      if (fieldUpdates.length > 0) {
        console.log('      [dry-run] would update:', JSON.stringify(Object.fromEntries(fieldUpdates), null, 6));
      }
      totalUpdated++;
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
