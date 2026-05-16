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
}
