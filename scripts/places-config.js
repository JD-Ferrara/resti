// ============================================================
// places-config.js — Central config for the Google Places pipeline
// ============================================================
// Edit this file to add new search areas, tune filter thresholds,
// or adjust chain exclusion / QSR allowlists.

// ── Search Areas ─────────────────────────────────────────
// Each area defines a geographic anchor + radius for Nearby Search.
// Add new entries here as you expand beyond Hudson Yards.
export const SEARCH_AREAS = {
  hudson_yards: {
    name: 'Hudson Yards',
    lat: 40.7534,
    lng: -74.0018,
    radius: 800,          // meters — covers Hudson Yards + Manhattan West
    // NYC NTA polygon(s) used to clip results to the actual district boundary.
    // Any place whose detected district doesn't match one of these is excluded.
    nta_names: ['Hudson Yards-Chelsea-Flat Iron-Union Square'],
  },
  chelsea: {
    name: 'Chelsea',
    lat: 40.7465,
    lng: -74.0014,
    radius: 900,
    nta_names: ['Chelsea', 'Hudson Yards-Chelsea-Flat Iron-Union Square'],
  },
  hells_kitchen: {
    name: "Hell's Kitchen",
    lat: 40.7614,
    lng: -73.9934,
    radius: 800,
    nta_names: ["Hell's Kitchen", 'Clinton'],
  },
  west_village: {
    name: 'West Village',
    lat: 40.7337,
    lng: -74.0063,
    radius: 700,
    nta_names: ['West Village', 'Greenwich Village-West'],
  },
  soho: {
    name: 'SoHo',
    lat: 40.7233,
    lng: -74.0030,
    radius: 700,
    nta_names: ['SoHo-TriBeCa-Civic Center-Little Italy'],
  },
  lower_east_side: {
    name: 'Lower East Side',
    lat: 40.7153,
    lng: -73.9862,
    radius: 700,
    nta_names: ['Lower East Side'],
  },
  tribeca: {
    name: 'Tribeca',
    lat: 40.7163,
    lng: -74.0086,
    radius: 700,
    nta_names: ['SoHo-TriBeCa-Civic Center-Little Italy'],
  },
  flatiron: {
    name: 'Flatiron',
    lat: 40.7410,
    lng: -73.9897,
    radius: 700,
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
export const NYC_GEOJSON_URL =
  'https://data.cityofnewyork.us/api/geospatial/cpf4-rkhq?method=export&type=GeoJSON';

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
