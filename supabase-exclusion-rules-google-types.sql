-- ============================================================
-- Seed place_exclusion_rules: Google type exclusions
-- ============================================================
-- These rules mirror the EXCLUDED_GOOGLE_TYPES array in places-config.js
-- and are passed as `excludedTypes` in every Nearby Search request.
-- Google drops matching places before they count against our result quota.
--
-- rule_type = 'google_type_exclude'
-- value     = Google Place type string (snake_case)
--
-- TO ADD A NEW EXCLUSION:
--   1. Insert a row here and run this migration
--   2. Also add the value to EXCLUDED_GOOGLE_TYPES in places-config.js
--
-- NOTE: Do NOT add lodging, night_club, or shopping_mall —
--       these legitimately contain hotel bars, speakeasies, and Eataly.
-- ============================================================

INSERT INTO place_exclusion_rules (rule_type, value, exclusion_reason, category, notes) VALUES

  -- Fuel / automotive
  ('google_type_exclude', 'gas_station',      'google_type_excluded', 'google_type', 'Gas station; occasionally has a coffee counter but not a dining destination'),
  ('google_type_exclude', 'car_wash',         'google_type_excluded', 'google_type', 'Car wash; no food service'),
  ('google_type_exclude', 'car_dealer',       'google_type_excluded', 'google_type', 'Car dealership; no food service'),

  -- Food retail (not sit-down dining)
  ('google_type_exclude', 'grocery_store',    'google_type_excluded', 'google_type', 'Grocery store; deli counters are not destination dining'),
  ('google_type_exclude', 'supermarket',      'google_type_excluded', 'google_type', 'Supermarket; same rationale as grocery_store'),
  ('google_type_exclude', 'convenience_store','google_type_excluded', 'google_type', 'Convenience store; not a dining destination'),

  -- Health / personal care
  ('google_type_exclude', 'pharmacy',         'google_type_excluded', 'google_type', 'Pharmacy; not a dining destination'),
  ('google_type_exclude', 'drugstore',        'google_type_excluded', 'google_type', 'Drugstore; same rationale as pharmacy'),
  ('google_type_exclude', 'beauty_salon',     'google_type_excluded', 'google_type', 'Beauty salon; not a food venue'),
  ('google_type_exclude', 'hair_care',        'google_type_excluded', 'google_type', 'Hair salon; not a food venue'),
  ('google_type_exclude', 'spa',              'google_type_excluded', 'google_type', 'Day spa; spa restaurants handled via allow-listing if exceptional'),

  -- Fitness
  ('google_type_exclude', 'gym',              'google_type_excluded', 'google_type', 'Gym; smoothie bar in a gym is not a dining destination'),
  ('google_type_exclude', 'fitness_center',   'google_type_excluded', 'google_type', 'Fitness center; same rationale as gym'),
  ('google_type_exclude', 'sports_club',      'google_type_excluded', 'google_type', 'Sports club; snack bar not destination-worthy'),

  -- Finance
  ('google_type_exclude', 'bank',             'google_type_excluded', 'google_type', 'Bank; occasionally has a café inside but not a dining destination'),
  ('google_type_exclude', 'atm',              'google_type_excluded', 'google_type', 'ATM; not a food venue'),

  -- Laundry
  ('google_type_exclude', 'laundry',          'google_type_excluded', 'google_type', 'Laundry; not a food venue'),
  ('google_type_exclude', 'dry_cleaning',     'google_type_excluded', 'google_type', 'Dry cleaner; not a food venue'),

  -- Entertainment (concession-only)
  ('google_type_exclude', 'movie_theater',    'google_type_excluded', 'google_type', 'Movie theater concession stand; dine-in theaters kept via place_allowlist'),
  ('google_type_exclude', 'bowling_alley',    'google_type_excluded', 'google_type', 'Bowling alley snack bar; not a dining destination'),
  ('google_type_exclude', 'amusement_park',   'google_type_excluded', 'google_type', 'Amusement park food stand; not a dining destination')

ON CONFLICT (rule_type, value) DO NOTHING;
