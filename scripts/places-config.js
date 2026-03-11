// ============================================================
// places-config.js — Central config for the Google Places pipeline
// ============================================================
// Edit this file to add new search areas, tune filter thresholds,
// or adjust chain exclusion / QSR allowlists.

// ── Search Areas ─────────────────────────────────────────
// Each area has:
//   districtName  — matches the "Name" property in scripts/data/custom-districts.geojson.
//                   Used for polygon-based geographic clipping (authoritative gate) and
//                   stored as custom_district on each place.
//   searchPoints  — array of {lat, lng, radius} circles, fetched independently
//                   and merged+deduplicated. Multiple points defeat the 60-result cap.
//   bounds        — {north, south, east, west} lat/lng bounding box.
//                   Used for grid generation (Hudson Yards) and as a loose reference.
//                   Geographic clipping now uses the custom polygon, not bounds.
//   nta_names     — secondary label used for district/neighborhood_area enrichment.
//                   NOT used for geographic clipping (polygon handles that).
export const SEARCH_AREAS = {
  hudson_yards: {
    name: 'Hudson Yards',
    districtName: 'Hudson Yards',
    // Fine-grained grid mode: auto-generates ~150m-radius circles across the entire
    // bounding box. With ≤5 restaurants per tiny circle, the 60-result cap is never
    // hit — every restaurant in the box is guaranteed to be returned regardless of
    // Google's ranking algorithm.
    gridStepMeters: 150,
    bounds: { north: 40.7570, south: 40.7440, east: -73.9940, west: -74.0145 },
    nta_names: ['Hudson Yards-Chelsea-Flat Iron-Union Square'],
  },
  chelsea: {
    name: 'Chelsea',
    districtName: 'Chelsea',
    // 4-point grid covering 14th–30th St, 7th–11th Ave at 450m radius each.
    searchPoints: [
      { lat: 40.7410, lng: -74.0050, radius: 450 }, // SW — lower Chelsea / 10th Ave
      { lat: 40.7410, lng: -73.9960, radius: 450 }, // SE — lower Chelsea / 8th Ave
      { lat: 40.7490, lng: -74.0050, radius: 450 }, // NW — upper Chelsea / 10th Ave
      { lat: 40.7490, lng: -73.9960, radius: 450 }, // NE — upper Chelsea / 8th Ave
    ],
    bounds: { north: 40.7510, south: 40.7360, east: -73.9880, west: -74.0120 },
    nta_names: ['Chelsea', 'Hudson Yards-Chelsea-Flat Iron-Union Square'],
  },
  meatpacking: {
    name: 'Meatpacking District',
    districtName: 'Meatpacking',
    searchPoints: [{ lat: 40.7403, lng: -74.0057, radius: 500 }],
    bounds: { north: 40.7440, south: 40.7360, east: -73.9990, west: -74.0140 },
    nta_names: ['West Village', 'Hudson Yards-Chelsea-Flat Iron-Union Square'],
  },
  west_village: {
    name: 'West Village',
    districtName: 'West Village',
    searchPoints: [{ lat: 40.7337, lng: -74.0063, radius: 700 }],
    bounds: { north: 40.7400, south: 40.7255, east: -73.9970, west: -74.0170 },
    nta_names: ['West Village', 'Greenwich Village-West'],
  },
  greenwich_village: {
    name: 'Greenwich Village',
    districtName: 'Greenwich Village',
    searchPoints: [{ lat: 40.7308, lng: -74.0000, radius: 700 }],
    bounds: { north: 40.7375, south: 40.7230, east: -73.9880, west: -74.0120 },
    nta_names: ['Greenwich Village', 'Greenwich Village-West'],
  },
  hudson_square: {
    name: 'Hudson Square',
    districtName: 'Hudson Square',
    searchPoints: [{ lat: 40.7265, lng: -74.0082, radius: 600 }],
    bounds: { north: 40.7310, south: 40.7180, east: -74.0000, west: -74.0190 },
    nta_names: ['SoHo-TriBeCa-Civic Center-Little Italy', 'West Village'],
  },
  soho: {
    name: 'SoHo',
    districtName: 'Soho',
    searchPoints: [{ lat: 40.7233, lng: -74.0030, radius: 700 }],
    bounds: { north: 40.7280, south: 40.7170, east: -73.9960, west: -74.0110 },
    nta_names: ['SoHo-TriBeCa-Civic Center-Little Italy'],
  },
  noho: {
    name: 'NoHo / Greenwich Village',
    districtName: 'NoHo',
    searchPoints: [{ lat: 40.7270, lng: -73.9950, radius: 650 }],
    bounds: { north: 40.7320, south: 40.7210, east: -73.9870, west: -74.0030 },
    nta_names: ['Greenwich Village', 'Greenwich Village-West', 'SoHo-TriBeCa-Civic Center-Little Italy'],
  },
  tribeca: {
    name: 'Tribeca',
    districtName: 'Tribeca',
    searchPoints: [{ lat: 40.7163, lng: -74.0086, radius: 700 }],
    bounds: { north: 40.7230, south: 40.7090, east: -74.0000, west: -74.0190 },
    nta_names: ['SoHo-TriBeCa-Civic Center-Little Italy'],
  },
  financial_district: {
    name: 'Financial District',
    districtName: 'Financial District',
    searchPoints: [{ lat: 40.7074, lng: -74.0100, radius: 700 }],
    bounds: { north: 40.7150, south: 40.7000, east: -74.0010, west: -74.0230 },
    nta_names: ['Battery Park City-Lower Manhattan'],
  },
  little_italy: {
    name: 'Little Italy',
    districtName: 'Little Italy',
    searchPoints: [{ lat: 40.7190, lng: -73.9975, radius: 450 }],
    bounds: { north: 40.7230, south: 40.7150, east: -73.9930, west: -74.0040 },
    nta_names: ['SoHo-TriBeCa-Civic Center-Little Italy'],
  },
  chinatown: {
    name: 'Chinatown',
    districtName: 'Chinatown',
    searchPoints: [{ lat: 40.7155, lng: -73.9969, radius: 550 }],
    bounds: { north: 40.7200, south: 40.7100, east: -73.9890, west: -74.0070 },
    nta_names: ['Chinatown'],
  },
  nolita: {
    name: 'NoLita',
    districtName: 'NoLita',
    searchPoints: [{ lat: 40.7226, lng: -73.9939, radius: 450 }],
    bounds: { north: 40.7265, south: 40.7185, east: -73.9885, west: -74.0010 },
    nta_names: ['SoHo-TriBeCa-Civic Center-Little Italy'],
  },
  lower_east_side: {
    name: 'Lower East Side',
    districtName: 'Lower East Side',
    searchPoints: [{ lat: 40.7153, lng: -73.9862, radius: 700 }],
    bounds: { north: 40.7230, south: 40.7080, east: -73.9770, west: -73.9970 },
    nta_names: ['Lower East Side'],
  },
  union_square: {
    name: 'Union Square',
    districtName: 'Union Square',
    searchPoints: [{ lat: 40.7358, lng: -73.9903, radius: 600 }],
    bounds: { north: 40.7420, south: 40.7290, east: -73.9800, west: -74.0010 },
    nta_names: ['Hudson Yards-Chelsea-Flat Iron-Union Square'],
  },
  gramercy: {
    name: 'Gramercy',
    districtName: 'Gramercy',
    searchPoints: [{ lat: 40.7372, lng: -73.9838, radius: 600 }],
    bounds: { north: 40.7450, south: 40.7290, east: -73.9750, west: -73.9940 },
    nta_names: ['Stuyvesant Town-Cooper Village', 'Gramercy'],
  },
  flatiron: {
    name: 'Flatiron',
    districtName: 'Flatiron',
    searchPoints: [{ lat: 40.7410, lng: -73.9897, radius: 700 }],
    bounds: { north: 40.7460, south: 40.7350, east: -73.9810, west: -74.0000 },
    nta_names: ['Flatiron', 'Hudson Yards-Chelsea-Flat Iron-Union Square'],
  },
  nomad: {
    name: 'NoMad',
    districtName: 'NoMad',
    searchPoints: [{ lat: 40.7450, lng: -73.9878, radius: 600 }],
    bounds: { north: 40.7510, south: 40.7385, east: -73.9770, west: -73.9990 },
    nta_names: ['Hudson Yards-Chelsea-Flat Iron-Union Square', 'Flatiron'],
  },
  east_village: {
    name: 'East Village',
    districtName: 'East Village',
    searchPoints: [{ lat: 40.7265, lng: -73.9820, radius: 700 }],
    bounds: { north: 40.7340, south: 40.7180, east: -73.9730, west: -73.9950 },
    nta_names: ['East Village'],
  },
};

// ── Quality Filters ──────────────────────────────────────
export const FILTERS = {
  minRating: 3.5,     // exclude anything rated below this
  minReviews: 10,     // lowered from 25 — newer HY openings (Limusina, etc.) may not
                      // have accumulated many reviews yet
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

  // Bar chains / generic sports bars (added when 'bar' type included in search)
  "Dave & Buster's",
  'Buffalo Wild Wings',
  'Twin Peaks',
  'Yard House',
  'Bar Louie',
  "Applebee's Bar & Grill",
  'World of Beer',
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
  'Greenwich Village':     'Greenwich Village',
  'East Village':          'East Village',
  'Battery Park City-Lower Manhattan': 'Financial District',
};
