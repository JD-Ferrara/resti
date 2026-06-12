// ============================================================
// synthesize-filtered-places.js — Step 5 synthesis pipeline
// ============================================================
// Reads rows from filtered_places (JOINed with raw_places for
// extra signals), calls Claude to synthesize five fields, then
// writes the results back to filtered_places:
//
//   name          → cleaned, customer-ready display name
//   cuisine       → controlled-vocabulary cuisine label
//   notes         → punchy editorial blurb (100–250 chars)
//   price         → validated 1–4 tier (may override Google)
//   proposed_tags → JSONB of applicable restaurant_tags booleans
//
// proposed_tags are stored in filtered_places until a future
// Step 6 "Promote" action upserts rows to restaurants +
// restaurant_tags (which requires a restaurants.id FK).
//
// Usage:
//   node scripts/synthesize-filtered-places.js               (incremental — pending only)
//   node scripts/synthesize-filtered-places.js --force        (re-synthesize all)
//   node scripts/synthesize-filtered-places.js --dry-run      (preview, no DB writes)
//   node scripts/synthesize-filtered-places.js --id ChIJ...  (single place by google_places_id)

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

// ── Config ────────────────────────────────────────────────
const AI_BATCH_SIZE = 12;   // restaurants per Claude call
const DB_BATCH_SIZE = 50;   // rows per Supabase upsert

// ── Args ──────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const FORCE   = args.includes('--force');
const ID_IDX  = args.indexOf('--id');
const SINGLE_ID = ID_IDX !== -1 ? args[ID_IDX + 1] : null;

// ── Clients ───────────────────────────────────────────────
const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── All 44 tag column names (mirrors restaurant_tags schema) ─
const ALL_TAGS = [
  // Occasion
  'romantic_milestone', 'saturday_night_out', 'birthday_dinner',
  'business_dinner', 'business_lunch', 'first_date', 'anniversary',
  'after_work_drinks', 'sunday_brunch',
  // Vibe
  'intimate_quiet', 'buzzy_lively', 'trendy_scene', 'unpretentious',
  'old_school_classic', 'hidden_gem', 'cozy', 'grand_impressive',
  // Drinks
  'craft_cocktails', 'extensive_wine_list', 'natural_wine',
  'great_beer_selection', 'standard_bar', 'destination_bar',
  // Food
  'sharing_plates', 'tasting_menu', 'traditional_entrees',
  'bar_snacks_only', 'chef_driven',
  // Group
  'solo_friendly', 'large_group', 'couples_only_vibe',
  'family_friendly', 'watch_games_with_friends',
  // Dietary
  'vegan', 'vegetarian_friendly', 'gluten_free_friendly',
  // Value
  'worth_the_splurge', 'overpriced_for_what_it_is', 'great_value',
  'corporate_card_only', 'happy_hour_deal', 'budget_friendly',
];

// ── Claude tool definition ────────────────────────────────
const SYNTHESIS_TOOL = {
  name: 'synthesize_restaurants',
  description:
    'Synthesize display-ready data for a batch of NYC restaurant candidates.',
  input_schema: {
    type: 'object',
    properties: {
      results: {
        type: 'array',
        description: 'One entry per restaurant, in the same order as provided.',
        items: {
          type: 'object',
          properties: {
            google_places_id: {
              type: 'string',
              description: 'The google_places_id of the restaurant.',
            },
            cleaned_name: {
              type: 'string',
              description: 'Customer-ready display name with proper capitalization.',
            },
            cuisine: {
              type: 'string',
              description: 'Cuisine label from the approved taxonomy (1–3 words).',
            },
            notes: {
              type: 'string',
              description:
                'Editorial blurb: 100–250 characters, punchy, conversational.',
            },
            price: {
              type: 'integer',
              description: 'Validated price tier: 1 ($), 2 ($$), 3 ($$$), 4 ($$$$).',
              enum: [1, 2, 3, 4],
            },
            proposed_tags: {
              type: 'object',
              description:
                'Only include tags that are genuinely true. Omit false ones.',
              properties: Object.fromEntries(
                ALL_TAGS.map(t => [t, { type: 'boolean' }])
              ),
              additionalProperties: false,
            },
          },
          required: ['google_places_id', 'cleaned_name', 'cuisine', 'notes', 'price', 'proposed_tags'],
        },
      },
    },
    required: ['results'],
  },
};

// ── System prompt ─────────────────────────────────────────
const SYSTEM_PROMPT = `\
You are the editorial director for a premium NYC neighborhood dining guide covering
Manhattan's most vibrant areas: Hudson Yards, Chelsea, Meatpacking, West Village,
Greenwich Village, Hudson Square, SoHo, NoHo, Tribeca, Financial District, Little Italy,
Chinatown, NoLita, Lower East Side, Union Square, Gramercy, Flatiron, NoMad, and East Village.

Your task is to synthesize five fields for each restaurant. Use all available signals:
the restaurant's name, address, district, Google types, editorial summary, website, price level,
rating, review count, and your own knowledge of the NYC dining scene.

━━━ 1. NAME CLEANING ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Keep only the brand name diners would use out loud.
• Strip location qualifiers: "- A Breakfast & Brunch Restaurant", "Hudson Yards",
  "NYC", "New York", "Manhattan", "West Village", etc.
• Strip format/category tags: "Restaurant & Bar", "Café & Bakery", "Kitchen", etc.
  UNLESS they're core to the brand identity (e.g. "Shake Shack" stays "Shake Shack").
• Fix capitalization — title-case by default.
• Preserve intentional stylizations (e.g. "db Bistro" stays lowercase "db").
• Examples:
    "In Common NYC - A Breakfast & Brunch Restaurant" → "In Common NYC"  [keep NYC — it's part of brand]
    "estiatorio Milos Hudson Yards"                   → "Estiatorio Milos"
    "Tuxula Steak New York"                           → "Tuxula"
    "Le Bernardin Restaurant"                         → "Le Bernardin"

━━━ 2. CUISINE TAXONOMY ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Use 1–3 words. Prefer the established labels below; extend conservatively only if nothing fits.

Approved labels (use these first):
  Modern American, Contemporary American, New American, American Bar & Grill,
  Italian, Modern Italian, Italian Osteria, Italian Market,
  Japanese, Modern Japanese, Omakase, Ramen,
  French, French Brasserie, Modern French,
  Greek, Coastal Greek, Greek Seafood,
  Spanish, Spanish Tapas, Spanish Market,
  Mexican, Upscale Mexican, Contemporary Mexican, Plant-Based Mexican,
  Mediterranean, Eastern Mediterranean, Coastal Mediterranean,
  Steakhouse, Modern Steakhouse, Chophouse,
  Seafood, Modern Seafood,
  Chinese, Cantonese, Sichuan, Shanghainese,
  Korean, Korean BBQ,
  Indian, Modern Indian,
  Thai, Vietnamese, Peruvian, Argentinian,
  Pizza, Neapolitan Pizza,
  Sushi, Izakaya, Nikkei Izakaya,
  Middle Eastern, Israeli, Lebanese,
  Wine Bar, Natural Wine Bar,
  Cocktail Bar, Gastropub,
  Jewish Deli, Bagels & Appetizing,
  Fast Casual, Farm-to-Table, All-Day Café,
  Food Hall, Market Hall

If none fit, coin a label using the same [Style] [Primary] format and flag it
in the notes field with "[NEW CUISINE LABEL]" at the end.

━━━ 3. NOTES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Voice: conversational, insider, direct. NOT marketing copy.
Length: 100–250 characters (tight — every word earns its place).
Content: what makes it worth going, who it's for, the standout thing (dish, vibe, chef, view).

✓ Good: "Dan Kluger's gem. Greywind upstairs, Spygold cocktail bar below. Most neighborhood-feeling spot here."
✓ Good: "Michelin recognized. Chef Hillary Sterling. Caramelized onion torta alone is worth the trip."
✗ Bad: "A beloved neighborhood restaurant offering seasonal New American cuisine in a warm, inviting atmosphere."

Avoid: "is known for", "boasts", "offers", "features", "beloved", "vibrant", "exciting".
Time-sensitive claims: do NOT say "newly opened", "just launched", or similar — these age badly.
If an existing notes value is provided and still accurate, you may reuse or lightly refresh it.
Prefer editorial_summary as a starting signal, then your own knowledge of the restaurant.

━━━ 4. PRICE TIERS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
These are per-person spend INCLUDING a drink or two:

  1 ($)    < $25   Counter service, fast casual, grab-and-go.
  2 ($$)   $25–60  Neighborhood sit-down, casual Italian, gastropub.
  3 ($$$)  $60–120 Upscale casual, chef-driven, full service bar.
  4 ($$$$) $120+   Fine dining, tasting menus, destination restaurants.

Google's price_level is a starting signal but is often wrong. Trust your knowledge
of the restaurant over the provided price signal, especially for well-known spots.

━━━ 5. TAGS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Select only tags that are GENUINELY true for this restaurant. Don't pad.
Output only the true ones — false tags are omitted (they default to false).

Tag definitions:

OCCASION
  romantic_milestone    — special enough for an engagement, anniversary milestone, or first-date wow
  saturday_night_out    — fun, energetic, fits a night out with friends or a date
  birthday_dinner       — celebratory atmosphere, accepts large groups or has a birthday feel
  business_dinner       — polished, quiet enough to talk, impresses clients
  business_lunch        — works for a daytime work meal, not too expensive or loud
  first_date            — good vibe, not too loud, not too stuffy, easy to talk
  anniversary           — romantic, memorable, worth the occasion
  after_work_drinks     — bar-friendly, early evening crowd, good for decompressing
  sunday_brunch         — serves brunch, relaxed weekend atmosphere

VIBE
  intimate_quiet        — small tables, lower noise level, conversation-friendly
  buzzy_lively          — high energy, packed, lively scene
  trendy_scene          — you're likely to see influencers or fashion people here
  unpretentious         — no attitude, approachable, neighborhood feel
  old_school_classic    — institution, long history, classic NYC character
  hidden_gem            — not well-known, under-the-radar, locals' secret
  cozy                  — warm, intimate, comfortable — not vast or cavernous
  grand_impressive      — architecture, views, or scale that makes you say "wow"

DRINKS
  craft_cocktails       — serious cocktail program, skilled bartenders
  extensive_wine_list   — deep list, sommelier, imported or rare bottles
  natural_wine          — natural/biodynamic wine focus
  great_beer_selection  — rotating taps, craft cans, notable beer list
  standard_bar          — basic but functional bar — house wine, beer, well spirits
  destination_bar       — bar alone is a reason to go

FOOD
  sharing_plates        — designed for sharing, small plates or family style
  tasting_menu          — chef's tasting menu available (prix fixe, omakase, etc.)
  traditional_entrees   — classic plated mains, individual dishes
  bar_snacks_only       — limited food menu, mostly snacks or bar bites
  chef_driven           — high-concept, distinctive chef perspective or vision

GROUP
  solo_friendly         — comfortable eating alone, good bar seats or counter
  large_group           — accommodates 8+ easily, good for parties
  couples_only_vibe     — intimate, not great for big groups or kids
  family_friendly       — welcoming to families, kids not out of place
  watch_games_with_friends — TVs, casual, good for sports watching

DIETARY
  vegan                 — full vegan menu or vegan-first concept
  vegetarian_friendly   — solid vegetarian options beyond one sad pasta
  gluten_free_friendly  — accommodates gluten-free without much effort

VALUE
  worth_the_splurge     — expensive but earns it — you leave feeling it was worth it
  overpriced_for_what_it_is — not worth the price relative to quality or experience
  great_value           — punches above its price point
  corporate_card_only   — priced so high only an expense account makes sense
  happy_hour_deal       — explicit happy hour with discounts on food or drink
  budget_friendly       — genuinely cheap, under $20/person easily possible
`;

// ── Fetch rows to process ─────────────────────────────────
async function fetchRows() {
  // Start with filtered_places
  const buildQuery = (withStatusFilter) => {
    let q = supabase.from('filtered_places').select('*');
    if (SINGLE_ID) {
      q = q.eq('google_places_id', SINGLE_ID);
    } else if (!FORCE && withStatusFilter) {
      q = q.eq('synthesis_status', 'pending');
    }
    return q;
  };

  let { data: fpRows, error: fpErr } = await buildQuery(true);

  // synthesis_status column won't exist until the migration is run.
  // Fall back to fetching all rows so the script still works pre-migration.
  if (fpErr && fpErr.message.includes('synthesis_status')) {
    console.warn('⚠️  synthesis_status column not found — run supabase-add-synthesis-columns.sql.');
    console.warn('   Fetching all rows and treating them as pending.\n');
    ({ data: fpRows, error: fpErr } = await buildQuery(false));
  }

  if (fpErr) throw new Error(`filtered_places fetch: ${fpErr.message}`);
  if (!fpRows?.length) return [];

  // JOIN with raw_places for extra signals
  const ids = fpRows.map(r => r.google_places_id);
  const { data: rpRows, error: rpErr } = await supabase
    .from('raw_places')
    .select('google_place_id, google_rating, google_review_count, price_range')
    .in('google_place_id', ids);
  if (rpErr) console.warn(`raw_places fetch warning: ${rpErr.message}`);

  const rpMap = Object.fromEntries((rpRows || []).map(r => [r.google_place_id, r]));

  // JOIN with restaurants to retrieve existing notes (for review/reuse)
  const { data: restRows, error: restErr } = await supabase
    .from('restaurants')
    .select('google_place_id, notes')
    .in('google_place_id', ids);
  if (restErr) console.warn(`restaurants fetch warning: ${restErr.message}`);

  const restMap = Object.fromEntries((restRows || []).map(r => [r.google_place_id, r]));

  return fpRows.map(fp => ({
    ...fp,
    google_rating:       rpMap[fp.google_places_id]?.google_rating ?? null,
    google_review_count: rpMap[fp.google_places_id]?.google_review_count ?? null,
    price_range:         rpMap[fp.google_places_id]?.price_range ?? null,
    existing_notes:      restMap[fp.google_places_id]?.notes ?? null,
  }));
}

// ── Format one row into the Claude input string ───────────
function formatRow(row) {
  const lines = [
    `google_places_id: ${row.google_places_id}`,
    `name: ${row.name}`,
    `address: ${row.address ?? 'unknown'}`,
    `district: ${row.district ?? 'unknown'}`,
  ];
  if (row.area)                lines.push(`area: ${row.area}`);
  if (row.cuisine)             lines.push(`cuisine (Google): ${row.cuisine}`);
  if (row.editorial_summary)   lines.push(`editorial_summary: ${row.editorial_summary}`);
  if (row.google_types)        lines.push(`google_types: ${JSON.stringify(row.google_types)}`);
  if (row.website)             lines.push(`website: ${row.website}`);
  if (row.price != null)       lines.push(`price_level (Google int): ${row.price}`);
  if (row.price_range)         lines.push(`price_range (Google text): ${row.price_range}`);
  if (row.google_rating)       lines.push(`google_rating: ${row.google_rating}`);
  if (row.google_review_count) lines.push(`google_review_count: ${row.google_review_count}`);
  if (row.existing_notes)      lines.push(`existing_notes (review for accuracy): ${row.existing_notes}`);
  return lines.join('\n');
}

// ── Call Claude for one batch ─────────────────────────────
async function synthesizeBatch(batch) {
  const userMessage = batch.map((r, i) =>
    `--- Restaurant ${i + 1} ---\n${formatRow(r)}`
  ).join('\n\n');

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
    tools: [SYNTHESIS_TOOL],
    tool_choice: { type: 'tool', name: 'synthesize_restaurants' },
  });

  const toolUse = response.content.find(b => b.type === 'tool_use');
  if (!toolUse) throw new Error('No tool_use block in Claude response');
  return toolUse.input.results;
}

// ── Write results back to filtered_places ────────────────
async function writeResults(results) {
  const updates = results.map(r => ({
    google_places_id: r.google_places_id,
    name:             r.cleaned_name,
    cuisine:          r.cuisine,
    notes:            r.notes,
    price:            r.price,
    proposed_tags:    r.proposed_tags,
    synthesis_status: 'complete',
  }));

  for (let i = 0; i < updates.length; i += DB_BATCH_SIZE) {
    const chunk = updates.slice(i, i + DB_BATCH_SIZE);
    const { error } = await supabase
      .from('filtered_places')
      .upsert(chunk, { onConflict: 'google_places_id' });
    if (error) throw new Error(`DB upsert failed: ${error.message}`);
  }
}

// ── Mark rows as errored ──────────────────────────────────
async function markErrors(ids) {
  await supabase
    .from('filtered_places')
    .update({ synthesis_status: 'error' })
    .in('google_places_id', ids);
}

// ── Main ──────────────────────────────────────────────────
async function main() {
  console.log(`\n🔬 Step 5: Synthesize Filtered Places`);
  if (DRY_RUN) console.log('   [DRY RUN — no DB writes]');
  if (FORCE)   console.log('   [FORCE — re-synthesizing all rows]');
  if (SINGLE_ID) console.log(`   [SINGLE — ${SINGLE_ID}]`);
  console.log();

  const rows = await fetchRows();
  if (!rows.length) {
    console.log('✅ No rows to process.');
    return;
  }
  console.log(`📋 ${rows.length} row(s) to synthesize`);

  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < rows.length; i += AI_BATCH_SIZE) {
    const batch = rows.slice(i, i + AI_BATCH_SIZE);
    const batchNum = Math.floor(i / AI_BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(rows.length / AI_BATCH_SIZE);
    console.log(`\n⏳ Batch ${batchNum}/${totalBatches} (${batch.length} restaurants)…`);

    let results;
    try {
      results = await synthesizeBatch(batch);
    } catch (err) {
      console.error(`   ❌ Claude error: ${err.message}`);
      if (!DRY_RUN) await markErrors(batch.map(r => r.google_places_id));
      errorCount += batch.length;
      continue;
    }

    if (DRY_RUN) {
      for (const r of results) {
        console.log(`\n  ── ${r.google_places_id} ──`);
        console.log(`  name:    ${r.cleaned_name}`);
        console.log(`  cuisine: ${r.cuisine}`);
        console.log(`  price:   ${r.price}`);
        console.log(`  notes:   ${r.notes}`);
        const trueTags = Object.entries(r.proposed_tags)
          .filter(([, v]) => v)
          .map(([k]) => k);
        console.log(`  tags:    ${trueTags.join(', ') || '(none)'}`);
      }
      successCount += results.length;
    } else {
      try {
        await writeResults(results);
        for (const r of results) {
          const trueTags = Object.entries(r.proposed_tags)
            .filter(([, v]) => v)
            .map(([k]) => k);
          console.log(`  ✓ ${r.cleaned_name} (${r.cuisine}, ${'$'.repeat(r.price)}) — ${trueTags.length} tags`);
        }
        successCount += results.length;
      } catch (err) {
        console.error(`   ❌ DB write error: ${err.message}`);
        await markErrors(batch.map(r => r.google_places_id));
        errorCount += batch.length;
      }
    }
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ Done. ${successCount} synthesized, ${errorCount} errors.`);
  if (errorCount > 0) {
    console.log(`   Re-run with --force to retry errored rows.`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
