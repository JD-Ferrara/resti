-- ============================================================
-- Add mocktail_program tag to restaurant_tags
-- ============================================================
-- Run once in Supabase SQL Editor.
-- Adds a boolean tag for restaurants with a dedicated, curated
-- non-alcoholic drinks program — not just "we can make it without
-- alcohol," but a thoughtfully crafted mocktail or zero-proof menu.

ALTER TABLE restaurant_tags
  ADD COLUMN IF NOT EXISTS mocktail_program BOOLEAN NOT NULL DEFAULT FALSE;
