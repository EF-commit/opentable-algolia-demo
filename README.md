# TableFinder – restaurant search prototype for OpenTable (Algolia)

Live demo: _paste your GitHub Pages link here_

This is my take on the OpenTable brief. From the discovery notes there are really two kinds of users. Some already
know where they want to eat and just need to find it fast, even if they spell it wrong or the place is a chain with
ten branches. Others are browsing and want ideas. I tried to cover both on one page, and I send click and
"reserve" events to Algolia so search can eventually be measured against bookings, which is what OpenTable
actually cares about.

Heads up: the data only has US restaurants. If you open the demo from outside the US, pick a city in the "Near"
menu (New York works well).

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

I kept all the Algolia configuration in a script instead of clicking it together in the dashboard. That way it's
in Git, I can see what changed between runs, and I can rebuild the index from scratch with one command.

## Data prep (`scripts/prepare-data.mjs`)

The two files describe the same 5,000 restaurants: the JSON has name, address and coordinates, the CSV has
cuisine, stars and price. I join them on `objectID`. Every record matched, but the ID is a number in one file and
a string in the other, so I compare them as strings.

Cleanup I did:

- Merged cuisine labels that mean the same thing (`Steak` and `Steakhouse`, `Gastro Pub` and `Gastropub`).
  That touched 274 records. Without it, filtering on Steakhouse misses 123 places.
- Grouped the 114 cuisines into 10 families so the cuisine menu has two levels instead of one huge list.
- Price: 220 restaurants have a different price in the JSON than in the CSV. I went with the CSV text because
  it's what diners actually see, and turned it into a number (2–4) for sorting. This is something I'd check with
  OpenTable rather than decide alone.
- Stars and review counts were stored as text, so I converted them to numbers. Also switched links to https and
  mapped Diners Club / Carte Blanche to Discover (same card network).

Things I added:

- `popularity`, a Bayesian average of stars and number of reviews. Almost every restaurant sits around 4.3
  stars, so raw stars don't tell them apart, and I didn't want a 5.0 with 3 reviews beating a 4.7 with 2,000.
- `experiences`: simple rules that tag places as Date night, Hidden gem, Business dinner and so on. They're
  rough. In a real project these would come from review text.
- `brand`, `branch` and `same_name_count`, to help people pick the right branch of a chain.

## Search configuration (`scripts/push-to-algolia.mjs`)

Searchable attributes: `name` first, because the most common job is finding a place you already know. Then
cuisine, neighbourhood and city, experiences and dining style, area, address and postal code. Everything except
name, address and postal code is `unordered`, since where a word sits inside "cuisine" doesn't mean anything.

Ranking is Algolia's default chain. `geo` kicks in when we know where the user is, and `desc(popularity)` is the
custom ranking, so popularity only decides between results that are equally good matches. In the front end I set
`aroundPrecision: 1000`, which treats places within the same 1 km band as equally close. Otherwise a mediocre
place 50 metres closer would always beat a much better one.

Other settings:

- Typos: default tolerance, but none on numbers or postal codes (10012 and 10021 are different places).
  Plurals ignored. I kept stop words because a lot of names start with "The".
- `removeWordsIfNoResults: none`. I started with `allOptional` and changed it after testing (see below).
- Sorting uses three standard replicas: Top rated, Most reviewed, Price low to high.
- Synonyms: steak/steakhouse/chophouse, bbq/barbecue, pizza/pizzeria, nyc/new york and a few more. Some are
  one-way, like sushi → japanese, so "sushi" shows Japanese places but "japanese" doesn't fill up with sushi bars.
- Rules: the free plan only allows 3, so I picked the ones that change the search. "sushi san diego" becomes
  a San Diego filter, "cheap" becomes a price filter, and "near me" gets dropped because location is already
  handled by geo. I'd also written a "romantic" rule, but it only needed to match the Date night tag, so I turned
  it into a synonym instead.

Location works like this: browser GPS if the user allows it, otherwise their IP, and there's a city picker for
everything else. By default results stay within 30 miles, so "ruths cris" near New York shows the New Jersey
branch and not Pittsburgh. You can switch to "Any distance" if you're planning a trip. If nothing matches nearby,
a "Closest matches further away" row shows the nearest options. And whenever a search returns nothing at all
(even `asdfgh`), the page still shows popular places nearby underneath the message, so there's never an empty page. And if you're nowhere near
any restaurant (like me testing from London), you get a warning to pick a city.

Favourites: there's a heart on every card. Saved places show up in a "Your favourites" row at the top when you
haven't typed anything, so a regular can rebook in one click. For the demo they're stored in the browser
(localStorage). In a real product they'd live in the diner's OpenTable account, and each favourite is already sent
to Algolia as an event, which is the kind of signal Personalization learns from.

"Similar nearby": after a name search like "nobu" or "le bernardin", three alternatives appear under the result:
same cuisine, within 5 miles of that restaurant, and a similar rating (±0.3 stars, relaxed to ±0.5 and 15 miles if
there aren't enough). Handy when your first choice is fully booked. It only triggers when every word matches the
top result's name and there are 5 results or fewer, so a broad search like "sushi" doesn't trigger it. In
production I'd use Algolia Recommend (Related Items), which learns this from click and booking events instead of
fixed rules.

"Featured near you" is a second search on the same index. It uses the same location and filters, looks within
5 miles, and puts everything in one distance band, so popularity alone decides the order.

## What I found while testing

All the searches I ran and what came back are in [`relevance-tests.md`](relevance-tests.md). The things that
made me change something:

- After the first upload I checked the config in the dashboard and saw `neighborhood),unordered(city` listed as
  one attribute. My syntax was wrong. The right way to put two attributes on the same level is
  `unordered(neighborhood,city)`. Neighbourhood and city searches only started working after that.
- The upload failed on rules at first: the free plan allows 3 and I had 4. That's how "romantic" became a synonym.
- Every card showed the same distance. It turns out that with `aroundPrecision` set, Algolia returns
  `geoDistance` in precision bands, not metres. Ranking was fine, only the display was wrong, so I now calculate
  the real distance in the browser (haversine).
- Testing from London, the first version just showed restaurants 3,000+ miles away with no explanation. Added
  the warning.
- "capital gri" near New York returned 46 random "...Grill" places. There's no Capital Grille within 30 miles,
  so `allOptional` quietly dropped "capital" and matched "grill". That's worse than nothing for someone looking
  for a specific restaurant. With `none`, the page says nothing matches nearby and the closest-matches row
  offers The Capital Grille in Pittsburgh. The downside is that long, chatty searches don't degrade as nicely.
- The city rule only filters on the exact `city` value. "sushi san diego" returns 2 places, because sushi
  places in Coronado or Carlsbad have a different city. Filtering on the metro `area` would be better. I left it
  because I'm out of rules on the free plan.
- The photo links in the dataset all return the same placeholder now. The cards use one free Unsplash food photo
  per cuisine family (the footer says they're illustrative). In production you'd use OpenTable's current photos.

## Running it

```
npm install
copy .env.example .env      (then add your Algolia App ID and admin/write key)
npm run data                (creates data/restaurants.json)
npm run push                (uploads records and settings to Algolia)
```

Then open `index.html` with VS Code Live Server.

## How I built it

I used AI tools to learn the stack, write and debug code, as the brief encourages. The testing was done on the
live index, and I can walk through every setting and why it's there.

## If I had more time

- Autocomplete with Query Suggestions.
- Personalization and Dynamic Re-Ranking once there are real booking events, plus an A/B test on the custom ranking.
- Availability (time slots) as a filter. That's probably what diners want most and it isn't in the data.
- NeuralSearch for searches like "quiet place for a business lunch".
- Real photos and tags pulled from reviews.
- Virtual replicas instead of standard ones at OpenTable's scale.
