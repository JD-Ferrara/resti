-- ============================================================
-- place_exclusion_rules: Dynamic exclusion criteria for the restaurant pipeline
-- ============================================================
-- Replaces the hardcoded EXCLUDED_CHAINS, FILTERS, and business status
-- checks in filter-places.js / places-config.js with DB-driven rules
-- that can be modified in the Supabase UI without redeploying code.
--
-- Rule types:
--   chain_name      — exact match on Google displayName.text → excluded
--   min_rating      — numeric floor; exclude if google_rating < value
--   min_reviews     — numeric floor; exclude if google_review_count < value
--   business_status — exclude if business_status matches value
--
-- Pipeline reads active rules at runtime:
--   SELECT * FROM place_exclusion_rules WHERE is_active = TRUE
--
-- Companion table place_allowlist holds destination QSRs that always pass
-- even if their name would match a chain_name rule.
-- ============================================================

CREATE TABLE IF NOT EXISTS place_exclusion_rules (

  id               SERIAL PRIMARY KEY,

  -- Rule type (drives how `value` is interpreted by the pipeline)
  rule_type        TEXT NOT NULL,
  -- chain_name      → value is an exact display name string
  -- min_rating      → value is a decimal string, e.g. "3.5"
  -- min_reviews     → value is an integer string, e.g. "10"
  -- business_status → value is a Google businessStatus enum string

  -- The value to match/compare against
  value            TEXT NOT NULL,

  -- Code written to raw_places.exclusion_reason when this rule fires
  exclusion_reason TEXT NOT NULL,
  -- chain_excluded | low_rating | too_few_reviews | permanently_closed

  -- UI / reporting grouping
  category         TEXT,
  -- fast_food | coffee_cafe | fast_casual | snack_dessert
  -- casual_dining | bar_chain | quality_threshold | business_status

  -- Editorial notes: why is this rule here?
  notes            TEXT,

  -- Toggle without deleting — pipeline skips inactive rules
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_exclusion_rule UNIQUE (rule_type, value)
);

-- Auto-update updated_at on any row change
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_exclusion_rules_updated_at ON place_exclusion_rules;
CREATE TRIGGER trg_exclusion_rules_updated_at
  BEFORE UPDATE ON place_exclusion_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Indexes ───────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_excl_rules_rule_type ON place_exclusion_rules(rule_type);
CREATE INDEX IF NOT EXISTS idx_excl_rules_is_active  ON place_exclusion_rules(is_active);
CREATE INDEX IF NOT EXISTS idx_excl_rules_category   ON place_exclusion_rules(category);


-- ============================================================
-- place_allowlist: Destination QSRs that always pass filtering
-- ============================================================
-- Any place whose displayName.text appears here is allowed through
-- regardless of chain_name rules in place_exclusion_rules.
-- ============================================================

CREATE TABLE IF NOT EXISTS place_allowlist (

  id         SERIAL PRIMARY KEY,

  -- Exact display name (case-sensitive, matches Google displayName.text)
  name       TEXT NOT NULL UNIQUE,

  -- Why this place is allowlisted
  notes      TEXT,

  is_active  BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_allowlist_is_active ON place_allowlist(is_active);


-- ============================================================
-- Seed: place_allowlist (Destination QSR)
-- ============================================================

INSERT INTO place_allowlist (name, notes) VALUES
  ('Shake Shack',        'Premium fast-casual burger chain — genuine destination quality'),
  ('Fuku',               'David Chang fried chicken concept — destination worth including'),
  ('Eataly',             'Italian marketplace / restaurant complex — major destination'),
  ('Roberta''s',         'Brooklyn pizza icon with Manhattan outposts — destination'),
  ('Joe''s Pizza',       'Classic NYC institution — worth including despite QSR format'),
  ('J.G. Melon',         'Old-school NYC burger spot — neighborhood institution'),
  ('Superiority Burger', 'James Beard-recognized vegetarian burger spot'),
  ('Dirt Candy',         'Michelin-starred vegetable-focused restaurant by Amanda Cohen'),
  ('Los Tacos No. 1',    'Widely cited as best tacos in NYC — destination QSR despite counter-service format')
ON CONFLICT (name) DO NOTHING;


-- ============================================================
-- Seed: place_exclusion_rules — Quality thresholds
-- ============================================================

INSERT INTO place_exclusion_rules (rule_type, value, exclusion_reason, category, notes) VALUES
  ('min_rating',      '3.5',               'low_rating',        'quality_threshold',
   'Exclude places rated below 3.5 on Google. Lowerable for newer openings without accumulated reviews.'),
  ('min_reviews',     '10',                'too_few_reviews',   'quality_threshold',
   'Exclude places with fewer than 10 Google reviews. Lowered from 25 to catch newer openings like Limusina in Hudson Yards.'),
  ('business_status', 'CLOSED_PERMANENTLY', 'permanently_closed', 'business_status',
   'Exclude places Google has marked as permanently closed.'),
  ('business_status', 'TEMPORARILY_CLOSED', 'temporarily_closed', 'business_status',
   'Exclude places Google has marked as temporarily closed. Re-evaluate once they reopen.')
ON CONFLICT (rule_type, value) DO NOTHING;


-- ============================================================
-- Seed: place_exclusion_rules — Chain exclusions
-- ============================================================

-- Fast food
INSERT INTO place_exclusion_rules (rule_type, value, exclusion_reason, category, notes) VALUES
  ('chain_name', 'McDonald''s',     'chain_excluded', 'fast_food', 'Global QSR chain'),
  ('chain_name', 'Subway',          'chain_excluded', 'fast_food', 'Global sandwich chain'),
  ('chain_name', 'Burger King',     'chain_excluded', 'fast_food', 'Global QSR chain'),
  ('chain_name', 'Wendy''s',        'chain_excluded', 'fast_food', 'QSR chain'),
  ('chain_name', 'Taco Bell',       'chain_excluded', 'fast_food', 'QSR chain'),
  ('chain_name', 'KFC',             'chain_excluded', 'fast_food', 'QSR chain'),
  ('chain_name', 'Pizza Hut',       'chain_excluded', 'fast_food', 'QSR pizza chain'),
  ('chain_name', 'Domino''s',       'chain_excluded', 'fast_food', 'QSR pizza chain'),
  ('chain_name', 'Papa John''s',    'chain_excluded', 'fast_food', 'QSR pizza chain'),
  ('chain_name', 'Little Caesars',  'chain_excluded', 'fast_food', 'QSR pizza chain'),
  ('chain_name', 'Popeyes',         'chain_excluded', 'fast_food', 'QSR fried chicken chain'),
  ('chain_name', 'Chick-fil-A',     'chain_excluded', 'fast_food', 'QSR fried chicken chain'),
  ('chain_name', 'Five Guys',       'chain_excluded', 'fast_food', 'Burger chain'),
  ('chain_name', 'Jersey Mike''s',  'chain_excluded', 'fast_food', 'Sandwich chain'),
  ('chain_name', 'Jimmy John''s',   'chain_excluded', 'fast_food', 'Sandwich chain'),
  ('chain_name', 'Firehouse Subs',  'chain_excluded', 'fast_food', 'Sandwich chain'),
  ('chain_name', 'Wingstop',        'chain_excluded', 'fast_food', 'Wings chain'),
  ('chain_name', 'Raising Cane''s', 'chain_excluded', 'fast_food', 'Chicken tenders chain'),
  ('chain_name', 'Whataburger',     'chain_excluded', 'fast_food', 'Regional burger chain'),
  ('chain_name', 'Hardees',         'chain_excluded', 'fast_food', 'QSR chain')
ON CONFLICT (rule_type, value) DO NOTHING;

-- Coffee / café chains
INSERT INTO place_exclusion_rules (rule_type, value, exclusion_reason, category, notes) VALUES
  ('chain_name', 'Starbucks',       'chain_excluded', 'coffee_cafe', 'Global coffee chain'),
  ('chain_name', 'Dunkin''',        'chain_excluded', 'coffee_cafe', 'Coffee/donut chain'),
  ('chain_name', 'Dunkin Donuts',   'chain_excluded', 'coffee_cafe', 'Legacy name for Dunkin'''),
  ('chain_name', 'Tim Hortons',     'chain_excluded', 'coffee_cafe', 'Canadian coffee chain'),
  ('chain_name', 'Pret a Manger',   'chain_excluded', 'coffee_cafe', 'UK-origin fast casual café chain'),
  ('chain_name', 'Le Pain Quotidien','chain_excluded','coffee_cafe', 'Belgian bakery chain')
ON CONFLICT (rule_type, value) DO NOTHING;

-- Fast casual
INSERT INTO place_exclusion_rules (rule_type, value, exclusion_reason, category, notes) VALUES
  ('chain_name', 'Chipotle',               'chain_excluded', 'fast_casual', 'Mexican fast casual chain'),
  ('chain_name', 'Chipotle Mexican Grill', 'chain_excluded', 'fast_casual', 'Same brand, alternate display name'),
  ('chain_name', 'Panera Bread',           'chain_excluded', 'fast_casual', 'Bakery-café chain'),
  ('chain_name', 'Panda Express',          'chain_excluded', 'fast_casual', 'Chinese-American fast casual chain'),
  ('chain_name', 'Sweetgreen',             'chain_excluded', 'fast_casual', 'Salad chain'),
  ('chain_name', 'Dig',                    'chain_excluded', 'fast_casual', 'Farm-to-counter fast casual chain'),
  ('chain_name', 'Cosi',                   'chain_excluded', 'fast_casual', 'Sandwich chain'),
  ('chain_name', 'Quiznos',                'chain_excluded', 'fast_casual', 'Toasted sandwich chain'),
  ('chain_name', 'Arby''s',               'chain_excluded', 'fast_casual', 'Roast beef sandwich chain')
ON CONFLICT (rule_type, value) DO NOTHING;

-- Snack / dessert chains
INSERT INTO place_exclusion_rules (rule_type, value, exclusion_reason, category, notes) VALUES
  ('chain_name', 'Auntie Anne''s',    'chain_excluded', 'snack_dessert', 'Mall pretzel chain'),
  ('chain_name', 'Cinnabon',          'chain_excluded', 'snack_dessert', 'Mall cinnamon roll chain'),
  ('chain_name', 'Jamba',             'chain_excluded', 'snack_dessert', 'Smoothie chain (rebranded from Jamba Juice)'),
  ('chain_name', 'Jamba Juice',       'chain_excluded', 'snack_dessert', 'Smoothie chain (legacy name)'),
  ('chain_name', 'Cold Stone Creamery','chain_excluded','snack_dessert', 'Ice cream chain'),
  ('chain_name', 'Baskin-Robbins',    'chain_excluded', 'snack_dessert', 'Ice cream chain')
ON CONFLICT (rule_type, value) DO NOTHING;

-- Casual dining chains
INSERT INTO place_exclusion_rules (rule_type, value, exclusion_reason, category, notes) VALUES
  ('chain_name', 'Applebee''s',          'chain_excluded', 'casual_dining', 'Casual dining chain'),
  ('chain_name', 'Denny''s',             'chain_excluded', 'casual_dining', 'Casual diner chain'),
  ('chain_name', 'IHOP',                 'chain_excluded', 'casual_dining', 'Pancake chain'),
  ('chain_name', 'Olive Garden',         'chain_excluded', 'casual_dining', 'Italian-American casual dining chain'),
  ('chain_name', 'Chili''s',             'chain_excluded', 'casual_dining', 'Tex-Mex casual dining chain'),
  ('chain_name', 'T.G.I. Friday''s',     'chain_excluded', 'casual_dining', 'Casual dining chain'),
  ('chain_name', 'Red Lobster',          'chain_excluded', 'casual_dining', 'Seafood casual dining chain'),
  ('chain_name', 'Outback Steakhouse',   'chain_excluded', 'casual_dining', 'Australian-themed casual steakhouse chain'),
  ('chain_name', 'Buffalo Wild Wings',   'chain_excluded', 'casual_dining', 'Wings-focused sports bar chain'),
  ('chain_name', 'Hooters',              'chain_excluded', 'casual_dining', 'Wings/casual dining chain')
ON CONFLICT (rule_type, value) DO NOTHING;

-- Bar chains / generic sports bars
INSERT INTO place_exclusion_rules (rule_type, value, exclusion_reason, category, notes) VALUES
  ('chain_name', 'Dave & Buster''s',        'chain_excluded', 'bar_chain', 'Entertainment/arcade bar chain'),
  ('chain_name', 'Twin Peaks',              'chain_excluded', 'bar_chain', 'Sports bar chain'),
  ('chain_name', 'Yard House',              'chain_excluded', 'bar_chain', 'Large-format beer bar chain'),
  ('chain_name', 'Bar Louie',               'chain_excluded', 'bar_chain', 'Bar and grill chain'),
  ('chain_name', 'Applebee''s Bar & Grill', 'chain_excluded', 'bar_chain', 'Variant name for Applebee''s'),
  ('chain_name', 'World of Beer',           'chain_excluded', 'bar_chain', 'Beer bar chain')
ON CONFLICT (rule_type, value) DO NOTHING;
