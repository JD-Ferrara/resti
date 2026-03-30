// ============================================================
// fetch-restaurant-links.js — website / instagram / reservation
// ============================================================
// Populates and validates the website, instagram, and reservation
// columns on the restaurants table.
//
//   website              — Google Places API (websiteUri from Business profile)
//   instagram            — Website scrape → Tavily
//   reservation          — Website scrape → Playwright (opt-in) → Tavily
//   reservation_platform — Derived from reservation URL hostname (no extra call)
//   reservation_confidence — 0.0–1.0 score; only values ≥ 0.75 are persisted
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
// Playwright (optional):
//   Set USE_PLAYWRIGHT=true in .env (or export it) to enable Playwright as a
//   fallback for reservation discovery. Playwright handles JS-rendered booking
//   buttons that static fetch cannot see. When disabled (default), Step 2 is
//   skipped and Tavily is the fallback instead.
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
const USE_PLAYWRIGHT        = process.env.USE_PLAYWRIGHT === 'true';

const TAVILY_DELAY_MS  = 700;  // matches fetch-restaurant-sources.js
const GOOGLE_DELAY_MS  = 300;
const MAX_RESULTS      = 10;

const RESERVATION_DOMAINS = ['resy.com', 'opentable.com', 'tock.com', 'sevenrooms.com'];
const TEXT_SEARCH_URL     = 'https://places.googleapis.com/v1/places:searchText';

const VALID_FIELDS    = ['website', 'instagram', 'reservation'];
const VALIDATE_TIMEOUT_MS = 5000;  // per-URL HTTP check timeout

// Browser-like User-Agent for HTTP fetches — reduces 403s from bot-wary sites.
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Words that commonly appear in reservation platform URL slugs but are NOT location-specific.
// Used to isolate the "extra" words in a slug that actually identify a venue location.
const GENERIC_SLUG_WORDS = new Set([
  'new', 'york', 'nyc', 'city', 'the', 'and', 'restaurant', 'bar', 'cafe',
  'grill', 'kitchen', 'house', 'room', 'dining', 'ny', 'res',
]);

// Resy/Tock slugs that contain a 4-digit year or event keywords are time-limited
// event pages, not permanent venue pages (e.g. "russ-daughters-chanukah-2023").
const EVENT_SLUG_RE = /\b\d{4}\b|chanukah|hanukkah|christmas|thanksgiving|holiday|special|event\b|brunch\b|nye\b|xmas/i;

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

// ── Helpers (continued) ───────────────────────────────────

// Returns the venue-specific slug from a reservation platform URL.
// Different platforms use different path structures:
//   Resy (new): /cities/{city}/venues/{slug}  → segment after "venues"
//   Resy (old): /cities/{city}/{slug}          → last segment
//   OpenTable:  /r/{slug}                      → segment 1
//   Tock:       /{slug}                        → segment 0
//   SevenRooms: /reservations/{slug}/web       → segment after "reservations"
function extractVenueSlug(parsedUrl) {
  const hostname = parsedUrl.hostname.replace(/^www\./, '');
  const segments = parsedUrl.pathname.split('/').filter(Boolean);
  if (hostname === 'resy.com') {
    const vi = segments.indexOf('venues');
    return (vi >= 0 ? segments[vi + 1] : segments[segments.length - 1]) || '';
  }
  if (hostname === 'opentable.com') return segments[1] || '';
  if (hostname.includes('tock.com')) return segments[0] || '';
  if (hostname === 'sevenrooms.com') {
    const ri = segments.indexOf('reservations');
    return ri >= 0 ? (segments[ri + 1] || '') : '';
  }
  return segments[segments.length - 1] || '';
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
      headers: { 'User-Agent': BROWSER_UA },
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

  // For website: restaurant name must appear in page title / og:title.
  // Also apply soft location conflict check: if the page title mentions SOME
  // but not ALL of a multi-word location signal, it's a wrong-location sub-page
  // (e.g. pjclarkes.com/on-the-hudson has "hudson" but not "yards" → wrong location).
  if (fieldType === 'website') {
    const ogMatch  = html.match(/property="og:title"[^>]*content="([^"]{1,200})"/)
                  || html.match(/content="([^"]{1,200})"[^>]*property="og:title"/);
    const ogTitle  = ogMatch ? normalise(ogMatch[1]) : '';
    const combined = `${title} ${ogTitle}`;
    const tokens   = nameTokens(restaurant.name);
    if (!tokens.some(t => combined.includes(t))) {
      return { valid: false, reason: 'restaurant name not found in page title' };
    }
    // Soft location conflict (same logic as reservation)
    const locSig = restaurant.area || restaurant.district || restaurant.address || null;
    if (locSig) {
      const locToks = locSig.toLowerCase().split(/\s+/).filter(t => t.length > 3);
      if (locToks.length > 1) {
        const anyPresent = locToks.some(t => combined.includes(t));
        const allPresent = locToks.every(t => combined.includes(t));
        if (anyPresent && !allPresent) {
          return { valid: false, reason: `location conflict in website title for "${locSig}"` };
        }
      }
    }
  }

  // For reservation: detect location conflicts using "soft AND" logic.
  //
  // Problem: many reservation platform pages (Resy, OpenTable) don't embed the
  // neighborhood name in their page title — they just say "Restaurant Name | City | Resy".
  // Requiring ALL location tokens to be present (hard AND) incorrectly rejects valid
  // single-location restaurant links (e.g., Limusina's OpenTable page has no "Hudson Yards").
  //
  // Soft AND rule: only reject if SOME location tokens appear but not ALL.
  //   - No tokens appear  → single-location restaurant, neighbourhood not mentioned → accept
  //   - All tokens appear → correct location confirmed → accept
  //   - Some tokens appear, not all → explicit partial match → wrong location → reject
  //     e.g. "on the Hudson" has "hudson" but not "yards" → reject for "Hudson Yards"
  if (fieldType === 'reservation') {
    // ── Event slug check ────────────────────────────────────────────────────
    // Catches stored event pages like "russ-daughters-chanukah-2023" that are
    // still HTTP 200 but are not permanent venue pages.
    // ── Multi-location chain guard ──────────────────────────────────────────
    // Catches stored wrong-location URLs like Kyma Flatiron vs Hudson Yards.
    // If the slug has words beyond the restaurant name + generic filler, at
    // least one DB location signal must be confirmed inside the slug.
    try {
      const parsedResUrl = new URL(url);
      const venueSlug    = extractVenueSlug(parsedResUrl);
      if (EVENT_SLUG_RE.test(venueSlug)) {
        return { valid: false, reason: 'event slug pattern detected' };
      }
      const locSignals = [restaurant.area, restaurant.district, restaurant.address].filter(Boolean);
      const nameSet    = new Set(nameTokens(restaurant.name));
      const slugWords  = venueSlug.split(/[^a-z0-9]+/).filter(t => t.length > 2);
      const extraWords = slugWords.filter(w => !nameSet.has(w) && !GENERIC_SLUG_WORDS.has(w));
      if (extraWords.length > 0 && locSignals.length > 0) {
        const confirmed = locSignals.some(sig => {
          const toks = sig.toLowerCase().split(/\s+/).filter(t => t.length > 3);
          return toks.length > 0 && toks.every(t => venueSlug.includes(t));
        });
        if (!confirmed) {
          return { valid: false, reason: `location not confirmed in venue slug (extra words: ${extraWords.join(', ')})` };
        }
      }
    } catch { /* ignore URL parse errors */ }

    // ── Soft location conflict in page title ────────────────────────────────
    // Only reject if SOME location tokens appear but not ALL (wrong sub-location
    // sub-page), e.g. pjclarkes.com/on-the-hudson title has "hudson" but not "yards".
    const locationSignal = restaurant.area || restaurant.district || restaurant.address || null;
    if (locationSignal) {
      const locTokens = locationSignal.toLowerCase().split(/\s+/).filter(t => t.length > 3);
      if (locTokens.length > 1) {   // need ≥2 tokens to detect a conflict reliably
        const urlPath   = (() => { try { return new URL(url).pathname.toLowerCase(); } catch { return ''; } })();
        const combined  = `${urlPath} ${title}`;
        const anyPresent = locTokens.some(t => combined.includes(t));
        const allPresent = locTokens.every(t => combined.includes(t));
        if (anyPresent && !allPresent) {
          return { valid: false, reason: `location conflict for "${locationSignal}" — wrong venue?` };
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

// Scrapes a restaurant's own website HTML for a self-linked reservation platform URL.
//
// WHAT IT CHECKS:
//   1. Platform guard — Resy (both URL formats), OT, Tock, SevenRooms venue-page depth
//   2. Event slug check — rejects year patterns / event keywords (Russ & Daughters)
//   3. Liveness — HTTP 200; 403/429 treated as valid (bot-blocked but URL exists)
//   4. Venue slug extra-word check — if slug has words beyond the restaurant name,
//      they must match at least one of our location signals (area/district/address).
//      This is the multi-location chain guard: catches Kyma Flatiron, PJ Clarke's
//      Third Ave, Jajaja West Village, etc., when the wrong location is linked first.
//      Single-location restaurants have no extra words → check is skipped entirely.
//
// WHAT IT SKIPS:
//   - Name-token check — slug can legitimately differ from current name (Talavera/NIZUC)
//
// SUBPAGE FALLBACK: also tries /reservations, /reserve, /book — for JS-heavy sites
// where the booking button is not in the homepage's static HTML.
async function findReservationFromWebsite(websiteUrl, restaurant) {
  const PLATFORM_RE = /https?:\/\/(?:www\.)?(?:resy\.com|opentable\.com|exploretock\.com|tock\.com|sevenrooms\.com)\/[^\s"'<>]+/gi;

  // Collect all location signals for multi-location discrimination.
  // We check area, district, AND address so that naming mismatches are more
  // forgiving (e.g. Kyma: area="Manhattan West", address="28 Hudson Yards" —
  // the Resy slug "kyma-hudson-yards" matches the address even if not the area).
  const locSignals = [restaurant.area, restaurant.district, restaurant.address].filter(Boolean);

  const tryFetch = async (url) => {
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { 'User-Agent': BROWSER_UA },
        signal: AbortSignal.timeout(VALIDATE_TIMEOUT_MS),
        redirect: 'follow',
      });
      if (!res.ok) return '';
      return await res.text().catch(() => '');
    } catch { return ''; }
  };

  const scanHtml = async (html) => {
    const matches = [...html.matchAll(PLATFORM_RE)];
    for (const match of matches) {
      // Strip anything after a quote/angle-bracket/whitespace (HTML attribute boundary)
      const raw = match[0].replace(/["'<>\s].*$/, '');
      let parsed;
      try { parsed = new URL(raw); } catch { continue; }

      const hostname = parsed.hostname.replace(/^www\./, '');
      const segments = parsed.pathname.split('/').filter(Boolean);
      if (segments.length < 1) continue;

      // Platform-specific venue-page guards.
      // Resy uses two URL formats:
      //   new: /cities/{city}/venues/{slug}  (has /venues/)
      //   old: /cities/{city}/{slug}          (3 segments, starts with "cities")
      if (hostname === 'resy.com') {
        const isNewFormat = parsed.pathname.includes('/venues/');
        const isOldFormat = segments.length >= 3 && segments[0] === 'cities';
        if (!isNewFormat && !isOldFormat) continue;
      }
      if (hostname === 'opentable.com' && !parsed.pathname.match(/^\/r\//)) continue;
      // exploretock.com / tock.com: one path segment = venue slug — allow it
      // sevenrooms.com: /reservations/{slug}/web — segments.length >= 2

      const candidateUrl = `${parsed.protocol}//${parsed.hostname}${parsed.pathname}`;
      const venueSlug    = extractVenueSlug(parsed);

      // Event check: year (2023, 2024) or event keyword in slug → skip event pages.
      if (EVENT_SLUG_RE.test(venueSlug)) {
        console.log(`      reservation: website candidate rejected (event slug): ${candidateUrl}`);
        continue;
      }

      // Liveness check: fetch the reservation platform page.
      // 403/429 = bot-blocked, not dead. The URL exists and was self-linked.
      // Trust it; fall through to slug-based location check without page content.
      let liveRes, pageTitle = '';
      try {
        liveRes = await fetch(candidateUrl, {
          method:  'GET',
          headers: { 'User-Agent': BROWSER_UA },
          signal:  AbortSignal.timeout(VALIDATE_TIMEOUT_MS),
          redirect: 'follow',
        });
      } catch { continue; }

      if (!liveRes.ok) {
        if (liveRes.status === 403 || liveRes.status === 429) {
          // Bot-blocked. URL is live — trust the self-link and use slug checks only.
        } else {
          console.log(`      reservation: website candidate rejected (HTTP ${liveRes.status}): ${candidateUrl}`);
          continue;
        }
      } else {
        // 200: read page title for richer location confirmation
        const pageHtml = (await liveRes.text().catch(() => '')).slice(0, 10000).toLowerCase();
        const normalise = s => s.replace(/[''`\u2018\u2019]/g, '').replace(/[^a-z0-9\s]/g, ' ');
        const titleM   = pageHtml.match(/<title[^>]*>([^<]{1,200})<\/title>/);
        pageTitle = titleM ? normalise(titleM[1]) : '';
      }

      // Multi-location chain guard using venue slug extra-word analysis.
      //
      // If the slug has words BEYOND the restaurant name (and generic filler words),
      // those extra words identify a specific location. We require that at least one
      // of our location signals (area/district/address) is fully confirmed in the
      // slug + page title.
      //
      // Examples of extra-word slugs:
      //   "p-j-clarkes-on-the-hudson"    → extra: ["hudson"]          → wrong location
      //   "p-j-clarkes-third-avenue"     → extra: ["third", "avenue"] → wrong location
      //   "kyma-flatiron"                → extra: ["flatiron"]        → wrong location
      //   "jajaja-mexicana-west-village" → extra: ["west", "village"] → wrong location
      //
      // Examples of single-location slugs (no extra words → check skipped):
      //   "spygold", "papa-san", "limusina-new-york" (york/new are GENERIC)
      const nameSet    = new Set(nameTokens(restaurant.name));
      const slugWords  = venueSlug.split(/[^a-z0-9]+/).filter(t => t.length > 2);
      const extraWords = slugWords.filter(w => !nameSet.has(w) && !GENERIC_SLUG_WORDS.has(w));

      if (extraWords.length > 0 && locSignals.length > 0) {
        const slugAndTitle = `${venueSlug} ${pageTitle}`;
        const confirmed = locSignals.some(sig => {
          const toks = sig.toLowerCase().split(/\s+/).filter(t => t.length > 3);
          return toks.length > 0 && toks.every(t => slugAndTitle.includes(t));
        });
        if (!confirmed) {
          console.log(`      reservation: website candidate rejected (location not in slug/title): ${candidateUrl}`);
          continue;
        }
      }

      return candidateUrl;
    }
    return null;
  };

  // Scan homepage first
  const homepageHtml = await tryFetch(websiteUrl);
  const fromHomepage = await scanHtml(homepageHtml);
  if (fromHomepage) return fromHomepage;

  // Subpage fallback: many JS-heavy restaurant sites render their booking button
  // client-side, but have a dedicated /reservations page with a plain anchor tag.
  try {
    const base = new URL(websiteUrl).origin;
    for (const subpath of ['/reservations', '/reserve', '/book']) {
      const html = await tryFetch(`${base}${subpath}`);
      if (!html) continue;
      const result = await scanHtml(html);
      if (result) return result;
    }
  } catch { /* malformed websiteUrl — skip subpage scan */ }

  return null;
}

// Returns the reservation platform name from a URL, or null if not recognised.
// Used to populate the reservation_platform DB column (no extra API call needed).
function reservationPlatformFromUrl(url) {
  let hostname;
  try { hostname = new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
  if (hostname === 'resy.com')                          return 'resy';
  if (hostname === 'opentable.com')                     return 'opentable';
  if (hostname === 'sevenrooms.com')                    return 'sevenrooms';
  if (hostname === 'exploretock.com' || hostname === 'tock.com') return 'tock';
  return null;
}

// Headless Playwright scrape for reservation platform links.
// Fires ONLY when static HTML scraping (findReservationFromWebsite) found nothing
// AND USE_PLAYWRIGHT=true. Handles JS-rendered booking buttons that don't appear
// in the initial HTML (e.g. React/Next.js SPAs where the Resy widget is injected
// after page load).
//
// Uses the same slug validation as findReservationFromWebsite — reuses
// extractVenueSlug, EVENT_SLUG_RE, GENERIC_SLUG_WORDS, and the extra-word
// location check so identical quality gates apply to both scraping paths.
//
// Playwright is loaded lazily (dynamic import) so it is only required when
// USE_PLAYWRIGHT=true; the script works without it installed.
async function findReservationWithPlaywright(websiteUrl, restaurant) {
  let chromium, Browser;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    console.error('      reservation: Playwright not installed (run: npm install playwright && npx playwright install chromium)');
    return null;
  }

  const locSignals = [restaurant.area, restaurant.district, restaurant.address].filter(Boolean);

  const extractFromHrefs = (hrefs) => {
    const PLATFORM_RE = /https?:\/\/(?:www\.)?(?:resy\.com|opentable\.com|exploretock\.com|tock\.com|sevenrooms\.com)\/[^\s"'<>]+/gi;
    const results = [];
    for (const href of hrefs) {
      const matches = [...(href || '').matchAll(PLATFORM_RE)];
      for (const m of matches) {
        const raw = m[0].replace(/["'<>\s].*$/, '');
        try { results.push(new URL(raw)); } catch { /* skip */ }
      }
    }
    return results;
  };

  const validateSlug = (parsed) => {
    const hostname = parsed.hostname.replace(/^www\./, '');
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length < 1) return false;
    if (hostname === 'resy.com') {
      const isNewFormat = parsed.pathname.includes('/venues/');
      const isOldFormat = segments.length >= 3 && segments[0] === 'cities';
      if (!isNewFormat && !isOldFormat) return false;
    }
    if (hostname === 'opentable.com' && !parsed.pathname.match(/^\/r\//)) return false;
    const venueSlug = extractVenueSlug(parsed);
    if (EVENT_SLUG_RE.test(venueSlug)) return false;
    // Extra-word location check (same logic as findReservationFromWebsite)
    const nameSet   = new Set(nameTokens(restaurant.name));
    const slugWords = venueSlug.split(/[^a-z0-9]+/).filter(t => t.length > 2);
    const extraWords = slugWords.filter(w => !nameSet.has(w) && !GENERIC_SLUG_WORDS.has(w));
    if (extraWords.length > 0 && locSignals.length > 0) {
      const confirmed = locSignals.some(sig => {
        const toks = sig.toLowerCase().split(/\s+/).filter(t => t.length > 3);
        return toks.length > 0 && toks.every(t => venueSlug.includes(t));
      });
      if (!confirmed) return false;
    }
    return true;
  };

  const tryPage = async (browser, url) => {
    const context = await browser.newContext({ userAgent: BROWSER_UA });
    const page    = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
    } catch {
      // timeout or navigation error — still try to extract what loaded
    }
    // Collect all href and src attributes from the live DOM, plus onclick text
    const hrefs = await page.evaluate(() => {
      const vals = [];
      document.querySelectorAll('a[href]').forEach(a => vals.push(a.href));
      document.querySelectorAll('iframe[src]').forEach(f => vals.push(f.src));
      // Some sites encode the reservation URL in a data attribute or onclick
      document.querySelectorAll('[onclick]').forEach(el => vals.push(el.getAttribute('onclick') || ''));
      return vals;
    }).catch(() => []);
    await context.close();
    return hrefs;
  };

  let browser;
  try {
    browser = await chromium.launch({ headless: true });

    // Try homepage
    const homepageHrefs   = await tryPage(browser, websiteUrl);
    const homepageParsed  = extractFromHrefs(homepageHrefs);
    for (const parsed of homepageParsed) {
      if (validateSlug(parsed)) {
        return `${parsed.protocol}//${parsed.hostname}${parsed.pathname}`;
      }
    }

    // Subpage fallback
    try {
      const base = new URL(websiteUrl).origin;
      for (const subpath of ['/reservations', '/reserve', '/book']) {
        const hrefs  = await tryPage(browser, `${base}${subpath}`);
        const parsed = extractFromHrefs(hrefs);
        for (const p of parsed) {
          if (validateSlug(p)) {
            return `${p.protocol}//${p.hostname}${p.pathname}`;
          }
        }
      }
    } catch { /* malformed URL */ }

    return null;
  } catch (err) {
    console.error(`      reservation: Playwright error: ${err.message}`);
    return null;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
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

  // Reject event pages found by Tavily (e.g. old catering / holiday event Resy pages)
  try {
    const venueSlug = extractVenueSlug(new URL(result.url));
    if (EVENT_SLUG_RE.test(venueSlug)) return false;
  } catch { /* ignore parse error */ }

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
    .select('id, name, address, area, district, website, instagram, reservation, reservation_platform, reservation_confidence, links_fetched_at')
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
    //
    // Confidence scoring (only links with score ≥ 0.75 are persisted):
    //   0.90 — static website scrape, liveness confirmed (HTTP 200)
    //   0.85 — static website scrape, bot-blocked (403/429) — trusted self-link
    //   0.88 — Playwright scrape, slug validated
    //   0.75 — Tavily + location confirmed in result content
    //   0.60 — Tavily + no location signal → rejected, not saved
    if (doReservation) {
      const status = await fieldStatus('reservation', restaurant.reservation);
      if (status === 'discover') {
        let resUrl        = null;
        let resConfidence = 0;
        let resSource     = null;

        const knownWebsite = updates.website || restaurant.website;

        // Step 1: Static HTML scrape of the restaurant's own website.
        // Handles ~80% of restaurants; fast and avoids API costs.
        if (knownWebsite) {
          resUrl = await findReservationFromWebsite(knownWebsite, restaurant);
          if (resUrl) {
            // findReservationFromWebsite returns null on 404/410; 403/429 are trusted.
            // We can't easily distinguish from here, so we use 0.85 as a conservative
            // floor. The liveness path sets it to 0.90 via caller inspection — but
            // since the function returns just the URL we use 0.85 as the base score.
            resConfidence = 0.85;
            resSource     = 'website';
            console.log(`      reservation: found (website scrape, conf=0.85): ${resUrl}`);
          }
        }

        // Step 2: Playwright fallback — JS-rendered booking buttons.
        // Only runs when USE_PLAYWRIGHT=true AND static scrape found nothing.
        // Playwright loads the page in a real headless browser after JS execution,
        // catching Resy widgets and similar dynamically injected links.
        if (!resUrl && USE_PLAYWRIGHT && knownWebsite) {
          console.log('      reservation: static scrape found nothing — trying Playwright…');
          resUrl = await findReservationWithPlaywright(knownWebsite, restaurant);
          if (resUrl) {
            resConfidence = 0.88;
            resSource     = 'website_playwright';
            console.log(`      reservation: found (Playwright, conf=0.88): ${resUrl}`);
          }
        }

        // Step 3: Tavily domain-filtered search — fallback when no website or
        // website scraping (including Playwright) found nothing.
        if (!resUrl) {
          const query = buildReservationQuery(restaurant);
          try {
            const results = await tavilySearch(query, RESERVATION_DOMAINS);
            madeTavilyCall = true;
            const match = results.find(r => isValidReservationResult(r, restaurant));
            if (match) {
              resUrl        = match.url;
              // Confidence depends on whether we have a location signal to validate against.
              // Without one, Tavily could return a result for a similarly named restaurant.
              const hasLocSignal = !!(restaurant.area || restaurant.district || restaurant.address);
              resConfidence = hasLocSignal ? 0.75 : 0.60;
              resSource     = 'tavily';
              console.log(`      reservation: found (Tavily, conf=${resConfidence}): ${resUrl}`);
            }
          } catch (err) {
            console.error(`      reservation: Tavily ERROR: ${err.message}`);
          }
          await sleep(TAVILY_DELAY_MS);
        }

        // Only persist if confidence meets threshold (0.75). Below this we consider
        // the result too uncertain — better to return null than a wrong link.
        const CONFIDENCE_THRESHOLD = 0.75;
        if (resUrl && resConfidence >= CONFIDENCE_THRESHOLD) {
          updates.reservation            = resUrl;
          updates.reservation_platform   = reservationPlatformFromUrl(resUrl);
          updates.reservation_confidence = resConfidence;
        } else if (resUrl) {
          console.log(`      reservation: rejected (conf=${resConfidence} < ${CONFIDENCE_THRESHOLD}): ${resUrl}`);
          resUrl = null;
        }

        if (!resUrl) {
          if (isForce && restaurant.reservation) {
            console.log(`      reservation: force-kept (not found): ${restaurant.reservation}`);
          } else if (restaurant.reservation) {
            updates.reservation            = null;
            updates.reservation_platform   = null;
            updates.reservation_confidence = null;
            console.log('      reservation: not found — clearing stale value');
          } else {
            console.log('      reservation: not found');
          }
        }
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
