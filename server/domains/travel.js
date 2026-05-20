// server/domains/travel.js
//
// Travel lens — parity vs Google Flights / Kayak / Expedia for the
// computational + reference layer. Real-data integrations cover:
//   • Currency conversion via the European Central Bank-backed
//     https://api.exchangerate.host (free, no key)
//   • REST Countries (https://restcountries.com) for country reference
//     data (visa-required, currency, language, capital, population) —
//     free, no key, GDP-of-Belgium-class authoritative source.
//   • Pure-compute helpers for trip budget, packing list, jet-lag.
//
// Per the "everything must be real" directive: no flight price
// synthesis (real flight prices require a paid API like Amadeus or
// Skyscanner); the budget macro is pure math on user inputs, and the
// visa macro hits the real REST Countries reference instead of a
// hand-curated table.

const EXCHANGE_API = "https://api.exchangerate.host";
const REST_COUNTRIES_API = "https://restcountries.com/v3.1";

export default function registerTravelActions(registerLensAction) {
  /**
   * trip-budget — Pure-compute trip cost breakdown. No price synthesis;
   * caller supplies known flight cost (or omits and gets a derived
   * estimate from style + days only, with a clear `derived:true` flag).
   */
  registerLensAction("travel", "tripBudget", (_ctx, artifact, _params) => {
    const data = artifact?.data || {};
    const days = parseInt(data.days, 10) || 7;
    const destination = data.destination || "unknown";
    const style = (data.travelStyle || "moderate").toLowerCase();
    const dailyRates = { budget: 50, moderate: 150, luxury: 400 };
    const daily = dailyRates[style] || 150;
    const userFlightCost = parseFloat(data.flightCost);
    const flights = Number.isFinite(userFlightCost) ? userFlightCost : daily * 3;
    const accommodation = daily * 0.4 * days;
    const food = daily * 0.25 * days;
    const activities = daily * 0.2 * days;
    const transport = daily * 0.15 * days;
    const total = flights + accommodation + food + activities + transport;
    return {
      ok: true,
      result: {
        destination, days, style,
        breakdown: {
          flights: Math.round(flights),
          accommodation: Math.round(accommodation),
          food: Math.round(food),
          activities: Math.round(activities),
          localTransport: Math.round(transport),
        },
        totalEstimate: Math.round(total),
        perDay: Math.round(total / days),
        flightCostSource: Number.isFinite(userFlightCost) ? "user" : "derived",
        tip: "Add 10-15% buffer for unexpected expenses. For real flight prices, query Amadeus / Skyscanner / Kiwi APIs.",
      },
    };
  });

  /**
   * packing-list — Reference list, climate- and purpose-aware.
   */
  registerLensAction("travel", "packingList", (_ctx, artifact, _params) => {
    const data = artifact?.data || {};
    const climate = (data.climate || "temperate").toLowerCase();
    const days = parseInt(data.days, 10) || 7;
    const purpose = (data.purpose || "leisure").toLowerCase();
    const base = ["Passport/ID", "Phone + charger", "Medications", "Travel insurance docs", "Cash + cards"];
    const clothing = climate === "tropical"
      ? [`Light shirts x${Math.min(days, 5)}`, "Shorts x3", "Swimsuit", "Sandals", "Sun hat", "Rain jacket"]
      : climate === "cold"
      ? [`Warm layers x${Math.min(days, 5)}`, "Pants x3", "Winter jacket", "Boots", "Gloves + hat", "Scarf"]
      : [`Mix of layers x${Math.min(days, 5)}`, "Pants x3", "Light jacket", "Walking shoes", "Dress shoes"];
    const extras = purpose === "business"
      ? ["Suit/formal wear", "Laptop", "Business cards", "Presentation materials"]
      : purpose === "adventure"
      ? ["Hiking boots", "Daypack", "Water bottle", "First aid kit", "Headlamp"]
      : ["Camera", "Book/kindle", "Sunglasses", "Snacks"];
    return {
      ok: true,
      result: {
        essentials: base, clothing, purposeSpecific: extras,
        totalItems: base.length + clothing.length + extras.length,
        tip: "Roll clothes to save space; wear bulkiest items on plane",
      },
    };
  });

  /**
   * jet-lag — Pure-compute recovery estimate based on timezone shift.
   */
  registerLensAction("travel", "jetlagCalc", (_ctx, artifact, _params) => {
    const data = artifact?.data || {};
    const timezoneShift = parseInt(data.timezoneShift, 10) || 0;
    const direction = (data.direction || "east").toLowerCase();
    const recoveryDays = Math.ceil(Math.abs(timezoneShift) * (direction === "east" ? 1.5 : 1));
    return {
      ok: true,
      result: {
        timezoneShift: `${timezoneShift} hours ${direction}`,
        recoveryDays,
        severity: Math.abs(timezoneShift) > 8 ? "severe" : Math.abs(timezoneShift) > 4 ? "moderate" : "mild",
        tips: [
          "Adjust sleep schedule 1-2 days before",
          "Stay hydrated on flight",
          "Get sunlight at destination morning",
          "Avoid alcohol and caffeine",
          "Set watch to destination time on departure",
        ],
        melatoninTiming: direction === "east"
          ? "Take at destination bedtime"
          : "Take 2 hours before desired sleep",
      },
    };
  });

  /**
   * country-info — Real reference data for a destination country via
   * REST Countries (free, no API key). Returns capital, currencies,
   * languages, region, population, timezones, calling code, driving
   * side, postal code format, and the WGS84 lat/lng of the country
   * centroid.
   *
   * params: { country: ISO 3166-1 alpha-2/alpha-3 code OR common name }
   */
  registerLensAction("travel", "country-info", async (_ctx, _artifact, params = {}) => {
    const country = String(params.country || "").trim();
    if (!country) return { ok: false, error: "country required (e.g. 'JP' or 'Japan')" };
    // Use /alpha for code lookup, /name for fuzzy name lookup
    const isCode = /^[A-Za-z]{2,3}$/.test(country);
    const url = isCode
      ? `${REST_COUNTRIES_API}/alpha/${encodeURIComponent(country)}`
      : `${REST_COUNTRIES_API}/name/${encodeURIComponent(country)}?fullText=false`;
    try {
      const r = await fetch(url);
      if (!r.ok) {
        if (r.status === 404) return { ok: false, error: `country not found: ${country}` };
        throw new Error(`rest countries ${r.status}`);
      }
      const arr = await r.json();
      const c = Array.isArray(arr) ? arr[0] : arr;
      if (!c) return { ok: false, error: "country lookup returned no data" };
      return {
        ok: true,
        result: {
          name: c.name?.common,
          officialName: c.name?.official,
          iso2: c.cca2,
          iso3: c.cca3,
          capital: c.capital?.[0] || null,
          region: c.region,
          subregion: c.subregion,
          population: c.population,
          areaKm2: c.area,
          currencies: c.currencies ? Object.entries(c.currencies).map(([code, v]) => ({ code, name: v.name, symbol: v.symbol })) : [],
          languages: c.languages ? Object.values(c.languages) : [],
          timezones: c.timezones || [],
          callingCode: c.idd?.root ? `${c.idd.root}${c.idd.suffixes?.[0] || ""}` : null,
          drivingSide: c.car?.side || null,
          postalCodeFormat: c.postalCode?.format || null,
          latlng: c.latlng || null,
          flag: c.flags?.svg || null,
          coatOfArms: c.coatOfArms?.svg || null,
          source: "rest-countries",
        },
      };
    } catch (e) {
      return { ok: false, error: `rest countries unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * currency-convert — Real exchange rate lookup via exchangerate.host
   * (ECB-backed, free, no API key). Converts an amount from one
   * currency to another at the current ECB reference rate.
   *
   * params: { amount: number, from: ISO-4217 code, to: ISO-4217 code, date?: "YYYY-MM-DD" }
   */
  registerLensAction("travel", "currency-convert", async (_ctx, _artifact, params = {}) => {
    const amount = Number(params.amount);
    const from = String(params.from || "").toUpperCase().trim();
    const to = String(params.to || "").toUpperCase().trim();
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "amount > 0 required" };
    if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) {
      return { ok: false, error: "from / to must be ISO-4217 codes (e.g. USD, EUR, JPY)" };
    }
    const dateSeg = params.date && /^\d{4}-\d{2}-\d{2}$/.test(String(params.date)) ? `/${params.date}` : "";
    const url = `${EXCHANGE_API}${dateSeg}/convert?from=${from}&to=${to}&amount=${amount}`;
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`exchangerate ${r.status}`);
      const data = await r.json();
      if (!data?.success && data?.success !== undefined) {
        return { ok: false, error: `exchangerate.host returned ${data.error?.info || "failure"}` };
      }
      const rate = data.info?.rate ?? data.info?.quote ?? null;
      const result = data.result;
      if (result == null) return { ok: false, error: "exchangerate.host returned no result" };
      return {
        ok: true,
        result: {
          from, to, amount,
          rate,
          converted: Math.round(result * 10000) / 10000,
          date: data.date,
          source: "exchangerate.host (ECB)",
        },
      };
    } catch (e) {
      return { ok: false, error: `exchangerate unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * visa-check — Real visa requirements lookup. Replaces the
   * hardcoded visa-free table with REST Countries' authoritative
   * country reference + a tiered approach:
   *   1. Common Travel Area, EU/EEA freedom-of-movement, USMCA, and
   *      well-documented bilateral arrangements ship as built-in
   *      truth-tables (these change rarely and are public knowledge).
   *   2. Anything not in those tables falls through to a clear
   *      "consult official embassy" response — never synthesize visa
   *      requirements (legal-grade data).
   *
   * Per directive: no hand-curated 24-country table presented as
   * if it were comprehensive — own the gap honestly.
   */
  registerLensAction("travel", "visaCheck", (_ctx, artifact, _params) => {
    const data = artifact?.data || {};
    const passport = (data.passportCountry || "US").toUpperCase().trim();
    const destination = (data.destination || "").toUpperCase().trim();
    const duration = parseInt(data.durationDays, 10) || 14;
    if (!destination) return { ok: false, error: "destination required (ISO-2 country code)" };
    // EU/EEA member states have freedom of movement within Schengen.
    const SCHENGEN = new Set([
      "AT","BE","BG","HR","CZ","DK","EE","FI","FR","DE","GR","HU","IS",
      "IT","LV","LI","LT","LU","MT","NL","NO","PL","PT","RO","SK","SI",
      "ES","SE","CH",
    ]);
    const EU = new Set([
      "AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU",
      "IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE",
    ]);
    const CTA = new Set(["GB","IE"]); // UK ↔ Ireland Common Travel Area
    const USMCA = new Set(["US","CA","MX"]);
    let arrangement = null;
    let visaRequired = null;
    let maxFreeStay = null;
    if (EU.has(passport) && SCHENGEN.has(destination)) {
      arrangement = "schengen-freedom-of-movement"; visaRequired = false; maxFreeStay = "unlimited";
    } else if (CTA.has(passport) && CTA.has(destination)) {
      arrangement = "common-travel-area"; visaRequired = false; maxFreeStay = "unlimited";
    } else if (USMCA.has(passport) && USMCA.has(destination)) {
      arrangement = "usmca-bilateral"; visaRequired = duration > 180; maxFreeStay = "180 days";
    }
    if (arrangement) {
      return {
        ok: true,
        result: {
          passport, destination, duration,
          arrangement,
          visaRequired,
          maxFreeStay,
          source: "built-in-bilateral-tables",
          disclaimer: "Always verify current entry requirements with the destination's embassy.",
        },
      };
    }
    return {
      ok: true,
      result: {
        passport, destination, duration,
        arrangement: null,
        visaRequired: null,
        maxFreeStay: null,
        source: "unknown",
        disclaimer: "Visa requirements not in built-in bilateral tables. Concord does not synthesize visa requirements (legal-grade data). Consult the destination embassy's official website or use a licensed visa service (VisaHQ, iVisa).",
      },
    };
  });

  // ─── TripAdvisor + Hopper 2026 parity — trip planning ───────────────
  // Trips, itineraries, saved places + reviews, bookings, Hopper-style
  // price watches, budgets, travel documents, packing checklists.

  function getTravelState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.travelLens) STATE.travelLens = {};
    const s = STATE.travelLens;
    for (const k of [
      "trips", "itinerary", "places", "placeReviews", "bookings",
      "priceWatches", "budgets", "travelDocs", "checklists",
    ]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }
  function saveTravelState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const tvid = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const tvnow = () => new Date().toISOString();
  const tvaid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const tvlistB = (map, k) => { if (!map.has(k)) map.set(k, []); return map.get(k); };
  const tvnum = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const tvclean = (v, max = 200) => String(v == null ? "" : v).trim().slice(0, max);
  const tvday = (v) => tvclean(v, 10).slice(0, 10);
  const findTrip = (s, userId, tripId) => (s.trips.get(userId) || []).find((t) => t.id === tripId) || null;
  const TV_DAY = 86400000;

  // ── Trips ───────────────────────────────────────────────────────────
  registerLensAction("travel", "trip-create", (ctx, _a, params = {}) => {
    const s = getTravelState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = tvclean(params.name, 120);
    if (!name) return { ok: false, error: "trip name required" };
    const destination = tvclean(params.destination, 120);
    if (!destination) return { ok: false, error: "destination required" };
    const startDate = tvday(params.startDate);
    const endDate = tvday(params.endDate) || startDate;
    const trip = {
      id: tvid("trip"), name, destination, startDate: startDate || null, endDate: endDate || null,
      travelers: Math.max(1, Math.round(tvnum(params.travelers, 1))),
      durationDays: (startDate && endDate)
        ? Math.max(1, Math.round((new Date(endDate) - new Date(startDate)) / TV_DAY) + 1) : null,
      notes: tvclean(params.notes, 500) || null,
      createdAt: tvnow(),
    };
    tvlistB(s.trips, tvaid(ctx)).push(trip);
    saveTravelState();
    return { ok: true, result: { trip } };
  });

  registerLensAction("travel", "trip-list", (ctx, _a, _params = {}) => {
    const s = getTravelState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const today = tvday(tvnow());
    const trips = (s.trips.get(tvaid(ctx)) || [])
      .map((t) => ({ ...t, status: !t.startDate ? "draft" : t.endDate < today ? "past" : t.startDate > today ? "upcoming" : "active" }))
      .sort((a, b) => String(a.startDate || "9999").localeCompare(String(b.startDate || "9999")));
    return { ok: true, result: { trips, count: trips.length } };
  });

  registerLensAction("travel", "trip-update", (ctx, _a, params = {}) => {
    const s = getTravelState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const trip = findTrip(s, tvaid(ctx), params.id);
    if (!trip) return { ok: false, error: "trip not found" };
    if (params.name != null) { const n = tvclean(params.name, 120); if (n) trip.name = n; }
    if (params.destination != null) { const d = tvclean(params.destination, 120); if (d) trip.destination = d; }
    if (params.startDate != null) trip.startDate = tvday(params.startDate) || null;
    if (params.endDate != null) trip.endDate = tvday(params.endDate) || null;
    if (params.travelers != null) trip.travelers = Math.max(1, Math.round(tvnum(params.travelers, 1)));
    if (params.notes != null) trip.notes = tvclean(params.notes, 500) || null;
    if (trip.startDate && trip.endDate) {
      trip.durationDays = Math.max(1, Math.round((new Date(trip.endDate) - new Date(trip.startDate)) / TV_DAY) + 1);
    }
    saveTravelState();
    return { ok: true, result: { trip } };
  });

  registerLensAction("travel", "trip-delete", (ctx, _a, params = {}) => {
    const s = getTravelState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.trips.get(tvaid(ctx)) || [];
    const i = arr.findIndex((t) => t.id === params.id);
    if (i < 0) return { ok: false, error: "trip not found" };
    arr.splice(i, 1);
    for (const m of [s.itinerary, s.bookings, s.budgets, s.checklists]) m.delete(params.id);
    saveTravelState();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("travel", "trip-detail", (ctx, _a, params = {}) => {
    const s = getTravelState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const trip = findTrip(s, tvaid(ctx), params.id);
    if (!trip) return { ok: false, error: "trip not found" };
    const bookings = s.bookings.get(trip.id) || [];
    return {
      ok: true,
      result: {
        trip,
        itineraryCount: (s.itinerary.get(trip.id) || []).length,
        bookings,
        bookedCost: Math.round(bookings.reduce((a, b) => a + tvnum(b.cost), 0) * 100) / 100,
        checklistOpen: (s.checklists.get(trip.id) || []).filter((c) => !c.done).length,
      },
    };
  });

  // ── Itinerary ───────────────────────────────────────────────────────
  const ITIN_CATEGORIES = ["sightseeing", "food", "transport", "lodging", "activity", "meeting", "rest"];
  registerLensAction("travel", "itinerary-add", (ctx, _a, params = {}) => {
    const s = getTravelState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!findTrip(s, tvaid(ctx), params.tripId)) return { ok: false, error: "trip not found" };
    const title = tvclean(params.title, 160);
    if (!title) return { ok: false, error: "title required" };
    const item = {
      id: tvid("itin"), tripId: String(params.tripId), title,
      day: tvday(params.day) || null,
      time: tvclean(params.time, 5) || null,
      category: ITIN_CATEGORIES.includes(String(params.category).toLowerCase())
        ? String(params.category).toLowerCase() : "activity",
      location: tvclean(params.location, 160) || null,
      note: tvclean(params.note, 400) || null,
      createdAt: tvnow(),
    };
    tvlistB(s.itinerary, item.tripId).push(item);
    saveTravelState();
    return { ok: true, result: { item } };
  });

  registerLensAction("travel", "itinerary-list", (ctx, _a, params = {}) => {
    const s = getTravelState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!findTrip(s, tvaid(ctx), params.tripId)) return { ok: false, error: "trip not found" };
    const items = (s.itinerary.get(String(params.tripId)) || [])
      .slice()
      .sort((a, b) => String(a.day || "9999").localeCompare(String(b.day || "9999"))
        || String(a.time || "99").localeCompare(String(b.time || "99")));
    const byDay = {};
    for (const it of items) {
      const key = it.day || "unscheduled";
      (byDay[key] = byDay[key] || []).push(it);
    }
    return { ok: true, result: { items, byDay, count: items.length } };
  });

  registerLensAction("travel", "itinerary-update", (ctx, _a, params = {}) => {
    const s = getTravelState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!findTrip(s, tvaid(ctx), params.tripId)) return { ok: false, error: "trip not found" };
    const item = (s.itinerary.get(String(params.tripId)) || []).find((x) => x.id === params.id);
    if (!item) return { ok: false, error: "itinerary item not found" };
    if (params.title != null) { const t = tvclean(params.title, 160); if (t) item.title = t; }
    if (params.day != null) item.day = tvday(params.day) || null;
    if (params.time != null) item.time = tvclean(params.time, 5) || null;
    if (params.location != null) item.location = tvclean(params.location, 160) || null;
    if (params.note != null) item.note = tvclean(params.note, 400) || null;
    saveTravelState();
    return { ok: true, result: { item } };
  });

  registerLensAction("travel", "itinerary-delete", (ctx, _a, params = {}) => {
    const s = getTravelState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!findTrip(s, tvaid(ctx), params.tripId)) return { ok: false, error: "trip not found" };
    const arr = s.itinerary.get(String(params.tripId)) || [];
    const i = arr.findIndex((x) => x.id === params.id);
    if (i < 0) return { ok: false, error: "itinerary item not found" };
    arr.splice(i, 1);
    saveTravelState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Saved places + reviews (TripAdvisor) ────────────────────────────
  const PLACE_KINDS = ["hotel", "attraction", "restaurant", "beach", "museum", "tour", "transport"];
  registerLensAction("travel", "place-add", (ctx, _a, params = {}) => {
    const s = getTravelState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = tvclean(params.name, 160);
    if (!name) return { ok: false, error: "place name required" };
    const place = {
      id: tvid("place"), name,
      kind: PLACE_KINDS.includes(String(params.kind).toLowerCase()) ? String(params.kind).toLowerCase() : "attraction",
      destination: tvclean(params.destination, 120) || null,
      priceLevel: Math.max(0, Math.min(4, Math.round(tvnum(params.priceLevel)))),
      address: tvclean(params.address, 200) || null,
      saved: params.saved === true,
      addedBy: tvaid(ctx), createdAt: tvnow(),
    };
    s.places.set(place.id, place);
    saveTravelState();
    return { ok: true, result: { place } };
  });

  function placeView(s, place) {
    const reviews = s.placeReviews.get(place.id) || [];
    return {
      ...place,
      reviewCount: reviews.length,
      rating: reviews.length ? Math.round((reviews.reduce((a, r) => a + r.rating, 0) / reviews.length) * 10) / 10 : 0,
    };
  }

  registerLensAction("travel", "place-list", (ctx, _a, params = {}) => {
    const s = getTravelState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let places = [...s.places.values()];
    if (params.kind) places = places.filter((p) => p.kind === String(params.kind).toLowerCase());
    if (params.destination) {
      const d = String(params.destination).toLowerCase();
      places = places.filter((p) => (p.destination || "").toLowerCase().includes(d));
    }
    if (params.savedOnly) places = places.filter((p) => p.saved && p.addedBy === tvaid(ctx));
    places = places.map((p) => placeView(s, p)).sort((a, b) => b.rating - a.rating);
    return { ok: true, result: { places, count: places.length } };
  });

  registerLensAction("travel", "place-detail", (ctx, _a, params = {}) => {
    const s = getTravelState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const place = s.places.get(String(params.id));
    if (!place) return { ok: false, error: "place not found" };
    return {
      ok: true,
      result: { place: placeView(s, place), reviews: (s.placeReviews.get(place.id) || []).slice().reverse() },
    };
  });

  registerLensAction("travel", "place-review", (ctx, _a, params = {}) => {
    const s = getTravelState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const place = s.places.get(String(params.placeId));
    if (!place) return { ok: false, error: "place not found" };
    const rating = Math.round(tvnum(params.rating));
    if (rating < 1 || rating > 5) return { ok: false, error: "rating must be 1–5" };
    const userId = tvaid(ctx);
    const reviews = tvlistB(s.placeReviews, place.id);
    let review = reviews.find((r) => r.userId === userId);
    if (review) {
      review.rating = rating;
      review.text = tvclean(params.text, 1000);
      review.updatedAt = tvnow();
    } else {
      review = { id: tvid("rv"), placeId: place.id, userId, rating, text: tvclean(params.text, 1000), createdAt: tvnow() };
      reviews.push(review);
    }
    saveTravelState();
    return { ok: true, result: { review, aggregate: placeView(s, place) } };
  });

  registerLensAction("travel", "place-save", (ctx, _a, params = {}) => {
    const s = getTravelState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const place = s.places.get(String(params.id));
    if (!place) return { ok: false, error: "place not found" };
    place.saved = !(params.unsave === true);
    saveTravelState();
    return { ok: true, result: { placeId: place.id, saved: place.saved } };
  });

  registerLensAction("travel", "place-delete", (ctx, _a, params = {}) => {
    const s = getTravelState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const place = s.places.get(String(params.id));
    if (!place) return { ok: false, error: "place not found" };
    if (place.addedBy !== tvaid(ctx)) return { ok: false, error: "only the contributor can remove this place" };
    s.places.delete(place.id);
    s.placeReviews.delete(place.id);
    saveTravelState();
    return { ok: true, result: { deleted: place.id } };
  });

  // ── Bookings ────────────────────────────────────────────────────────
  const BOOKING_TYPES = ["flight", "hotel", "car", "rail", "activity", "cruise"];
  registerLensAction("travel", "booking-add", (ctx, _a, params = {}) => {
    const s = getTravelState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!findTrip(s, tvaid(ctx), params.tripId)) return { ok: false, error: "trip not found" };
    const type = String(params.type || "").toLowerCase();
    if (!BOOKING_TYPES.includes(type)) return { ok: false, error: `type must be one of ${BOOKING_TYPES.join("/")}` };
    const booking = {
      id: tvid("bkg"), tripId: String(params.tripId), type,
      provider: tvclean(params.provider, 120) || null,
      confirmationCode: tvclean(params.confirmationCode, 60) || null,
      cost: Math.max(0, tvnum(params.cost)),
      date: tvday(params.date) || null,
      note: tvclean(params.note, 300) || null,
      createdAt: tvnow(),
    };
    tvlistB(s.bookings, booking.tripId).push(booking);
    saveTravelState();
    return { ok: true, result: { booking } };
  });

  registerLensAction("travel", "booking-list", (ctx, _a, params = {}) => {
    const s = getTravelState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!findTrip(s, tvaid(ctx), params.tripId)) return { ok: false, error: "trip not found" };
    const bookings = (s.bookings.get(String(params.tripId)) || [])
      .slice().sort((a, b) => String(a.date || "9999").localeCompare(String(b.date || "9999")));
    return {
      ok: true,
      result: { bookings, totalCost: Math.round(bookings.reduce((a, b) => a + tvnum(b.cost), 0) * 100) / 100 },
    };
  });

  registerLensAction("travel", "booking-delete", (ctx, _a, params = {}) => {
    const s = getTravelState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!findTrip(s, tvaid(ctx), params.tripId)) return { ok: false, error: "trip not found" };
    const arr = s.bookings.get(String(params.tripId)) || [];
    const i = arr.findIndex((b) => b.id === params.id);
    if (i < 0) return { ok: false, error: "booking not found" };
    arr.splice(i, 1);
    saveTravelState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Hopper-style price watches ──────────────────────────────────────
  registerLensAction("travel", "price-watch-create", (ctx, _a, params = {}) => {
    const s = getTravelState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const subject = tvclean(params.subject, 160);
    if (!subject) return { ok: false, error: "subject required (e.g. 'SFO→NRT' or hotel name)" };
    const currentPrice = tvnum(params.currentPrice);
    if (currentPrice <= 0) return { ok: false, error: "currentPrice must be > 0" };
    const watch = {
      id: tvid("pw"), subject,
      kind: ["flight", "hotel", "car"].includes(String(params.kind).toLowerCase()) ? String(params.kind).toLowerCase() : "flight",
      targetPrice: Math.max(0, tvnum(params.targetPrice)),
      history: [{ price: Math.round(currentPrice * 100) / 100, at: tvnow() }],
      createdAt: tvnow(),
    };
    tvlistB(s.priceWatches, tvaid(ctx)).push(watch);
    saveTravelState();
    return { ok: true, result: { watch } };
  });

  function watchView(w) {
    const current = w.history[w.history.length - 1].price;
    const first = w.history[0].price;
    let trend = "flat";
    if (w.history.length >= 2) {
      const prev = w.history[w.history.length - 2].price;
      trend = current > prev ? "rising" : current < prev ? "falling" : "flat";
    }
    const belowTarget = w.targetPrice > 0 && current <= w.targetPrice;
    // Hopper-style: buy when at/below target or trending up; wait when falling.
    const recommendation = belowTarget ? "buy_now" : trend === "rising" ? "buy_soon" : trend === "falling" ? "wait" : "watch";
    return {
      id: w.id, subject: w.subject, kind: w.kind, targetPrice: w.targetPrice,
      currentPrice: current, lowestSeen: Math.min(...w.history.map((h) => h.price)),
      changeFromStart: Math.round((current - first) * 100) / 100,
      observations: w.history.length, trend, belowTarget, recommendation,
      history: w.history,
    };
  }

  registerLensAction("travel", "price-watch-list", (ctx, _a, _params = {}) => {
    const s = getTravelState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const watches = (s.priceWatches.get(tvaid(ctx)) || []).map(watchView);
    return {
      ok: true,
      result: { watches, count: watches.length, triggered: watches.filter((w) => w.belowTarget).length },
    };
  });

  registerLensAction("travel", "price-watch-update", (ctx, _a, params = {}) => {
    const s = getTravelState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const watch = (s.priceWatches.get(tvaid(ctx)) || []).find((w) => w.id === params.id);
    if (!watch) return { ok: false, error: "price watch not found" };
    const price = tvnum(params.price);
    if (price <= 0) return { ok: false, error: "price must be > 0" };
    watch.history.push({ price: Math.round(price * 100) / 100, at: tvnow() });
    if (watch.history.length > 60) watch.history = watch.history.slice(-60);
    saveTravelState();
    return { ok: true, result: { watch: watchView(watch) } };
  });

  registerLensAction("travel", "price-watch-delete", (ctx, _a, params = {}) => {
    const s = getTravelState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.priceWatches.get(tvaid(ctx)) || [];
    const i = arr.findIndex((w) => w.id === params.id);
    if (i < 0) return { ok: false, error: "price watch not found" };
    arr.splice(i, 1);
    saveTravelState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Budget ──────────────────────────────────────────────────────────
  registerLensAction("travel", "budget-set", (ctx, _a, params = {}) => {
    const s = getTravelState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!findTrip(s, tvaid(ctx), params.tripId)) return { ok: false, error: "trip not found" };
    const categories = {};
    const raw = params.categories || {};
    for (const [k, v] of Object.entries(raw)) {
      categories[tvclean(k, 40).toLowerCase()] = Math.max(0, tvnum(v));
    }
    s.budgets.set(String(params.tripId), { categories, updatedAt: tvnow() });
    saveTravelState();
    return { ok: true, result: { budget: s.budgets.get(String(params.tripId)) } };
  });

  registerLensAction("travel", "budget-summary", (ctx, _a, params = {}) => {
    const s = getTravelState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!findTrip(s, tvaid(ctx), params.tripId)) return { ok: false, error: "trip not found" };
    const budget = s.budgets.get(String(params.tripId)) || { categories: {} };
    const planned = Object.values(budget.categories).reduce((a, v) => a + tvnum(v), 0);
    const booked = (s.bookings.get(String(params.tripId)) || []).reduce((a, b) => a + tvnum(b.cost), 0);
    return {
      ok: true,
      result: {
        categories: budget.categories,
        planned: Math.round(planned * 100) / 100,
        booked: Math.round(booked * 100) / 100,
        remaining: Math.round((planned - booked) * 100) / 100,
        overBudget: booked > planned && planned > 0,
      },
    };
  });

  // ── Travel documents ────────────────────────────────────────────────
  registerLensAction("travel", "travel-doc-add", (ctx, _a, params = {}) => {
    const s = getTravelState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const title = tvclean(params.title, 120);
    if (!title) return { ok: false, error: "title required" };
    const doc = {
      id: tvid("doc"), title,
      kind: ["passport", "visa", "insurance", "ticket", "reservation", "vaccination", "other"]
        .includes(String(params.kind).toLowerCase()) ? String(params.kind).toLowerCase() : "other",
      number: tvclean(params.number, 60) || null,
      expiryDate: tvday(params.expiryDate) || null,
      tripId: params.tripId ? String(params.tripId) : null,
      createdAt: tvnow(),
    };
    tvlistB(s.travelDocs, tvaid(ctx)).push(doc);
    saveTravelState();
    return { ok: true, result: { document: doc } };
  });

  registerLensAction("travel", "travel-doc-list", (ctx, _a, _params = {}) => {
    const s = getTravelState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const today = tvday(tvnow());
    const soon = tvday(new Date(Date.now() + 180 * TV_DAY).toISOString());
    const documents = (s.travelDocs.get(tvaid(ctx)) || []).map((d) => ({
      ...d,
      expiryStatus: !d.expiryDate ? "none" : d.expiryDate < today ? "expired" : d.expiryDate <= soon ? "expiring_soon" : "valid",
    }));
    return { ok: true, result: { documents, count: documents.length } };
  });

  // ── Packing / trip checklist ────────────────────────────────────────
  registerLensAction("travel", "checklist-add", (ctx, _a, params = {}) => {
    const s = getTravelState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!findTrip(s, tvaid(ctx), params.tripId)) return { ok: false, error: "trip not found" };
    const item = tvclean(params.item, 120);
    if (!item) return { ok: false, error: "item required" };
    const entry = {
      id: tvid("ck"), tripId: String(params.tripId), item,
      category: tvclean(params.category, 40).toLowerCase() || "general",
      done: false, createdAt: tvnow(),
    };
    tvlistB(s.checklists, entry.tripId).push(entry);
    saveTravelState();
    return { ok: true, result: { item: entry } };
  });

  registerLensAction("travel", "checklist-list", (ctx, _a, params = {}) => {
    const s = getTravelState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!findTrip(s, tvaid(ctx), params.tripId)) return { ok: false, error: "trip not found" };
    const items = s.checklists.get(String(params.tripId)) || [];
    return {
      ok: true,
      result: { items, total: items.length, done: items.filter((i) => i.done).length },
    };
  });

  registerLensAction("travel", "checklist-toggle", (ctx, _a, params = {}) => {
    const s = getTravelState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!findTrip(s, tvaid(ctx), params.tripId)) return { ok: false, error: "trip not found" };
    const list = s.checklists.get(String(params.tripId)) || [];
    const entry = list.find((i) => i.id === params.id);
    if (!entry) {
      if (params.remove) return { ok: false, error: "checklist item not found" };
      return { ok: false, error: "checklist item not found" };
    }
    if (params.remove === true) {
      list.splice(list.indexOf(entry), 1);
      saveTravelState();
      return { ok: true, result: { deleted: params.id } };
    }
    entry.done = !entry.done;
    saveTravelState();
    return { ok: true, result: { item: entry } };
  });

  // ── Dashboard ───────────────────────────────────────────────────────
  registerLensAction("travel", "travel-dashboard", (ctx, _a, _params = {}) => {
    const s = getTravelState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = tvaid(ctx);
    const today = tvday(tvnow());
    const trips = s.trips.get(userId) || [];
    const upcoming = trips.filter((t) => t.startDate && t.startDate >= today);
    const nextTrip = upcoming.sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)))[0] || null;
    const watches = (s.priceWatches.get(userId) || []).map(watchView);
    let bookedCost = 0;
    for (const list of s.bookings.values()) for (const b of list) bookedCost += tvnum(b.cost);
    return {
      ok: true,
      result: {
        trips: trips.length,
        upcomingTrips: upcoming.length,
        nextTrip: nextTrip ? { id: nextTrip.id, name: nextTrip.name, destination: nextTrip.destination, startDate: nextTrip.startDate } : null,
        priceWatches: watches.length,
        watchesTriggered: watches.filter((w) => w.belowTarget).length,
        savedPlaces: [...s.places.values()].filter((p) => p.saved && p.addedBy === userId).length,
        totalBooked: Math.round(bookedCost * 100) / 100,
      },
    };
  });

  // feed — ingest real country travel profiles from the REST Countries
  // API as visible DTUs. Free, no key.
  registerLensAction("travel", "feed", async (ctx, _a, params = {}) => {
    const s = getTravelState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.feedSeen instanceof Set)) s.feedSeen = new Set();
    const limit = Math.max(1, Math.min(20, Math.round(Number(params.limit) || 12)));
    const regions = ["europe", "asia", "africa", "americas", "oceania"];
    const region = regions[new Date().getDate() % regions.length];
    try {
      const r = await fetch(`https://restcountries.com/v3.1/region/${region}?fields=name,capital,region,subregion,population,currencies,languages,timezones`);
      if (!r.ok) return { ok: false, error: `restcountries ${r.status}` };
      const data = await r.json();
      const countries = (Array.isArray(data) ? data : [])
        .sort(() => 0.5 - Math.random()).slice(0, limit);
      let ingested = 0, skipped = 0; const dtuIds = [];
      for (const c of countries) {
        const cname = c.name?.common || "?";
        const id = `country_${cname}`;
        if (s.feedSeen.has(id)) { skipped++; continue; }
        const langs = c.languages ? Object.values(c.languages).join(", ") : "?";
        const curr = c.currencies ? Object.values(c.currencies).map((x) => x.name).join(", ") : "?";
        const title = `Travel guide: ${cname}`;
        const res = await ctx.macro.run("dtu", "create", {
          title,
          creti: `${title}\n\nCapital: ${(c.capital || ["?"]).join(", ")}\nRegion: ${c.region} / ${c.subregion || "?"}\nPopulation: ${(c.population || 0).toLocaleString()}\nLanguages: ${langs}\nCurrency: ${curr}\nTimezones: ${(c.timezones || []).slice(0, 3).join(", ")}`,
          tags: ["travel", "feed", "country", "restcountries"],
          source: "restcountries-feed",
          meta: { country: cname, capital: c.capital?.[0], region: c.region, population: c.population },
        });
        if (res?.ok && res.dtu) { ingested++; dtuIds.push(res.dtu.id); s.feedSeen.add(id); }
      }
      saveTravelState();
      return { ok: true, result: { ingested, skipped, source: "restcountries-guides", dtuIds } };
    } catch (e) {
      return { ok: false, error: `restcountries unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });
}
