// =====================================================================
// push-to-algolia.mjs
// STEP 2 of the data pipeline: send the clean records to Algolia and
// apply ALL search settings (so the configuration lives in code, can be
// reviewed in Git, and can be re-applied at any time).
// Run with:   node --env-file=.env scripts/push-to-algolia.mjs
// =====================================================================

import fs from "node:fs";
import { algoliasearch } from "algoliasearch";

// Secret keys come from the .env file (never written in the code itself)
const APP_ID = process.env.ALGOLIA_APP_ID;
const ADMIN_KEY = process.env.ALGOLIA_ADMIN_KEY;
if (!APP_ID || !ADMIN_KEY) {
  throw new Error("Missing ALGOLIA_APP_ID or ALGOLIA_ADMIN_KEY in your .env file");
}

const INDEX = "restaurants";
const REPLICAS = {
  top_rated: `${INDEX}_top_rated`,
  most_reviewed: `${INDEX}_most_reviewed`,
  price_asc: `${INDEX}_price_asc`,
};

const client = algoliasearch(APP_ID, ADMIN_KEY);
const records = JSON.parse(fs.readFileSync("data/restaurants.json", "utf8"));

// ---------------------------------------------------------------------
// 1. UPLOAD THE RECORDS
// saveObjects = "add or replace by objectID", so running twice is safe.
// ---------------------------------------------------------------------
console.log(`Uploading ${records.length} records...`);
await client.saveObjects({ indexName: INDEX, objects: records, waitForTasks: true });

// ---------------------------------------------------------------------
// 2. MAIN INDEX SETTINGS (relevance configuration)
// ---------------------------------------------------------------------
const DEFAULT_RANKING = ["typo", "geo", "words", "filters", "proximity", "attribute", "exact", "custom"];

console.log("Applying index settings...");
let res = await client.setSettings({
  indexName: INDEX,
  forwardToReplicas: true, // replicas inherit these, we override ranking below
  indexSettings: {
    // WHERE to search, in order of importance (top = most important)
    searchableAttributes: [
      "name",                                   // known-item search: name wins
      "unordered(cuisine)",                     // "sushi", "italian"
      "unordered(neighborhood, city)", // "soho", "denver"
      "unordered(experiences, dining_style)", // "date night", "fine dining"
      "unordered(area)",
      "address",
      "postal_code",
    ],

    // WHAT can be filtered / counted in the filters
    attributesForFaceting: [
      "searchable(cuisine)",
      "cuisine_hierarchy.lvl0",
      "cuisine_hierarchy.lvl1",
      "price_range",
      "dining_style",
      "experiences",
      "searchable(city)",
      "area",
      "payment_options",
      "stars_count",
    ],

    // TIE-BREAKER when text relevance is equal: Bayesian popularity
    customRanking: ["desc(popularity)"],
    ranking: DEFAULT_RANKING,

    // Typo & query behaviour
    typoTolerance: true,
    minWordSizefor1Typo: 4,
    minWordSizefor2Typos: 8,
    allowTyposOnNumericTokens: false,          // "10012" must not match "10021"
    disableTypoToleranceOnAttributes: ["postal_code"],
    ignorePlurals: ["en"],                      // "steakhouses" = "steakhouse"
    queryLanguages: ["en"],
    indexLanguages: ["en"],
    removeStopWords: false,                     // keep "the" in "The Palm"
    removeWordsIfNoResults: "none",      // long queries degrade gracefully

    // Display
    attributesToHighlight: ["name", "cuisine", "neighborhood", "city"],
    hitsPerPage: 12,

    // Sort options = replicas (a copy of the index with a different order)
    replicas: Object.values(REPLICAS),
  },
});
await client.waitForTask({ indexName: INDEX, taskID: res.taskID });

// ---------------------------------------------------------------------
// 3. REPLICAS = SORT ORDERS ("Top rated", "Most reviewed", "Price")
// ---------------------------------------------------------------------
const replicaRanking = {
  [REPLICAS.top_rated]: ["desc(stars_count)", "desc(reviews_count)", ...DEFAULT_RANKING],
  [REPLICAS.most_reviewed]: ["desc(reviews_count)", ...DEFAULT_RANKING],
  [REPLICAS.price_asc]: ["asc(price_level)", ...DEFAULT_RANKING],
};
for (const [replica, ranking] of Object.entries(replicaRanking)) {
  console.log(`Configuring replica ${replica}...`);
  res = await client.setSettings({ indexName: replica, indexSettings: { ranking } });
  await client.waitForTask({ indexName: replica, taskID: res.taskID });
}

// ---------------------------------------------------------------------
// 4. SYNONYMS = different words, same meaning
// ---------------------------------------------------------------------
console.log("Saving synonyms...");
const synonyms = [
  { objectID: "steak", type: "synonym", synonyms: ["steakhouse", "steak house", "steak", "chophouse", "chop house"] },
  { objectID: "bbq", type: "synonym", synonyms: ["bbq", "barbecue", "barbeque", "bar-b-que"] },
  { objectID: "pizza", type: "synonym", synonyms: ["pizza", "pizzeria"] },
  { objectID: "pub", type: "synonym", synonyms: ["pub", "gastropub", "gastro pub"] },
  { objectID: "texmex", type: "synonym", synonyms: ["tex mex", "tex-mex", "texmex"] },
  // one-way: "sushi" also shows Japanese restaurants, but not the reverse
  { objectID: "sushi", type: "oneWaySynonym", input: "sushi", synonyms: ["japanese"] },
  { objectID: "veggie", type: "oneWaySynonym", input: "veggie", synonyms: ["vegetarian", "vegan"] },
  { objectID: "romantic", type: "oneWaySynonym", input: "romantic", synonyms: ["date night"] },
  // city nicknames
  { objectID: "nyc", type: "synonym", synonyms: ["nyc", "new york"] },
  { objectID: "sf", type: "synonym", synonyms: ["sf", "san francisco"] },
  { objectID: "philly", type: "synonym", synonyms: ["philly", "philadelphia"] },
];
res = await client.saveSynonyms({
  indexName: INDEX,
  synonymHit: synonyms,
  forwardToReplicas: true,
  replaceExistingSynonyms: true,
});
await client.waitForTask({ indexName: INDEX, taskID: res.taskID });

// ---------------------------------------------------------------------
// 5. RULES = "if the query looks like X, then do Y"
// ---------------------------------------------------------------------
console.log("Saving rules...");
const removeWord = (word) => ({ type: "remove", delete: word });
const rules = [
  {
    objectID: "city-detection",
    description: "'sushi boston' -> filter on city Boston, search 'sushi'",
    conditions: [{ pattern: "{facet:city}", anchoring: "contains" }],
    consequence: { params: { automaticFacetFilters: [{ facet: "city" }] } },
  },
  {
    objectID: "cheap",
    description: "Budget words become a price filter",
    conditions: [{ pattern: "cheap", anchoring: "contains" }],
    consequence: { params: { filters: 'price_range:"$30 and under"', query: { edits: [removeWord("cheap")] } } },
  },
  {
    objectID: "near-me",
    description: "Location words are handled by geo ranking, not text",
    conditions: [{ pattern: "near me", anchoring: "contains" }],
    consequence: { params: { query: { edits: [removeWord("near"), removeWord("me")] } } },
  },
];
res = await client.saveRules({
  indexName: INDEX,
  rules,
  forwardToReplicas: true,
  clearExistingRules: true,
});
await client.waitForTask({ indexName: INDEX, taskID: res.taskID });

console.log("Done! Open the Algolia dashboard to see the 'restaurants' index.");