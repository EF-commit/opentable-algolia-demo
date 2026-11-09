# TableFinder – restaurant discovery prototype for OpenTable, powered by Algolia

**Live demo:** _paste your GitHub Pages link here_

OpenTable has two kinds of diners. Some **know** the restaurant they want: they need search that is fast,
forgiving with spelling, and picks the right branch of a chain. Others are **exploring**: they need inspiration,
browsing and easy refinement. This prototype serves both from one page, and sends click and booking events
back to Algolia so search quality can be measured against conversion.

> Tip for reviewers: the dataset covers US restaurants only. If you open the demo from outside the US, pick a
> city in the **Near** menu (e.g. New York).

## What the demo does

| OpenTable pain point (discovery notes) | What the demo does | Algolia feature |
|---|---|---|
| Names are hard to spell | `ruths cris`, `capital gri`, `bluewater` still find the restaurant | Typo tolerance, prefix search, word splitting/joining |
| Chains with several locations | Nearest branch first, full address on the card, "N restaurants share this name" badge | Geo ranking (`aroundLatLng`), data enrichment |
| Weak discovery | Cuisine carousel (10 families → cuisines), Occasion filter (Date night, Hidden gem…), price, rating, style, city, distance, sorting, **Featured near you** | Facets, hierarchical menu, replicas, nested index |
| Feels old | Results on every keystroke, shareable URLs, phone layout | InstantSearch.js, routing |
| Conversion | "Restaurant clicked" and "Reservation started" events | Insights API → Analytics, A/B testing, Dynamic Re-Ranking, Personalization |

## Architecture

```
dataset/ (2 raw files) ─► scripts/prepare-data.mjs ─► data/restaurants.json (5,000 clean records)
                                                        │
                          scripts/push-to-algolia.mjs ──┘──► Algolia index "restaurants"
                          (records + settings + replicas + synonyms + rules, all in code)
                                                        ▲
index.html + style.css + app.js (InstantSearch.js) ─────┘  search-only key, runs in the browser
```

Configuration lives in code, so it is versioned in Git and can be re-applied at any time.

## Data preparation (`scripts/prepare-data.mjs`)

- **Join:** `restaurants_list.json` (name, address, GPS) + `restaurants_info.csv` (cuisine, stars, price) on
  `objectID`. 5,000 / 5,000 matched. The JSON ID is a number and the CSV ID is text, so both are compared as text.
- **Cleaning:**
  - Cuisine labels normalised (e.g. `Steak` → `Steakhouse`, `Gastro Pub` → `Gastropub`): 274 records fixed.
  - 114 cuisines grouped into 10 families for a two-level cuisine menu.
  - **Price conflict:** 220 records disagree between the JSON `price` and the CSV `price_range`. I used the CSV
    text as the source of truth (it is what diners see) and derived `price_level` (2–4) for sorting. I would
    confirm this choice with OpenTable.
  - Stars and review counts converted from text to numbers; links switched to `https`; Diners Club and Carte
    Blanche mapped to Discover (same card network).
- **Enrichment:**
  - `popularity`: a Bayesian average of stars and review count. Ratings cluster around 4.3, so raw stars barely
    separate restaurants, and a 5.0 with 3 reviews should not beat a 4.7 with 2,000.
  - `experiences`: rule-based discovery tags (Date night, Special occasion, Business dinner, Casual & affordable,
    Hidden gem, Crowd favourite). In production these would come from review text.
  - `brand`, `branch`, `same_name_count`: help users pick the right location of a chain.

## Relevance configuration (`scripts/push-to-algolia.mjs`)

- **Searchable attributes:** `name` first (known-item search), then cuisine, neighbourhood + city,
  experiences + dining style, area, address, postal code. Everything except name, address and postal code is
  `unordered`.
- **Ranking:** Algolia's default tie-breaking chain. `geo` decides when a location is known.
- **Custom ranking:** `desc(popularity)`, which only breaks ties between equally relevant results.
- **Distance bands:** `aroundPrecision: 1000` in the front end, so places within the same 1 km band count as
  equally close and the better restaurant wins.
- **Typos:** default tolerance; no typos on numbers or postal codes; plurals ignored; stop words kept (names like
  "The Palm"); `removeWordsIfNoResults: allOptional` so long queries don't dead-end.
- **Sorting:** standard replicas for Top rated, Most reviewed and Price low → high.
- **Synonyms:** steak/steakhouse/chophouse, bbq/barbecue, pizza/pizzeria, nyc/new york…; one-way
  sushi → japanese, veggie → vegetarian/vegan, romantic → date night.
- **Rules (3, the free-plan limit):** city detection (`sushi san diego` → filter San Diego), `cheap` → price
  filter, `near me` → removed because geo ranking handles location. "Romantic" was moved from a rule to a
  one-way synonym because it only needs to match a tag, not change the search.
- **Featured near you:** a second search on the same index (nested `index` widget) that inherits the user's
  location and filters, looks within 5 miles, and uses one distance band so popularity alone sets the order.
- **Location:** browser GPS → IP location → city picker. Results are limited to **30 miles** of the user or chosen
  city by default (`aroundRadius`), so "ruths cris" near New York shows the New Jersey branch, not Pittsburgh.
  "Any distance" is available for people planning a trip. When nothing matches nearby, a "Closest matches further
  away" row suggests the nearest matching restaurants (a second search with no radius), so there is no dead end.
  Users far from every restaurant get a warning.

## Testing and what I changed

See [`relevance-tests.md`](relevance-tests.md) for the searches I ran and the results. Issues found and fixed
while testing:

- **Searchable-attribute syntax:** after the first upload, the dashboard showed
  `neighborhood),unordered(city` as one attribute. The correct syntax for two same-priority unordered
  attributes is `unordered(neighborhood,city)`. Neighbourhood and city searches only matched after the fix.
- **Free-plan rule limit:** the plan allows 3 rules; I had 4. Kept the three that change the search and moved
  "romantic" to a synonym.
- **Distances:** with `aroundPrecision` set, Algolia's `geoDistance` is expressed in precision bands, so every
  card showed the same distance. The front end now computes the real distance (haversine) from the user's
  position. Ranking was not affected.
- **Testing from outside the data's coverage:** from London the first version gave no hint why results were
  thousands of miles away. It now warns users who are far from every restaurant.
- **Photos:** the dataset's image links now return a generic placeholder. Cards use one free Unsplash food photo
  per cuisine family (labelled as illustrative in the footer), with an illustration as fallback. In production
  OpenTable would index its current restaurant photo URLs.
- _Add your own findings from the test log here._

## Run it yourself

```
npm install
copy .env.example .env      (then add your Algolia App ID and admin/write key)
npm run data                (creates data/restaurants.json)
npm run push                (uploads records and settings to Algolia)
```
Then open `index.html` with VS Code Live Server.

## With more time

Query Suggestions (autocomplete), Personalization and Dynamic Re-Ranking driven by real booking events, an A/B
test of the custom ranking, real-time availability as a filter, NeuralSearch for natural-language queries
("quiet place for a business lunch"), real photos and review-based tags, virtual replicas at production scale.
