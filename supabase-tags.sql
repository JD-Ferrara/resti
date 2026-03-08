-- ============================================================
-- restaurant_tags: single wide pivot table
-- ============================================================
-- One row per restaurant. Each tag is a boolean column.
-- Columns: restaurant_id (PK), restaurant_name, then one column
-- per tag — grouped by category in the order below.
--
-- This replaces the previous two-table approach (tags + join table).
-- Run this file in Supabase SQL Editor. Safe to re-run.
-- ============================================================

-- ── 0. Drop old tables if they exist ─────────────────────────
-- The old schema used a separate `tags` definition table and a
-- junction restaurant_tags table. Replace both with this file.
DROP TABLE IF EXISTS restaurant_tags CASCADE;
DROP TABLE IF EXISTS tags CASCADE;


-- ── 1. Create the wide pivot table ───────────────────────────
CREATE TABLE restaurant_tags (
  restaurant_id   INTEGER PRIMARY KEY REFERENCES restaurants(id) ON DELETE CASCADE,
  restaurant_name TEXT    NOT NULL,

  -- ── Occasion ──
  romantic_milestone        BOOLEAN NOT NULL DEFAULT FALSE,
  saturday_night_out        BOOLEAN NOT NULL DEFAULT FALSE,
  birthday_dinner           BOOLEAN NOT NULL DEFAULT FALSE,
  business_dinner           BOOLEAN NOT NULL DEFAULT FALSE,
  business_lunch            BOOLEAN NOT NULL DEFAULT FALSE,
  first_date                BOOLEAN NOT NULL DEFAULT FALSE,
  anniversary               BOOLEAN NOT NULL DEFAULT FALSE,
  after_work_drinks         BOOLEAN NOT NULL DEFAULT FALSE,
  sunday_brunch             BOOLEAN NOT NULL DEFAULT FALSE,

  -- ── Vibe ──
  intimate_quiet            BOOLEAN NOT NULL DEFAULT FALSE,
  buzzy_lively              BOOLEAN NOT NULL DEFAULT FALSE,
  trendy_scene              BOOLEAN NOT NULL DEFAULT FALSE,
  unpretentious             BOOLEAN NOT NULL DEFAULT FALSE,
  old_school_classic        BOOLEAN NOT NULL DEFAULT FALSE,
  hidden_gem                BOOLEAN NOT NULL DEFAULT FALSE,
  cozy                      BOOLEAN NOT NULL DEFAULT FALSE,
  grand_impressive          BOOLEAN NOT NULL DEFAULT FALSE,

  -- ── Drinks ──
  craft_cocktails           BOOLEAN NOT NULL DEFAULT FALSE,
  extensive_wine_list       BOOLEAN NOT NULL DEFAULT FALSE,
  natural_wine              BOOLEAN NOT NULL DEFAULT FALSE,
  great_beer_selection      BOOLEAN NOT NULL DEFAULT FALSE,
  standard_bar              BOOLEAN NOT NULL DEFAULT FALSE,
  destination_bar           BOOLEAN NOT NULL DEFAULT FALSE,

  -- ── Food ──
  sharing_plates            BOOLEAN NOT NULL DEFAULT FALSE,
  tasting_menu              BOOLEAN NOT NULL DEFAULT FALSE,
  traditional_entrees       BOOLEAN NOT NULL DEFAULT FALSE,
  bar_snacks_only           BOOLEAN NOT NULL DEFAULT FALSE,
  chef_driven               BOOLEAN NOT NULL DEFAULT FALSE,

  -- ── Group ──
  solo_friendly             BOOLEAN NOT NULL DEFAULT FALSE,
  large_group               BOOLEAN NOT NULL DEFAULT FALSE,
  couples_only_vibe         BOOLEAN NOT NULL DEFAULT FALSE,
  family_friendly           BOOLEAN NOT NULL DEFAULT FALSE,
  watch_games_with_friends  BOOLEAN NOT NULL DEFAULT FALSE,

  -- ── Dietary ──
  vegan                     BOOLEAN NOT NULL DEFAULT FALSE,
  vegetarian_friendly       BOOLEAN NOT NULL DEFAULT FALSE,
  gluten_free_friendly      BOOLEAN NOT NULL DEFAULT FALSE,

  -- ── Value ──
  worth_the_splurge         BOOLEAN NOT NULL DEFAULT FALSE,
  overpriced_for_what_it_is BOOLEAN NOT NULL DEFAULT FALSE,
  great_value               BOOLEAN NOT NULL DEFAULT FALSE,
  corporate_card_only       BOOLEAN NOT NULL DEFAULT FALSE,
  happy_hour_deal           BOOLEAN NOT NULL DEFAULT FALSE,
  budget_friendly           BOOLEAN NOT NULL DEFAULT FALSE
);


-- ── 2. Seed one row per restaurant ───────────────────────────
-- All tags start as FALSE. Edit them directly in the Supabase
-- table editor — check the box to enable a tag for a restaurant.
INSERT INTO restaurant_tags (restaurant_id, restaurant_name)
SELECT id, name FROM restaurants
ON CONFLICT (restaurant_id) DO UPDATE SET restaurant_name = EXCLUDED.restaurant_name;
