-- ============================================================
-- raw_places schema cleanup
-- ============================================================
-- 1. Add google_maps_uri (Basic tier — direct Maps link)
-- 2. Add phone and hours columns if missing (were mapped in code
--    but not in the original CREATE TABLE)
-- 3. Drop amenity boolean columns — all are Google Preferred
--    (Atmosphere) tier and were always NULL. Fetch via targeted
--    Place Details enrichment after filtering if ever needed.
-- ============================================================

-- ── Add new columns ───────────────────────────────────────

ALTER TABLE raw_places
  ADD COLUMN IF NOT EXISTS google_maps_uri TEXT;

-- phone and hours exist in the original schema but confirm they're present
ALTER TABLE raw_places
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS hours JSONB;

-- ── Drop Preferred-tier amenity columns (always NULL) ─────
-- These require Preferred (Atmosphere) billing tier on every discovery
-- request. Not worth the cost for bulk discovery — fetch targeted
-- via Place Details for filtered candidates if needed later.

ALTER TABLE raw_places
  DROP COLUMN IF EXISTS has_outdoor_seating,
  DROP COLUMN IF EXISTS takes_reservations,
  DROP COLUMN IF EXISTS serves_beer,
  DROP COLUMN IF EXISTS serves_wine,
  DROP COLUMN IF EXISTS serves_breakfast,
  DROP COLUMN IF EXISTS serves_lunch,
  DROP COLUMN IF EXISTS serves_dinner,
  DROP COLUMN IF EXISTS has_takeout,
  DROP COLUMN IF EXISTS has_delivery;
