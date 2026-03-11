// ============================================================
// build-filtered-places.js — Phase 1 filtering pipeline
// ============================================================
// Builds (or rebuilds) the filtered_places staging table from scratch.
//
// Pipeline steps:
//   1. Truncate filtered_places (clean slate for this run)
//   2. Insert existing curated restaurants (source_status = 'existing')
//   3. Identify new candidates from raw_places (status = 'pending', not in restaurants)
//   4. AI-classify candidates via Claude to determine relevance
//   5. Insert approved candidates (source_status = 'ai_candidate')
//
// Usage:
//   node scripts/build-filtered-places.js
//   node scripts/build-filtered-places.js --area hudson_yards   (filter by search_area)
//   node scripts/build-filtered-places.js --dry-run              (skip DB writes, preview only)

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

// ── Config ────────────────────────────────────────────────
const AI_BATCH_SIZE = 30;  // candidates per Claude API call
const DB_BATCH_SIZE = 50;  // rows per Supabase upsert

// ── Claude classification tool definition ─────────────────
const CLASSIFICATION_TOOL = {
  name: 'classify_restaurants',
  description:
    'Classify a batch of restaurant candidates as relevant or not for a curated NYC dining guide.',
  input_schema: {
    type: 'object',
    properties: {
      classifications: {
        type: 'array',
        description: 'One entry per candidate, in the same order as provided.',
        items: {
          type: 'object',
          properties: {
            google_place_id: {
              type: 'string',
              description: 'The google_place_id of the candidate being classified.',
            },
            relevant: {
              type: 'boolean',
              description: 'true = include in the curated guide, false = exclude.',
            },
            reason: {
              type: 'string',
              description: 'Brief reason for the decision (1–2 sentences).',
            },
          },
          required: ['google_place_id', 'relevant', 'reason'],
        },
      },
    },
    required: ['classifications'],
  },
};

// ── Claude system prompt ───────────────────────────────────
const CLASSIFICATION_SYSTEM_PROMPT = `\
You are a restaurant curation expert for a premium NYC neighborhood dining guide covering
19 Manhattan neighborhoods: Hudson Yards, Chelsea, Meatpacking District, West Village,
Greenwich Village, Hudson Square, SoHo, NoHo, Tribeca, Financial District, Little Italy,
Chinatown, NoLita, Lower East Side, Union Square, Gramercy, Flatiron, NoMad, and East Village.

Your task is to evaluate candidate restaurants and decide whether each one belongs in a
curated, editorial-quality dining guide that locals and visitors use to find great meals.

━━━ EXCLUDE these types ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Fast food chains (McDonald's, Subway, Burger King, Taco Bell, KFC, Popeyes, etc.)
• Quick service / counter-service restaurants (QSR) with no table service
• Major national or international chains that are not destination-worthy
  (Applebee's, Chili's, Olive Garden, IHOP, Denny's, TGI Friday's, Outback, etc.)
• Generic coffee shops and bakeries (Starbucks, Dunkin', Tim Hortons, Pret a Manger,
  Le Pain Quotidien, generic café chains)
• Convenience stores, bodegas, delis, and food kiosks
• Grocery stores, supermarkets, or food halls that are just grocery shopping
• Hotel restaurants that are generic lobby cafes (not destination restaurants)
• Vending machines, catering companies, private dining clubs (not open to public)
• Franchise chains in snacks/dessert (Auntie Anne's, Cinnabon, Jamba Juice, etc.)
• Sports bar chains (Dave & Buster's, Buffalo Wild Wings, Twin Peaks, Yard House, etc.)
• Places that are clearly outside the intended neighborhood or district

━━━ INCLUDE these types ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Full-service, sit-down restaurants of any cuisine
• Chef-driven or concept-driven dining destinations
• Notable bars and cocktail lounges with a meaningful food menu
• Destination casual dining, brunch spots, and lunch counters worth a visit
• Unique food concepts with a clear identity and local following
• Wine bars, sake bars, or specialty beverage spots with food
• Well-regarded ethnic restaurants with quality ingredients and a loyal following
• Notable food halls or market concepts (e.g., José Andrés concepts, Eataly)
• Hotel restaurants that are genuine dining destinations (not generic lobby cafes)

━━━ DECISION GUIDANCE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Use the name, Google place types, editorial summary, address, and price level together.
• A place labeled "restaurant" or "bar" with a high price level and an editorial summary
  about the cuisine is almost always relevant.
• A place labeled "fast_food_restaurant" or "meal_takeaway" with no editorial summary
  and a low price level is almost always not relevant.
• When in genuine doubt about a borderline case, lean toward EXCLUDING.
• Return a classification for EVERY candidate in the batch, in the same order provided.`;

// ── Supabase client ───────────────────────────────────────
function getSupabase() {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env\n' +
      'Note: Use SUPABASE_SERVICE_ROLE_KEY (not the anon key) for write access.'
    );
  }
  return createClient(url, key);
}

// ── Anthropic client ──────────────────────────────────────
function getAnthropic() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('Missing ANTHROPIC_API_KEY in .env');
  return new Anthropic({ apiKey: key });
}

// ── CLI args ──────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const areaIdx = args.indexOf('--area');
  return {
    area: areaIdx !== -1 ? args[areaIdx + 1] : null,
    dryRun: args.includes('--dry-run'),
  };
}

// ─────────────────────────────────────────────────────────
// STEP 1: Truncate filtered_places
// ─────────────────────────────────────────────────────────
async function truncateFilteredPlaces(supabase, dryRun) {
  console.log('[1/5] Clearing filtered_places table...');
  if (dryRun) {
    console.log('  [DRY RUN] Skipping truncate.');
    return;
  }
  const { error } = await supabase
    .from('filtered_places')
    .delete()
    .gte('id', 1);
  if (error) throw new Error(`Truncate failed: ${error.message}`);
  console.log('  ✅ Table cleared.\n');
}

// ─────────────────────────────────────────────────────────
// STEP 2: Insert existing curated restaurants
// ─────────────────────────────────────────────────────────
async function insertExistingRestaurants(supabase, dryRun) {
  console.log('[2/5] Inserting existing curated restaurants...');

  // Get all curated restaurants (curated-only fields + the join key)
  const { data: restaurants, error: restErr } = await supabase
    .from('restaurants')
    .select('google_place_id, cuisine, notes, instagram, reservation');
  if (restErr) throw new Error(`Failed to fetch restaurants: ${restErr.message}`);

  const curatedIds = restaurants
    .filter(r => r.google_place_id)
    .map(r => r.google_place_id);

  if (curatedIds.length === 0) {
    console.log('  ⚠️  No curated restaurants have a google_place_id yet.\n');
    return 0;
  }

  // Get Google data for those IDs from raw_places
  const { data: rawRows, error: rawErr } = await supabase
    .from('raw_places')
    .select(
      'google_place_id, name, address, district, neighborhood_area, custom_district, ' +
      'price_level, hours, phone, website, google_types, editorial_summary'
    )
    .in('google_place_id', curatedIds);
  if (rawErr) throw new Error(`Failed to fetch raw_places for existing restaurants: ${rawErr.message}`);

  const rawByPlaceId = Object.fromEntries(rawRows.map(r => [r.google_place_id, r]));

  // Curated lookup map
  const curatedByPlaceId = Object.fromEntries(
    restaurants.filter(r => r.google_place_id).map(r => [r.google_place_id, r])
  );

  const matched  = curatedIds.filter(id => rawByPlaceId[id]);
  const unmatched = curatedIds.filter(id => !rawByPlaceId[id]);

  console.log(`  Curated restaurants total:   ${restaurants.length}`);
  console.log(`  Matched to raw_places:       ${matched.length}`);
  if (unmatched.length > 0) {
    console.log(`  ⚠️  No raw_places match:      ${unmatched.length}`);
    for (const id of unmatched) {
      console.log(`     · google_place_id: ${id}`);
    }
  }

  if (matched.length === 0) {
    console.log('  ⚠️  No existing restaurants to insert (IDs not yet in raw_places).\n');
    return 0;
  }

  // Build rows: Google fields from raw_places, curated fields from restaurants
  const rows = matched.map(id => {
    const rp = rawByPlaceId[id];
    const cur = curatedByPlaceId[id];
    return {
      google_places_id:   id,
      name:               rp.name,
      address:            rp.address,
      district:           rp.district,
      area:               rp.neighborhood_area,
      custom_district:    rp.custom_district,
      cuisine:            cur.cuisine,
      notes:              cur.notes,
      price:              rp.price_level,
      hours:              rp.hours,
      phone:              rp.phone,
      website:            rp.website,
      instagram:          cur.instagram,
      reservation:        cur.reservation,
      google_types:       rp.google_types,
      editorial_summary:  rp.editorial_summary,
      source_status:      'existing',
    };
  });

  if (dryRun) {
    console.log(`  [DRY RUN] Would insert ${rows.length} existing restaurants.\n`);
    return rows.length;
  }

  // Upsert in batches
  for (let i = 0; i < rows.length; i += DB_BATCH_SIZE) {
    const batch = rows.slice(i, i + DB_BATCH_SIZE);
    const { error } = await supabase
      .from('filtered_places')
      .upsert(batch, { onConflict: 'google_places_id' });
    if (error) throw new Error(`Upsert existing restaurants failed: ${error.message}`);
  }

  console.log(`  ✅ ${rows.length} existing restaurants inserted (source_status = 'existing').\n`);
  return rows.length;
}

// ─────────────────────────────────────────────────────────
// STEP 3: Identify new candidate restaurants
// ─────────────────────────────────────────────────────────
async function getCandidates(supabase, areaFilter) {
  console.log('[3/5] Identifying new candidate restaurants...');

  // Get all google_place_ids already in the restaurants table
  const { data: restaurantIds, error: rErr } = await supabase
    .from('restaurants')
    .select('google_place_id')
    .not('google_place_id', 'is', null);
  if (rErr) throw new Error(`Failed to fetch restaurant IDs: ${rErr.message}`);
  const existingRestaurantIds = new Set(restaurantIds.map(r => r.google_place_id));

  // Query raw_places for pending rows
  let query = supabase
    .from('raw_places')
    .select(
      'google_place_id, name, address, district, neighborhood_area, custom_district, ' +
      'google_types, editorial_summary, price_level, price_range, ' +
      'google_rating, google_review_count, phone, website, hours, ' +
      'business_status, search_area'
    )
    .eq('status', 'pending');

  if (areaFilter) {
    query = query.eq('search_area', areaFilter);
  }

  const { data: pending, error: pErr } = await query;
  if (pErr) throw new Error(`Failed to fetch pending raw_places: ${pErr.message}`);

  // Exclude places already in the curated restaurants table
  const candidates = pending.filter(p => !existingRestaurantIds.has(p.google_place_id));

  console.log(`  Pending raw_places${areaFilter ? ` (${areaFilter})` : ''}:  ${pending.length}`);
  console.log(`  Already in restaurants:       ${pending.length - candidates.length}`);
  console.log(`  New candidates to classify:   ${candidates.length}\n`);

  return candidates;
}

// ─────────────────────────────────────────────────────────
// STEP 4: AI classification
// ─────────────────────────────────────────────────────────

/**
 * Classify a single batch of candidates via Claude.
 * Returns an array of { google_place_id, relevant, reason }.
 */
async function classifyBatch(anthropic, batch, batchLabel) {
  const candidateList = batch
    .map((p, idx) => {
      const types = Array.isArray(p.google_types)
        ? p.google_types.join(', ')
        : (p.google_types ?? 'unknown');
      return [
        `${idx + 1}. google_place_id: ${p.google_place_id}`,
        `   Name: ${p.name}`,
        `   Address: ${p.address ?? 'Unknown'}`,
        `   District: ${p.district ?? p.neighborhood_area ?? 'Unknown'}`,
        `   Google Types: ${types}`,
        `   Price Level: ${p.price_range ?? `${p.price_level ?? 'Unknown'}`}`,
        `   Rating: ${p.google_rating ?? 'N/A'} (${p.google_review_count ?? 0} reviews)`,
        `   Editorial Summary: ${p.editorial_summary ?? 'None'}`,
      ].join('\n');
    })
    .join('\n\n');

  const userMessage =
    `Classify the following ${batch.length} restaurant candidates for the curated dining guide.\n\n` +
    `Return a classification for every candidate.\n\n${candidateList}`;

  let response;
  try {
    response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: CLASSIFICATION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
      tools: [CLASSIFICATION_TOOL],
      tool_choice: { type: 'tool', name: 'classify_restaurants' },
    });
  } catch (err) {
    throw new Error(`Claude API error on ${batchLabel}: ${err.message}`);
  }

  const toolUseBlock = response.content.find(b => b.type === 'tool_use');
  if (!toolUseBlock) {
    throw new Error(`No tool_use block returned by Claude for ${batchLabel}`);
  }

  const { classifications } = toolUseBlock.input;

  // Validate: ensure every candidate got a result
  const returnedIds = new Set(classifications.map(c => c.google_place_id));
  const missing = batch.filter(p => !returnedIds.has(p.google_place_id));
  if (missing.length > 0) {
    console.warn(
      `  ⚠️  ${batchLabel}: Claude did not return a classification for ${missing.length} candidate(s):`,
      missing.map(p => p.name).join(', ')
    );
    // Default missing candidates to excluded
    for (const p of missing) {
      classifications.push({
        google_place_id: p.google_place_id,
        relevant: false,
        reason: 'No classification returned by AI — defaulting to excluded.',
      });
    }
  }

  return classifications;
}

/**
 * Classify all candidates in batches. Returns a flat array of classifications.
 */
async function classifyCandidates(anthropic, candidates) {
  const totalBatches = Math.ceil(candidates.length / AI_BATCH_SIZE);
  console.log(
    `[4/5] AI classifying ${candidates.length} candidates ` +
    `in ${totalBatches} batch(es) of up to ${AI_BATCH_SIZE}...`
  );

  const allClassifications = [];
  let totalApproved = 0;
  let totalExcluded = 0;

  for (let i = 0; i < candidates.length; i += AI_BATCH_SIZE) {
    const batch = candidates.slice(i, i + AI_BATCH_SIZE);
    const batchNum = Math.floor(i / AI_BATCH_SIZE) + 1;
    const batchLabel = `Batch ${batchNum}/${totalBatches}`;

    process.stdout.write(`  ${batchLabel} (${batch.length} candidates)... `);

    const classifications = await classifyBatch(anthropic, batch, batchLabel);
    allClassifications.push(...classifications);

    const approved = classifications.filter(c => c.relevant).length;
    const excluded = classifications.filter(c => !c.relevant).length;
    totalApproved += approved;
    totalExcluded += excluded;

    console.log(`✅ ${approved} approved, ❌ ${excluded} excluded`);
  }

  console.log(`\n  AI classification complete:`);
  console.log(`    Approved (relevant = true):  ${totalApproved}`);
  console.log(`    Excluded (relevant = false): ${totalExcluded}\n`);

  return allClassifications;
}

// ─────────────────────────────────────────────────────────
// STEP 5: Insert approved candidates
// ─────────────────────────────────────────────────────────
async function insertApprovedCandidates(supabase, candidates, classifications, dryRun) {
  console.log('[5/5] Inserting approved AI candidates...');

  // Map raw_places rows by google_place_id for fast lookup
  const candidateMap = new Map(candidates.map(c => [c.google_place_id, c]));

  // Filter to approved only and build filtered_places rows
  const approvedRows = classifications
    .filter(c => c.relevant)
    .map(c => {
      const raw = candidateMap.get(c.google_place_id);
      if (!raw) {
        console.warn(`  ⚠️  Could not find raw_places row for approved ID: ${c.google_place_id}`);
        return null;
      }
      return {
        google_places_id:   raw.google_place_id,
        name:               raw.name,
        address:            raw.address,
        district:           raw.district,
        area:               raw.neighborhood_area,
        custom_district:    raw.custom_district,
        cuisine:            null,   // not available from raw_places; fill in later via enrichment
        notes:              null,   // not available from raw_places; editorial to be added
        price:              raw.price_level,
        hours:              raw.hours,
        phone:              raw.phone,
        website:            raw.website,
        instagram:          null,   // not available from raw_places
        reservation:        null,   // not available from raw_places
        google_types:       raw.google_types,
        editorial_summary:  raw.editorial_summary,
        source_status:      'ai_candidate',
      };
    })
    .filter(Boolean);

  if (approvedRows.length === 0) {
    console.log('  No approved candidates to insert.\n');
    return 0;
  }

  if (dryRun) {
    console.log(`  [DRY RUN] Would insert ${approvedRows.length} approved candidates.`);
    console.log('  Sample approved:');
    for (const row of approvedRows.slice(0, 10)) {
      const cls = classifications.find(c => c.google_place_id === row.google_places_id);
      console.log(`    · ${row.name} — ${cls?.reason ?? ''}`);
    }
    if (approvedRows.length > 10) {
      console.log(`    … and ${approvedRows.length - 10} more.`);
    }
    console.log();
    return approvedRows.length;
  }

  // Upsert in batches
  for (let i = 0; i < approvedRows.length; i += DB_BATCH_SIZE) {
    const batch = approvedRows.slice(i, i + DB_BATCH_SIZE);
    const { error } = await supabase
      .from('filtered_places')
      .upsert(batch, { onConflict: 'google_places_id' });
    if (error) throw new Error(`Upsert approved candidates failed: ${error.message}`);
  }

  console.log(`  ✅ ${approvedRows.length} approved candidates inserted (source_status = 'ai_candidate').\n`);
  return approvedRows.length;
}

// ─────────────────────────────────────────────────────────
// Exclusion summary (helpful for reviewing what was filtered)
// ─────────────────────────────────────────────────────────
function printExclusionSummary(candidates, classifications) {
  const excluded = classifications.filter(c => !c.relevant);
  if (excluded.length === 0) return;

  const candidateMap = new Map(candidates.map(c => [c.google_place_id, c]));
  console.log(`\n${'─'.repeat(56)}`);
  console.log(`  Excluded candidates (${excluded.length})`);
  console.log(`${'─'.repeat(56)}`);
  for (const cls of excluded) {
    const raw = candidateMap.get(cls.google_place_id);
    console.log(`  · ${raw?.name ?? cls.google_place_id}`);
    console.log(`    Reason: ${cls.reason}`);
  }
}

// ─────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────
async function run() {
  const { area, dryRun } = parseArgs();

  console.log(`\n${'═'.repeat(56)}`);
  console.log('  build-filtered-places — Phase 1 pipeline');
  if (area)    console.log(`  Area filter: ${area}`);
  if (dryRun)  console.log('  🔍 DRY RUN — no database writes');
  console.log(`${'═'.repeat(56)}\n`);

  const supabase  = getSupabase();
  const anthropic = getAnthropic();

  // ── Step 1: Truncate ──────────────────────────────────
  await truncateFilteredPlaces(supabase, dryRun);

  // ── Step 2: Existing curated restaurants ─────────────
  const existingCount = await insertExistingRestaurants(supabase, dryRun);

  // ── Step 3: Candidates ────────────────────────────────
  const candidates = await getCandidates(supabase, area);

  if (candidates.length === 0) {
    console.log('No new candidates found. Pipeline complete.\n');
    console.log(`${'═'.repeat(56)}`);
    console.log(`  Final filtered_places count: ${existingCount} (existing only)`);
    console.log(`${'═'.repeat(56)}\n`);
    return;
  }

  // ── Step 4: AI classification ─────────────────────────
  const classifications = await classifyCandidates(anthropic, candidates);

  // ── Step 5: Insert approved ───────────────────────────
  const newCount = await insertApprovedCandidates(supabase, candidates, classifications, dryRun);

  // ── Summary ───────────────────────────────────────────
  const totalExcluded = classifications.filter(c => !c.relevant).length;

  console.log(`${'═'.repeat(56)}`);
  console.log('  Pipeline complete!');
  console.log(`${'═'.repeat(56)}`);
  console.log(`  Existing curated restaurants: ${existingCount}`);
  console.log(`  New candidates evaluated:     ${candidates.length}`);
  console.log(`  New candidates approved:      ${newCount}`);
  console.log(`  New candidates excluded:      ${totalExcluded}`);
  console.log(`  Total in filtered_places:     ${existingCount + newCount}`);
  console.log(`${'═'.repeat(56)}\n`);

  // Print exclusion list for review
  printExclusionSummary(candidates, classifications);
}

run().catch(err => {
  console.error(`\n❌ Fatal error: ${err.message}`);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
