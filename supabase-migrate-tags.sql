-- ============================================================
-- Migrate tag data from restaurants.tags JSONB
-- into the restaurant_tags wide boolean table.
--
-- Run this AFTER supabase-tags.sql (which creates the table
-- and seeds one all-FALSE row per restaurant).
--
-- Safe to re-run — it overwrites with the correct values.
-- ============================================================

UPDATE restaurant_tags rt
SET
  -- ── Occasion ──
  romantic_milestone        = (r.tags -> 'occasion') @> '"romantic_milestone"',
  saturday_night_out        = (r.tags -> 'occasion') @> '"saturday_night_out"',
  birthday_dinner           = (r.tags -> 'occasion') @> '"birthday_dinner"',
  business_dinner           = (r.tags -> 'occasion') @> '"business_dinner"',
  business_lunch            = (r.tags -> 'occasion') @> '"business_lunch"',
  first_date                = (r.tags -> 'occasion') @> '"first_date"',
  anniversary               = (r.tags -> 'occasion') @> '"anniversary"',
  after_work_drinks         = (r.tags -> 'occasion') @> '"after_work_drinks"',
  sunday_brunch             = (r.tags -> 'occasion') @> '"sunday_brunch"',

  -- ── Vibe ──
  intimate_quiet            = (r.tags -> 'vibe') @> '"intimate_quiet"',
  buzzy_lively              = (r.tags -> 'vibe') @> '"buzzy_lively"',
  trendy_scene              = (r.tags -> 'vibe') @> '"trendy_scene"',
  unpretentious             = (r.tags -> 'vibe') @> '"unpretentious"',
  old_school_classic        = (r.tags -> 'vibe') @> '"old_school_classic"',
  hidden_gem                = (r.tags -> 'vibe') @> '"hidden_gem"',
  cozy                      = (r.tags -> 'vibe') @> '"cozy"',
  grand_impressive          = (r.tags -> 'vibe') @> '"grand_impressive"',

  -- ── Drinks ──
  craft_cocktails           = (r.tags -> 'drinks') @> '"craft_cocktails"',
  extensive_wine_list       = (r.tags -> 'drinks') @> '"extensive_wine_list"',
  natural_wine              = (r.tags -> 'drinks') @> '"natural_wine"',
  great_beer_selection      = (r.tags -> 'drinks') @> '"great_beer_selection"',
  standard_bar              = (r.tags -> 'drinks') @> '"standard_bar"',
  destination_bar           = (r.tags -> 'drinks') @> '"destination_bar"',

  -- ── Food ──
  sharing_plates            = (r.tags -> 'food') @> '"sharing_plates"',
  tasting_menu              = (r.tags -> 'food') @> '"tasting_menu"',
  traditional_entrees       = (r.tags -> 'food') @> '"traditional_entrees"',
  bar_snacks_only           = (r.tags -> 'food') @> '"bar_snacks_only"',
  chef_driven               = (r.tags -> 'food') @> '"chef_driven"',

  -- ── Group ──
  solo_friendly             = (r.tags -> 'group') @> '"solo_friendly"',
  large_group               = (r.tags -> 'group') @> '"large_group"',
  couples_only_vibe         = (r.tags -> 'group') @> '"couples_only_vibe"',
  family_friendly           = (r.tags -> 'group') @> '"family_friendly"',
  watch_games_with_friends  = (r.tags -> 'group') @> '"watch_games_with_friends"',

  -- ── Dietary ──
  vegan                     = (r.tags -> 'dietary') @> '"vegan"',
  vegetarian_friendly       = (r.tags -> 'dietary') @> '"vegetarian_friendly"',
  gluten_free_friendly      = (r.tags -> 'dietary') @> '"gluten_free_friendly"',

  -- ── Value ──
  worth_the_splurge         = (r.tags -> 'value') @> '"worth_the_splurge"',
  overpriced_for_what_it_is = (r.tags -> 'value') @> '"overpriced_for_what_it_is"',
  great_value               = (r.tags -> 'value') @> '"great_value"',
  corporate_card_only       = (r.tags -> 'value') @> '"corporate_card_only"',
  happy_hour_deal           = (r.tags -> 'value') @> '"happy_hour_deal"',
  budget_friendly           = (r.tags -> 'value') @> '"budget_friendly"'

FROM restaurants r
WHERE rt.restaurant_id = r.id
  AND r.tags IS NOT NULL;
