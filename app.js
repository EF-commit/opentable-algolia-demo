// =====================================================================
// app.js – the search experience (InstantSearch.js)
// =====================================================================

// ---------------------------------------------------------------------
// 1. CONNECT TO ALGOLIA
// The Search-Only key is PUBLIC by design: it can only read, never write.
// ---------------------------------------------------------------------
const ALGOLIA_APP_ID = "7A9UXTGE6W";
const ALGOLIA_SEARCH_KEY = "0786e42f8c38ea74e53701c4eeda78c4";
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
let radius = "all";        // "all" or a number of metres

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
  ({ refine }) => { updateParams = () => refine(locationParams()); }
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
const miles = (metres) => (metres / 1609).toFixed(metres < 16090 ? 1 : 0);
const initials = (name) => name.split(" ").slice(0, 2).map((w) => w[0]).join("");

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
  trackEl.replaceChildren();
  for (const hit of items) {
    const card = el("a", "fcard");
    card.href = hit.reserve_url;
    card.target = "_blank";
    card.rel = "noopener";
    const image = el("div", "fcard__image", initials(hit.brand));
    image.append(el("span", "fcard__badge", "★ " + hit.stars_count.toFixed(1)));
    const body = el("div", "fcard__body");
    const distance = distanceMetres(hit);
    body.append(
      el("strong", "fcard__name", hit.name),
      el("span", "fcard__meta", `${hit.cuisine} · ${dollars(hit.price_level)}`),
      el("span", "fcard__meta", `${hit.neighborhood}${distance !== undefined ? ` · ${miles(distance)} mi` : ""}`)
    );
    card.append(image, body);
    card.addEventListener("click", () => sendEvent("click", hit, "Featured Restaurant Clicked"));
    trackEl.append(card);
  }
});

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

  searchBox({
    container: "#searchbox",
    placeholder: "Restaurant, cuisine, neighbourhood… try “sushi soho” or “ruths cris”",
    autofocus: true,
    showLoadingIndicator: true,
  }),

  // Discovery chips (enriched "experiences" attribute)
  refinementList({
    container: "#experiences",
    attribute: "experiences",
    sortBy: ["count:desc"],
    cssClasses: { list: "chips__list", item: "chip", selectedItem: "chip--active" },
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
        dining_style: "Style", city: "City", experiences: "Experience" }[item.attribute] || item.label,
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
          ? html`<strong>${data.nbHits.toLocaleString()}</strong> results for “${data.query}”`
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
              <span>${initials(hit.brand)}</span>
              <img src=${hit.image_url} alt="" loading="lazy"
                   onError=${(e) => (e.currentTarget.style.display = "none")} />
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
        return html`
          <div class="empty">
            <h2>No restaurants match “${results.query}”</h2>
            <p>Try a cuisine (“italian”), a neighbourhood (“soho”), check the spelling,
               or remove some filters.</p>
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
search.on("render", () => {
  const hits = search.helper?.lastResults?.hits || [];
  const nearest = hits[0] ? distanceMetres(hits[0]) : undefined;
  const usingMyLocation = document.getElementById("location-select").value === "auto";
  if (usingMyLocation && search.helper.state.index === INDEX && nearest > 300000) {
    setStatus("You seem far from our restaurants (this demo covers US cities). Pick a city in the “Near” menu.", true);
  }
});

// ---------------------------------------------------------------------
// 6. START
// ---------------------------------------------------------------------
search.start();
useBrowserLocation();

// ---------------------------------------------------------------------
// 7. FILTER BAR: open/close the drop-down panels, show active filters on pills
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
document.querySelector(".carousel__arrow--left").addEventListener("click", () => track.scrollBy({ left: -320, behavior: "smooth" }));
document.querySelector(".carousel__arrow--right").addEventListener("click", () => track.scrollBy({ left: 320, behavior: "smooth" }));

// "Price · 1": each pill shows how many of its filters are active
const PILL_FILTERS = { "panel-price": "price_range", "panel-style": "dining_style", "panel-city": "city" };
search.on("render", () => {
  const state = search.helper.state;
  pills.forEach((pill) => {
    const base = pill.dataset.label || (pill.dataset.label = pill.textContent);
    let active = 0;
    if (PILL_FILTERS[pill.dataset.panel]) {
      active = (state.disjunctiveFacetsRefinements[PILL_FILTERS[pill.dataset.panel]] || []).length;
    } else if (pill.dataset.panel === "panel-rating") {
      active = Object.keys(state.numericRefinements.stars_count || {}).length ? 1 : 0;
    }
    pill.textContent = active ? `${base} · ${active}` : base;
    pill.classList.toggle("pill--active", active > 0);
  });
});
