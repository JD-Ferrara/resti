-- Migration: move platform + url from creators → creator_quotes
-- Paste into Supabase SQL Editor and click Run.

-- 1. Add platform and url to creator_quotes
ALTER TABLE creator_quotes ADD COLUMN platform text;
ALTER TABLE creator_quotes ADD COLUMN url text;

-- 2. Backfill existing rows with placeholder values
--    (replace these with real video URLs when you have them)
UPDATE creator_quotes SET platform = 'tiktok',  url = 'https://www.tiktok.com/@newyorkturk'  WHERE creator_id = 'newyorkturk';
UPDATE creator_quotes SET platform = 'youtube', url = 'https://www.youtube.com/@jamesnu'      WHERE creator_id = 'foodalwayswon';

-- 3. Remove primary_platform and url from creators
--    (platforms array stays — still used for filter bar icons)
ALTER TABLE creators DROP COLUMN primary_platform;
ALTER TABLE creators DROP COLUMN url;
