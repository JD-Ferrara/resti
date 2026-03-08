-- Paste this entire file into the Supabase SQL Editor and click Run.
-- Run AFTER supabase-seed.sql (restaurants table must exist first).

-- 1. Creators table
CREATE TABLE creators (
  id text PRIMARY KEY,
  full_name text NOT NULL,
  primary_handle text NOT NULL,
  primary_platform text NOT NULL,
  platforms text[] NOT NULL DEFAULT '{}',
  url text NOT NULL
);

-- 2. Creator quotes table (links a creator quote to a restaurant)
CREATE TABLE creator_quotes (
  id serial PRIMARY KEY,
  restaurant_id integer REFERENCES restaurants(id) ON DELETE CASCADE,
  creator_id text REFERENCES creators(id) ON DELETE CASCADE,
  quote text NOT NULL
);

-- 3. Seed creators
INSERT INTO creators (id, full_name, primary_handle, primary_platform, platforms, url) VALUES
('newyorkturk', 'Ertan Bek', 'NewYorkTurk', 'tiktok', ARRAY['tiktok', 'instagram', 'youtube'], 'https://www.tiktok.com/@newyorkturk'),
('foodalwayswon', 'James Andrews', 'jamesnu', 'youtube', ARRAY['youtube', 'instagram'], 'https://www.youtube.com/@jamesnu');

-- 4. Seed creator quotes
INSERT INTO creator_quotes (restaurant_id, creator_id, quote) VALUES
(5,  'newyorkturk',   'Most underrated spot in Hudson Yards — the burger alone makes it worth the trip.'),
(5,  'foodalwayswon', 'Greywind is doing everything right. Dan Kluger never misses.'),
(24, 'newyorkturk',   'The caramelized onion torta is one of the best bites in the city right now.'),
(24, 'foodalwayswon', 'Live-fire Italian done with real intention. This is a Danny Meyer classic in the making.'),
(25, 'newyorkturk',   'The eel pizza sounds insane — it tastes even better. One of the most exciting openings of 2025.'),
(2,  'foodalwayswon', 'Zou Zou''s is the spot that finally gave Hudson Yards a restaurant worth bragging about.');
