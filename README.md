# TableFinder – restaurant search prototype for OpenTable (Algolia)

Live demo: https://ef-commit.github.io/opentable-algolia-demo/

**In short:** one search page for two kinds of diners. People who know where they want to eat find it even with a
typo or a half-typed name, and people who are still deciding can browse by cuisine, occasion, price and rating.
Results stay close to the diner, the page is never empty, and every click and "Reserve" is sent to Algolia.

The data only has US restaurants. If you open the demo from outside the US, pick a city in the "Near" menu
(New York is a good one).

## What it does

| OpenTable pain point (discovery notes) | What the demo does | Algolia feature |
|---|---|---|
| Names are hard to spell | `ruths cris`, `capital gri`, `bluewater` still find the restaurant | Typo tolerance, prefix search, word splitting/joining |
| Chains with several locations | Nearest branch first, full address on the card, "N restaurants share this name" badge | Geo ranking (`aroundLatLng`), data enrichment |
| Regulars want to get back to their usual places fast | Heart any restaurant; "Your favourites" sits at the top of the page | Favourite sent as an Insights event (input for Personalization) |
| Weak discovery | Cuisine carousel (10 families → cuisines), Occasion filter (Date night, Hidden gem…), price, rating, style, city, distance, sorting, **Featured near you** | Facets, hierarchical menu, replicas, nested index |
| Feels old | Results on every keystroke, shareable URLs, phone layout | InstantSearch.js, routing |
| Conversion | "Restaurant clicked" and "Reservation started" events | Insights API → Analytics, A/B testing, Dynamic Re-Ranking, Personalization |

## How it fits together

```
dataset/ (2 raw files) ─► scripts/prepare-data.mjs ─► data/restaurants.json (5,000 clean records)
                                                        │
                          scripts/push-to-algolia.mjs ──┘──► Algolia index "restaurants"
                          (records + settings + replicas + synonyms + rules, all in code)
                                                        ▲
index.html + style.css + app.js (InstantSearch.js) ─────┘  search-only key, runs in the browser
```

One script cleans the data, a second one sends it to Algolia with all the search settings, and the website asks
Algolia for results while you type. I kept the settings in a script rather than in the dashboard, so every change
is saved in Git and I can rebuild the index with one command.

## Preparing the data

The two files describe the same 5,000 restaurants, and all of them matched on `objectID`. What I fixed:

- Cuisines written in different ways (`Steak` and `Steakhouse`) are merged: 274 restaurants. Without this,
  filtering on Steakhouse missed 123 places.
- 114 cuisines grouped into 10 families, so you pick "Asian" first and then "Sushi" or "Thai".
- 220 restaurants had two different prices. I used the one diners see on the site, but I'd check this with
  OpenTable.

What I added:

- A `popularity` score that mixes stars with the number of reviews. Almost every place is rated around 4.3, and I
  didn't want a 5.0 from 3 reviews to beat a 4.7 from 2,000.
- Occasion tags like Date night and Hidden gem. They're simple rules for now; real review text would make them
  much better.
- A count of restaurants that share a name, so the card can warn you to check the address.

## Search settings

The decisions a diner would notice:

- **Name comes first.** Most people search for a place they already know. Popularity only decides between results
  that match equally well, so a popular restaurant never pushes out the one you typed.
- **Close by.** Results use your location (GPS, IP or the city you pick) and stay within 30 miles, so "ruths cris"
  near New York shows the New Jersey branch, not Pittsburgh. "Any distance" is there for trip planning.
- **Typos forgiven, but not when you typed it right.** "nobuo" finds Nobu. "nobu" shows only Nobu.
- **Same meaning, same results.** steak/steakhouse, bbq/barbecue, nyc/new york. "sushi" also shows Japanese places.
- **Three rules** (the free plan limit): "sushi san diego" filters on San Diego, "cheap" becomes a price filter, and
  "near me" is ignored because location is already handled.
- **Never an empty page.** If nothing matches nearby, you see the closest matches further away. If nothing matches
  at all, you see popular places nearby. An empty page is a lost booking.
- **Similar nearby.** After a search for one restaurant, three similar places within 5 miles appear underneath, in
  case your first choice is fully booked.

## What I found while testing

All the searches are in [`relevance-tests.md`](relevance-tests.md). The ones that made me change something:

- "capital gri" near New York returned 46 random "...Grill" places, because Algolia dropped the word "capital".
  For someone looking for one restaurant that's worse than nothing. Now it says there's no match nearby and offers
  The Capital Grille in Pittsburgh.
- "nobu" also showed Nougatine, one letter off. I made typo matching stricter, and "ruths cris" still works.
- Testing from London, the first version showed restaurants 3,000 miles away with no explanation. Now you get a
  red warning to pick a city.
- Every card showed the same distance, so the site now works out the real distance itself.
- "union" near New York only returned the town of Union, New Jersey, because the city rule filtered on it. I'm out
  of rules on the free plan, so it's on my next-steps list.

## Running it

```
npm install
copy .env.example .env      (then add your Algolia App ID and admin/write key)
npm run data                (creates data/restaurants.json)
npm run push                (uploads records and settings to Algolia)
```

Then open `index.html` with VS Code Live Server.

## How I built it

I focused on the customer experience: search that finds the right restaurant even when the name is misspelled,
and a page that always gives the diner somewhere to go next. Most of my decisions came from testing the live site
the way a diner would, which is how I ended up keeping results within 30 miles, never showing an empty page, and
limiting "Similar nearby" to three places. I used AI tools for coding support, as the brief encourages.

## If I had more time

- Availability as a filter ("a table for 2 tonight at 8pm"). It's probably what diners want most, and it isn't in
  the data.
- Autocomplete with Query Suggestions.
- Personalization and an A/B test on the popularity ranking, once there are real booking events.
- A side-by-side "compare" view for a shortlist of restaurants.
- Real photos (the cards use illustrative Unsplash photos per cuisine) and tags taken from reviews.
