-- ============================================================
-- supabase-fix-filtered-existing.sql
-- ============================================================
-- One-time fix: re-populate the 'existing' rows in filtered_places
-- using raw_places as the source for Google data, instead of the
-- restaurants table.
--
-- Fields updated from raw_places:
--   name, address, district, area (← neighborhood_area),
--   price (← price_level), hours, phone, website,
--   google_types, editorial_summary
--
-- Fields left unchanged (curated, only live in restaurants):
--   cuisine, notes, instagram, reservation, source_status
--
-- Run once in the Supabase SQL Editor.
-- Safe to re-run (UPDATE is idempotent).

UPDATE filtered_places fp
SET
  name              = rp.name,
  address           = rp.address,
  district          = rp.district,
  area              = rp.neighborhood_area,
  price             = rp.price_level,
  hours             = rp.hours,
  phone             = rp.phone,
  website           = rp.website,
  google_types      = to_jsonb(rp.google_types),
  editorial_summary = rp.editorial_summary
FROM raw_places rp
WHERE fp.google_places_id = rp.google_place_id
  AND fp.source_status    = 'existing'
  AND fp.id              <= 24;
