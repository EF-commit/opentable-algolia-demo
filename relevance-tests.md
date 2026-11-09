# Relevance test log

Location used for testing: **New York** (Near menu), unless stated otherwise. For each search: what I
expected, what the top 3 results were, and what I changed.

| # | Case | Search | Expected | Top 3 results I saw | Change made | After the change |
|---|---|---|---|---|---|---|
| 1 | Known item, typo, chain | `ruths cris` | Ruth's Chris Steak House, nearest branch first | | | |
| 2 | Joined / split words | `bluewater` vs `blue water` | Same results both ways | | | |
| 3 | Partial name | `capital gri` | The Capital Grille | | | |
| 4 | Broad | `italian` | Popular Italian places near New York | | | |
| 5 | Synonym | `steak` vs `steakhouse` | Same results | | | |
| 6 | City in the query (rule) | `sushi san diego` | Only San Diego sushi/Japanese places | | | |
| 7 | Intent word (rule) | `cheap mexican` | Mexican, $30 and under only | | | |
| 8 | Empty search (discovery) | (nothing typed) | Featured near New York + popular places nearby | | | |
| 9 | No results | `asdfgh` | Friendly empty message | | | |
| 10 | Postal code | `10012` | Restaurants in that ZIP, no near-miss ZIPs | | | |
| 11 | Outside coverage | "My location" from London | Warning to pick a city | Warning shown in red | Added warning for GPS users (it only covered IP users before) | Works |
