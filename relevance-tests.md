# Relevance test log

Location for testing: **New York** (Near menu, default 30-mile radius) unless stated otherwise.
All results below were observed on the live `restaurants` index.

| # | Case | Search | Expected | What I saw | Change made | After the change |
|---|---|---|---|---|---|---|
| 1 | Known item, typo, chain | `ruths cris` | Ruth's Chris, nearest branch | Typos forgiven, 31 branches, nearest first: Parsippany NJ (25 mi), Pittsburgh (315 mi), North Raleigh (420 mi) | Far-away branches were noise for a New York diner: default radius of 30 miles (`aroundRadius`), "Any distance" kept as an option | 1 result: Ruth's Chris – Parsippany NJ (25 mi) |
| 2 | Joined / split words | `bluewater` vs `blue water` | Same results | Same results both ways (Algolia splits/joins words automatically) | None needed | – |
| 3 | Partial name, not nearby | `capital gri` | The Capital Grille | 46 unrelated "…Grill" places: no Capital Grille within 30 mi, so `removeWordsIfNoResults: allOptional` dropped "capital" | `removeWordsIfNoResults: none` + a "Closest matches further away" row when nothing matches nearby | 0 nearby; Closest matches: The Capital Grille – Pittsburgh (315 mi), Indianapolis, Memphis, Miami |
| 4 | Broad | `italian` | Popular Italian places nearby | 261 results: Ecco, Gigino Trattoria, Roc Restaurant (all Manhattan) | None needed | – |
| 5 | Synonym | `steak` vs `steakhouse` | Same results | 40 vs 38, same top 3 (Bobby Van's Steakhouse, Knickerbocker Bar and Grill, Liberty Prime Steakhouse). Gap explained by prefix matching on the last word | None needed | – |
| 6 | City in the query (rule) | `sushi san diego` (Near: San Diego) | San Diego sushi/Japanese places | Rule `city-detection` fired: 2 results, Nobu San Diego, Benihana – San Diego. Sushi places in Coronado, Carlsbad, Del Mar are excluded because their `city` is not "San Diego" | Not changed (free plan: 3 rules). Next step: filter on the metro `area` instead of `city` | – |
| 6b | City in the query vs location | `sushi san diego` (Near: New York) | Something useful | 0 within 30 mi of New York; the Closest matches row offers the San Diego results | None needed | – |
| 7 | Intent word (rule) | `cheap mexican` | Mexican, $30 and under | Rule `cheap` fired ("cheap" removed, price filter applied): 24 results, Pulqueria, La Esquina, Tacombi Fonda Nolita – all $30 and under | None needed | – |
| 8 | Empty search (discovery) | (nothing typed) | Featured + popular nearby | 1,104 restaurants within 30 mi, popular first (Woolworth Tower Kitchen, Dark Horse, Benares – Tribeca); Featured near New York row; cuisine tiles with counts | None needed | – |
| 9 | No results | `asdfgh` | Never an empty page | Only the "No restaurants match" message: a dead end | Added a "Popular near New York instead" row under the message (direct query: location only, no text, no filters) | Message + 8 popular places nearby |
| 10 | Postal code | `10012` | Restaurants in that ZIP, no near-miss ZIPs | 59 results in SoHo (La Esquina, Café Select…); no typo matches on numbers | None needed | – |
| 11 | Synonym (one-way) | `romantic` | Date night places | 124 results: Ecco, Marc Forgione, Tamarind – Tribeca | Moved from a rule to a one-way synonym (free plan rule limit) | Works as before |
| 12 | Location words | `steak near me` | Steakhouses near me | Rule `near-me` fired ("near me" removed): 39 steakhouses near New York | None needed | – |
| 12b | Exact name | `nobu` | Only Nobu | Nobu Fifty Seven + Nougatine at Jean Georges (1-typo match on "nou…") | `typoTolerance: true → "min"`: typo matches only when no exact match exists | Only Nobu Fifty Seven; `ruths cris` still finds Ruth's Chris |
| 12c | Ambiguous: name or place? | `union` | Restaurants named "Union" and places around Union Square | 2 results, both in the town of Union, NJ: the city rule read "union" as the city Union and filtered on it, so Union Square restaurants (e.g. Blue Water Grill) were hidden | Not changed (no rules left on the free plan). Fix: only apply the city rule when the query has another word ("sushi union"), or use it as an optional boost instead of a filter | – |
| 12d | Same chain, same city | `the smith` | All New York branches, easy to tell apart | 2 results: The Smith – East Village and The Smith – Lincoln Center, each with its neighbourhood and full address on the card | None needed | – |
| 13 | Misspelled name | `nobuo` | Forgiving match | 1 result: Nobu Fifty Seven (one typo). Nobuo at Teeter House (Phoenix) excluded by the radius | None needed | – |
| 14 | Outside coverage | "My location" from London | Warning to pick a city | First version showed results 3,300 mi away with no hint, and all cards showed the same distance | Real distance computed client-side (geoDistance is in precision bands); red warning when far from every restaurant | Warning shown; real distances |
| 15 | Configuration check | Dashboard → searchable attributes | `neighborhood` and `city` as separate attributes | `neighborhood),unordered(city` parsed as one attribute | Syntax fixed: `unordered(neighborhood,city)` | Neighbourhood and city searches match |
