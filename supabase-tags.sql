-- ============================================================
-- Tags system: replaces the JSONB tags column on restaurants
-- ============================================================
-- Two tables:
--   tags            — canonical tag definitions (category + key + label)
--   restaurant_tags — join table linking restaurants ↔ tags
--
-- Run this AFTER your restaurants table already exists.
-- The migration section at the bottom backfills restaurant_tags
-- from the existing restaurants.tags JSONB column, then drops it.

-- ── 1. Tag definitions ────────────────────────────────────
CREATE TABLE IF NOT EXISTS tags (
  id          SERIAL PRIMARY KEY,
  category    TEXT NOT NULL,    -- occasion | vibe | drinks | food | group | dietary | value
  tag_key     TEXT NOT NULL,    -- snake_case key used in app logic
  label       TEXT NOT NULL,    -- human-readable display label
  UNIQUE(category, tag_key)
);

-- ── 2. Seed all tag definitions ───────────────────────────
INSERT INTO tags (category, tag_key, label) VALUES

  -- Occasion
  ('occasion', 'romantic_milestone',   'Romantic / Milestone'),
  ('occasion', 'saturday_night_out',   'Saturday Night Out'),
  ('occasion', 'birthday_dinner',      'Birthday Dinner'),
  ('occasion', 'business_dinner',      'Business Dinner'),
  ('occasion', 'business_lunch',       'Business Lunch'),
  ('occasion', 'first_date',           'First Date'),
  ('occasion', 'anniversary',          'Anniversary'),
  ('occasion', 'after_work_drinks',    'After Work Drinks'),
  ('occasion', 'sunday_brunch',        'Sunday Brunch'),

  -- Vibe
  ('vibe', 'intimate_quiet',      'Intimate & Quiet'),
  ('vibe', 'buzzy_lively',        'Buzzy & Lively'),
  ('vibe', 'trendy_scene',        'Trendy Scene'),
  ('vibe', 'unpretentious',       'Unpretentious'),
  ('vibe', 'old_school_classic',  'Old School Classic'),
  ('vibe', 'hidden_gem',          'Hidden Gem'),
  ('vibe', 'cozy',                'Cozy'),
  ('vibe', 'grand_impressive',    'Grand & Impressive'),

  -- Drinks
  ('drinks', 'craft_cocktails',      'Craft Cocktails'),
  ('drinks', 'extensive_wine_list',  'Extensive Wine List'),
  ('drinks', 'natural_wine',         'Natural Wine'),
  ('drinks', 'great_beer_selection', 'Great Beer Selection'),
  ('drinks', 'standard_bar',         'Standard Bar'),
  ('drinks', 'destination_bar',      'Destination Bar'),

  -- Food
  ('food', 'sharing_plates',    'Sharing Plates'),
  ('food', 'tasting_menu',      'Tasting Menu'),
  ('food', 'traditional_entrees','Traditional Entrees'),
  ('food', 'bar_snacks_only',   'Bar Snacks Only'),
  ('food', 'chef_driven',       'Chef-Driven'),

  -- Group
  ('group', 'solo_friendly',            'Solo Friendly'),
  ('group', 'large_group',              'Large Group'),
  ('group', 'couples_only_vibe',        'Couples Only Vibe'),
  ('group', 'family_friendly',          'Family Friendly'),
  ('group', 'watch_games_with_friends', 'Watch Games with Friends'),

  -- Dietary
  ('dietary', 'vegan',                 'Vegan'),
  ('dietary', 'vegetarian_friendly',   'Vegetarian Friendly'),
  ('dietary', 'gluten_free_friendly',  'Gluten-Free Friendly'),

  -- Value
  ('value', 'worth_the_splurge',        'Worth the Splurge'),
  ('value', 'overpriced_for_what_it_is','Overpriced for What It Is'),
  ('value', 'great_value',              'Great Value'),
  ('value', 'corporate_card_only',      'Corporate Card Only'),
  ('value', 'happy_hour_deal',          'Happy Hour Deal'),
  ('value', 'budget_friendly',          'Budget Friendly')

ON CONFLICT (category, tag_key) DO NOTHING;

-- ── 3. Restaurant ↔ Tag join table ────────────────────────
CREATE TABLE IF NOT EXISTS restaurant_tags (
  restaurant_id  INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  tag_id         INTEGER NOT NULL REFERENCES tags(id)        ON DELETE CASCADE,
  PRIMARY KEY (restaurant_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_restaurant_tags_restaurant ON restaurant_tags(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_restaurant_tags_tag        ON restaurant_tags(tag_id);

-- ── 4. Migrate existing JSONB tags → restaurant_tags ─────
-- Reads the existing restaurants.tags JSONB (shape: {"occasion": ["key1","key2"], ...})
-- and creates the corresponding restaurant_tags rows.
--
-- Run once. Safe to re-run: INSERT ... ON CONFLICT DO NOTHING.

INSERT INTO restaurant_tags (restaurant_id, tag_id)
SELECT
  r.id            AS restaurant_id,
  t.id            AS tag_id
FROM
  restaurants r,
  -- Expand JSONB: each category key → each tag_key in its array
  LATERAL jsonb_each(r.tags) AS cat(category, tag_keys),
  LATERAL jsonb_array_elements_text(cat.tag_keys) AS tag_key_value
JOIN tags t
  ON t.category = cat.category
 AND t.tag_key  = tag_key_value
WHERE
  r.tags IS NOT NULL
ON CONFLICT DO NOTHING;

-- ── 5. Drop the now-redundant JSONB column ────────────────
-- Only run this after verifying restaurant_tags is correctly populated.
-- Uncomment when ready:
--
-- ALTER TABLE restaurants DROP COLUMN IF EXISTS tags;
--
-- To verify before dropping:
-- SELECT r.id, r.name, array_agg(t.category || ':' || t.tag_key) AS tags
-- FROM restaurants r
-- LEFT JOIN restaurant_tags rt ON rt.restaurant_id = r.id
-- LEFT JOIN tags t ON t.id = rt.tag_id
-- GROUP BY r.id, r.name
-- ORDER BY r.id;
