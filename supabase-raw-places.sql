-- ============================================================
-- raw_places: Staging table for Google Places API pipeline runs
-- ============================================================
-- Each row represents one venue returned by a pipeline fetch.
-- Data is upserted on google_place_id; re-running is safe.
-- Status flow: pending → matched | queued | excluded | imported

CREATE TABLE IF NOT EXISTS raw_places (

  -- ── Google Places core ───────────────────────────────────
  google_place_id         TEXT PRIMARY KEY,
  name                    TEXT NOT NULL,
  address                 TEXT,
  latitude                FLOAT,
  longitude               FLOAT,

  -- Ratings & pricing
  google_rating           FLOAT,          -- e.g. 4.3
  google_review_count     INTEGER,        -- e.g. 1842
  price_level             INTEGER,        -- 1–4 from Google (PRICE_LEVEL_INEXPENSIVE … EXPENSIVE)
  price_range             TEXT,           -- derived label: "$" | "$$" | "$$$" | "$$$$"

  -- Contact & hours
  phone                   TEXT,
  website                 TEXT,
  hours                   JSONB,          -- regularOpeningHours object from Google

  -- Service & amenity booleans (from Google Places New API)
  business_status         TEXT,           -- OPERATIONAL | CLOSED_TEMPORARILY | CLOSED_PERMANENTLY
  has_outdoor_seating     BOOLEAN,
  takes_reservations      BOOLEAN,
  serves_beer             BOOLEAN,
  serves_wine             BOOLEAN,
  serves_breakfast        BOOLEAN,
  serves_lunch            BOOLEAN,
  serves_dinner           BOOLEAN,
  has_takeout             BOOLEAN,
  has_delivery            BOOLEAN,

  -- Google category types (e.g. ["restaurant","bar","food"])
  google_types            TEXT[],

  -- Google editorial summary (brief AI-generated description, when available)
  editorial_summary       TEXT,

  -- ── Geography ────────────────────────────────────────────
  -- district: fine-grained NYC neighborhood (Chelsea, West Village, SoHo, LES, etc.)
  -- Populated by turf.js point-in-polygon against NYC Open Data NTA boundaries
  district                TEXT,

  -- neighborhood_area: broader grouping (Midtown West, Downtown, etc.)
  neighborhood_area       TEXT,

  -- Which search area this record was fetched for (key from SEARCH_AREAS config)
  search_area             TEXT,           -- e.g. "hudson_yards"

  -- ── Third-party enrichment (populated separately) ────────
  yelp_id                 TEXT,
  infatuation_score       TEXT,           -- e.g. "8.0" or "Must Try"
  michelin_stars          INTEGER,        -- 0–3 (NULL = not rated)

  -- ── Pipeline metadata ────────────────────────────────────
  fetched_at              TIMESTAMPTZ DEFAULT NOW(),
  last_pipeline_run       TIMESTAMPTZ DEFAULT NOW(),
  is_permanently_closed   BOOLEAN DEFAULT FALSE,

  -- Trending score: calculated field (future — engagement signals, recency, review velocity)
  trending_score          FLOAT,

  -- Known opening date (from Google or manual entry)
  date_opened             DATE,

  -- ── Curation & partner fields ────────────────────────────
  is_new                  BOOLEAN DEFAULT FALSE,  -- recently opened
  is_verified_partner     BOOLEAN DEFAULT FALSE,  -- paying restaurant partner
  verified_since          DATE,

  -- Owner-facing fields
  owner_response          TEXT,           -- restaurant's statement / rebuttal field
  owner_name              TEXT,
  owner_title             TEXT,           -- Chef | Owner | GM | etc.

  -- Time-limited featuring
  featured_until          DATE,

  -- Reservation platform (Resy, OpenTable, Tock, SevenRooms, etc.)
  reservation_platform    TEXT,

  -- Dining experience flags
  has_private_dining      BOOLEAN,
  has_tasting_menu        BOOLEAN,

  -- ── Match / import tracking ──────────────────────────────
  -- Set when this raw record has been matched to an existing curated restaurant
  matched_restaurant_id   INTEGER REFERENCES restaurants(id),

  -- Workflow status
  status                  TEXT DEFAULT 'pending',
  -- pending   → newly fetched, not yet reviewed
  -- matched   → corresponds to an existing restaurants row
  -- queued    → approved for import / enrichment by Claude pipeline
  -- excluded  → filtered out (chain, low rating, permanently closed, etc.)
  -- imported  → fully processed and written to restaurants table

  -- Full raw API response preserved for debugging / re-processing
  raw_data                JSONB
);

-- ── Indexes ───────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_raw_places_search_area  ON raw_places(search_area);
CREATE INDEX IF NOT EXISTS idx_raw_places_status       ON raw_places(status);
CREATE INDEX IF NOT EXISTS idx_raw_places_district     ON raw_places(district);
CREATE INDEX IF NOT EXISTS idx_raw_places_rating       ON raw_places(google_rating);
CREATE INDEX IF NOT EXISTS idx_raw_places_pipeline_run ON raw_places(last_pipeline_run);
