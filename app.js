// =====================================================================
// app.js – the search experience (InstantSearch.js)
// =====================================================================

// ---------------------------------------------------------------------
// 1. CONNECT TO ALGOLIA
// The Search-Only key is PUBLIC by design: it can only read, never write.
// ---------------------------------------------------------------------
const ALGOLIA_APP_ID = "YOUR_APP_ID";
const ALGOLIA_SEARCH_KEY = "YOUR_SEARCH_ONLY_API_KEY";
const INDEX = "restaurants";

const { liteClient: algoliasearch } = window["algoliasearch/lite"];
const searchClient = algoliasearch(ALGOLIA_APP_ID, ALGOLIA_SEARCH_KEY);

const search = instantsearch({
  indexName: INDEX,
  searchClient,
  insights: true,       // sends click/conversion events -> Analytics, A/B tests
  routing: true,        // the URL reflects the search, so it can be shared
});

const { searchBox, infiniteHits, hierarchicalMenu, refinementList, ratingMenu,
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

function setStatus(text) {
  document.getElementById("location-status").textContent = text;
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

// ---------------------------------------------------------------------
// 4. WIDGETS (each one draws a piece of the page)
// ---------------------------------------------------------------------
search.addWidgets([
  locationConfigure({ searchParameters: locationParams() }),

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

  hierarchicalMenu({
    container: "#cuisine",
    attributes: ["cuisine_hierarchy.lvl0", "cuisine_hierarchy.lvl1"],
    limit: 10,
    showMore: true,
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

  clearRefinements({ container: "#clear-refinements", templates: { resetLabel: "Clear all filters" } }),
  currentRefinements({ container: "#current-refinements" }),

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
          : html`<strong>Popular near ${locationLabel}</strong> · ${data.nbHits.toLocaleString()} restaurants`;
        return html`${title} <span class="muted">(${data.processingTimeMS} ms)</span>`;
      },
    },
  }),

  infiniteHits({
    container: "#hits",
    cssClasses: { list: "cards", loadMore: "load-more" },
    templates: {
      item(hit, { html, components, sendEvent }) {
        const distance = hit._rankingInfo?.geoDistance;
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
  const nearest = hits[0]?._rankingInfo?.geoDistance;
  if (!userLocation && search.helper.state.index === INDEX && nearest > 300000) {
    setStatus("You seem far from our restaurants (this demo covers US cities). Pick a city in the “Near” menu.");
  }
});

// ---------------------------------------------------------------------
// 6. START
// ---------------------------------------------------------------------
search.start();
useBrowserLocation();

// On phones, start with the filters folded away
if (window.innerWidth < 760) document.querySelector(".filters").removeAttribute("open");
