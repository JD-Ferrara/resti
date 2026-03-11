-- ============================================================
-- supabase-add-custom-district.sql
-- ============================================================
-- Adds a custom_district column to restaurants, raw_places, and
-- filtered_places tables. This column stores the district name from
-- scripts/data/custom-districts.geojson, determined by polygon
-- point-in-polygon detection during the Google Places pipeline.
--
-- Values are one of the 19 V1 district names:
--   Hudson Yards, Chelsea, Meatpacking, West Village, Greenwich Village,
--   Hudson Square, Soho, Tribeca, Financial District, Little Italy,
--   Chinatown, NoLita, Lower East Side, NoHo, Union Square, Gramercy,
--   Flatiron, NoMad, East Village
--
-- Run this migration once in the Supabase SQL editor.
-- ============================================================

-- ── restaurants ────────────────────────────────────────────

ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS custom_district text;

COMMENT ON COLUMN restaurants.custom_district IS
  'Custom V1 district name from geofence polygon detection (e.g. "Hudson Yards", "Chelsea").';

CREATE INDEX IF NOT EXISTS restaurants_custom_district_idx
  ON restaurants (custom_district);

-- ── raw_places ─────────────────────────────────────────────

ALTER TABLE raw_places
  ADD COLUMN IF NOT EXISTS custom_district text;

COMMENT ON COLUMN raw_places.custom_district IS
  'Custom V1 district name from geofence polygon detection (e.g. "Hudson Yards", "Chelsea").';

CREATE INDEX IF NOT EXISTS raw_places_custom_district_idx
  ON raw_places (custom_district);

-- ── filtered_places ────────────────────────────────────────

ALTER TABLE filtered_places
  ADD COLUMN IF NOT EXISTS custom_district text;

COMMENT ON COLUMN filtered_places.custom_district IS
  'Custom V1 district name from geofence polygon detection (e.g. "Hudson Yards", "Chelsea").';

CREATE INDEX IF NOT EXISTS filtered_places_custom_district_idx
  ON filtered_places (custom_district);
