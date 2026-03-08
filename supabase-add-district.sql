-- ============================================================
-- Add district column to the restaurants table
-- ============================================================
-- Run this in the Supabase SQL Editor.
-- The district column groups restaurants by neighborhood for
-- filtering in the UI. Values are manually curated.

ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS district TEXT;

-- ── Backfill: Hudson Yards complex ───────────────────────
-- Addresses containing "Hudson Yards" (10/20/30 HY, Equinox, etc.)
UPDATE restaurants
SET district = 'Hudson Yards'
WHERE address ILIKE '%Hudson Yards%';

-- ── Backfill: Manhattan West development ─────────────────
-- Addresses explicitly in Manhattan West or The Spiral (W 33rd/34th St)
UPDATE restaurants
SET district = 'Manhattan West'
WHERE address ILIKE '%Manhattan West%'
   OR address ILIKE '%The Spiral%'
   OR address ILIKE '%W 33rd%'
   OR address ILIKE '%W 34th%';

-- ── Backfill: 9th/10th Ave corridor ──────────────────────
-- These addresses don't mention either complex by name but sit
-- in the same immediate area. Assign to Manhattan West for now.
-- Review and reassign as needed once Google Places confirms NTA boundaries.
UPDATE restaurants
SET district = 'Manhattan West'
WHERE name IN ('Limusina', 'Greywind / Spygold', 'Kyma');

-- ── Verify ────────────────────────────────────────────────
-- Run this to confirm the backfill:
-- SELECT id, name, address, district FROM restaurants ORDER BY district, name;
