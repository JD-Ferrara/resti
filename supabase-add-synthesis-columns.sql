-- ============================================================
-- Add synthesis columns to filtered_places
-- ============================================================
-- Run once in Supabase SQL Editor before executing Step 5.
--
-- proposed_tags: Claude-assigned tags stored as JSONB until
--   the row is promoted to restaurants + restaurant_tags.
-- synthesis_status: tracks which rows Step 5 has processed.
--   'pending'  → not yet synthesized (default)
--   'complete' → Claude synthesis written successfully
--   'error'    → synthesis attempted but failed (check logs)

ALTER TABLE filtered_places
  ADD COLUMN IF NOT EXISTS proposed_tags     JSONB,
  ADD COLUMN IF NOT EXISTS synthesis_status  TEXT NOT NULL DEFAULT 'pending';

CREATE INDEX IF NOT EXISTS idx_filtered_places_synthesis
  ON filtered_places(synthesis_status);
