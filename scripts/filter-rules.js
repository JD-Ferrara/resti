// ============================================================
// filter-rules.js — Load filter rules from Supabase DB
// ============================================================
// Reads place_exclusion_rules and place_allowlist to build the rules
// object consumed by filterPlaces(). All chain exclusions, status checks,
// and quality thresholds live in the DB — edit them there, not in code.

/**
 * Fetch active filter rules from Supabase.
 * @returns {{
 *   allowlist:       Set<string>,
 *   excludedChains:  Set<string>,
 *   excludedStatuses: Set<string>,
 *   minRating:       number,
 *   minReviews:      number,
 * }}
 */
export async function fetchFilterRules(supabase) {
  const [rulesResult, allowlistResult] = await Promise.all([
    supabase
      .from('place_exclusion_rules')
      .select('rule_type, value')
      .eq('is_active', true),
    supabase
      .from('place_allowlist')
      .select('name')
      .eq('is_active', true),
  ]);

  if (rulesResult.error)    throw new Error(`Failed to fetch place_exclusion_rules: ${rulesResult.error.message}`);
  if (allowlistResult.error) throw new Error(`Failed to fetch place_allowlist: ${allowlistResult.error.message}`);

  const excludedChains   = new Set();
  const excludedStatuses = new Set();
  let minRating  = 0;
  let minReviews = 0;

  for (const rule of (rulesResult.data ?? [])) {
    switch (rule.rule_type) {
      case 'chain_name':      excludedChains.add(rule.value);        break;
      case 'business_status': excludedStatuses.add(rule.value);      break;
      case 'min_rating':      minRating  = parseFloat(rule.value);   break;
      case 'min_reviews':     minReviews = parseInt(rule.value, 10); break;
    }
  }

  return {
    allowlist:        new Set((allowlistResult.data ?? []).map((r) => r.name)),
    excludedChains,
    excludedStatuses,
    minRating,
    minReviews,
  };
}
