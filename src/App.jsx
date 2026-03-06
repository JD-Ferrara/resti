import { useState, useMemo, useRef, useEffect } from "react";

// Creator registry — single source of truth
const CREATORS = {
  newyorkturk: {
    id: "newyorkturk",
    fullName: "Ertan Bek",
    primaryHandle: "NewYorkTurk",
    primaryPlatform: "tiktok",
    platforms: ["tiktok", "instagram", "youtube"],
    url: "https://www.tiktok.com/@newyorkturk",
  },
  foodalwayswon: {
    id: "foodalwayswon",
    fullName: "James Andrews",
    primaryHandle: "jamesnu",
    primaryPlatform: "youtube",
    platforms: ["youtube", "instagram"],
    url: "https://www.youtube.com/@jamesnu",
  },
};

// Creator voice placeholders — replace quotes with real content once sourced
const CREATOR_VOICES = {
  5: [ // Greywind
    { creatorId: "newyorkturk", quote: "Most underrated spot in Hudson Yards — the burger alone makes it worth the trip." },
    { creatorId: "foodalwayswon", quote: "Greywind is doing everything right. Dan Kluger never misses." },
  ],
  24: [ // Ci Siamo
    { creatorId: "newyorkturk", quote: "The caramelized onion torta is one of the best bites in the city right now." },
    { creatorId: "foodalwayswon", quote: "Live-fire Italian done with real intention. This is a Danny Meyer classic in the making." },
  ],
  25: [ // Papa San
    { creatorId: "newyorkturk", quote: "The eel pizza sounds insane — it tastes even better. One of the most exciting openings of 2025." },
  ],
  2: [ // Zou Zou's
    { creatorId: "foodalwayswon", quote: "Zou Zou's is the spot that finally gave Hudson Yards a restaurant worth bragging about." },
  ],
};

const RESTAURANTS = [
  { id: 1, name: "Queensyard", cuisine: "Contemporary American", price: 4, address: "Level 4, 20 Hudson Yards", website: "https://www.queensyardnyc.com", instagram: "https://www.instagram.com/queensyardnyc/", reservation: "https://resy.com/cities/new-york-ny/venues/queensyard", sources: [{ label: "The Infatuation", url: "https://www.theinfatuation.com/new-york/reviews/queensyard" }, { label: "OpenTable", url: "https://www.opentable.com/r/queensyard-new-york" }], tags: { occasion: ["romantic_milestone","saturday_night_out","birthday_dinner","anniversary"], vibe: ["buzzy_lively","grand_impressive","trendy_scene"], drinks: ["craft_cocktails","extensive_wine_list"], food: ["sharing_plates","chef_driven"], group: ["large_group","couples_only_vibe"], value: ["worth_the_splurge"], dietary: [] }, notes: "Stunning Vessel views, London-style American. Creative cocktails. Best for when you want to impress." },
  { id: 2, name: "Zou Zou's", cuisine: "Eastern Mediterranean", price: 3, address: "385 9th Ave, Manhattan West", website: "https://www.zouzousnyc.com", instagram: "https://www.instagram.com/zouzousnyc/", reservation: "https://www.opentable.com/r/zou-zous-new-york", sources: [{ label: "The Infatuation", url: "https://www.theinfatuation.com/new-york/reviews/zou-zous" }, { label: "OpenTable", url: "https://www.opentable.com/r/zou-zous-new-york" }], tags: { occasion: ["after_work_drinks","saturday_night_out","birthday_dinner"], vibe: ["buzzy_lively","trendy_scene","grand_impressive"], drinks: ["craft_cocktails","destination_bar"], food: ["sharing_plates","chef_driven"], group: ["large_group"], value: ["worth_the_splurge"], dietary: ["vegetarian_friendly"] }, notes: "Perpetually packed after-work crowd. Moodily lit, great sharing plates. Chez Zou upstairs for cocktails." },
  { id: 3, name: "Estiatorio Milos", cuisine: "Greek Seafood", price: 4, address: "Level 5, 20 Hudson Yards", website: "https://www.estiatoriomilos.com/location/nyhudsonyards/", instagram: "https://www.instagram.com/estiatoriomilos/", reservation: "https://resy.com/cities/new-york-ny/venues/estiatorio-milos-hudson-yards", sources: [{ label: "The Infatuation", url: "https://www.theinfatuation.com/new-york/reviews/estiatorio-milos-hudson-yards" }, { label: "OpenTable", url: "https://www.opentable.com/r/estiatorio-milos-hudson-yards-new-york" }], tags: { occasion: ["romantic_milestone","anniversary","business_dinner"], vibe: ["grand_impressive","intimate_quiet","old_school_classic"], drinks: ["extensive_wine_list"], food: ["traditional_entrees","chef_driven"], group: ["couples_only_vibe"], value: ["corporate_card_only"], dietary: ["gluten_free_friendly"] }, notes: "World-renowned Greek seafood. One of the clearest engagement/anniversary choices in the neighborhood. Outdoor terrace overlooking the Yards." },
  { id: 4, name: "Peak with Priceless", cuisine: "American", price: 4, address: "101st Floor, 30 Hudson Yards", website: "https://www.peaknyc.com", instagram: "https://www.instagram.com/peakhudsonyards/", reservation: "https://www.opentable.com/r/peak-restaurant-and-bar-new-york", sources: [{ label: "OpenTable", url: "https://www.opentable.com/r/peak-restaurant-and-bar-new-york" }], tags: { occasion: ["birthday_dinner","saturday_night_out","first_date","romantic_milestone"], vibe: ["grand_impressive","buzzy_lively","trendy_scene"], drinks: ["craft_cocktails","extensive_wine_list"], food: ["traditional_entrees","sharing_plates"], group: ["large_group","couples_only_vibe"], value: ["worth_the_splurge"], dietary: [] }, notes: "101st floor, one above Edge. Free Edge admission with $60 spend. Views are the main event — the food plays second fiddle." },
  { id: 5, name: "Greywind / Spygold", cuisine: "Contemporary American", price: 3, address: "451 10th Avenue", website: "https://www.greywindnyc.com", instagram: "https://www.instagram.com/greywind_nyc/", reservation: "https://resy.com/cities/new-york-ny/venues/greywind", sources: [{ label: "The Infatuation", url: "https://www.theinfatuation.com/new-york/reviews/greywind" }, { label: "Resy", url: "https://blog.resy.com/2023/04/greywind/" }], tags: { occasion: ["first_date","saturday_night_out","after_work_drinks"], vibe: ["cozy","intimate_quiet","hidden_gem","unpretentious"], drinks: ["craft_cocktails","destination_bar"], food: ["sharing_plates","chef_driven"], group: ["couples_only_vibe","solo_friendly"], value: ["worth_the_splurge","happy_hour_deal"], dietary: ["vegetarian_friendly"] }, notes: "Dan Kluger's gem. Greywind upstairs, Spygold cocktail bar below. Most neighborhood-feeling spot here. NY Mag best burgers list." },
  { id: 6, name: "Electric Lemon", cuisine: "New American", price: 3, address: "24th Floor, Equinox Hotel, 31 Hudson Yards", website: "https://electriclemonnyc.com", instagram: "https://www.instagram.com/electriclemonnyc/", reservation: "https://resy.com/cities/new-york-ny/venues/electric-lemon", sources: [{ label: "The Infatuation", url: "https://www.theinfatuation.com/new-york/reviews/electric-lemon" }], tags: { occasion: ["saturday_night_out","first_date","after_work_drinks"], vibe: ["trendy_scene","buzzy_lively"], drinks: ["craft_cocktails","destination_bar"], food: ["sharing_plates"], group: ["couples_only_vibe","large_group"], value: ["worth_the_splurge"], dietary: ["vegetarian_friendly","gluten_free_friendly"] }, notes: "Seasonal American on the 24th floor of the Equinox Hotel. Rooftop terrace with fire pits. Health-conscious but not boring about it." },
  { id: 7, name: "BondST", cuisine: "Japanese / Asian-American", price: 3, address: "Level 5, 20 Hudson Yards", website: "https://www.bondstrestaurant.com", instagram: "https://www.instagram.com/bondst.hudsonyards/", reservation: "https://www.opentable.com/r/bondst-hudson-yards-new-york", sources: [{ label: "OpenTable", url: "https://www.opentable.com/r/bondst-hudson-yards-new-york" }], tags: { occasion: ["business_dinner","first_date","anniversary","saturday_night_out"], vibe: ["intimate_quiet","trendy_scene"], drinks: ["craft_cocktails","extensive_wine_list"], food: ["sharing_plates","traditional_entrees"], group: ["couples_only_vibe","large_group"], value: ["worth_the_splurge"], dietary: ["gluten_free_friendly"] }, notes: "Elevated Japanese with a strong cocktail program. 25-year NoHo institution, now with a Hudson Yards home. More relaxed than Katsuya but still impressive." },
  { id: 8, name: "P.J. Clarke's", cuisine: "American Bar & Grill", price: 2, address: "4 Hudson Yards", website: "https://www.pjclarkes.com/location/hudson-yards", instagram: "https://www.instagram.com/pjclarkes/", reservation: null, sources: [{ label: "The Infatuation", url: "https://www.theinfatuation.com/new-york/reviews/pj-clarkes-hudson-yards" }], tags: { occasion: ["after_work_drinks","saturday_night_out"], vibe: ["old_school_classic","unpretentious","buzzy_lively"], drinks: ["standard_bar","great_beer_selection"], food: ["bar_snacks_only","traditional_entrees"], group: ["watch_games_with_friends","large_group","solo_friendly"], value: ["great_value"], dietary: [] }, notes: "About 50% bar — and it knows it. Best burger in the neighborhood. After-work crowd owns this place 5–7pm weekdays." },
  { id: 10, name: "Mercado Little Spain", cuisine: "Spanish Market / Hall", price: 2, address: "10 Hudson Yards", website: "https://www.littlespain.com", instagram: "https://www.instagram.com/mercadolittlespain/", reservation: null, sources: [{ label: "The Infatuation", url: "https://www.theinfatuation.com/new-york/reviews/mercado-little-spain" }, { label: "NY Times", url: "https://www.nytimes.com/2019/03/14/dining/mercado-little-spain-review.html" }], tags: { occasion: ["saturday_night_out","sunday_brunch","birthday_dinner"], vibe: ["buzzy_lively","unpretentious"], drinks: ["standard_bar","natural_wine"], food: ["sharing_plates","bar_snacks_only"], group: ["large_group","family_friendly"], value: ["great_value"], dietary: ["vegetarian_friendly"] }, notes: "José Andrés food hall. NY Times: more great food per square foot than anywhere in NYC. Go with a group and try everything." },
  { id: 11, name: "La Barra", cuisine: "Spanish Tapas", price: 2, address: "Inside Mercado Little Spain, 10 Hudson Yards", website: "https://www.littlespain.com", instagram: "https://www.instagram.com/mercadolittlespain/", reservation: "https://www.opentable.com/r/la-barra-new-york", sources: [{ label: "OpenTable", url: "https://www.opentable.com/r/la-barra-new-york" }], tags: { occasion: ["after_work_drinks","saturday_night_out"], vibe: ["buzzy_lively","unpretentious"], drinks: ["standard_bar","natural_wine"], food: ["sharing_plates"], group: ["large_group"], value: ["great_value","happy_hour_deal"], dietary: ["vegetarian_friendly"] }, notes: "Best happy hour in Hudson Yards. Solid tapas, great wine by the glass, zero attitude." },
  { id: 12, name: "Miznon", cuisine: "Israeli Street Food", price: 1, address: "10 Hudson Yards", website: "https://www.miznon.com/nyc", instagram: "https://www.instagram.com/miznon_usa/", reservation: null, sources: [{ label: "The Infatuation", url: "https://www.theinfatuation.com/new-york/reviews/miznon-hudson-yards" }, { label: "Eater NY", url: "https://ny.eater.com/venue/miznon-hudson-yards" }], tags: { occasion: ["business_lunch","sunday_brunch"], vibe: ["unpretentious","buzzy_lively"], drinks: ["standard_bar"], food: ["bar_snacks_only","sharing_plates"], group: ["solo_friendly","family_friendly"], value: ["great_value","budget_friendly"], dietary: ["vegetarian_friendly"] }, notes: "No-frills Israeli pita counter. Whole-roasted cauliflower pita is a signature. Best quick lunch in the neighborhood." },
  { id: 14, name: "Bronx Brewery Kitchen", cuisine: "Bar / American", price: 1, address: "Level 2, Hudson Yards Shops", website: "https://www.thebronxbrewery.com/hudson-yards", instagram: "https://www.instagram.com/bronxbrewery/", reservation: null, sources: [{ label: "Hudson Yards", url: "https://www.hudsonyardsnewyork.com/food-drink/bronx-brewery" }], tags: { occasion: ["after_work_drinks","saturday_night_out"], vibe: ["unpretentious","cozy"], drinks: ["great_beer_selection","standard_bar"], food: ["bar_snacks_only"], group: ["watch_games_with_friends","large_group","solo_friendly"], value: ["great_value","budget_friendly"], dietary: [] }, notes: "Best spot in the neighborhood to catch a game. Relaxed, no pretense, solid rotating taps." },
  { id: 15, name: "Shake Shack", cuisine: "Fast Casual American", price: 1, address: "Hudson Yards", website: "https://www.shakeshack.com/location/hudson-yards-nyc/", instagram: "https://www.instagram.com/shakeshack/", reservation: null, sources: [], tags: { occasion: ["business_lunch"], vibe: ["unpretentious"], drinks: ["standard_bar"], food: ["traditional_entrees"], group: ["solo_friendly","family_friendly"], value: ["great_value","budget_friendly"], dietary: [] }, notes: "It's Shake Shack. Reliable, fast, no surprises." },
  { id: 16, name: "Limusina", cuisine: "Upscale Mexican", price: 3, address: "441 9th Avenue", website: "https://www.limusina.com", instagram: "https://www.instagram.com/limusinanyc/", reservation: "https://resy.com/cities/new-york-ny/venues/limusina", sources: [{ label: "The Infatuation", url: "https://www.theinfatuation.com/new-york/reviews/limusina" }, { label: "Eater NY", url: "https://ny.eater.com/venue/limusina-nyc" }, { label: "Robb Report", url: "https://robbreport.com/food-drink/dining/limusina-quality-branded-mexican-restaurant-nyc-1237037953/" }], tags: { occasion: ["saturday_night_out","birthday_dinner","first_date","after_work_drinks"], vibe: ["trendy_scene","buzzy_lively","grand_impressive"], drinks: ["craft_cocktails","destination_bar"], food: ["sharing_plates","chef_driven"], group: ["large_group","couples_only_vibe"], value: ["worth_the_splurge"], dietary: ["vegetarian_friendly"] }, notes: "Newest Quality Branded hotspot (Don Angie, Zou Zou's). 3-level former parking garage. Great drinks and snacks." },
  { id: 17, name: "Kyma", cuisine: "Greek / Mediterranean Seafood", price: 3, address: "445 W 35th Street", website: "https://kymarestaurants.com/nyc", instagram: "https://www.instagram.com/kymahudsonyards/", reservation: "https://www.opentable.com/r/kyma-hudson-yards-new-york", sources: [{ label: "OpenTable", url: "https://www.opentable.com/r/kyma-hudson-yards-new-york" }], tags: { occasion: ["saturday_night_out","anniversary","business_dinner","birthday_dinner"], vibe: ["buzzy_lively","grand_impressive","trendy_scene"], drinks: ["craft_cocktails","extensive_wine_list"], food: ["traditional_entrees","sharing_plates","chef_driven"], group: ["large_group","couples_only_vibe"], value: ["worth_the_splurge"], dietary: ["gluten_free_friendly"] }, notes: "Whitewashed Mykonos interior. DJ Fridays & Saturdays from 8pm — vibe shifts significantly. Fish flown daily from the Mediterranean." },
  { id: 18, name: "NIZUC", cuisine: "Contemporary Coastal Mexican", price: 3, address: "Hudson Yards", website: "https://www.nizucrestaurant.com", instagram: "https://www.instagram.com/nizucnyc/", reservation: "https://www.opentable.com/r/nizuc-new-york", sources: [{ label: "OpenTable", url: "https://www.opentable.com/r/nizuc-new-york" }], tags: { occasion: ["saturday_night_out","first_date","after_work_drinks"], vibe: ["buzzy_lively","trendy_scene"], drinks: ["craft_cocktails"], food: ["sharing_plates","traditional_entrees"], group: ["large_group","couples_only_vibe"], value: ["worth_the_splurge"], dietary: ["vegetarian_friendly"] }, notes: "Coastal Mexican with Latin flair. Vibrant atmosphere, quality-ingredient focused." },
  { id: 19, name: "Russ & Daughters", cuisine: "Jewish Deli / Appetizing", price: 2, address: "50 Hudson Yards", website: "https://www.russanddaughters.com/cafe", instagram: "https://www.instagram.com/russanddaughters/", reservation: "https://resy.com/cities/new-york-ny/venues/russ-and-daughters-hudson-yards", sources: [{ label: "Eater NY", url: "https://ny.eater.com/venue/russ-and-daughters-hudson-yards" }], tags: { occasion: ["sunday_brunch","business_lunch"], vibe: ["old_school_classic","unpretentious","hidden_gem"], drinks: ["destination_bar"], food: ["traditional_entrees"], group: ["solo_friendly","family_friendly","couples_only_vibe"], value: ["great_value","worth_the_splurge"], dietary: ["gluten_free_friendly"] }, notes: "110-year-old LES icon. Smoked fish, bagels, bialys, babka. Caviar & champagne bar opening soon." },
  { id: 20, name: "Oyamel", cuisine: "Mexican", price: 2, address: "10 Hudson Yards", website: "https://www.oyamel.com/hudson-yards", instagram: "https://www.instagram.com/oyamelnyc/", reservation: "https://www.opentable.com/r/oyamel-new-york", sources: [{ label: "The Infatuation", url: "https://www.theinfatuation.com/new-york/reviews/oyamel-hudson-yards" }], tags: { occasion: ["after_work_drinks","saturday_night_out","sunday_brunch"], vibe: ["buzzy_lively","unpretentious"], drinks: ["craft_cocktails"], food: ["sharing_plates"], group: ["large_group","family_friendly"], value: ["great_value"], dietary: ["vegetarian_friendly"] }, notes: "José Andrés' Mexican concept. Lighter and more casual than Limusina. Good margaritas and antojitos post-work." },
  { id: 21, name: "ANA Bar and Eatery", cuisine: "All-Day Café / American", price: 2, address: "15 Hudson Yards", website: "https://www.15hudsonyards.com/dining/ana", instagram: "https://www.instagram.com/anabarandeatery/", reservation: null, sources: [], tags: { occasion: ["sunday_brunch","business_lunch"], vibe: ["cozy","unpretentious"], drinks: ["standard_bar"], food: ["traditional_entrees","bar_snacks_only"], group: ["solo_friendly","family_friendly"], value: ["great_value"], dietary: [] }, notes: "All-day café inside 15 Hudson Yards. Good pit stop before or after The Shed." },
  { id: 22, name: "Eataly", cuisine: "Italian Market / Café", price: 2, address: "Hudson Yards", website: "https://www.eataly.com/us_en/stores/nyc-hudson-yards/", instagram: "https://www.instagram.com/eataly/", reservation: null, sources: [{ label: "Eater NY", url: "https://ny.eater.com/venue/eataly-hudson-yards" }], tags: { occasion: ["sunday_brunch","business_lunch"], vibe: ["buzzy_lively","unpretentious"], drinks: ["standard_bar","natural_wine"], food: ["traditional_entrees","sharing_plates"], group: ["solo_friendly","family_friendly","large_group"], value: ["great_value"], dietary: ["vegetarian_friendly"] }, notes: "Fourth NYC Eataly, opened spring 2025. Italian marketplace with pasta, pizza, coffee, and wine." },
  { id: 23, name: "Fuku", cuisine: "Fast Casual / Fried Chicken", price: 1, address: "Hudson Yards", website: "https://www.fuku.com", instagram: "https://www.instagram.com/eatfuku/", reservation: null, sources: [], tags: { occasion: ["business_lunch"], vibe: ["unpretentious"], drinks: ["standard_bar"], food: ["traditional_entrees"], group: ["solo_friendly","family_friendly"], value: ["budget_friendly","great_value"], dietary: [] }, notes: "David Chang's fried chicken concept. Spicy chicken sandwich is the move." },
  { id: 24, name: "Ci Siamo", cuisine: "Italian / Live-Fire", price: 3, address: "440 W 33rd St, Manhattan West", website: "https://www.cisiamo.com", instagram: "https://www.instagram.com/cisiamonyc/", reservation: "https://www.sevenrooms.com/reservations/cisiamo/web", sources: [{ label: "Michelin", url: "https://guide.michelin.com/us/en/new-york-state/new-york/restaurant/ci-siamo" }, { label: "The Infatuation", url: "https://www.theinfatuation.com/new-york/reviews/ci-siamo" }, { label: "Eater NY", url: "https://ny.eater.com/venue/ci-siamo-nyc" }], tags: { occasion: ["romantic_milestone","saturday_night_out","anniversary","business_dinner","first_date"], vibe: ["grand_impressive","intimate_quiet","unpretentious"], drinks: ["craft_cocktails","extensive_wine_list","natural_wine"], food: ["sharing_plates","chef_driven","traditional_entrees"], group: ["couples_only_vibe","large_group"], value: ["worth_the_splurge"], dietary: ["vegetarian_friendly","gluten_free_friendly"] }, notes: "Danny Meyer / USHG live-fire Italian in Manhattan West. Michelin recognized. Chef Hillary Sterling. Caramelized onion torta alone is worth the trip." },
  { id: 25, name: "Papa San", cuisine: "Peruvian-Japanese / Nikkei Izakaya", price: 3, address: "501 W 34th Street (The Spiral)", website: "https://www.papasannyc.com", instagram: "https://www.instagram.com/papasannyc/", reservation: "https://resy.com/cities/new-york-ny/venues/papa-san", sources: [{ label: "The Infatuation", url: "https://www.theinfatuation.com/new-york/reviews/papa-san" }, { label: "Michelin", url: "https://guide.michelin.com/us/en/new-york-state/new-york/restaurant/papa-san" }, { label: "Resy", url: "https://blog.resy.com/2025/02/papa-san-nyc/" }], tags: { occasion: ["saturday_night_out","first_date","birthday_dinner","after_work_drinks"], vibe: ["buzzy_lively","trendy_scene","hidden_gem"], drinks: ["craft_cocktails","destination_bar","extensive_wine_list"], food: ["sharing_plates","chef_driven"], group: ["large_group","couples_only_vibe","solo_friendly"], value: ["worth_the_splurge"], dietary: ["gluten_free_friendly"] }, notes: "Opened Feb 2025. Nikkei izakaya: ceviches, robatayaki, eel pizza. Bar by Tres Monos (#7 World's 50 Best Bars). 60+ sakes." },
  { id: 26, name: "Locanda Verde", cuisine: "Italian Osteria", price: 3, address: "50 Hudson Yards", website: "https://www.locandaverdenyc.com/location/hudson-yards/", instagram: "https://www.instagram.com/locandaverde/", reservation: "https://resy.com/cities/new-york-ny/venues/locanda-verde-hudson-yards", sources: [{ label: "The Infatuation", url: "https://www.theinfatuation.com/new-york/reviews/locanda-verde-hudson-yards" }, { label: "OpenTable", url: "https://www.opentable.com/r/locanda-verde-hudson-yards-new-york" }], tags: { occasion: ["romantic_milestone","saturday_night_out","anniversary","business_dinner","sunday_brunch","business_lunch"], vibe: ["grand_impressive","cozy","old_school_classic"], drinks: ["craft_cocktails","extensive_wine_list"], food: ["traditional_entrees","chef_driven","sharing_plates"], group: ["couples_only_vibe","large_group"], value: ["worth_the_splurge"], dietary: ["vegetarian_friendly"] }, notes: "Andrew Carmellini's beloved Tribeca osteria, second location opened 2024. Open breakfast through dinner. Request balcony for intimate seating." },
  { id: 27, name: "Saverne", cuisine: "French Brasserie / Alsatian", price: 3, address: "531 W 34th St (The Spiral)", website: "https://www.savernenyc.com", instagram: "https://www.instagram.com/gabrielkreuther/", reservation: "https://resy.com/cities/new-york-ny/venues/saverne", sources: [{ label: "Resy", url: "https://blog.resy.com/2026/03/gabriel-kreuther-saverne/" }, { label: "WWD", url: "https://wwd.com/eye/lifestyle/inside-saverne-gabriel-kreuther-restaurant-1238640964/" }], tags: { occasion: ["saturday_night_out","first_date","business_dinner","romantic_milestone"], vibe: ["grand_impressive","cozy","unpretentious"], drinks: ["craft_cocktails","extensive_wine_list","great_beer_selection"], food: ["sharing_plates","chef_driven","traditional_entrees"], group: ["couples_only_vibe","large_group","solo_friendly"], value: ["worth_the_splurge"], dietary: ["gluten_free_friendly"] }, notes: "Opened March 2, 2026. Gabriel Kreuther (2 Michelin stars) goes casual. Wood-fired Alsatian brasserie at The Spiral. Tarte flambée, 12-seat chef's counter. Early buzz is exceptional.", isNew: true },
  { id: 28, name: "Jajaja Mexicana", cuisine: "Plant-Based Mexican", price: 2, address: "450 W 33rd St (Manhattan West)", website: "https://www.jajajamexicana.com", instagram: "https://www.instagram.com/jajajaplants/", reservation: null, sources: [{ label: "Jajaja", url: "https://www.jajajamexicana.com/hudson-yards-ny-ny" }], tags: { occasion: ["business_lunch","saturday_night_out","sunday_brunch","after_work_drinks"], vibe: ["buzzy_lively","unpretentious"], drinks: ["craft_cocktails"], food: ["sharing_plates"], group: ["solo_friendly","family_friendly","large_group"], value: ["great_value"], dietary: ["vegan","vegetarian_friendly","gluten_free_friendly"] }, notes: "100% plant-based Mexican — the entire menu is vegan by design. House-made tortillas, coco queso, seitan chorizo." },
];

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

// Concierge system prompt — built from live restaurant data so it's always in sync
const RESTAURANT_CONTEXT = RESTAURANTS.map(r =>
  `${r.name} (${r.cuisine}, ${PRICE_LABELS[r.price]}, ${r.address}): ${r.notes}`
).join("\n");

const CONCIERGE_SYSTEM = `You are a trusted friend who knows every restaurant in the Hudson Yards area of NYC better than anyone. You're warm, direct, and opinionated — the person in every friend group who always knows exactly where to go and why. You've been curating this neighborhood for friends, coworkers, dates, and family for years.

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
${RESTAURANT_CONTEXT}

You only know these restaurants. If asked about somewhere else, be honest about it and bring the conversation back to what's here.`;


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

function CreatorVoices({ voices }) {
  return (
    <div className="mb-4 space-y-2">
      {voices.map((v, i) => {
        const creator = CREATORS[v.creatorId];
        if (!creator) return null;
        return (
          <a key={i} href={creator.url} target="_blank" rel="noopener noreferrer"
            className="flex items-start gap-2.5 p-2.5 rounded-xl bg-neutral-50 hover:bg-neutral-100 transition-colors no-underline group">
            <div className="shrink-0 mt-0.5 w-5 h-5 rounded-full bg-white border border-neutral-200 flex items-center justify-center">
              {PLATFORM_ICON[creator.primaryPlatform]}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-neutral-600 leading-snug italic">"{v.quote}"</p>
              <p className="text-[10px] text-neutral-400 mt-0.5 font-medium">{creator.fullName} | @{creator.primaryHandle}</p>
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

function Card({ r, activeTags, onTagClick }) {
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const allTags = Object.entries(r.tags).flatMap(([cat, ts]) => ts.map(t => ({ tag: t, category: cat })));

  // Priority order for which tags show first
  const PRIORITY_CATS = ["occasion", "vibe", "drinks", "food", "group", "value", "dietary"];
  const sortedTags = [...allTags].sort((a, b) => PRIORITY_CATS.indexOf(a.category) - PRIORITY_CATS.indexOf(b.category));

  const PREVIEW_COUNT = 4;
  const visibleTags = tagsExpanded ? sortedTags : sortedTags.slice(0, PREVIEW_COUNT);
  const hiddenCount = sortedTags.length - PREVIEW_COUNT;
  const voices = CREATOR_VOICES[r.id];

  return (
    <div className="bg-white border border-neutral-100 rounded-2xl p-6 hover:border-neutral-200 hover:shadow-[0_2px_20px_rgba(0,0,0,0.06)] transition-all duration-200">
      <div className="flex items-start justify-between mb-1">
        <div className="flex-1 min-w-0 pr-3">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-[16px] font-semibold text-neutral-900 tracking-[-0.01em] leading-snug">{r.name}</h3>
            {r.isNew && <span className="text-[9px] font-bold tracking-[0.08em] uppercase px-1.5 py-[3px] rounded-full bg-neutral-900 text-white leading-none">New</span>}
          </div>
          <p className="text-[12px] text-neutral-400 mt-0.5">{r.cuisine}</p>
        </div>
        <span className="text-[12px] text-neutral-400 font-mono shrink-0 mt-0.5">{PRICE_LABELS[r.price]}</span>
      </div>

      <p className="text-[11px] text-neutral-400 mb-3 flex items-center gap-1">
        <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" className="w-2.5 h-2.5 shrink-0 text-neutral-300">
          <path d="M7 1C4.8 1 3 2.8 3 5c0 3 4 8 4 8s4-5 4-8c0-2.2-1.8-4-4-4z"/><circle cx="7" cy="5" r="1.3"/>
        </svg>
        {r.address}
      </p>

      <p className="text-[13px] text-neutral-600 leading-[1.6] mb-4">{r.notes}</p>

      {/* Creator voices */}
      {voices && <CreatorVoices voices={voices} />}

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
          {r.sources.map(s => (
            <a key={s.label} href={s.url} target="_blank" rel="noopener noreferrer"
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

function Sidebar({ activeTags, onTagToggle, onClear, priceFilter, onPriceToggle, creatorFilter, onCreatorToggle }) {
  return (
    <aside className="w-52 shrink-0 sticky top-12 h-[calc(100vh-3rem)] overflow-y-auto py-7 pr-3">
      <div className="flex items-center justify-between mb-5">
        <span className="text-[10px] font-semibold tracking-[0.12em] uppercase text-neutral-400">Filters</span>
        {(activeTags.length > 0 || creatorFilter.length > 0) && <button onClick={onClear} className="text-[10px] text-neutral-400 hover:text-neutral-800 transition-colors tracking-wide">Clear all</button>}
      </div>
      <div className="space-y-5">
        {/* Price */}
        <div>
          <p className="text-[10px] font-semibold tracking-[0.1em] uppercase text-neutral-300 mb-2">Price</p>
          <div className="flex flex-wrap gap-1.5">
            {[1,2,3,4].map(p => (
              <button key={p} onClick={() => onPriceToggle(p)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-mono font-medium border transition-all duration-150
                  ${priceFilter.includes(p) ? "bg-neutral-900 text-white border-neutral-900" : "bg-white text-neutral-500 border-neutral-200 hover:border-neutral-400 hover:text-neutral-800"}`}>
                {PRICE_LABELS[p]}
              </button>
            ))}
          </div>
        </div>
        {/* Creator */}
        <div>
          <p className="text-[10px] font-semibold tracking-[0.1em] uppercase text-neutral-300 mb-2">Creator</p>
          <div className="flex flex-col gap-1.5">
            {Object.values(CREATORS).map(c => {
              const active = creatorFilter.includes(c.id);
              return (
                <button key={c.id} onClick={() => onCreatorToggle(c.id)}
                  className={`flex items-center justify-between px-2.5 py-2 rounded-xl text-left border transition-all duration-150 w-full
                    ${active ? "bg-neutral-900 border-neutral-900" : "bg-white border-neutral-200 hover:border-neutral-400"}`}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className={`text-[11px] font-semibold leading-none ${active ? "text-white" : "text-neutral-700"}`}>{c.fullName}</p>
                      <div className="flex items-center gap-0.5">
                        {c.platforms.map(p => (
                          <span key={p} className={`flex items-center justify-center w-3.5 h-3.5 rounded-full ${active ? "bg-neutral-700" : "bg-neutral-100"}`}>
                            {PLATFORM_ICON[p]}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <p className={`text-[10px] mt-0.5 ${active ? "text-neutral-300" : "text-neutral-400"}`}>@{c.primaryHandle}</p>
                </button>
              );
            })}
          </div>
        </div>
        {Object.entries(TAG_CATEGORIES).map(([catKey, cat]) => (
          <div key={catKey}>
            <p className="text-[10px] font-semibold tracking-[0.1em] uppercase text-neutral-300 mb-2">{cat.label}</p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(cat.tags).map(([tagKey]) => {
                const isActive = activeTags.some(a => a.tag === tagKey && a.category === catKey);
                return <TagChip key={tagKey} tag={tagKey} category={catKey} active={isActive} onClick={onTagToggle} />;
              })}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}

export default function App() {
  // Explore mode state
  const [activeTags, setActiveTags] = useState([]);
  const [search, setSearch] = useState("");
  const [priceFilter, setPriceFilter] = useState([]);
  const [creatorFilter, setCreatorFilter] = useState([]);
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
    } catch {
      setChatMessages(prev => [...prev, { role: "assistant", content: "Something went wrong. Please try again." }]);
    }
    setChatLoading(false);
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  const filtered = useMemo(() => RESTAURANTS.filter(r => {
    const q = search.toLowerCase();
    const voiceCreatorIds = (CREATOR_VOICES[r.id] || []).map(v => v.creatorId);
    return (!q || r.name.toLowerCase().includes(q) || r.cuisine.toLowerCase().includes(q) || r.notes.toLowerCase().includes(q))
      && (!priceFilter.length || priceFilter.includes(r.price))
      && (!creatorFilter.length || creatorFilter.some(id => voiceCreatorIds.includes(id)))
      && activeTags.every(({ tag, category }) => r.tags[category]?.includes(tag));
  }), [activeTags, search, priceFilter, creatorFilter]);

  return (
    <div className="min-h-screen bg-[#FAF8F5]" style={{ fontFamily: "-apple-system, 'SF Pro Text', 'SF Pro Display', BlinkMacSystemFont, 'Helvetica Neue', sans-serif" }}>

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

          <div className="flex items-center gap-2.5">
            {mode === "explore" ? (
              /* Search — Explore mode */
              <div className="relative">
                <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-neutral-400 pointer-events-none" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <circle cx="5.5" cy="5.5" r="4"/><path d="M12 12l-2.5-2.5"/>
                </svg>
                <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
                  className="pl-7 pr-3 py-[5px] text-[12px] bg-neutral-100 rounded-full border-0 text-neutral-900 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-300 w-36 transition-all duration-200 focus:w-48" />
              </div>
            ) : (
              /* Chat input — Concierge mode */
              <div className="flex gap-1.5 items-center">
                <input
                  type="text"
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && !e.shiftKey && handleConciergeChat()}
                  placeholder="Tell me what you're planning…"
                  className="w-56 px-3 py-[5px] text-[12px] bg-neutral-100 rounded-full border-0 text-neutral-900 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-300 transition-all duration-200 focus:w-72"
                />
                <button
                  onClick={() => handleConciergeChat()}
                  disabled={!chatInput.trim() || chatLoading}
                  className="shrink-0 px-3 py-[5px] rounded-full text-[12px] font-medium bg-neutral-900 text-white hover:bg-neutral-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150"
                >
                  Send
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {mode === "concierge" ? (
        /* ── Concierge Chat Mode ── */
        <div className="max-w-2xl mx-auto px-6 flex flex-col" style={{ height: "calc(100vh - 3rem)" }}>

          {/* Messages / Landing */}
          <div className="flex-1 overflow-y-auto py-6 space-y-4">
            {chatMessages.length === 0 ? (
              /* Landing state */
              <div className="text-center py-20">
                <p className="text-[15px] font-medium text-neutral-700 mb-2">Your Hudson Yards concierge</p>
                <p className="text-[13px] text-neutral-400 leading-relaxed">
                  Tell me the occasion and I'll find you the right spot.<br className="hidden sm:block" />
                  I'll ask a couple questions before making a call.
                </p>
                <div className="mt-6 flex flex-wrap gap-2 justify-center">
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
              </div>
            ) : (
              /* Chat thread */
              chatMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[82%] px-4 py-2.5 rounded-2xl text-[13px] leading-relaxed whitespace-pre-wrap
                    ${msg.role === "user"
                      ? "bg-neutral-900 text-white rounded-br-sm"
                      : "bg-white border border-neutral-100 text-neutral-800 rounded-bl-sm shadow-sm"
                    }`}>
                    {msg.content}
                  </div>
                </div>
              ))
            )}

            {/* Typing indicator */}
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

          {/* Active filter bar */}
          {activeTags.length > 0 && (
            <div className="bg-white border-b border-neutral-100">
              <div className="max-w-[1100px] mx-auto px-8 py-2 flex items-center gap-2 flex-wrap">
                <span className="text-[10px] text-neutral-400 tracking-wider uppercase">Active</span>
                {activeTags.map(({ tag, category }) => (
                  <TagChip key={`${category}-${tag}`} tag={tag} category={category} active onRemove={handleTagToggle} />
                ))}
              </div>
            </div>
          )}

          {/* Layout */}
          <div className="max-w-[1100px] mx-auto px-8 flex gap-8 pt-6 pb-16">
            <Sidebar activeTags={activeTags} onTagToggle={handleTagToggle} onClear={() => { setActiveTags([]); setCreatorFilter([]); }} priceFilter={priceFilter} onPriceToggle={p => setPriceFilter(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p])} creatorFilter={creatorFilter} onCreatorToggle={id => setCreatorFilter(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])} />

            <main className="flex-1 min-w-0">
              <p className="text-[11px] text-neutral-400 mb-5 tracking-wider uppercase">
                {filtered.length === RESTAURANTS.length ? `${RESTAURANTS.length} restaurants` : `${filtered.length} of ${RESTAURANTS.length}`}
              </p>
              {filtered.length === 0 ? (
                <div className="text-center py-24">
                  <p className="text-[14px] text-neutral-400">No matches — try removing a filter.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3.5">
                  {filtered.map(r => <Card key={r.id} r={r} activeTags={activeTags} onTagClick={handleTagToggle} />)}
                </div>
              )}
            </main>
          </div>
        </>
      )}
    </div>
  );
}
