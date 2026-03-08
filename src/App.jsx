import { useState, useMemo, useRef, useEffect } from "react";
import { supabase } from "./supabase";



const TAG_CATEGORIES = {
  occasion: { label: "Occasion", tags: { romantic_milestone: "Romantic Milestone", saturday_night_out: "Saturday Night Out", birthday_dinner: "Birthday Dinner", business_dinner: "Business Dinner", business_lunch: "Business Lunch", first_date: "First Date", anniversary: "Anniversary", after_work_drinks: "After Work", sunday_brunch: "Sunday Brunch" } },
  vibe: { label: "Vibe", tags: { intimate_quiet: "Intimate & Quiet", buzzy_lively: "Buzzy & Lively", trendy_scene: "Trendy Scene", unpretentious: "Unpretentious", old_school_classic: "Old School", hidden_gem: "Hidden Gem", cozy: "Cozy", grand_impressive: "Grand & Impressive" } },
  drinks: { label: "Drinks", tags: { craft_cocktails: "Craft Cocktails", extensive_wine_list: "Extensive Wine", natural_wine: "Natural Wine", great_beer_selection: "Great Beer", standard_bar: "Standard Bar", destination_bar: "Destination Bar" } },
  food: { label: "Food", tags: { sharing_plates: "Sharing Plates", tasting_menu: "Tasting Menu", traditional_entrees: "Traditional Entrees", bar_snacks_only: "Bar Snacks", chef_driven: "Chef Driven" } },
  group: { label: "Group", tags: { solo_friendly: "Solo Friendly", large_group: "Large Group", couples_only_vibe: "Couples Vibe", family_friendly: "Family Friendly", watch_games_with_friends: "Watch Games" } },
  dietary: { label: "Dietary", tags: { vegan: "Vegan", vegetarian_friendly: "Vegetarian Friendly", gluten_free_friendly: "Gluten Free" } },
  value: { label: "Value", tags: { worth_the_splurge: "Worth the Splurge", overpriced_for_what_it_is: "Overpriced", great_value: "Great Value", corporate_card_only: "Corporate Card Only", happy_hour_deal: "Happy Hour", budget_friendly: "Budget Friendly" } },
};

const PRICE_LABELS = { 1: "$", 2: "$$", 3: "$$$", 4: "$$$$" };
const CAT_ACCENT = { occasion: "#D4163C", vibe: "#6D28D9", drinks: "#0369A1", food: "#B45309", group: "#047857", dietary: "#065F46", value: "#1E40AF" };

// Editorial publications — ordered by prestige/usefulness for display.
// Add new columns to restaurant_sources table first, then add here.
const EDITORIAL_SOURCES = [
  { key: "michelin",        label: "Michelin"          },
  { key: "new_york_times",  label: "NY Times"          },
  { key: "infatuation",     label: "The Infatuation"   },
  { key: "eater",           label: "Eater NY"          },
  { key: "new_york_mag",    label: "NY Mag"            },
  { key: "robb_report",     label: "Robb Report"       },
  { key: "bon_appetit",     label: "Bon Appétit"       },
  { key: "timeout",         label: "Time Out"          },
  { key: "vogue",           label: "Vogue"             },
  { key: "wsj",             label: "WSJ"               },
  { key: "wwd",             label: "WWD"               },
  { key: "resy_blog",       label: "Resy"              },
];



function TagChip({ tag, category, active, onClick, onRemove }) {
  const label = TAG_CATEGORIES[category]?.tags[tag] || tag.replace(/_/g, " ");
  const accent = CAT_ACCENT[category];
  return (
    <button
      onClick={() => onClick?.(tag, category)}
      style={active ? { backgroundColor: accent, color: "#fff", borderColor: accent } : {}}
      className={`inline-flex items-center gap-1 px-2.5 py-[3px] rounded-full text-[11px] font-medium border transition-all duration-150 leading-none
        ${active ? "" : "bg-white text-neutral-500 border-neutral-200 hover:border-neutral-400 hover:text-neutral-800"}`}
    >
      {label}
      {onRemove && (
        <span onClick={e => { e.stopPropagation(); onRemove(tag, category); }} className="ml-0.5 opacity-60 hover:opacity-100 text-[11px] leading-none">×</span>
      )}
    </button>
  );
}

const WebIcon = () => <svg viewBox="0 0 20 20" fill="none" stroke="#111" strokeWidth="1.6" className="w-[14px] h-[14px]"><circle cx="10" cy="10" r="7.5"/><path d="M10 2.5a11 11 0 0 1 2.5 7.5A11 11 0 0 1 10 17.5M10 2.5a11 11 0 0 0-2.5 7.5A11 11 0 0 0 10 17.5M2.5 10h15"/></svg>;
const IgIcon = () => <svg viewBox="0 0 20 20" fill="none" stroke="#111" strokeWidth="1.6" className="w-[14px] h-[14px]"><rect x="2.5" y="2.5" width="15" height="15" rx="4"/><circle cx="10" cy="10" r="3.25"/><circle cx="14.25" cy="5.75" r="0.75" fill="#111" stroke="none"/></svg>;
const ResIcon = () => <svg viewBox="0 0 20 20" fill="none" stroke="#111" strokeWidth="1.6" className="w-[14px] h-[14px]"><rect x="2.5" y="3.5" width="15" height="14" rx="2"/><path d="M13.5 1.5v4M6.5 1.5v4M2.5 9h15"/><path d="M6.5 12.5h.01M10 12.5h.01M13.5 12.5h.01M6.5 15.5h.01M10 15.5h.01" strokeWidth="2" strokeLinecap="round"/></svg>;

const PLATFORM_ICON = {
  youtube: (
    <svg width="11" height="11" viewBox="0 0 20 20" fill="none">
      <rect x="1" y="4" width="18" height="12" rx="3" fill="#FF0000"/>
      <path d="M8 7.5l5 2.5-5 2.5V7.5z" fill="white"/>
    </svg>
  ),
  instagram: (
    <svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="#C13584" strokeWidth="1.8">
      <rect x="2.5" y="2.5" width="15" height="15" rx="4"/>
      <circle cx="10" cy="10" r="3.25"/>
      <circle cx="14.25" cy="5.75" r="1" fill="#C13584" stroke="none"/>
    </svg>
  ),
  tiktok: (
    <svg width="11" height="11" viewBox="0 0 20 20" fill="#000">
      <path d="M14 2a4 4 0 0 0 4 4v3a7 7 0 0 1-4-1.3V13a5 5 0 1 1-5-5v3a2 2 0 1 0 2 2V2h3z"/>
    </svg>
  ),
};

function CreatorVoices({ voices, onTrack }) {
  return (
    <div className="mb-4 space-y-2">
      {voices.map((v, i) => {
        const creator = v.creator;
        if (!creator) return null;
        return (
          <a key={i} href={v.url} target="_blank" rel="noopener noreferrer"
            onClick={() => onTrack?.("video_play")}
            className="flex items-start gap-2.5 p-2.5 rounded-xl bg-neutral-50 hover:bg-neutral-100 transition-colors no-underline group">
            <div className="shrink-0 mt-0.5 w-5 h-5 rounded-full bg-white border border-neutral-200 flex items-center justify-center">
              {PLATFORM_ICON[v.platform]}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-neutral-600 leading-snug italic">"{v.quote}"</p>
              <p className="text-[10px] text-neutral-400 mt-0.5 font-medium">{creator.full_name} | @{creator.primary_handle}</p>
            </div>
            <svg className="shrink-0 mt-1 opacity-0 group-hover:opacity-40 transition-opacity" width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M2 10L10 2M10 2H5M10 2v5"/>
            </svg>
          </a>
        );
      })}
    </div>
  );
}

function Card({ r, activeTags, onTagClick, onTrack, voices }) {
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const allTags = Object.entries(r.tags).flatMap(([cat, ts]) => ts.map(t => ({ tag: t, category: cat })));

  // Priority order for which tags show first
  const PRIORITY_CATS = ["occasion", "vibe", "drinks", "food", "group", "value", "dietary"];
  const sortedTags = [...allTags].sort((a, b) => PRIORITY_CATS.indexOf(a.category) - PRIORITY_CATS.indexOf(b.category));

  const PREVIEW_COUNT = 4;
  const visibleTags = tagsExpanded ? sortedTags : sortedTags.slice(0, PREVIEW_COUNT);
  const hiddenCount = sortedTags.length - PREVIEW_COUNT;

  return (
    <div className="bg-white border border-neutral-100 rounded-2xl p-6 hover:border-neutral-200 hover:shadow-[0_2px_20px_rgba(0,0,0,0.06)] transition-all duration-200">
      <div className="flex items-start justify-between mb-1">
        <div className="flex-1 min-w-0 pr-3">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-[16px] font-semibold text-neutral-900 tracking-[-0.01em] leading-snug">{r.name}</h3>
            {(r.is_new || r.isNew) && <span className="text-[9px] font-bold tracking-[0.08em] uppercase px-1.5 py-[3px] rounded-full bg-neutral-900 text-white leading-none">New</span>}
          </div>
          <p className="text-[12px] text-neutral-400 mt-0.5">{r.cuisine}</p>
        </div>
        <span className="text-[12px] text-neutral-400 font-mono shrink-0 mt-0.5">{PRICE_LABELS[r.price]}</span>
      </div>

      <p className="text-[11px] text-neutral-400 mb-1.5 flex items-center gap-1">
        <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" className="w-2.5 h-2.5 shrink-0 text-neutral-300">
          <path d="M7 1C4.8 1 3 2.8 3 5c0 3 4 8 4 8s4-5 4-8c0-2.2-1.8-4-4-4z"/><circle cx="7" cy="5" r="1.3"/>
        </svg>
        {r.address}
      </p>

      {r.district && (
        <span className="inline-block text-[10px] text-neutral-400 bg-neutral-100 px-2 py-0.5 rounded-full mb-3">
          {r.district}
        </span>
      )}

      <p className="text-[13px] text-neutral-600 leading-[1.6] mb-4">{r.notes}</p>

      {/* Creator voices */}
      {voices && <CreatorVoices voices={voices} onTrack={onTrack} />}

      {/* Tags — collapsed by default */}
      <div className="mb-4">
        <div className="flex flex-wrap gap-1.5">
          {visibleTags.map(({ tag, category }) => {
            const isActive = activeTags.some(a => a.tag === tag && a.category === category);
            return <TagChip key={`${category}-${tag}`} tag={tag} category={category} active={isActive} onClick={onTagClick} />;
          })}
          {!tagsExpanded && hiddenCount > 0 && (
            <button onClick={() => setTagsExpanded(true)}
              className="inline-flex items-center gap-1 px-2.5 py-[3px] rounded-full text-[11px] font-medium border border-dashed border-neutral-300 text-neutral-400 hover:text-neutral-600 hover:border-neutral-400 transition-all leading-none">
              +{hiddenCount} more
            </button>
          )}
          {tagsExpanded && (
            <button onClick={() => setTagsExpanded(false)}
              className="inline-flex items-center gap-1 px-2.5 py-[3px] rounded-full text-[11px] font-medium border border-dashed border-neutral-300 text-neutral-400 hover:text-neutral-600 hover:border-neutral-400 transition-all leading-none">
              less
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between pt-3.5 mt-4 -mx-6 -mb-6 px-6 pb-4 rounded-b-2xl bg-neutral-50 border-t border-neutral-150">
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {EDITORIAL_SOURCES.filter(s => r.sources?.[s.key]).map(s => (
            <a key={s.key} href={r.sources[s.key]} target="_blank" rel="noopener noreferrer"
              onClick={() => onTrack?.("editorial_click")}
              className="text-[11px] text-neutral-400 hover:text-neutral-700 transition-colors underline underline-offset-2 decoration-neutral-300 hover:decoration-neutral-500">
              {s.label}
            </a>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0, marginLeft: "12px" }}>
          {r.website && (
            <a href={r.website} target="_blank" rel="noopener noreferrer" title="Website"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "30px", height: "30px", borderRadius: "50%", backgroundColor: "#e5e5e5", textDecoration: "none" }}>
              <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="#111111" strokeWidth="1.8">
                <circle cx="10" cy="10" r="7.5"/>
                <path d="M10 2.5a11 11 0 0 1 2.5 7.5A11 11 0 0 1 10 17.5M10 2.5a11 11 0 0 0-2.5 7.5A11 11 0 0 0 10 17.5M2.5 10h15"/>
              </svg>
            </a>
          )}
          {r.instagram && (
            <a href={r.instagram} target="_blank" rel="noopener noreferrer" title="Instagram"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "30px", height: "30px", borderRadius: "50%", backgroundColor: "#e5e5e5", textDecoration: "none" }}>
              <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="#111111" strokeWidth="1.8">
                <rect x="2.5" y="2.5" width="15" height="15" rx="4"/>
                <circle cx="10" cy="10" r="3.25"/>
                <circle cx="14.25" cy="5.75" r="1" fill="#111111" stroke="none"/>
              </svg>
            </a>
          )}
          {r.reservation && (
            <a href={r.reservation} target="_blank" rel="noopener noreferrer" title="Reserve"
              onClick={() => onTrack?.("reservation_click")}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "30px", height: "30px", borderRadius: "50%", backgroundColor: "#e5e5e5", textDecoration: "none" }}>
              <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="#111111" strokeWidth="1.8">
                <rect x="2.5" y="3.5" width="15" height="14" rx="2"/>
                <path d="M13.5 1.5v4M6.5 1.5v4M2.5 9h15"/>
                <circle cx="6.5" cy="13" r="0.8" fill="#111111" stroke="none"/>
                <circle cx="10" cy="13" r="0.8" fill="#111111" stroke="none"/>
                <circle cx="13.5" cy="13" r="0.8" fill="#111111" stroke="none"/>
              </svg>
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function FilterBar({ activeTags, onTagToggle, onClear, priceFilter, onPriceToggle, creatorFilter, onCreatorToggle, creators, districtFilter, onDistrictToggle, districts }) {
  const [open, setOpen] = useState(null);
  const barRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (barRef.current && !barRef.current.contains(e.target)) setOpen(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const toggle = (key) => setOpen(prev => prev === key ? null : key);
  const hasAnyFilter = activeTags.length > 0 || priceFilter.length > 0 || creatorFilter.length > 0 || districtFilter.length > 0;

  const filters = [
    { key: "price", label: "Price", count: priceFilter.length },
    ...(districts.length > 0 ? [{ key: "district", label: "District", count: districtFilter.length }] : []),
    { key: "creator", label: "Creator", count: creatorFilter.length },
    ...Object.entries(TAG_CATEGORIES).map(([catKey, cat]) => ({
      key: catKey,
      label: cat.label,
      count: activeTags.filter(t => t.category === catKey).length,
    })),
  ];

  return (
    <div className="bg-white border-b border-neutral-100" ref={barRef}>
      <div className="max-w-[1100px] mx-auto px-8 py-3">
        <div className="flex items-center gap-2 flex-wrap">
          {filters.map(f => {
            const isActive = f.count > 0;
            const isOpen = open === f.key;
            return (
              <div key={f.key} className="relative shrink-0">
                <button
                  onClick={() => toggle(f.key)}
                  className={`flex items-center gap-1.5 px-3.5 py-[7px] rounded-full text-[12px] font-medium border transition-all duration-150 whitespace-nowrap
                    ${isActive
                      ? "bg-neutral-900 text-white border-neutral-900"
                      : isOpen
                      ? "bg-neutral-50 text-neutral-900 border-neutral-400"
                      : "bg-white text-neutral-700 border-neutral-300 hover:border-neutral-500 hover:bg-neutral-50"}`}
                >
                  {f.label}
                  {isActive && (
                    <span className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-semibold bg-white/20 text-white">
                      {f.count}
                    </span>
                  )}
                  <svg
                    className={`w-3 h-3 transition-transform duration-150 ${isOpen ? "rotate-180" : ""} ${isActive ? "text-white/70" : "text-neutral-400"}`}
                    viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2"
                  >
                    <path d="M2 4l4 4 4-4" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>

                {isOpen && (
                  <div className="absolute top-full mt-2 left-0 z-30 bg-white rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] border border-neutral-100 p-4">
                    {f.key === "price" && (
                      <div>
                        <p className="text-[10px] font-semibold tracking-[0.1em] uppercase text-neutral-400 mb-3">Price Range</p>
                        <div className="flex gap-2">
                          {[1,2,3,4].map(p => (
                            <button key={p} onClick={() => onPriceToggle(p)}
                              className={`px-3 py-1.5 rounded-full text-[12px] font-mono font-medium border transition-all duration-150
                                ${priceFilter.includes(p) ? "bg-neutral-900 text-white border-neutral-900" : "bg-white text-neutral-600 border-neutral-200 hover:border-neutral-400"}`}>
                              {PRICE_LABELS[p]}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {f.key === "district" && (
                      <div className="min-w-[200px]">
                        <p className="text-[10px] font-semibold tracking-[0.1em] uppercase text-neutral-400 mb-3">Neighborhood</p>
                        <div className="flex flex-col gap-1.5">
                          {districts.map(d => {
                            const active = districtFilter.includes(d);
                            return (
                              <button key={d} onClick={() => onDistrictToggle(d)}
                                className={`flex items-center justify-between px-3 py-2 rounded-xl text-left border transition-all duration-150 w-full
                                  ${active ? "bg-neutral-900 border-neutral-900" : "bg-white border-neutral-200 hover:border-neutral-400"}`}>
                                <span className={`text-[12px] font-medium ${active ? "text-white" : "text-neutral-700"}`}>{d}</span>
                                {active && (
                                  <svg className="w-4 h-4 text-white shrink-0 ml-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 16 16">
                                    <path d="M3 8l4 4 6-7" strokeLinecap="round" strokeLinejoin="round"/>
                                  </svg>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {f.key === "creator" && (
                      <div className="min-w-[240px]">
                        <p className="text-[10px] font-semibold tracking-[0.1em] uppercase text-neutral-400 mb-3">Featured Creators</p>
                        <div className="flex flex-col gap-2">
                          {Object.values(creators).map(c => {
                            const active = creatorFilter.includes(c.id);
                            return (
                              <button key={c.id} onClick={() => onCreatorToggle(c.id)}
                                className={`flex items-center justify-between px-3 py-2.5 rounded-xl text-left border transition-all duration-150 w-full
                                  ${active ? "bg-neutral-900 border-neutral-900" : "bg-white border-neutral-200 hover:border-neutral-400"}`}>
                                <div>
                                  <div className="flex items-center gap-1.5">
                                    <p className={`text-[12px] font-semibold leading-none ${active ? "text-white" : "text-neutral-700"}`}>{c.full_name}</p>
                                    <div className="flex items-center gap-0.5">
                                      {c.platforms.map(p => (
                                        <span key={p} className={`flex items-center justify-center w-3.5 h-3.5 rounded-full ${active ? "bg-neutral-700" : "bg-neutral-100"}`}>
                                          {PLATFORM_ICON[p]}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                  <p className={`text-[10px] mt-0.5 ${active ? "text-neutral-300" : "text-neutral-400"}`}>@{c.primary_handle}</p>
                                </div>
                                {active && (
                                  <svg className="w-4 h-4 text-white shrink-0 ml-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 16 16">
                                    <path d="M3 8l4 4 6-7" strokeLinecap="round" strokeLinejoin="round"/>
                                  </svg>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {TAG_CATEGORIES[f.key] && (
                      <div className="min-w-[240px] max-w-[300px]">
                        <p className="text-[10px] font-semibold tracking-[0.1em] uppercase text-neutral-400 mb-3">{TAG_CATEGORIES[f.key].label}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {Object.entries(TAG_CATEGORIES[f.key].tags).map(([tagKey]) => {
                            const isActiveTag = activeTags.some(a => a.tag === tagKey && a.category === f.key);
                            return <TagChip key={tagKey} tag={tagKey} category={f.key} active={isActiveTag} onClick={onTagToggle} />;
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {hasAnyFilter && (
            <button
              onClick={onClear}
              className="shrink-0 text-[12px] text-neutral-500 hover:text-neutral-900 transition-colors ml-1 underline underline-offset-2 whitespace-nowrap"
            >
              Clear all
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  // Restaurant data from Supabase
  const [restaurants, setRestaurants] = useState([]);
  const [loadingRestaurants, setLoadingRestaurants] = useState(true);
  // Creator data from Supabase — keyed by creator id for O(1) lookup
  const [creators, setCreators] = useState({});
  // Creator quotes from Supabase — keyed by restaurant_id
  const [creatorVoices, setCreatorVoices] = useState({});

  useEffect(() => {
    supabase
      .from("restaurants")
      .select("*, restaurant_tags(tag_id, tags(category, tag_key)), restaurant_sources(*)")
      .order("id")
      .then(({ data, error }) => {
        if (!error && data) {
          const transformed = data.map(r => {
            // Reshape restaurant_tags join rows → {occasion: [...], vibe: [...], ...}
            const tags = {};
            (r.restaurant_tags || []).forEach(rt => {
              const { category, tag_key } = rt.tags;
              if (!tags[category]) tags[category] = [];
              tags[category].push(tag_key);
            });
            // Flatten restaurant_sources (0 or 1 row) → plain object
            const sources = r.restaurant_sources?.[0] ?? {};
            return { ...r, tags, sources };
          });
          setRestaurants(transformed);
        }
        setLoadingRestaurants(false);
      });

    supabase
      .from("creators")
      .select("*")
      .then(({ data }) => {
        if (data) setCreators(Object.fromEntries(data.map(c => [c.id, c])));
      });

    supabase
      .from("creator_quotes")
      .select("*, creator:creators(*)")
      .then(({ data }) => {
        if (data) {
          const grouped = {};
          data.forEach(q => {
            if (!grouped[q.restaurant_id]) grouped[q.restaurant_id] = [];
            grouped[q.restaurant_id].push({ creatorId: q.creator_id, quote: q.quote, creator: q.creator, platform: q.platform, url: q.url });
          });
          setCreatorVoices(grouped);
        }
      });
  }, []);

  // Track a click event to the events table (fire-and-forget)
  const trackEvent = (restaurantId, eventType) => {
    supabase.from("events").insert({ restaurant_id: restaurantId, event_type: eventType });
  };

  // Concierge system prompt — built from live Supabase data
  const CONCIERGE_SYSTEM = useMemo(() => {
    const context = restaurants.map(r =>
      `${r.name} (${r.cuisine}, ${PRICE_LABELS[r.price]}, ${r.address}): ${r.notes}`
    ).join("\n");
    return `You are a trusted friend who knows every restaurant in the Hudson Yards area of NYC better than anyone. You're warm, direct, and opinionated — the person in every friend group who always knows exactly where to go and why. You've been curating this neighborhood for friends, coworkers, dates, and family for years.

Your approach before recommending anything:
- Never assume. Always ask 2–3 natural questions to understand the full picture before giving a recommendation. You need to know: who they're with (or going solo), what the occasion or vibe is, roughly what time/day they're thinking, and any relevant preferences (budget, cuisine, dietary needs).
- Ask these questions conversationally — not all at once like a form. Start with the most important unknown and let the conversation flow. Mix up how you phrase things. Don't start every response the same way.
- If the person gives you enough detail upfront (occasion + party + time + vibe), you can skip straight to a recommendation. Use judgment.

When you have enough context:
- Give one clear primary recommendation and one strong backup. Be specific about why each fits their exact situation — not a generic description, but a real reason tied to what they told you.
- Be confident and opinionated. If somewhere is the obvious right call, say it. If something doesn't fit what they described, be honest.
- Keep responses concise and human. No bullet walls. No stiff AI-speak. Talk like a friend giving real advice over text.

After recommending, stay in the conversation. If they want a different vibe, a different price point, or have follow-up questions — help them pivot. This is a dialogue, not a one-shot answer.

Restaurants in this guide:
${context}

You only know these restaurants. If asked about somewhere else, be honest about it and bring the conversation back to what's here.`;
  }, [restaurants]);

  // Explore mode state
  const [activeTags, setActiveTags] = useState([]);
  const [search, setSearch] = useState("");
  const [priceFilter, setPriceFilter] = useState([]);
  const [creatorFilter, setCreatorFilter] = useState([]);
  const [districtFilter, setDistrictFilter] = useState([]);
  const [aiInput, setAiInput] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiLabel, setAiLabel] = useState("");
  const [aiError, setAiError] = useState("");

  // App mode + Concierge state
  const [mode, setMode] = useState("explore");
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef(null);
  const messagesScrollRef = useRef(null);

  const handleTagToggle = (tag, category) => {
    setActiveTags(prev => {
      const exists = prev.some(t => t.tag === tag && t.category === category);
      return exists ? prev.filter(t => !(t.tag === tag && t.category === category)) : [...prev, { tag, category }];
    });
  };

  const handleAiSearch = async () => {
    if (!aiInput.trim() || aiLoading) return;
    setAiLoading(true);
    setAiLabel("");
    setAiError("");

    const tagMap = Object.entries(TAG_CATEGORIES).map(([catKey, cat]) =>
      `${catKey}: ${Object.keys(cat.tags).join(", ")}`
    ).join("\n");

    const prompt = `You are a restaurant filter assistant. A user describes what they want in plain language. Select matching filter tags from the list below.

Available tags by category:
${tagMap}

User request: "${aiInput}"

Reply with ONLY a raw JSON array, no markdown, no explanation:
[{"tag": "first_date", "category": "occasion"}, {"tag": "intimate_quiet", "category": "vibe"}]`;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: prompt }],
          max_tokens: 500,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`API ${res.status}: ${errText}`);
      }

      const data = await res.json();
      const text = data.content?.[0]?.text || "[]";
      const clean = text.replace(/```json|```/g, "").trim();
      const tags = JSON.parse(clean);
      const validTags = Array.isArray(tags) ? tags.filter(t => TAG_CATEGORIES[t.category]?.tags[t.tag]) : [];
      if (validTags.length > 0) {
        setActiveTags(validTags);
        setAiLabel(aiInput);
        setAiInput("");
      } else {
        setAiError("No matching filters found — try rephrasing.");
      }
    } catch (e) {
      setAiError("Something went wrong: " + e.message);
    }
    setAiLoading(false);
  };

  const handleConciergeChat = async (overrideText) => {
    const text = overrideText ?? chatInput;
    if (!text.trim() || chatLoading) return;
    const userMessage = { role: "user", content: text.trim() };
    const newMessages = [...chatMessages, userMessage];
    setChatMessages(newMessages);
    setChatInput("");
    setChatLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system: CONCIERGE_SYSTEM,
          messages: newMessages,
          max_tokens: 700,
        }),
      });

      const data = await res.json();
      const reply = data.content?.[0]?.text || "Sorry, I couldn't get a response. Please try again.";
      setChatMessages(prev => [...prev, { role: "assistant", content: reply }]);

      // Track any restaurants mentioned in the AI reply
      const replyLower = reply.toLowerCase();
      restaurants.forEach(r => {
        if (replyLower.includes(r.name.toLowerCase())) {
          trackEvent(r.id, "concierge_surface");
        }
      });
    } catch {
      setChatMessages(prev => [...prev, { role: "assistant", content: "Something went wrong. Please try again." }]);
    }
    setChatLoading(false);
  };

  useEffect(() => {
    const scroll = () => {
      if (messagesScrollRef.current) {
        messagesScrollRef.current.scrollTop = messagesScrollRef.current.scrollHeight;
      }
    };
    // First pass: after React paints the new DOM
    requestAnimationFrame(scroll);
    // Second pass: after mobile keyboard animation finishes (~350ms)
    const t = setTimeout(scroll, 380);
    return () => clearTimeout(t);
  }, [chatMessages]);

  const districts = useMemo(() =>
    [...new Set(restaurants.map(r => r.district).filter(Boolean))].sort(),
  [restaurants]);

  const filtered = useMemo(() => restaurants.filter(r => {
    const q = search.toLowerCase();
    const voiceCreatorIds = (creatorVoices[r.id] || []).map(v => v.creatorId);
    return (!q || r.name.toLowerCase().includes(q) || r.cuisine.toLowerCase().includes(q) || r.notes.toLowerCase().includes(q))
      && (!priceFilter.length || priceFilter.includes(r.price))
      && (!creatorFilter.length || creatorFilter.some(id => voiceCreatorIds.includes(id)))
      && (!districtFilter.length || districtFilter.includes(r.district))
      && activeTags.every(({ tag, category }) => r.tags[category]?.includes(tag));
  }), [restaurants, creatorVoices, activeTags, search, priceFilter, creatorFilter, districtFilter]);

  return (
    <div className={`bg-[#FAF8F5] ${mode === "concierge" ? "h-dvh overflow-hidden" : "min-h-screen"}`} style={{ fontFamily: "-apple-system, 'SF Pro Text', 'SF Pro Display', BlinkMacSystemFont, 'Helvetica Neue', sans-serif" }}>

      {/* Header */}
      <header className="sticky top-0 z-20 bg-white/90 backdrop-blur-2xl border-b border-neutral-100">
        <div className="max-w-[1100px] mx-auto px-8 h-12 flex items-center justify-between gap-6">

          {/* Wordmark */}
          <div className="flex items-baseline gap-3 shrink-0">
            <span className="text-3xl font-bold text-neutral-900" style={{ letterSpacing: "-0.06em", lineHeight: 1 }}>
              re<span style={{ letterSpacing: "-0.08em" }}>s</span>ti
            </span>
            <span className="hidden sm:inline text-[11px] text-neutral-300 tracking-[0.06em] font-normal">Hudson Yards · NYC</span>
          </div>

          {/* Mode Toggle */}
          <div className="flex items-center gap-1 bg-neutral-100 rounded-full p-0.5">
            <button
              onClick={() => setMode("explore")}
              className={`px-4 py-1 rounded-full text-[12px] font-medium transition-all duration-150 ${mode === "explore" ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-800"}`}
            >
              Explore
            </button>
            <button
              onClick={() => setMode("concierge")}
              className={`px-4 py-1 rounded-full text-[12px] font-medium transition-all duration-150 ${mode === "concierge" ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-800"}`}
            >
              Concierge
            </button>
          </div>

          {/* Right slot — fixed width so mode toggle never shifts */}
          <div className="flex items-center justify-end" style={{ width: "9rem" }}>
            {mode === "explore" && (
              <div className="relative">
                <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-neutral-400 pointer-events-none" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <circle cx="5.5" cy="5.5" r="4"/><path d="M12 12l-2.5-2.5"/>
                </svg>
                <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
                  className="pl-7 pr-3 py-[5px] text-[12px] bg-neutral-100 rounded-full border-0 text-neutral-900 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-300 w-36 transition-all duration-200 focus:w-36" />
              </div>
            )}
          </div>
        </div>
      </header>

      {mode === "concierge" ? (
        /* ── Concierge: fixed-height container, no page-level scroll ── */
        <div className="flex flex-col bg-[#FAF8F5]" style={{ height: "calc(100dvh - 3rem)" }}>

          {/* Title bar — always visible, never scrolls away */}
          <div className="shrink-0 border-b border-neutral-100 bg-[#FAF8F5]">
            <div className="max-w-2xl mx-auto px-6 pt-6 pb-4 text-center">
              <p className="text-[22px] font-semibold text-neutral-800 tracking-tight mb-1">Your Restaurant Concierge</p>
              <p className="text-[13px] text-neutral-400 leading-relaxed">
                Tell me the occasion — I'll ask a couple of questions<br className="hidden sm:block" />
                and point you somewhere worth going.
              </p>
            </div>
            {/* Start Over — own row below subtitle, only visible during active chat */}
            {chatMessages.length > 0 && (
              <div className="max-w-2xl mx-auto px-6 pb-3">
                <button
                  onClick={() => { setChatMessages([]); setChatInput(""); }}
                  className="flex items-center gap-1 text-[11px] text-neutral-400 hover:text-neutral-700 transition-colors"
                >
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M2 8a6 6 0 1 0 1.5-3.9M2 4v4h4"/>
                  </svg>
                  Start over
                </button>
              </div>
            )}
          </div>

          {chatMessages.length === 0 ? (
            /* ── Landing: pills + input near top, just below the title bar ── */
            <div className="flex-1 flex flex-col">
              <div className="max-w-2xl mx-auto w-full px-6 pt-8">
                <div className="flex flex-wrap gap-2 justify-center mb-4">
                  {[
                    ["First date", "Looking for a first date spot"],
                    ["Birthday dinner", "Planning a birthday dinner"],
                    ["After-work drinks", "Need a spot for after-work drinks"],
                    ["Business lunch", "Looking for a business lunch spot"],
                    ["Romantic night out", "Planning a romantic night out"],
                    ["Group outing", "Organizing a group outing"],
                  ].map(([label, msg]) => (
                    <button
                      key={label}
                      onClick={() => handleConciergeChat(msg)}
                      className="px-4 py-2 rounded-full text-[12px] border border-neutral-200 text-neutral-500 hover:border-neutral-400 hover:text-neutral-800 transition-all bg-white"
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2 items-center">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={e => setChatInput(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && !e.shiftKey && handleConciergeChat()}
                    placeholder="Tell me what you're planning…"
                    className="flex-1 px-4 py-2.5 text-base sm:text-[13px] bg-neutral-100 rounded-full border-0 text-neutral-900 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-300 transition-all"
                  />
                  <button
                    onClick={() => handleConciergeChat()}
                    disabled={!chatInput.trim() || chatLoading}
                    className="shrink-0 px-4 py-2.5 rounded-full text-[13px] font-medium bg-neutral-900 text-white hover:bg-neutral-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150"
                  >
                    Send
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* ── Active Chat: messages scroll, input pinned at bottom ── */
            <>
              <div className="flex-1 overflow-y-auto" ref={messagesScrollRef}>
                <div className="max-w-2xl mx-auto px-6 py-4 min-h-full flex flex-col justify-end gap-4">
                  {chatMessages.map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[82%] px-4 py-2.5 rounded-2xl text-[13px] leading-relaxed whitespace-pre-wrap
                        ${msg.role === "user"
                          ? "bg-neutral-900 text-white rounded-br-sm"
                          : "bg-white border border-neutral-100 text-neutral-800 rounded-bl-sm shadow-sm"
                        }`}>
                        {msg.content}
                      </div>
                    </div>
                  ))}
                  {chatLoading && (
                    <div className="flex justify-start">
                      <div className="bg-white border border-neutral-100 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
                        <div className="flex gap-1.5 items-center">
                          <span className="w-1.5 h-1.5 rounded-full bg-neutral-300 animate-bounce" style={{ animationDelay: "0ms" }} />
                          <span className="w-1.5 h-1.5 rounded-full bg-neutral-300 animate-bounce" style={{ animationDelay: "150ms" }} />
                          <span className="w-1.5 h-1.5 rounded-full bg-neutral-300 animate-bounce" style={{ animationDelay: "300ms" }} />
                        </div>
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>
              </div>

              {/* Input — always pinned at bottom, same padding as landing */}
              <div className="shrink-0 border-t border-neutral-100 bg-[#FAF8F5] px-6 pt-3 pb-4">
                <div className="max-w-2xl mx-auto flex gap-2 items-center">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={e => setChatInput(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && !e.shiftKey && handleConciergeChat()}
                    placeholder="Tell me what you're planning…"
                    className="flex-1 px-4 py-2.5 text-base sm:text-[13px] bg-neutral-100 rounded-full border-0 text-neutral-900 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-300 transition-all"
                  />
                  <button
                    onClick={() => handleConciergeChat()}
                    disabled={!chatInput.trim() || chatLoading}
                    className="shrink-0 px-4 py-2.5 rounded-full text-[13px] font-medium bg-neutral-900 text-white hover:bg-neutral-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150"
                  >
                    Send
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      ) : (
        /* ── Explore Mode ── */
        <>
          {/* AI Search Bar */}
          <div className="bg-white border-b border-neutral-100">
            <div className="max-w-[1100px] mx-auto px-8 py-4">
              <div className="flex gap-2 items-center">
                <div className="flex-1 relative">
                  <div className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none">
                    <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
                      <path d="M10 2C10 2 7 6 7 10s3 8 3 8M10 2c0 0 3 4 3 8s-3 8-3 8M2 10h16M2.5 7h15M2.5 13h15" stroke="#aaa" strokeWidth="1.4" strokeLinecap="round"/>
                    </svg>
                  </div>
                  <input
                    type="text"
                    value={aiInput}
                    onChange={e => { setAiInput(e.target.value); setAiError(""); }}
                    onKeyDown={e => e.key === "Enter" && handleAiSearch()}
                    placeholder={'Describe what you\'re looking for... e.g. "romantic dinner to propose at" or "casual drinks after work with coworkers"'}
                    className="w-full pl-9 pr-4 py-2.5 text-[13px] bg-neutral-50 border border-neutral-200 rounded-xl text-neutral-900 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-300 focus:border-transparent transition-all"
                  />
                </div>
                <button
                  onClick={handleAiSearch}
                  disabled={!aiInput.trim() || aiLoading}
                  className="shrink-0 px-4 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-150 bg-neutral-900 text-white hover:bg-neutral-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {aiLoading ? (
                    <>
                      <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                      </svg>
                      Thinking…
                    </>
                  ) : (
                    <>
                      <svg width="13" height="13" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M10 1l2.39 6.626L19 10l-6.61 2.374L10 19l-2.39-6.626L1 10l6.61-2.374L10 1z"/>
                      </svg>
                      Find
                    </>
                  )}
                </button>
              </div>
              {aiLabel && (
                <p className="mt-2 text-[11px] text-neutral-400">
                  Showing results for <span className="text-neutral-600 font-medium">&#34;{aiLabel}&#34;</span>
                  <button onClick={() => { setActiveTags([]); setAiLabel(""); }} className="ml-2 text-neutral-400 hover:text-neutral-700 underline underline-offset-2">clear</button>
                </p>
              )}
              {aiError && (
                <p className="mt-2 text-[11px] text-red-500">{aiError}</p>
              )}
            </div>
          </div>

          {/* Filter Bar */}
          <FilterBar
            activeTags={activeTags}
            onTagToggle={handleTagToggle}
            onClear={() => { setActiveTags([]); setPriceFilter([]); setCreatorFilter([]); setDistrictFilter([]); }}
            priceFilter={priceFilter}
            onPriceToggle={p => setPriceFilter(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p])}
            creatorFilter={creatorFilter}
            onCreatorToggle={id => setCreatorFilter(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])}
            creators={creators}
            districtFilter={districtFilter}
            onDistrictToggle={d => setDistrictFilter(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d])}
            districts={districts}
          />

          {/* Active filter chips */}
          {(activeTags.length > 0 || priceFilter.length > 0 || creatorFilter.length > 0 || districtFilter.length > 0) && (
            <div className="bg-[#FAF8F5] border-b border-neutral-100">
              <div className="max-w-[1100px] mx-auto px-8 py-2 flex items-center gap-2 flex-wrap">
                <span className="text-[10px] text-neutral-400 tracking-wider uppercase shrink-0">Active</span>
                {priceFilter.map(p => (
                  <button key={p} onClick={() => setPriceFilter(prev => prev.filter(x => x !== p))}
                    className="inline-flex items-center gap-1 px-2.5 py-[3px] rounded-full text-[11px] font-medium border bg-neutral-900 text-white border-neutral-900">
                    {PRICE_LABELS[p]}
                    <span className="text-white/60 hover:text-white ml-0.5">×</span>
                  </button>
                ))}
                {districtFilter.map(d => (
                  <button key={d} onClick={() => setDistrictFilter(prev => prev.filter(x => x !== d))}
                    className="inline-flex items-center gap-1 px-2.5 py-[3px] rounded-full text-[11px] font-medium border bg-neutral-900 text-white border-neutral-900">
                    {d}
                    <span className="text-white/60 hover:text-white ml-0.5">×</span>
                  </button>
                ))}
                {creatorFilter.map(id => {
                  const c = creators[id];
                  return c ? (
                    <button key={id} onClick={() => setCreatorFilter(prev => prev.filter(x => x !== id))}
                      className="inline-flex items-center gap-1 px-2.5 py-[3px] rounded-full text-[11px] font-medium border bg-neutral-900 text-white border-neutral-900">
                      {c.full_name}
                      <span className="text-white/60 hover:text-white ml-0.5">×</span>
                    </button>
                  ) : null;
                })}
                {activeTags.map(({ tag, category }) => (
                  <TagChip key={`${category}-${tag}`} tag={tag} category={category} active onRemove={handleTagToggle} />
                ))}
              </div>
            </div>
          )}

          {/* Content */}
          <div className="max-w-[1100px] mx-auto px-8 pt-6 pb-16">
            <p className="text-[11px] text-neutral-400 mb-5 tracking-wider uppercase">
              {loadingRestaurants ? "Loading…" : filtered.length === restaurants.length ? `${restaurants.length} restaurants` : `${filtered.length} of ${restaurants.length}`}
            </p>
            {loadingRestaurants ? (
              <div className="text-center py-24">
                <p className="text-[14px] text-neutral-400">Loading restaurants…</p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-24">
                <p className="text-[14px] text-neutral-400">No matches — try removing a filter.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
                {filtered.map(r => <Card key={r.id} r={r} activeTags={activeTags} onTagClick={handleTagToggle} onTrack={(type) => trackEvent(r.id, type)} voices={creatorVoices[r.id]} />)}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
