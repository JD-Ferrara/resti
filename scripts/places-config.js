// ============================================================
// places-config.js — Central config for the Google Places pipeline
// ============================================================
// Edit this file to add new search areas, tune filter thresholds,
// or adjust chain exclusion / QSR allowlists.

// ── Search Areas ─────────────────────────────────────────
// Each area defines a name, NTA boundary filter, and one or more searchPoints.
// searchPoints is an array of {lat, lng, radius} circles — the API is called
// for each point independently (up to 60 results each) and results are merged
// + deduplicated by google_place_id. Use multiple points for dense neighborhoods
// to work around the Google Places 60-result-per-circle cap.
export const SEARCH_AREAS = {
  hudson_yards: {
    name: 'Hudson Yards',
    // 4-point grid covering 30th–42nd St, 9th–12th Ave at 450m radius each.
    // Replaces the old single 800m circle (60 results) with up to 240 results.
    searchPoints: [
      { lat: 40.7480, lng: -74.0065, radius: 450 }, // SW — The Shops at HY / 11th Ave
      { lat: 40.7480, lng: -73.9975, radius: 450 }, // SE — Manhattan West / 9th Ave
      { lat: 40.7565, lng: -74.0065, radius: 450 }, // NW — Javits / upper 11th Ave
      { lat: 40.7565, lng: -73.9975, radius: 450 }, // NE — upper 9th Ave / Midtown West
    ],
    nta_names: ['Hudson Yards-Chelsea-Flat Iron-Union Square'],
  },
  chelsea: {
    name: 'Chelsea',
    // 4-point grid covering 14th–30th St, 7th–11th Ave at 450m radius each.
    searchPoints: [
      { lat: 40.7410, lng: -74.0050, radius: 450 }, // SW — lower Chelsea / 10th Ave
      { lat: 40.7410, lng: -73.9960, radius: 450 }, // SE — lower Chelsea / 8th Ave
      { lat: 40.7490, lng: -74.0050, radius: 450 }, // NW — upper Chelsea / 10th Ave
      { lat: 40.7490, lng: -73.9960, radius: 450 }, // NE — upper Chelsea / 8th Ave
    ],
    nta_names: ['Chelsea', 'Hudson Yards-Chelsea-Flat Iron-Union Square'],
  },
  hells_kitchen: {
    name: "Hell's Kitchen",
    // 2-point grid covering 42nd–57th St, 8th–12th Ave.
    searchPoints: [
      { lat: 40.7565, lng: -73.9970, radius: 400 }, // South — 42nd–48th St
      { lat: 40.7640, lng: -73.9970, radius: 400 }, // North — 50th–57th St
    ],
    nta_names: ["Hell's Kitchen", 'Clinton'],
  },
  west_village: {
    name: 'West Village',
    searchPoints: [{ lat: 40.7337, lng: -74.0063, radius: 700 }],
    nta_names: ['West Village', 'Greenwich Village-West'],
  },
  soho: {
    name: 'SoHo',
    searchPoints: [{ lat: 40.7233, lng: -74.0030, radius: 700 }],
    nta_names: ['SoHo-TriBeCa-Civic Center-Little Italy'],
  },
  noho: {
    name: 'NoHo / Greenwich Village',
    searchPoints: [{ lat: 40.7270, lng: -73.9950, radius: 650 }],
    nta_names: ['Greenwich Village', 'Greenwich Village-West', 'SoHo-TriBeCa-Civic Center-Little Italy'],
  },
  lower_east_side: {
    name: 'Lower East Side',
    searchPoints: [{ lat: 40.7153, lng: -73.9862, radius: 700 }],
    nta_names: ['Lower East Side'],
  },
  tribeca: {
    name: 'Tribeca',
    searchPoints: [{ lat: 40.7163, lng: -74.0086, radius: 700 }],
    nta_names: ['SoHo-TriBeCa-Civic Center-Little Italy'],
  },
  flatiron: {
    name: 'Flatiron',
    searchPoints: [{ lat: 40.7410, lng: -73.9897, radius: 700 }],
    nta_names: ['Flatiron', 'Hudson Yards-Chelsea-Flat Iron-Union Square'],
  },
};

// ── Quality Filters ──────────────────────────────────────
export const FILTERS = {
  minRating: 3.5,     // exclude anything rated below this
  minReviews: 25,     // catches newer spots that haven't accumulated many reviews yet
};

// ── Chain Exclusion List ─────────────────────────────────
// Exact name match (case-sensitive). Places whose displayName.text exactly
// matches one of these strings are excluded — unless also in DESTINATION_QSR.
export const EXCLUDED_CHAINS = new Set([
  // Fast food
  "McDonald's",
  'Subway',
  'Burger King',
  "Wendy's",
  'Taco Bell',
  'KFC',
  'Pizza Hut',
  "Domino's",
  "Papa John's",
  'Little Caesars',
  'Popeyes',
  'Chick-fil-A',
  'Five Guys',
  "Jersey Mike's",
  "Jimmy John's",
  'Firehouse Subs',
  'Wingstop',
  "Raising Cane's",
  'Whataburger',
  'Hardees',

  // Coffee / fast casual
  'Starbucks',
  "Dunkin'",
  'Dunkin Donuts',
  'Tim Hortons',
  'Pret a Manger',
  'Le Pain Quotidien',

  // Fast casual
  'Chipotle',
  'Chipotle Mexican Grill',
  'Panera Bread',
  'Panda Express',
  'Sweetgreen',
  'Dig',
  'Cosi',
  'Quiznos',
  "Arby's",

  // Snacks / dessert chains
  "Auntie Anne's",
  'Cinnabon',
  'Jamba',
  'Jamba Juice',
  'Cold Stone Creamery',
  "Baskin-Robbins",

  // Casual dining chains (not destination-worthy)
  'Applebee\'s',
  "Denny's",
  'IHOP',
  'Olive Garden',
  "Chili's",
  "T.G.I. Friday's",
  'Red Lobster',
  'Outback Steakhouse',
  'Buffalo Wild Wings',
  "Hooters",
]);

// ── Destination QSR Allowlist ────────────────────────────
// These are chains or chain-adjacent spots we WANT in the database —
// they're actual destinations with quality food, just quick-service leaning.
// A place here will pass the chain filter even if it appears in EXCLUDED_CHAINS
// (it won't, since these aren't listed above — but this acts as an explicit
// "always include" safeguard for future edge cases).
export const DESTINATION_QSR = new Set([
  'Shake Shack',
  'Fuku',
  'Eataly',                 // technically a chain but a genuine destination
  'Roberta\'s',
  "Joe's Pizza",
  "J.G. Melon",
  'Superiority Burger',
  'Dirt Candy',
  'Smash Burger',           // not the chain — hypothetical standalone
]);

// ── Google Places Field Mask ─────────────────────────────
// Controls which fields are returned by the API (and billed accordingly).
// See: https://developers.google.com/maps/documentation/places/web-service/place-data-fields
export const PLACES_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.rating',
  'places.userRatingCount',
  'places.priceLevel',
  'places.websiteUri',
  'places.nationalPhoneNumber',
  'places.regularOpeningHours',
  'places.types',
  'places.businessStatus',
  'places.editorialSummary',
  'places.outdoorSeating',
  'places.reservable',
  'places.servesBeer',
  'places.servesWine',
  'places.servesBreakfast',
  'places.servesLunch',
  'places.servesDinner',
  'places.takeout',
  'places.delivery',
  'places.dineIn',
  'places.photos',
  'places.currentOpeningHours',
].join(',');

// ── NYC GeoJSON ──────────────────────────────────────────
// NYC Open Data — Neighborhood Tabulation Areas (NTA) boundaries
// Used by detect-neighborhood.js for turf.js point-in-polygon checks.
// Fetched once and cached to scripts/cache/nyc-neighborhoods.geojson
// Using the Socrata resource endpoint — more stable than the geospatial export URL.
// $limit=5000 ensures all ~260 NTA features are returned (default cap is 1000).
export const NYC_GEOJSON_URL =
  'https://data.cityofnewyork.us/resource/cpf4-rkhq.geojson?$limit=5000';

// Broader neighborhood area groupings — maps NTA names to a human-readable area label.
// Add more NTA names as you expand to new areas.
export const NEIGHBORHOOD_AREA_MAP = {
  'Hudson Yards-Chelsea-Flat Iron-Union Square': 'Midtown West / Chelsea',
  'Chelsea':               'Chelsea',
  "Hell's Kitchen":        "Hell's Kitchen",
  'Clinton':               "Hell's Kitchen",
  'West Village':          'West Village',
  'Greenwich Village-West':'West Village',
  'SoHo-TriBeCa-Civic Center-Little Italy': 'SoHo / Tribeca',
  'Lower East Side':       'Lower East Side',
  'Chinatown':             'Chinatown / LES',
  'Flatiron':              'Flatiron',
  'Midtown-Midtown South': 'Midtown',
  'Stuyvesant Town-Cooper Village': 'Gramercy',
  'Gramercy':              'Gramercy',
  'Murray Hill-Kip\'s Bay':'Murray Hill',
  'Upper West Side':       'Upper West Side',
  'Upper East Side-Carnegie Hill': 'Upper East Side',
  'Williamsburg':          'Williamsburg',
  'Greenpoint':            'Greenpoint',
  'DUMBO-Vinegar Hill-Downtown Brooklyn-Boerum Hill': 'DUMBO / Brooklyn Heights',
};
