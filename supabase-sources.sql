-- ============================================================
-- restaurant_sources: one column per editorial publication
-- ============================================================
-- Run this in the Supabase SQL Editor.
--
-- Design rationale:
--   One row per restaurant, one column per publication.
--   Easy to scan in the Supabase table editor, easy to update
--   a single URL without touching anything else.
--
-- Reservation platforms (OpenTable, Resy booking) are NOT here —
-- those live in restaurants.reservation. Only editorial coverage
-- (reviews, features, guides) belongs in this table.
--
-- resy_blog is an exception: blog.resy.com is Resy's editorial
-- arm (features, profiles) — distinct from the booking platform.
--
-- To add a new publication: ALTER TABLE restaurant_sources ADD COLUMN <name> TEXT;

CREATE TABLE IF NOT EXISTS restaurant_sources (
  restaurant_id   INTEGER PRIMARY KEY REFERENCES restaurants(id) ON DELETE CASCADE,

  -- ── Editorial publications ────────────────────────────────
  infatuation     TEXT,   -- theinfatuation.com review URL
  eater           TEXT,   -- ny.eater.com URL
  timeout         TEXT,   -- timeout.com/newyork URL
  new_york_times  TEXT,   -- nytimes.com dining review URL
  new_york_mag    TEXT,   -- nymag.com or grubstreet.com URL
  michelin        TEXT,   -- guide.michelin.com listing URL
  robb_report     TEXT,   -- robbreport.com URL
  bon_appetit     TEXT,   -- bonappetit.com URL
  vogue           TEXT,   -- vogue.com URL
  wsj             TEXT,   -- wsj.com URL
  wwd             TEXT,   -- wwd.com URL
  resy_blog       TEXT,   -- blog.resy.com editorial feature URL

  -- ── Add new publications below this line ─────────────────
  -- e.g.: conde_nast_traveler TEXT, food_and_wine TEXT, etc.

  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── Backfill from existing restaurants.sources JSONB ─────
-- Only editorial URLs are carried over.
-- Booking-platform-only entries (OpenTable, Resy reservation links,
-- venue directory pages) are intentionally dropped — those live
-- in restaurants.reservation.

INSERT INTO restaurant_sources (restaurant_id, infatuation)
  VALUES (1, 'https://www.theinfatuation.com/new-york/reviews/queensyard')
  ON CONFLICT (restaurant_id) DO UPDATE SET infatuation = EXCLUDED.infatuation;

INSERT INTO restaurant_sources (restaurant_id, infatuation)
  VALUES (2, 'https://www.theinfatuation.com/new-york/reviews/zou-zous')
  ON CONFLICT (restaurant_id) DO UPDATE SET infatuation = EXCLUDED.infatuation;

INSERT INTO restaurant_sources (restaurant_id, infatuation)
  VALUES (3, 'https://www.theinfatuation.com/new-york/reviews/estiatorio-milos-hudson-yards')
  ON CONFLICT (restaurant_id) DO UPDATE SET infatuation = EXCLUDED.infatuation;

INSERT INTO restaurant_sources (restaurant_id, infatuation, resy_blog)
  VALUES (5, 'https://www.theinfatuation.com/new-york/reviews/greywind', 'https://blog.resy.com/2023/04/greywind/')
  ON CONFLICT (restaurant_id) DO UPDATE SET infatuation = EXCLUDED.infatuation, resy_blog = EXCLUDED.resy_blog;

INSERT INTO restaurant_sources (restaurant_id, infatuation)
  VALUES (6, 'https://www.theinfatuation.com/new-york/reviews/electric-lemon')
  ON CONFLICT (restaurant_id) DO UPDATE SET infatuation = EXCLUDED.infatuation;

INSERT INTO restaurant_sources (restaurant_id, infatuation)
  VALUES (8, 'https://www.theinfatuation.com/new-york/reviews/pj-clarkes-hudson-yards')
  ON CONFLICT (restaurant_id) DO UPDATE SET infatuation = EXCLUDED.infatuation;

INSERT INTO restaurant_sources (restaurant_id, infatuation, new_york_times)
  VALUES (10, 'https://www.theinfatuation.com/new-york/reviews/mercado-little-spain', 'https://www.nytimes.com/2019/03/14/dining/mercado-little-spain-review.html')
  ON CONFLICT (restaurant_id) DO UPDATE SET infatuation = EXCLUDED.infatuation, new_york_times = EXCLUDED.new_york_times;

INSERT INTO restaurant_sources (restaurant_id, infatuation, eater)
  VALUES (12, 'https://www.theinfatuation.com/new-york/reviews/miznon-hudson-yards', 'https://ny.eater.com/venue/miznon-hudson-yards')
  ON CONFLICT (restaurant_id) DO UPDATE SET infatuation = EXCLUDED.infatuation, eater = EXCLUDED.eater;

INSERT INTO restaurant_sources (restaurant_id, infatuation, eater, robb_report)
  VALUES (16, 'https://www.theinfatuation.com/new-york/reviews/limusina', 'https://ny.eater.com/venue/limusina-nyc', 'https://robbreport.com/food-drink/dining/limusina-quality-branded-mexican-restaurant-nyc-1237037953/')
  ON CONFLICT (restaurant_id) DO UPDATE SET infatuation = EXCLUDED.infatuation, eater = EXCLUDED.eater, robb_report = EXCLUDED.robb_report;

INSERT INTO restaurant_sources (restaurant_id, eater)
  VALUES (19, 'https://ny.eater.com/venue/russ-and-daughters-hudson-yards')
  ON CONFLICT (restaurant_id) DO UPDATE SET eater = EXCLUDED.eater;

INSERT INTO restaurant_sources (restaurant_id, infatuation)
  VALUES (20, 'https://www.theinfatuation.com/new-york/reviews/oyamel-hudson-yards')
  ON CONFLICT (restaurant_id) DO UPDATE SET infatuation = EXCLUDED.infatuation;

INSERT INTO restaurant_sources (restaurant_id, eater)
  VALUES (22, 'https://ny.eater.com/venue/eataly-hudson-yards')
  ON CONFLICT (restaurant_id) DO UPDATE SET eater = EXCLUDED.eater;

INSERT INTO restaurant_sources (restaurant_id, infatuation, eater, michelin)
  VALUES (24, 'https://www.theinfatuation.com/new-york/reviews/ci-siamo', 'https://ny.eater.com/venue/ci-siamo-nyc', 'https://guide.michelin.com/us/en/new-york-state/new-york/restaurant/ci-siamo')
  ON CONFLICT (restaurant_id) DO UPDATE SET infatuation = EXCLUDED.infatuation, eater = EXCLUDED.eater, michelin = EXCLUDED.michelin;

INSERT INTO restaurant_sources (restaurant_id, infatuation, michelin, resy_blog)
  VALUES (25, 'https://www.theinfatuation.com/new-york/reviews/papa-san', 'https://guide.michelin.com/us/en/new-york-state/new-york/restaurant/papa-san', 'https://blog.resy.com/2025/02/papa-san-nyc/')
  ON CONFLICT (restaurant_id) DO UPDATE SET infatuation = EXCLUDED.infatuation, michelin = EXCLUDED.michelin, resy_blog = EXCLUDED.resy_blog;

INSERT INTO restaurant_sources (restaurant_id, infatuation)
  VALUES (26, 'https://www.theinfatuation.com/new-york/reviews/locanda-verde-hudson-yards')
  ON CONFLICT (restaurant_id) DO UPDATE SET infatuation = EXCLUDED.infatuation;

INSERT INTO restaurant_sources (restaurant_id, wwd, resy_blog)
  VALUES (27, 'https://wwd.com/eye/lifestyle/inside-saverne-gabriel-kreuther-restaurant-1238640964/', 'https://blog.resy.com/2026/03/gabriel-kreuther-saverne/')
  ON CONFLICT (restaurant_id) DO UPDATE SET wwd = EXCLUDED.wwd, resy_blog = EXCLUDED.resy_blog;

-- ── Verify ────────────────────────────────────────────────
-- SELECT r.name, s.infatuation, s.eater, s.new_york_times, s.michelin, s.robb_report, s.wwd, s.resy_blog
-- FROM restaurants r
-- LEFT JOIN restaurant_sources s ON s.restaurant_id = r.id
-- ORDER BY r.id;

-- ── Drop old sources column ───────────────────────────────
-- Run this after verifying the table looks correct:
--
-- ALTER TABLE restaurants DROP COLUMN IF EXISTS sources;
