-- ============================================================
-- Add parent_concept column to filtered_places
-- ============================================================
-- Stores the google_places_id of the parent/primary venue when
-- this row is a sibling location (e.g. Spygold → Greywind's ID).
-- Populated by Step 5 synthesis via Claude.
-- NULL means this venue has no known sibling relationship.

ALTER TABLE filtered_places
  ADD COLUMN IF NOT EXISTS parent_concept TEXT;
