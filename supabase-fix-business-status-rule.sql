-- ============================================================
-- Migration: Fix business_status exclusion rule value
-- ============================================================
-- The rule was originally seeded with 'TEMPORARILY_CLOSED' but Google
-- Places API (New) actually returns 'CLOSED_TEMPORARILY'. This caused
-- the filter to silently pass temporarily-closed places through, leaving
-- them in raw_places with status='pending' instead of being excluded.
-- ============================================================

UPDATE place_exclusion_rules
SET value = 'CLOSED_TEMPORARILY'
WHERE rule_type = 'business_status'
  AND value = 'TEMPORARILY_CLOSED';
