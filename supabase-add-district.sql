-- ============================================================
-- Add district + area columns to the restaurants table
-- ============================================================
-- Run this in the Supabase SQL Editor.
--
-- district = broad neighborhood for UI filtering
--            (Hudson Yards, Chelsea, West Village, etc.)
--            All current restaurants = 'Hudson Yards'
--
-- area     = specific sub-area stored in the DB for future use
--            (Manhattan West, The Spiral, etc.)
--            Not shown in the UI yet — kept for map views,
--            sub-area filtering, or editorial use later.
--
-- Manhattan West is a sub-segment of Hudson Yards:
-- both share district = 'Hudson Yards' so users see one
-- unified neighborhood, but area records the distinction
-- for residents and for future sub-area features.

ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS district TEXT;
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS area TEXT;

-- ── Backfill district ─────────────────────────────────────
-- All current restaurants belong to the Hudson Yards district.
-- Future restaurants in Chelsea, West Village, etc. will have
-- their own district values once those neighborhoods are added.
UPDATE restaurants SET district = 'Hudson Yards';

-- ── Backfill area: Hudson Yards complex ──────────────────
-- 10/20/30 HY, Equinox Hotel at 31 HY, The Shops, etc.
UPDATE restaurants
SET area = 'Hudson Yards'
WHERE address ILIKE '%Hudson Yards%';

-- ── Backfill area: Manhattan West / The Spiral ───────────
-- The Manhattan West development (W 33rd/34th St, 9th/10th Ave)
-- and The Spiral building — sub-area within the HY district.
UPDATE restaurants
SET area = 'Manhattan West'
WHERE address ILIKE '%Manhattan West%'
   OR address ILIKE '%The Spiral%'
   OR address ILIKE '%W 33rd%'
   OR address ILIKE '%W 34th%'
   OR name IN ('Limusina', 'Greywind / Spygold', 'Kyma');

-- ── Verify ────────────────────────────────────────────────
-- SELECT id, name, district, area, address
-- FROM restaurants
-- ORDER BY area, name;
