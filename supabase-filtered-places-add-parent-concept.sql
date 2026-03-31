-- ============================================================
-- Add parent_concept to filtered_places
-- ============================================================
-- Supports sister/affiliated venues (speakeasies, hotel bars, concept
-- spin-offs) that are standalone entries but belong to a parent concept.
--
-- Examples:
--   "Cocktail bar below Greywind"
--   "Upstairs cocktail lounge above Zou Zou's"
--   "Sister bar to Peak / Priceless"
--
-- Filled in editorially after classification. NULL for standalone venues.
-- The pipeline always sets this to NULL — it is never auto-populated.
-- ============================================================

ALTER TABLE filtered_places
  ADD COLUMN IF NOT EXISTS parent_concept TEXT;
