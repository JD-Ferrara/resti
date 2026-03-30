-- Migration: add reservation_platform and reservation_confidence to restaurants
--
-- reservation_platform: which booking system the venue uses
--   Values: 'resy' | 'opentable' | 'sevenrooms' | 'tock' | NULL
--
-- reservation_confidence: how confident the pipeline is in the stored reservation URL
--   0.0–1.0 float; only values ≥ 0.75 are persisted by fetch-restaurant-links.js
--   Useful for filtering out uncertain links and surfacing "needs review" rows.
--
-- Run this in Supabase SQL Editor before running fetch-restaurant-links.js
-- with confidence scoring enabled.

ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS reservation_platform  TEXT,
  ADD COLUMN IF NOT EXISTS reservation_confidence FLOAT;
