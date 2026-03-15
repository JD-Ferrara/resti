-- ============================================================
-- supabase-sources-extend.sql — extend restaurant_sources
-- ============================================================
-- Adds four additional high-quality editorial columns and a
-- tavily_fetched_at timestamp so the pipeline can skip rows
-- that were recently fetched.
--
-- Run this in the Supabase SQL Editor AFTER supabase-sources.sql.
--
-- New columns added:
--   food_and_wine       foodandwine.com
--   new_yorker          newyorker.com  (Tables for Two column)
--   tasting_table       tastingtable.com
--   conde_nast_traveler cntraveler.com
--   tavily_fetched_at   pipeline metadata — last Tavily search timestamp

ALTER TABLE restaurant_sources
  ADD COLUMN IF NOT EXISTS food_and_wine        TEXT,
  ADD COLUMN IF NOT EXISTS new_yorker           TEXT,
  ADD COLUMN IF NOT EXISTS tasting_table        TEXT,
  ADD COLUMN IF NOT EXISTS conde_nast_traveler  TEXT,
  ADD COLUMN IF NOT EXISTS tavily_fetched_at    TIMESTAMPTZ;

-- ── Verify new schema ─────────────────────────────────────
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_name = 'restaurant_sources'
-- ORDER BY ordinal_position;
