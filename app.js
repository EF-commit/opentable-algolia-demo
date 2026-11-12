// =====================================================================
// app.js – the search experience (InstantSearch.js)
// =====================================================================

// ---------------------------------------------------------------------
// 1. CONNECT TO ALGOLIA
// The Search-Only key is PUBLIC by design: it can only read, never write.
// ---------------------------------------------------------------------
const ALGOLIA_APP_ID = "7A9UXTGE6W";
const ALGOLIA_SEARCH_KEY = "3a40282e6446ee1d227478d0a4462e00";
const INDEX = "restaurants";

const { liteClient: algoliasearch } = window["algoliasearch/lite"];
const searchClient = algoliasearch(ALGOLIA_APP_ID, ALGOLIA_SEARCH_KEY);

const search = instantsearch({
  indexName: INDEX,
  searchClient,
  insights: true,       // sends click/conversion events -> Analytics, A/B tests
  routing: true,        // the URL reflects the search, so it can be shared
});

const { searchBox, infiniteHits, refinementList, ratingMenu,
  sortBy, stats, clearRefinements, currentRefinements } = instantsearch.widgets;

// ---------------------------------------------------------------------
// 2. LOCATION STATE (browser GPS -> fallback to IP -> or a chosen city)
// ---------------------------------------------------------------------
let userLocation = null;   // { lat, lng } or null (= use IP address)
let locationLabel = "your approximate location";
let radius = "48280";     // default: within 30 miles (in metres); "all" = any distance

// Builds the query parameters that depend on location
function locationParams() {
  const params = {
    getRankingInfo: true,  // gives us the distance of each result
    aroundPrecision: 1000, // results within the same 1 km "band" are ranked by popularity
    aroundRadius: radius === "all" ? "all" : Number(radius),
  };
  if (userLocation) {
    params.aroundLatLng = `${userLocation.lat},${userLocation.lng}`;
  } else {
    params.aroundLatLngViaIP = true; // fallback when GPS is not available
  }
  return params;
}

// A "configure" widget we can update later (when the location changes)
let updateParams = () => {};
const locationConfigure = instantsearch.connectors.connectConfigure(
  ({ refine }) => {
    updateParams = () => {
      search.helper.setPage(0); // a new location or distance always starts again at page 1
      refine(locationParams());
    };
  }
);

function setStatus(text, isWarning = false) {
  const status = document.getElementById("location-status");
  status.textContent = text;
  status.classList.toggle("location-status--warning", isWarning); // red style for warnings
}

function useBrowserLocation() {
  if (!navigator.geolocation) {
    setStatus("Location not available in this browser – using your approximate (IP) location.");
    return;
  }
  setStatus("Finding your location…");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      locationLabel = "you";
      setStatus("📍 Showing restaurants near you.");
      updateParams();
    },
    () => {
      userLocation = null;
      locationLabel = "your approximate location";
      setStatus("Location permission not given – using your approximate (IP) location. You can also pick a city.");
      updateParams();
    },
    { timeout: 8000 }
  );
}

document.getElementById("location-select").addEventListener("change", (e) => {
  const value = e.target.value;
  if (value === "auto") return useBrowserLocation();
  const [lat, lng] = value.split(",").map(Number);
  userLocation = { lat, lng };
  locationLabel = e.target.selectedOptions[0].text;
  setStatus(`📍 Showing restaurants near ${locationLabel}.`);
  updateParams();
});

document.getElementById("radius-select").addEventListener("change", (e) => {
  radius = e.target.value;
  updateParams();
});

// ---------------------------------------------------------------------
// 3. SMALL HELPERS FOR DISPLAY
// ---------------------------------------------------------------------
const dollars = (level) => "$".repeat(level);
const miles = (metres) =>
  metres < 16090 ? (metres / 1609).toFixed(1) : Math.round(metres / 1609).toLocaleString("en-US");

// Real distance in metres between two points on Earth (haversine formula)
function haversine(a, b) {
  const R = 6371000, toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Algolia's geoDistance is divided by the precision band (aroundPrecision),
// so we compute the real distance ourselves when we know the user's position.
function distanceMetres(hit) {
  if (userLocation && hit._geoloc) return haversine(userLocation, hit._geoloc);
  const info = hit._rankingInfo;
  return info?.geoDistance !== undefined ? info.geoDistance * (info.geoPrecision || 1) : undefined;
}

// ---------------------------------------------------------------------
// 3b. CUISINE CAROUSEL (Deliveroo-style tiles, built on the hierarchical menu)
// Row of cuisine families; picking one reveals its cuisines as small pills.
// ---------------------------------------------------------------------
const FAMILIES = [
  ["American", "🍔"], ["Italian & Pizza", "🍝"], ["Asian", "🍣"], ["Steak & Seafood", "🥩"],
  ["French & European", "🥐"], ["Latin American", "🌮"], ["Mediterranean & Middle Eastern", "🥙"],
  ["Bars & Pubs", "🍺"], ["Global & Fusion", "🌍"], ["Healthy & Plant-based", "🥗"],
];
// Food photos per cuisine family (free Unsplash licence). They illustrate the
// CUISINE, not the specific restaurant: the dataset's own photo links are stale.
const photo = (id) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=600&h=400&q=70`;
const FAMILY_PHOTOS = {
  "American": photo("photo-1568901346375-23c9450c58cd"),
  "Italian & Pizza": photo("photo-1621996346565-e3dbc646d9a9"),
  "French & European": photo("photo-1642112177610-c1ff271857dd"),
  "Mediterranean & Middle Eastern": photo("photo-1619941862585-cd4fa9a4c2cb"),
  "Bars & Pubs": photo("photo-1766589152188-54bd12a5c71b"),
  "Global & Fusion": photo("photo-1514326640560-7d063ef2aed5"),
  "Healthy & Plant-based": photo("photo-1758721217610-a5d729a319e9"),
  "Asian": photo("photo-1553621042-f6e147245754"),
  "Steak & Seafood": photo("photo-1615937657715-bc7b4b7962c1"),
  "Latin American": photo("photo-1760322328049-91bb196d41d9"),
};
const familyPhoto = (family) => FAMILY_PHOTOS[family];
const hidePhoto = (event) => (event.currentTarget.style.display = "none"); // broken link -> illustration shows

const familyIcon = (family) => (FAMILIES.find(([name]) => name === family) || [, "🍽️"])[1];
const familyOrder = (name) => {
  const i = FAMILIES.findIndex(([family]) => family === name);
  return i === -1 ? 99 : i;
};

// Small helper: create an element with a class and text
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const cuisineCarousel = instantsearch.connectors.connectHierarchicalMenu(({ items, refine }) => {
  const track = document.getElementById("cuisine-carousel");
  const sub = document.getElementById("sub-cuisines");
  track.replaceChildren();
  sub.replaceChildren();

  for (const item of items) {
    const tile = el("button", item.isRefined ? "tile tile--active" : "tile");
    const icon = (FAMILIES.find(([family]) => family === item.label) || [, "🍽️"])[1];
    tile.append(el("span", "tile__icon", icon), el("span", "tile__label", item.label),
      el("span", "tile__count", item.count.toLocaleString()));
    tile.addEventListener("click", () => refine(item.value));
    track.append(tile);

    // The selected family shows its cuisines underneath (e.g. Asian -> Sushi, Thai...)
    if (item.isRefined && item.data) {
      for (const child of item.data) {
        const pill = el("button", child.isRefined ? "chip-btn chip-btn--active" : "chip-btn", child.label);
        pill.append(el("span", "chip-btn__count", child.count.toLocaleString()));
        pill.addEventListener("click", () => refine(child.value));
        sub.append(pill);
      }
    }
  }
});

// ---------------------------------------------------------------------
// 3b+. FAVOURITES: a heart on every card, saved in this browser.
// In production they would live in the diner's OpenTable account; each
// favourite is also sent to Algolia as an event (input for Personalization).
// ---------------------------------------------------------------------
const FAVOURITES_KEY = "tablefinder:favourites";
function loadFavourites() {
  try { return JSON.parse(localStorage.getItem(FAVOURITES_KEY)) || {}; } catch { return {}; }
}
function saveFavourites(favourites) {
  try { localStorage.setItem(FAVOURITES_KEY, JSON.stringify(favourites)); } catch { /* storage blocked: ignore */ }
}
const isFavourite = (id) => Boolean(loadFavourites()[id]);

// Keep only what a card needs, so the favourites row works without a search
const FAVOURITE_FIELDS = ["objectID", "name", "brand", "cuisine", "price_level", "stars_count",
  "neighborhood", "city", "state", "reserve_url", "cuisine_hierarchy", "_geoloc"];

function toggleFavourite(hit, sendEvent) {
  const favourites = loadFavourites();
  if (favourites[hit.objectID]) {
    delete favourites[hit.objectID];
  } else {
    favourites[hit.objectID] = Object.fromEntries(FAVOURITE_FIELDS.map((field) => [field, hit[field]]));
    if (sendEvent) sendEvent("conversion", hit, "Restaurant Favourited");
  }
  saveFavourites(favourites);
  // Update every heart for this restaurant on the page, then the favourites row
  document.querySelectorAll(`.fav[data-id="${hit.objectID}"]`)
    .forEach((button) => button.classList.toggle("fav--on", Boolean(favourites[hit.objectID])));
  renderFavourites();
}

function heartButton(hit, sendEvent) {
  const button = el("button", isFavourite(hit.objectID) ? "fav fav--on" : "fav", "♥");
  button.dataset.id = hit.objectID;
  button.setAttribute("aria-label", "Save to favourites");
  button.addEventListener("click", (event) => {
    event.preventDefault();   // don't open the booking link
    event.stopPropagation();  // don't count as a card click
    toggleFavourite(hit, sendEvent);
  });
  return button;
}

// "Your favourites" row: on the browse view (nothing typed), when there are some
function renderFavourites() {
  const section = document.getElementById("favourites-section");
  const favourites = Object.values(loadFavourites());
  const browsing = !search.helper?.state.query;
  section.hidden = !(browsing && favourites.length > 0);
  if (section.hidden) return;
  document.getElementById("favourites").replaceChildren(...favourites.map((hit) => smallCard(hit, null, "")));
}

// ---------------------------------------------------------------------
// 3c. FEATURED CAROUSEL: best-loved restaurants within 5 miles
// A second, smaller search on the same index. It shares the user's location,
// but looks only within 5 miles and puts them all in ONE distance band
// (aroundPrecision = radius), so popularity decides the order.
// ---------------------------------------------------------------------
const FEATURED_RADIUS = 8047; // 5 miles in metres

const featuredCarousel = instantsearch.connectors.connectHits(({ items, results, sendEvent }) => {
  const section = document.getElementById("featured-section");
  const trackEl = document.getElementById("featured");
  // Only on the "browse" view: no text typed and some places nearby
  const show = results && !results.query && items.length > 0;
  section.hidden = !show;
  if (!show) return;

  document.getElementById("featured-title").textContent = `Featured near ${locationLabel}`;
  trackEl.replaceChildren(...items.map((hit) => smallCard(hit, sendEvent, "Featured Restaurant Clicked")));
});

// A compact restaurant card (photo, rating badge, name, cuisine, distance)
function smallCard(hit, sendEvent, eventName) {
  const card = el("a", "fcard");
  card.href = hit.reserve_url;
  card.target = "_blank";
  card.rel = "noopener";
  const image = el("div", "fcard__image", familyIcon(hit.cuisine_hierarchy.lvl0));
  const photoUrl = familyPhoto(hit.cuisine_hierarchy.lvl0);
  if (photoUrl) {
    const img = el("img");
    img.src = photoUrl;
    img.alt = "";
    img.loading = "lazy";
    img.addEventListener("error", hidePhoto);
    image.append(img);
  }
  image.append(el("span", "fcard__badge", "★ " + hit.stars_count.toFixed(1)));
  const body = el("div", "fcard__body");
  const distance = distanceMetres(hit);
  body.append(
    el("strong", "fcard__name", hit.name),
    el("span", "fcard__meta", `${hit.cuisine} · ${dollars(hit.price_level)}`),
    el("span", "fcard__meta", `${hit.neighborhood}${distance !== undefined ? ` · ${miles(distance)} mi` : ""}`)
  );
  image.append(heartButton(hit, sendEvent));
  card.append(image, body);
  if (sendEvent) card.addEventListener("click", () => sendEvent("click", hit, eventName));
  return card;
}

// ---------------------------------------------------------------------
// 3d. CLOSEST MATCHES: when nothing matches within the chosen distance,
// suggest the nearest matching restaurants further away (same text and
// filters, any distance) instead of a dead end.
// ---------------------------------------------------------------------
const closestMatches = instantsearch.connectors.connectHits(({ items, sendEvent }) => {
  const trackEl = document.getElementById("closest");
  trackEl.replaceChildren(...items.map((hit) => smallCard(hit, sendEvent, "Closest Match Clicked")));
});

const closestIndex = instantsearch.widgets.index({ indexName: INDEX, indexId: "closest" }).addWidgets([
  instantsearch.widgets.configure({ hitsPerPage: 4, aroundRadius: "all", getRankingInfo: true }),
  closestMatches({}),
]);

const featuredIndex = instantsearch.widgets.index({ indexName: INDEX, indexId: "featured" }).addWidgets([
  instantsearch.widgets.configure({
    hitsPerPage: 10,
    aroundRadius: FEATURED_RADIUS,
    aroundPrecision: FEATURED_RADIUS,
    getRankingInfo: true,
  }),
  featuredCarousel({}),
]);

// ---------------------------------------------------------------------
// 4. WIDGETS (each one draws a piece of the page)
// ---------------------------------------------------------------------
search.addWidgets([
  locationConfigure({ searchParameters: locationParams() }),
  featuredIndex,
  closestIndex,

  searchBox({
    container: "#searchbox",
    placeholder: "Restaurant, cuisine, neighbourhood… try “sushi soho” or “ruths cris”",
    autofocus: true,
    showLoadingIndicator: true,
  }),

  // Occasions (enriched "experiences" attribute), shown in the "Occasion" panel
  refinementList({
    container: "#experiences",
    attribute: "experiences",
    sortBy: ["count:desc"],
  }),

  cuisineCarousel({
    attributes: ["cuisine_hierarchy.lvl0", "cuisine_hierarchy.lvl1"],
    limit: 30,
    // Families keep a fixed order (tiles don't jump around); cuisines by popularity
    sortBy: (a, b) => familyOrder(a.name) - familyOrder(b.name) || b.count - a.count,
  }),

  refinementList({
    container: "#price",
    attribute: "price_range",
    sortBy: ["name:asc"],
    transformItems: (items) =>
      items.map((item) => ({
        ...item,
        highlighted: `${{ "$30 and under": "$$", "$31 to $50": "$$$", "$50 and over": "$$$$" }[item.value]} · ${item.value}`,
      })),
  }),

  ratingMenu({ container: "#rating", attribute: "stars_count", max: 5 }),

  refinementList({ container: "#dining-style", attribute: "dining_style" }),

  refinementList({
    container: "#city",
    attribute: "city",
    searchable: true,
    searchablePlaceholder: "Search a city",
    showMore: true,
  }),

  clearRefinements({ container: "#clear-refinements", templates: { resetLabel: "Clear all" } }),
  currentRefinements({
    container: "#current-refinements",
    // Friendly names instead of technical attribute names
    transformItems: (items) => items.map((item) => ({
      ...item,
      label: { "cuisine_hierarchy.lvl0": "Cuisine", price_range: "Price", stars_count: "Rating",
        dining_style: "Style", city: "City", experiences: "Occasion" }[item.attribute] || item.label,
    })),
  }),

  sortBy({
    container: "#sort-by",
    items: [
      { label: "Recommended", value: INDEX },
      { label: "Top rated", value: `${INDEX}_top_rated` },
      { label: "Most reviewed", value: `${INDEX}_most_reviewed` },
      { label: "Price: low to high", value: `${INDEX}_price_asc` },
    ],
  }),

  stats({
    container: "#stats",
    templates: {
      text(data, { html }) {
        const title = data.query
          ? html`<strong>${data.nbHits.toLocaleString()}</strong> ${data.nbHits === 1 ? "result" : "results"} for “${data.query}”`
          : html`<strong>Popular nearby</strong> · ${data.nbHits.toLocaleString()} restaurants`;
        return html`${title} <span class="muted">(${data.processingTimeMS} ms)</span>`;
      },
    },
  }),

  infiniteHits({
    container: "#hits",
    cssClasses: { list: "cards", loadMore: "load-more" },
    templates: {
      item(hit, { html, components, sendEvent }) {
        const distance = distanceMetres(hit);
        return html`
          <article class="card" onClick=${() => sendEvent("click", hit, "Restaurant Clicked")}>
            <div class="card__image">
              <button class=${isFavourite(hit.objectID) ? "fav fav--on" : "fav"} data-id=${hit.objectID}
                      aria-label="Save to favourites"
                      onClick=${(e) => { e.stopPropagation(); toggleFavourite(hit, sendEvent); }}>♥</button>
              <span class="card__emoji">${familyIcon(hit.cuisine_hierarchy.lvl0)}</span>
              ${familyPhoto(hit.cuisine_hierarchy.lvl0)
                ? html`<img src=${familyPhoto(hit.cuisine_hierarchy.lvl0)} alt="" loading="lazy" onError=${hidePhoto} />`
                : ""}
              <span class="card__cuisine">${hit.cuisine}</span>
            </div>
            <div class="card__body">
              <h2>${components.Highlight({ hit, attribute: "name" })}</h2>
              <p class="card__meta">
                ${components.Highlight({ hit, attribute: "cuisine" })}${" · "}
                ${components.Highlight({ hit, attribute: "neighborhood" })}${" · "}
                ${dollars(hit.price_level)}
              </p>
              <p class="card__rating">
                ★ ${hit.stars_count.toFixed(1)}${" "}
                <span class="muted">(${hit.reviews_count.toLocaleString()} reviews)</span>
                ${distance !== undefined ? html`<span class="muted"> · ${miles(distance)} mi away</span>` : ""}
              </p>
              <p class="card__address">${hit.address}, ${hit.city}, ${hit.state}</p>
              ${hit.same_name_count > 1
                ? html`<p class="card__warning">${hit.same_name_count} restaurants share this name – check the address</p>`
                : ""}
              <div class="card__tags">
                ${hit.experiences.map((tag) => html`<span class="tag">${tag}</span>`)}
              </div>
              <a class="button" href=${hit.reserve_url} target="_blank" rel="noopener"
                 onClick=${(e) => { e.stopPropagation(); sendEvent("conversion", hit, "Reservation Started"); }}>
                Reserve a table
              </a>
            </div>
          </article>`;
      },
      empty(results, { html }) {
        const area = radius === "all" ? "" : ` within ${miles(Number(radius))} miles of ${locationLabel}`;
        return html`
          <div class="empty">
            <h2>No restaurants match${results.query ? html` “${results.query}”` : ""}${area}</h2>
            <p>Try a cuisine (“italian”), a neighbourhood (“soho”), check the spelling,
               remove some filters, or choose “Any distance”.</p>
          </div>`;
      },
      showMoreText: "Show more restaurants",
    },
  }),
]);

// ---------------------------------------------------------------------
// 5. FRIENDLY WARNING if the user is far from every restaurant
// (e.g. testing from London: the dataset only covers the US)
// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// 6. NEVER AN EMPTY PAGE: when a search returns nothing, also show popular
// places near the user. It's a separate, direct query: no text, no filters,
// just location, so it always has something to show.
// ---------------------------------------------------------------------
let popularLoadedFor = "";
async function showPopularFallback(main) {
  const section = document.getElementById("popular-section");
  if (!main || main.nbHits > 0) { section.hidden = true; return; }
  section.hidden = false;

  const params = locationParams();
  const key = JSON.stringify(params);
  if (key === popularLoadedFor) return; // already loaded for this location
  popularLoadedFor = key;

  const ask = (extra) => searchClient
    .search([{ indexName: INDEX, params: { ...params, aroundPrecision: 8047, ...extra, query: "", hitsPerPage: 8, analytics: false } }])
    .then((response) => response.results[0].hits);
  let hits = await ask({});
  // 5-mile bands: among places nearby, the most popular come first
  if (hits.length === 0) hits = await ask({ aroundRadius: "all" }); // nothing nearby at all: widen

  document.getElementById("popular-title").textContent = `Popular near ${locationLabel} instead`;
  document.getElementById("popular").replaceChildren(...hits.map((hit) => smallCard(hit, null, "")));
}
// ---------------------------------------------------------------------
// 6b. SIMILAR NEARBY: after a name search ("nobu"), suggest places with the
// same cuisine, close to THAT restaurant, with a similar rating.
// In production, Algolia Recommend's Related Items model would learn this
// from click and booking events; here it's a rules-based version.
// ---------------------------------------------------------------------
let similarLoadedFor = "";
async function showSimilar(main) {
  const section = document.getElementById("similar-section");
  const top = main?.hits?.[0];
  // A "name search" = every word typed matched the top result's name, and only a
  // handful of results (so "sushi", which matches 50 names, doesn't count)
  const nameSearch = main?.query && main.nbHits <= 5 && top?._highlightResult?.name?.matchLevel === "full";
  if (!nameSearch || !top._geoloc) { section.hidden = true; return; }
  section.hidden = false;
  if (similarLoadedFor === top.objectID) return; // already loaded for this restaurant
  similarLoadedFor = top.objectID;

  const ask = (starsMargin, radius) => searchClient.search([{
    indexName: INDEX,
    params: {
      query: "",
      filters: `cuisine:"${top.cuisine}" AND stars_count:${(top.stars_count - starsMargin).toFixed(1)} TO ${(top.stars_count + starsMargin).toFixed(1)} AND NOT objectID:"${top.objectID}"`,
      aroundLatLng: `${top._geoloc.lat},${top._geoloc.lng}`,
      aroundRadius: radius,
      aroundPrecision: 1000,
      hitsPerPage: 3, // keep it short: three alternatives, no more
      analytics: false,
    },
  }]).then((response) => response.results[0].hits);

  let hits = await ask(0.3, 8047);                 // ±0.3 stars, within 5 miles
  if (hits.length < 3) hits = await ask(0.5, 24140); // relax: ±0.5 stars, within 15 miles
  if (hits.length === 0) { section.hidden = true; return; }

  // Distances on these cards are from the user, like everywhere else
  document.getElementById("similar-title").textContent = `Similar to ${top.name} nearby`;
  document.getElementById("similar").replaceChildren(...hits.map((hit) => smallCard(hit, null, "")));
}
search.on("render", () => showSimilar(search.helper?.lastResults));

search.on("render", () => showPopularFallback(search.helper?.lastResults));
search.on("render", renderFavourites);

search.on("render", () => {
  const main = search.helper?.lastResults;
  const closestSection = document.getElementById("closest-section");
  const hasSuggestions = document.getElementById("closest").children.length > 0;
  closestSection.hidden = !(main && main.nbHits === 0 && main.query && radius !== "all" && hasSuggestions);
});

search.on("render", () => {
  const hits = search.helper?.lastResults?.hits || [];
  const nearest = hits[0] ? distanceMetres(hits[0]) : undefined;
  const usingMyLocation = document.getElementById("location-select").value === "auto";
  const nothingNearby = hits.length === 0 && !search.helper.state.query; // e.g. London + "within 30 miles"
  if (usingMyLocation && search.helper.state.index === INDEX && (nearest > 300000 || nothingNearby)) {
    setStatus("You seem far from our restaurants (this demo covers US cities). Pick a city in the “Near” menu.", true);
  }
});

// ---------------------------------------------------------------------
// 7. START
// ---------------------------------------------------------------------
search.start();
useBrowserLocation();

// ---------------------------------------------------------------------
// 8. FILTER BAR: open/close the drop-down panels, show active filters on pills
// ---------------------------------------------------------------------
const pills = document.querySelectorAll(".pill[data-panel]");
function closePanels() {
  document.querySelectorAll(".panel--open, .pill--open")
    .forEach((node) => node.classList.remove("panel--open", "pill--open"));
}
pills.forEach((pill) => {
  pill.addEventListener("click", (event) => {
    event.stopPropagation();
    const panel = document.getElementById(pill.dataset.panel);
    const wasOpen = panel.classList.contains("panel--open");
    closePanels();
    if (!wasOpen) { panel.classList.add("panel--open"); pill.classList.add("pill--open"); }
  });
});
document.addEventListener("click", (event) => {
  // click outside = close (ignore clicks on elements the widgets just re-drew)
  if (event.target.isConnected && !event.target.closest(".panels")) closePanels();
});

// Carousel arrows scroll the row of cuisine tiles
const track = document.getElementById("cuisine-carousel");
const leftArrow = document.querySelector(".carousel__arrow--left");
const rightArrow = document.querySelector(".carousel__arrow--right");
leftArrow.addEventListener("click", () => track.scrollBy({ left: -320, behavior: "smooth" }));
rightArrow.addEventListener("click", () => track.scrollBy({ left: 320, behavior: "smooth" }));

// Only show an arrow when there is something to scroll to in that direction
function updateArrows() {
  leftArrow.hidden = track.scrollLeft <= 4; // small tolerance for padding/snapping
  rightArrow.hidden = track.scrollLeft + track.clientWidth >= track.scrollWidth - 4;
}
track.addEventListener("scroll", updateArrows);
window.addEventListener("resize", updateArrows);
search.on("render", updateArrows); // the number of tiles changes with the search

// "Price · 1": each pill shows how many of its filters are active
const PILL_FILTERS = { "panel-occasion": "experiences", "panel-price": "price_range", "panel-style": "dining_style", "panel-city": "city" };
search.on("render", () => {
  const state = search.helper.state;
  pills.forEach((pill) => {
    const base = pill.dataset.label || (pill.dataset.label = pill.textContent);
    let active = 0;
    if (PILL_FILTERS[pill.dataset.panel]) {
      active = (state.disjunctiveFacetsRefinements[PILL_FILTERS[pill.dataset.panel]] || []).length;
    } else if (pill.dataset.panel === "panel-rating") {
      // Active only if one of the rating lists actually holds a value
      // ("Clear all" empties the lists but leaves them in place)
      active = Object.values(state.numericRefinements.stars_count || {}).some((values) => values.length) ? 1 : 0;
    }
    pill.textContent = active ? `${base} · ${active}` : base;
    pill.classList.toggle("pill--active", active > 0);
  });
});
