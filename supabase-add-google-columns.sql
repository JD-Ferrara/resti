-- Add Google Places and supplementary columns to the restaurants table
-- Run this in the Supabase SQL Editor

ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS google_place_id TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS hours JSONB,
  ADD COLUMN IF NOT EXISTS google_types JSONB,
  ADD COLUMN IF NOT EXISTS editorial_summary TEXT;
