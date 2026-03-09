-- ============================================================
-- filtered_places: Phase 1 staging layer
-- ============================================================
-- Sits between raw_places (raw Google data) and restaurants (curated).
-- Rebuilt from scratch each pipeline run via build-filtered-places.js.
--
-- source_status values:
--   'existing'     → curated restaurant already in restaurants table
--   'ai_candidate' → new place approved by Claude AI classification
--
-- Run this once in the Supabase SQL Editor to create the table.
-- The pipeline script handles inserts/truncation on each run.

CREATE TABLE IF NOT EXISTS filtered_places (

  -- ── Identity ──────────────────────────────────────────────
  id                  SERIAL PRIMARY KEY,
  google_places_id    TEXT UNIQUE NOT NULL,   -- matches google_place_id in raw_places / restaurants

  -- ── Core details ──────────────────────────────────────────
  name                TEXT,
  address             TEXT,
  district            TEXT,                   -- e.g. 'Hudson Yards', 'Chelsea'
  area                TEXT,                   -- sub-area e.g. 'Manhattan West'

  -- ── Curated fields (populated for 'existing', NULL for 'ai_candidate') ──
  cuisine             TEXT,                   -- e.g. 'Contemporary American'
  notes               TEXT,                   -- editorial blurb from restaurants table
  price               INTEGER,               -- 1–4 (mirrors restaurants.price / raw_places.price_level)

  -- ── Google / contact data ─────────────────────────────────
  hours               JSONB,                  -- regularOpeningHours object
  phone               TEXT,
  website             TEXT,
  instagram           TEXT,                   -- populated for existing restaurants
  reservation         TEXT,                   -- reservation URL (Resy, OpenTable, etc.)

  -- ── Google metadata ───────────────────────────────────────
  google_types        JSONB,                  -- array of Google place type strings
  editorial_summary   TEXT,                   -- Google's AI-generated summary

  -- ── Pipeline metadata ────────────────────────────────────
  source_status       TEXT NOT NULL,          -- 'existing' | 'ai_candidate'
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_filtered_places_source_status ON filtered_places(source_status);
CREATE INDEX IF NOT EXISTS idx_filtered_places_district      ON filtered_places(district);
CREATE INDEX IF NOT EXISTS idx_filtered_places_google_id     ON filtered_places(google_places_id);
