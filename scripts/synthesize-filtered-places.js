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
//   node scripts/synthesize-filtered-places.js --enrich-menus (Tavily menu lookup per restaurant)

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

// ── Config ────────────────────────────────────────────────
const AI_BATCH_SIZE = 12;   // restaurants per Claude call
const DB_BATCH_SIZE = 50;   // rows per Supabase upsert

// ── Args ──────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const FORCE         = args.includes('--force');
const ENRICH_MENUS  = args.includes('--enrich-menus');
const ID_IDX        = args.indexOf('--id');
const SINGLE_ID     = ID_IDX !== -1 ? args[ID_IDX + 1] : null;

// ── Clients ───────────────────────────────────────────────
const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);
const anthropic   = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const TAVILY_KEY  = process.env.TAVILY_API_KEY;

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
  'great_beer_selection', 'standard_bar', 'destination_bar', 'mocktail_program',
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
                'Only include tags that are genuinely true for THIS venue specifically. Omit false ones.',
              properties: Object.fromEntries(
                ALL_TAGS.map(t => [t, { type: 'boolean' }])
              ),
              additionalProperties: false,
            },
            parent_concept: {
              type: 'string',
              description:
                'If this venue is a sibling/sub-concept of another venue at the same address, ' +
                'provide the google_places_id of the primary/parent venue. Omit or set null if ' +
                'this is the primary venue or has no sibling relationship.',
              nullable: true,
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
Use 1–3 words. Labels must be immediately recognizable to a general audience
without any culinary insider knowledge. If a label requires a dictionary, it fails.

APPROVED LABELS — use these first:
  Modern American, Contemporary American, New American, American Bar & Grill,
  Italian, Modern Italian, Traditional Italian,
  Japanese, Modern Japanese, Omakase, Ramen,
  French, French Brasserie, Modern French,
  Greek, Coastal Greek, Greek Seafood,
  Spanish, Spanish Tapas,
  Mexican, Upscale Mexican, Contemporary Mexican, Plant-Based Mexican,
  Mediterranean, Eastern Mediterranean, Coastal Mediterranean,
  Steakhouse, Modern Steakhouse, Chophouse,
  Seafood, Modern Seafood,
  Chinese, Cantonese, Sichuan, Shanghainese,
  Korean, Korean BBQ,
  Indian, Modern Indian,
  Thai, Vietnamese, Peruvian, Argentinian,
  Pizza, Neapolitan Pizza,
  Sushi, Izakaya, Nikkei,
  Middle Eastern, Israeli, Lebanese,
  Wine Bar, Natural Wine Bar,
  Cocktail Bar, Gastropub,
  New York Deli, Jewish Deli,
  Fast Casual, Farm-to-Table, All-Day Café,
  Food Hall

REMOVAL — these labels were in a prior list and must NOT be used:
  "Bagels & Appetizing" → use "New York Deli" or "Jewish Deli"
  "Italian Osteria"     → use "Traditional Italian" or "Modern Italian"
  "Italian Market"      → use "Food Hall" or "Italian"
  "Market Hall"         → use "Food Hall"
  "Spanish Market"      → use "Food Hall" or "Spanish"
  "Nikkei Izakaya"      → use "Nikkei" or "Japanese"

If none of the approved labels fit, coin one using [Style] [Primary Cuisine] format.
The result must pass the "would a non-foodie understand this?" test.
Flag it in the notes field with "[NEW CUISINE LABEL]" at the end.

━━━ 0. IDENTITY RULE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The address field is the definitive identifier for which restaurant this is.
Multiple places may share a building or a similar name. The address — especially
the floor number — tells you which venue you are actually describing.
  "101st Floor, 30 Hudson Yards" = Peak (sky views, destination dining)
  "5th Floor, 30 Hudson Yards"   = a separate bar/lounge — lower floor, no panoramic views

NEVER infer a venue type from the building it shares with others. A bar inside a
building that also contains a hotel is NOT automatically a hotel bar. A restaurant
inside a mall is NOT automatically casual. Only use facts specific to the venue itself.

If the address contradicts what you'd naturally write about the name, trust the address.
Never describe views, a floor experience, or a physical feature that doesn't match
the address's actual location.

━━━ 0b. PARENT CONCEPT ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
When sibling_venues data is provided, identify which venue is the primary concept
and which are sub-concepts or companion spaces.

Examples:
  Greywind (restaurant) + Spygold (cocktail bar below) → Spygold's parent_concept = Greywind's google_places_id
  Peak (101st floor dining) + Quin Bar (5th floor bar) → they are unrelated; no parent_concept

Rules:
• The "parent" is typically the primary dining room or the venue the brand is known by.
• A cocktail bar, lounge, or café that is a sub-space of a restaurant is the "sibling."
• Completely separate businesses that happen to share a building are NOT siblings.
• Set parent_concept only on the sibling, not the parent (the parent leaves it null/omitted).

━━━ 3. NOTES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Voice: conversational, insider, direct. NOT marketing copy.
Length: 100–250 characters (tight — every word earns its place).
Content: what makes it worth going, who it's for, the standout thing (dish, vibe, chef, view).

GOOD examples:
  "Dan Kluger's gem. Greywind upstairs, Spygold cocktail bar below. Most neighborhood-feeling spot here."
  "Michelin recognized. Chef Hillary Sterling. Caramelized onion torta alone is worth the trip."
BAD example:
  "A beloved neighborhood restaurant offering seasonal New American cuisine in a warm, inviting atmosphere."

FORMATTING
• No em dashes (use a period or comma instead).
• No en dashes used as separators.

TONE — these rules are strict. Violations will be rejected.
• Describe each place on its own merits. No comparisons that imply another place is better.
• No qualifiers that subtly diminish: "not a destination but...", "reliably good",
  "won't blow your mind", "does the job", "nothing groundbreaking".
• No irony or backhanded framing: "a crowd that actually seems happy here",
  "feels like it belongs somewhere with more character".
• No geographic snobbery or implications that any neighborhood is lesser than another.
• Casual, unpretentious, and neighborhood spots deserve the same honest positivity as
  fine dining. "Best quick lunch in the neighborhood" is a compliment, not a consolation.
• No inflation either — do not oversell or use adjectives that aren't earned.

Word ban: "boasts", "features", "vibrant", "exciting", "beloved", "is known for",
"offers", "provides", "nestled", "tucked", "haven", "gem" (overused).

Time-sensitive claims: do NOT say "newly opened", "just launched", or similar.
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

If sibling_venues data is provided, the listed venues share the same physical address.
This context is for IDENTITY clarity and parent_concept assignment only.
Tags are ALWAYS assessed independently per venue — Spygold and Greywind serve
different occasions and vibes and must be tagged on their own merits. Do not
copy or inherit tags from a sibling. Evaluate each venue as a standalone experience.

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
  mocktail_program      — a dedicated, curated zero-proof drinks section on the menu. Tag it when
                          the restaurant has clearly invested in non-alcoholic options as a real
                          program: a named section (e.g. "Placebos", "Non-Alcoholic", "Zero-Proof"),
                          house-made NA cocktails, or zero-proof pairings — not just "no alcohol on
                          request" or a single mocktail listed as an afterthought. If menu_snippets
                          are provided, look for section headers, asterisks, or dedicated NA items.

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

DIETARY — same evidence standard as mocktail_program
  These tags require genuine investment from the restaurant, not a token option.
  Tag only when the restaurant has a dedicated section, a meaningfully sized selection,
  or is explicitly known for it. "We can make the steak without butter" does not qualify.
  If menu_snippets are provided, look for dedicated sections, symbols (V, VG, GF), or
  a significant proportion of clearly marked items.

  vegan                 — full vegan menu or vegan-first concept (majority of menu is vegan)
  vegetarian_friendly   — a substantial, deliberately crafted vegetarian selection, not just sides
  gluten_free_friendly  — clearly marked GF options and kitchen awareness, not an afterthought

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

  const enriched = fpRows.map(fp => ({
    ...fp,
    google_rating:       rpMap[fp.google_places_id]?.google_rating ?? null,
    google_review_count: rpMap[fp.google_places_id]?.google_review_count ?? null,
    price_range:         rpMap[fp.google_places_id]?.price_range ?? null,
    existing_notes:      restMap[fp.google_places_id]?.notes ?? null,
    menu_snippet:        null,
  }));

  if (ENRICH_MENUS) {
    console.log(`🔍 Fetching menu snippets via Tavily for ${enriched.length} restaurants…`);
    for (const row of enriched) {
      row.menu_snippet = await fetchMenuSnippet(row);
      await new Promise(r => setTimeout(r, 600)); // rate limit: ~100 req/min
    }
    const found = enriched.filter(r => r.menu_snippet).length;
    console.log(`   Menu snippets found: ${found}/${enriched.length}\n`);
  }

  // Detect sibling venues sharing the same address (e.g. Greywind + Spygold).
  // Each sibling gets a cross-reference so Claude can consider shared menu context.
  const addressGroups = {};
  for (const row of enriched) {
    const key = (row.address ?? '').trim().toLowerCase();
    if (!key) continue;
    if (!addressGroups[key]) addressGroups[key] = [];
    addressGroups[key].push(row);
  }
  for (const siblings of Object.values(addressGroups)) {
    if (siblings.length < 2) continue;
    for (const row of siblings) {
      const others = siblings.filter(s => s.google_places_id !== row.google_places_id);
      row.sibling_context = others.map(s => {
        const parts = [`name: ${s.name}`];
        if (s.cuisine) parts.push(`cuisine: ${s.cuisine}`);
        if (s.menu_snippet) parts.push(`menu_snippet: ${s.menu_snippet}`);
        return parts.join(', ');
      }).join(' | ');
    }
  }

  return enriched;
}

// ── Tavily menu search ────────────────────────────────────
// Searches for the restaurant's menu/drinks page and returns
// up to ~800 chars of the most relevant content as a snippet.
// Only called when --enrich-menus flag is set.
async function fetchMenuSnippet(row) {
  if (!TAVILY_KEY) {
    console.warn('⚠️  TAVILY_API_KEY not set — skipping menu enrichment');
    return null;
  }
  try {
    const query = `${row.name} ${row.district ?? ''} menu drinks cocktails mocktail vegetarian gluten free`;
    const resp = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: TAVILY_KEY,
        query,
        search_depth: 'advanced',
        max_results: 5,
        include_domains: row.website ? [new URL(row.website).hostname] : [],
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();

    // Concatenate up to 800 chars from results most likely to be menu pages
    const snippet = (data.results || [])
      .filter(r => /menu|drink|cocktail|food|wine/i.test(r.url + ' ' + r.title))
      .slice(0, 3)
      .map(r => r.content || '')
      .join(' ')
      .slice(0, 800)
      .trim();

    return snippet || null;
  } catch {
    return null;
  }
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
  if (row.menu_snippet)        lines.push(`menu_snippets (use for dietary/mocktail tags): ${row.menu_snippet}`);
  if (row.sibling_context)     lines.push(`sibling_venues (same address — consider shared menu/tag context): ${row.sibling_context}`);
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
// Uses update (not upsert) so only the synthesized columns are
// touched — avoids NOT NULL violations on columns like source_status
// that aren't part of the synthesis payload.
async function writeResults(results) {
  for (const r of results) {
    const { error } = await supabase
      .from('filtered_places')
      .update({
        name:             r.cleaned_name,
        cuisine:          r.cuisine,
        notes:            r.notes,
        price:            r.price,
        proposed_tags:    r.proposed_tags,
        parent_concept:   r.parent_concept ?? null,
        synthesis_status: 'complete',
      })
      .eq('google_places_id', r.google_places_id);
    if (error) throw new Error(`DB update failed for ${r.google_places_id}: ${error.message}`);
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
