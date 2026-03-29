-- Add links_fetched_at tracking column to restaurants table
-- Run this in the Supabase SQL Editor

ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS links_fetched_at TIMESTAMPTZ;

COMMENT ON COLUMN restaurants.links_fetched_at IS
  'Timestamp of the last fetch-restaurant-links.js pipeline run for this restaurant.';
