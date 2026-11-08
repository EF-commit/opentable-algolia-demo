// =====================================================================
// prepare-data.mjs
// STEP 1 of the data pipeline: read the two files OpenTable gave us,
// join them, clean them, enrich them, and save ONE clean file:
//   data/restaurants.json
// Run with:   node scripts/prepare-data.mjs
// =====================================================================

import fs from "node:fs";

// ---------------------------------------------------------------------
// 1. READ THE TWO SOURCE FILES
// ---------------------------------------------------------------------
const list = JSON.parse(fs.readFileSync("dataset/restaurants_list.json", "utf8"));
const csvText = fs.readFileSync("dataset/restaurants_info.csv", "utf8");

// The CSV uses ";" (semicolon) as separator, not ",".
// First line = column names, every other line = one restaurant.
const lines = csvText.trim().split(/\r?\n/);
const headers = lines[0].split(";");
const infoById = {};
for (const line of lines.slice(1)) {
  const values = line.split(";");
  const row = {};
  headers.forEach((h, i) => (row[h] = values[i]));
  infoById[row.objectID] = row; // index by ID so the join is instant
}

// ---------------------------------------------------------------------
// 2. LOOKUP TABLES USED FOR CLEANING
// ---------------------------------------------------------------------

// Same cuisine written in different ways -> one clean label
const CUISINE_FIX = {
  "Steak": "Steakhouse",
  "Prime Rib": "Steakhouse",
  "Gastro Pub": "Gastropub",
  "Global, International": "International",
  "Tapas / Small Plates": "Tapas & Small Plates",
  "Latin / Spanish": "Latin American",
};

// Each cuisine belongs to a broad "family" -> used for a 2-level menu
const FAMILY = {
  "American": ["American", "Contemporary American", "Californian", "Comfort Food", "Burgers", "Northwest", "Southwest", "Southern", "Contemporary Southern", "Low Country", "Creole", "Creole / Cajun / Southern", "Cajun", "Barbecue", "Hawaii Regional Cuisine", "Hawaiian", "Breakfast", "Tex-Mex"],
  "Steak & Seafood": ["Steakhouse", "Seafood", "Brazilian Steakhouse", "Wild Game"],
  "Italian & Pizza": ["Italian", "Contemporary Italian", "Sicilian", "Pizzeria"],
  "Asian": ["Japanese", "Sushi", "Chinese", "Dim Sum", "Thai", "Vietnamese", "Korean", "Asian", "Pan-Asian", "Contemporary Asian", "Indian", "Contemporary Indian", "South Indian", "Filipino", "Burmese", "Southeast Asian", "Hibachi", "Pacific Rim", "Polynesian", "Eurasian"],
  "French & European": ["French", "Contemporary French", "Contemporary French / American", "French American", "Provencal", "Bistro", "European", "Contemporary European", "Modern European", "Continental", "German", "Austrian", "Swiss", "Belgian", "Scandinavian", "Eastern European", "Russian", "Irish", "British", "English", "Afternoon Tea", "Fondue", "Portuguese", "Spanish", "Basque", "Tapas & Small Plates"],
  "Mediterranean & Middle Eastern": ["Mediterranean", "Greek", "Turkish", "Lebanese", "Middle Eastern", "Persian", "Moroccan", "Syrian", "Afghan", "Kosher"],
  "Latin American": ["Mexican", "Contemporary Mexican", "Regional Mexican", "Traditional Mexican", "Mexican / Southwestern", "Latin American", "Cuban", "Peruvian", "Brazilian", "Argentinean", "Puerto Rican", "Caribbean", "South American"],
  "Bars & Pubs": ["Gastropub", "Wine Bar", "Brewery", "Beer Garden", "Bar / Lounge / Bottle Service"],
  "Global & Fusion": ["International", "Fusion / Eclectic", "African", "South African", "Ethiopian", "Australian", "Modern Australian"],
  "Healthy & Plant-based": ["Vegetarian", "Vegan", "Organic"],
};
const familyOf = {};
for (const [family, cuisines] of Object.entries(FAMILY)) {
  for (const c of cuisines) familyOf[c] = family;
}

// Price: the CSV text is our source of truth (see notes in the guide)
const PRICE_LEVEL = { "$30 and under": 2, "$31 to $50": 3, "$50 and over": 4 };

// Diners Club and Carte Blanche cards run on the Discover network
const PAYMENT_FIX = { "Diners Club": "Discover", "Carte Blanche": "Discover" };

// ---------------------------------------------------------------------
// 3. SAME-NAME DETECTION: "Ruth's Chris – Downtown" -> brand "Ruth's Chris"
// Counts how many restaurants share a brand name (chains, or simply
// two different places both called "Town"). The UI uses it to warn
// the user to check the address.
// ---------------------------------------------------------------------
const splitName = (name) => {
  const parts = name.split(/\s+[–-]\s+/); // split on " – " or " - "
  return { brand: parts[0].trim(), branch: parts.slice(1).join(" – ").trim() };
};
const brandCount = {};
for (const r of list) {
  const key = splitName(r.name).brand.toLowerCase();
  brandCount[key] = (brandCount[key] || 0) + 1;
}

// ---------------------------------------------------------------------
// 4. NUMBERS FOR A FAIR "POPULARITY" SCORE (Bayesian average)
// A 5.0 with 3 reviews should NOT beat a 4.7 with 2,000 reviews.
// ---------------------------------------------------------------------
const allStars = Object.values(infoById).map((r) => Number(r.stars_count));
const AVERAGE_STARS = allStars.reduce((a, b) => a + b, 0) / allStars.length;
const MIN_REVIEWS = 100; // "trust weight": how many reviews before we believe the rating

// ---------------------------------------------------------------------
// 5. BUILD ONE CLEAN RECORD PER RESTAURANT
// ---------------------------------------------------------------------
const report = { joined: 0, missingInfo: 0, priceConflicts: 0, cuisinesFixed: 0 };
const records = [];

for (const r of list) {
  const info = infoById[String(r.objectID)]; // JSON id is a number, CSV id is text
  if (!info) { report.missingInfo++; continue; }
  report.joined++;

  const stars = Number(info.stars_count);
  const reviews = Number(info.reviews_count);
  const cuisine = CUISINE_FIX[info.food_type] || info.food_type;
  if (cuisine !== info.food_type) report.cuisinesFixed++;
  const family = familyOf[cuisine] || "Other";
  const priceLevel = PRICE_LEVEL[info.price_range];
  if (priceLevel !== r.price) report.priceConflicts++;
  const { brand, branch } = splitName(r.name);
  const sameName = brandCount[brand.toLowerCase()];

  // Bayesian average, rounded and x100 so Algolia can sort an integer
  const popularity = Math.round(
    ((reviews / (reviews + MIN_REVIEWS)) * stars +
      (MIN_REVIEWS / (reviews + MIN_REVIEWS)) * AVERAGE_STARS) * 100
  );

  // Enrichment: "experiences" = simple, explainable rules for discovery
  const experiences = [];
  if (["Fine Dining", "Casual Elegant"].includes(info.dining_style) && stars >= 4.5) experiences.push("Date night");
  if (info.dining_style === "Fine Dining" && priceLevel === 4) experiences.push("Special occasion");
  if (info.dining_style === "Fine Dining" || cuisine === "Steakhouse") experiences.push("Business dinner");
  if (info.dining_style !== "Fine Dining" && priceLevel === 2) experiences.push("Casual & affordable");
  if (stars >= 4.5 && reviews < 150) experiences.push("Hidden gem");
  if (stars >= 4.3 && reviews >= 1000) experiences.push("Crowd favourite");

  records.push({
    objectID: String(r.objectID),
    name: r.name,
    brand,
    branch,                          // e.g. "Downtown Dallas" (empty if none)
    same_name_count: sameName,       // 1 = unique name
    cuisine,                         // cleaned cuisine
    original_food_type: info.food_type,
    cuisine_hierarchy: { lvl0: family, lvl1: `${family} > ${cuisine}` },
    dining_style: info.dining_style,
    price_range: info.price_range,
    price_level: priceLevel,         // 2, 3 or 4  -> shown as $$, $$$, $$$$
    stars_count: stars,
    reviews_count: reviews,
    popularity,
    experiences,
    neighborhood: info.neighborhood,
    address: r.address,
    city: r.city,
    state: r.state,
    postal_code: r.postal_code,
    area: r.area,
    phone: info.phone_number,        // CSV phone is already nicely formatted
    payment_options: [...new Set(r.payment_options.map((p) => PAYMENT_FIX[p] || p))],
    image_url: r.image_url.replace("http://", "https://"),
    reserve_url: r.reserve_url.replace("http://", "https://"),
    _geoloc: r._geoloc,              // special Algolia attribute for geo search
  });
}

// ---------------------------------------------------------------------
// 6. SAVE + PRINT A SHORT QUALITY REPORT
// ---------------------------------------------------------------------
fs.mkdirSync("data", { recursive: true });
fs.writeFileSync("data/restaurants.json", JSON.stringify(records, null, 2));

console.log("Data quality report:", report);
console.log("Average stars:", AVERAGE_STARS.toFixed(2));
console.log("Cuisines with no family (check these!):",
  [...new Set(records.filter((x) => x.cuisine_hierarchy.lvl0 === "Other").map((x) => x.cuisine))]);
console.log(`Saved ${records.length} records to data/restaurants.json`);

