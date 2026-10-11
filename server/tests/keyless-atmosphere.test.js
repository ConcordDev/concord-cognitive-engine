// Keyless air quality (Open-Meteo CAMS) and US weather (api.weather.gov).
// Mocks both upstreams. No real egress.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  ATMOSPHERE_TIMEOUT_MS,
  ATMOSPHERE_CACHE_TTL_MS,
  DEFAULT_NWS_USER_AGENT,
  clearAtmosphereCache,
  setAtmosphereFetchForTests,
  __setAtmosphereTimeoutForTests,
  loadAirQuality,
  loadUsWeather,
  nwsUserAgent,
} from "../lib/keyless-atmosphere.js";
import registerKeyRequiredLiveMacros from "../domains/key-required-live.js";

function json(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const ZIP_PLACE = {
  places: [{
    "place name": "San Francisco",
    "state abbreviation": "CA",
    latitude: "37.7509",
    longitude: "-122.4156",
  }],
};

const AQ_BODY = {
  timezone_abbreviation: "PDT",
  current: {
    time: "2026-10-11T09:00",
    us_aqi: 42,
    pm2_5: 8.1,
    pm10: 12.4,
    ozone: 68.2,
    nitrogen_dioxide: 11.5,
    carbon_monoxide: 190,
  },
};

function sfGeocode() {
  return {
    results: [{
      name: "San Francisco",
      latitude: 37.77493,
      longitude: -122.41942,
      country_code: "US",
      country: "United States",
      admin1: "California",
    }],
  };
}

function londonGeocode() {
  return {
    results: [{
      name: "London",
      latitude: 51.50853,
      longitude: -0.12574,
      country_code: "GB",
      country: "United Kingdom",
      admin1: "England",
    }],
  };
}

const POINTS = {
  properties: {
    gridId: "MTR",
    forecast: "https://api.weather.gov/gridpoints/MTR/85,105/forecast",
    forecastHourly: "https://api.weather.gov/gridpoints/MTR/85,105/forecast/hourly",
    observationStations: "https://api.weather.gov/gridpoints/MTR/85,105/stations",
    relativeLocation: { properties: { city: "San Francisco", state: "CA" } },
  },
};

const FORECAST = {
  properties: {
    updated: "2026-10-11T16:00:00+00:00",
    periods: [{
      number: 1,
      name: "This Afternoon",
      startTime: "2026-10-11T15:00:00-07:00",
      endTime: "2026-10-11T18:00:00-07:00",
      isDaytime: true,
      temperature: 68,
      temperatureUnit: "F",
      windSpeed: "10 mph",
      windDirection: "W",
      shortForecast: "Partly Cloudy",
      detailedForecast: "Partly cloudy, with a high near 68.",
      probabilityOfPrecipitation: { value: 20 },
    }],
  },
};

const HOURLY = {
  properties: {
    periods: [{
      number: 1,
      name: "",
      startTime: "2026-10-11T16:00:00-07:00",
      temperature: 67,
      temperatureUnit: "F",
      shortForecast: "Partly Cloudy",
      probabilityOfPrecipitation: { value: 10 },
    }],
  },
};

const STATIONS = {
  features: [{ properties: { stationIdentifier: "KSFO", name: "San Francisco Intl" } }],
};

const OBS = {
  properties: {
    timestamp: "2026-10-11T23:00:00+00:00",
    textDescription: "Partly Cloudy",
    temperature: { value: 18.3, unitCode: "wmoUnit:degC" },
    relativeHumidity: { value: 72 },
    windSpeed: { value: 4.1 },
  },
};

const ALERTS = {
  features: [{
    id: "https://api.weather.gov/alerts/urn:oid:1",
    properties: {
      id: "urn:oid:1",
      event: "Wind Advisory",
      severity: "Moderate",
      headline: "Wind Advisory until 8pm",
      areaDesc: "San Francisco",
      sent: "2026-10-11T12:00:00-07:00",
      expires: "2026-10-11T20:00:00-07:00",
    },
  }],
};

beforeEach(() => {
  clearAtmosphereCache();
  setAtmosphereFetchForTests(null);
  __setAtmosphereTimeoutForTests(null);
  delete process.env.EPA_AIRNOW_API_KEY;
  delete process.env.AIRNOW_API_KEY;
  delete process.env.OPENWEATHERMAP_API_KEY;
  delete process.env.NWS_USER_AGENT;
});

afterEach(() => {
  setAtmosphereFetchForTests(null);
  __setAtmosphereTimeoutForTests(null);
  clearAtmosphereCache();
});

describe("constants", () => {
  it("uses an 8s timeout, a 10 minute cache, and the default User-Agent", () => {
    assert.equal(ATMOSPHERE_TIMEOUT_MS, 8000);
    assert.equal(ATMOSPHERE_CACHE_TTL_MS, 10 * 60 * 1000);
    assert.equal(nwsUserAgent(), DEFAULT_NWS_USER_AGENT);
    assert.equal(DEFAULT_NWS_USER_AGENT, "ConcordOS (concord-os.org, contact@concord-os.org)");
  });
});

describe("loadAirQuality", () => {
  it("geocodes a US ZIP then reads us_aqi, PM2.5, PM10, ozone, NO2, and CO", async () => {
    const urls = [];
    setAtmosphereFetchForTests(async (url) => {
      urls.push(String(url));
      if (String(url).includes("api.zippopotam.us/us/94110")) return json(ZIP_PLACE);
      if (String(url).includes("air-quality-api.open-meteo.com")) return json(AQ_BODY);
      return json({}, 500);
    });
    const r = await loadAirQuality({ zipCode: "94110" });
    assert.equal(r.ok, true);
    assert.equal(r.source, "Open-Meteo");
    assert.match(r.sourceNote, /CAMS/);
    assert.match(r.sourceNote, /not EPA monitor/);
    assert.equal(r.us_aqi, 42);
    assert.equal(r.category, "Good");
    assert.equal(r.observedAt, "2026-10-11T09:00");
    assert.equal(r.pollutants.pm2_5, 8.1);
    assert.equal(r.pollutants.pm10, 12.4);
    assert.equal(r.pollutants.ozone, 68.2);
    assert.equal(r.pollutants.no2, 11.5);
    assert.equal(r.pollutants.co, 190);
    assert.equal(r.observations[0].parameter, "US AQI");
    assert.equal(r.observations[0].aqi, 42);
    assert.equal(r.observations[0].reportingArea, "San Francisco");
    assert.equal(r.observations[0].stateCode, "CA");
    assert.equal(r.observations[0].dateObserved, "2026-10-11");
    assert.equal(r.observations[0].hourObserved, 9);
    const pm = r.observations.find((o) => o.parameter === "PM2.5");
    assert.equal(pm.value, 8.1);
    assert.equal(pm.unit, "µg/m³");
    assert.equal(pm.aqi, null);
    const aq = new URL(urls.find((u) => u.includes("air-quality-api.open-meteo.com")));
    assert.equal(aq.searchParams.get("latitude"), "37.7509");
    assert.equal(aq.searchParams.get("longitude"), "-122.4156");
    assert.equal(aq.searchParams.get("current"), "us_aqi,pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,ozone");
    assert.equal(urls.some((u) => u.includes("airnow")), false);
    assert.equal(r.secondary, undefined);
  });

  it("falls back to Open-Meteo geocoding when zippopotam misses", async () => {
    const urls = [];
    setAtmosphereFetchForTests(async (url) => {
      urls.push(String(url));
      if (String(url).includes("zippopotam.us")) return json({}, 404);
      if (String(url).includes("geocoding-api.open-meteo.com")) {
        return json({
          results: [{ name: "94110", latitude: 37.75, longitude: -122.42, country_code: "US", admin1: "CA" }],
        });
      }
      if (String(url).includes("air-quality-api.open-meteo.com")) return json(AQ_BODY);
      return json({}, 500);
    });
    const r = await loadAirQuality({ zipCode: "94110" });
    assert.equal(r.ok, true);
    assert.equal(r.latitude, 37.75);
    assert.ok(urls.some((u) => u.includes("geocoding-api.open-meteo.com")));
  });

  it("does not invent a reading when Open-Meteo fails", async () => {
    setAtmosphereFetchForTests(async (url) => {
      if (String(url).includes("zippopotam.us")) return json(ZIP_PLACE);
      return json({}, 502);
    });
    const r = await loadAirQuality({ zipCode: "94110" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "upstream_unreachable");
    assert.equal(r.observations, undefined);
    assert.equal(r.us_aqi, undefined);
  });

  it("reports a timeout when the upstream aborts", async () => {
    __setAtmosphereTimeoutForTests(25);
    setAtmosphereFetchForTests((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        reject(err);
      });
    }));
    const r = await loadAirQuality({ zipCode: "94110" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "timeout");
    assert.match(r.error, /timed out/);
    assert.equal(r.us_aqi, undefined);
  });

  it("caches a successful ZIP lookup for the TTL", async () => {
    let calls = 0;
    setAtmosphereFetchForTests(async (url) => {
      calls += 1;
      if (String(url).includes("zippopotam.us")) return json(ZIP_PLACE);
      return json(AQ_BODY);
    });
    const a = await loadAirQuality({ zipCode: "94110" });
    const b = await loadAirQuality({ zipCode: "94110" });
    assert.equal(a.ok, true);
    assert.equal(b.us_aqi, 42);
    assert.equal(calls, 2);
  });

  it("keeps a valid AirNow payload as a secondary source and ignores a rejected key", async () => {
    process.env.AIRNOW_API_KEY = "test-key";
    const urls = [];
    setAtmosphereFetchForTests(async (url) => {
      urls.push(String(url));
      if (String(url).includes("zippopotam.us")) return json(ZIP_PLACE);
      if (String(url).includes("air-quality-api.open-meteo.com")) return json(AQ_BODY);
      if (String(url).includes("airnowapi.org")) {
        assert.match(String(url), /API_KEY=test-key/);
        return json([{
          DateObserved: "2026-10-11",
          HourObserved: 9,
          ReportingArea: "San Francisco",
          StateCode: "CA",
          ParameterName: "O3",
          AQI: 55,
          Category: { Name: "Moderate", Number: 2 },
        }]);
      }
      return json({}, 500);
    });
    const ok = await loadAirQuality({ zipCode: "94110" });
    assert.equal(ok.source, "Open-Meteo");
    assert.equal(ok.us_aqi, 42);
    assert.equal(ok.secondary.source, "EPA AirNow");
    assert.equal(ok.secondary.observations[0].aqi, 55);
    assert.ok(urls.some((u) => u.includes("airnowapi.org")));

    clearAtmosphereCache();
    setAtmosphereFetchForTests(async (url) => {
      if (String(url).includes("zippopotam.us")) return json(ZIP_PLACE);
      if (String(url).includes("air-quality-api.open-meteo.com")) return json(AQ_BODY);
      return json({}, 401);
    });
    const still = await loadAirQuality({ zipCode: "94110" });
    assert.equal(still.ok, true);
    assert.equal(still.us_aqi, 42);
    assert.equal(still.secondary, undefined);
  });

  it("live_air_quality macro returns the same Open-Meteo payload", async () => {
    const seen = new Map();
    registerKeyRequiredLiveMacros((domain, name, fn) => seen.set(`${domain}.${name}`, fn));
    setAtmosphereFetchForTests(async (url) => {
      if (String(url).includes("zippopotam.us")) return json(ZIP_PLACE);
      if (String(url).includes("air-quality-api.open-meteo.com")) return json(AQ_BODY);
      return json({}, 500);
    });
    const r = await seen.get("environment.live_air_quality")({}, { zipCode: "94110" });
    assert.equal(r.ok, true);
    assert.equal(r.source, "Open-Meteo");
    assert.equal(r.observations[0].aqi, 42);
    assert.equal(r.pollutants.pm2_5, 8.1);
  });
});

describe("loadUsWeather", () => {
  function installNws(extra) {
    const calls = [];
    setAtmosphereFetchForTests(async (url, init) => {
      const u = String(url);
      calls.push({ url: u, headers: init?.headers || {} });
      if (u.includes("geocoding-api.open-meteo.com")) {
        return json(u.includes("London") ? londonGeocode() : sfGeocode());
      }
      if (u.includes("api.weather.gov/points/")) {
        if (extra?.pointsStatus) return json({ detail: "not found" }, extra.pointsStatus);
        return json(POINTS);
      }
      if (u.endsWith("/forecast/hourly")) return json(HOURLY);
      if (u.endsWith("/forecast")) return json(FORECAST);
      if (u.endsWith("/stations")) return json(STATIONS);
      if (u.includes("/observations/latest")) return json(OBS);
      if (u.includes("/alerts/active")) return json(ALERTS);
      if (u.includes("openweathermap.org")) {
        return json({
          city: { name: "London", country: "GB" },
          list: [{
            dt: 1700000000,
            dt_txt: "2026-10-11 18:00:00",
            main: { temp: 14.2, humidity: 80 },
            weather: [{ main: "Clouds", description: "broken clouds" }],
            wind: { speed: 3 },
            pop: 0.4,
          }],
        });
      }
      return json({}, 500);
    });
    return calls;
  }

  it("follows points to forecast, hourly, observations, and alerts with the User-Agent", async () => {
    const calls = installNws();
    const r = await loadUsWeather({ city: "San Francisco" });
    assert.equal(r.ok, true);
    assert.equal(r.source, "NWS api.weather.gov");
    assert.equal(r.country, "US");
    assert.equal(r.city, "San Francisco");
    assert.equal(r.forecasts[0].temp, 68);
    assert.equal(r.forecasts[0].temperatureUnit, "F");
    assert.equal(r.forecasts[0].description, "Partly Cloudy");
    assert.equal(r.forecasts[0].pop, 0.2);
    assert.equal(r.hourly[0].temp, 67);
    assert.equal(r.current.stationId, "KSFO");
    assert.equal(r.current.tempC, 18.3);
    assert.equal(r.current.humidity, 72);
    assert.equal(r.current.description, "Partly Cloudy");
    assert.equal(r.alerts[0].event, "Wind Advisory");
    const urls = calls.map((c) => c.url);
    assert.ok(urls.some((u) => u === "https://api.weather.gov/points/37.7749,-122.4194"));
    assert.ok(urls.some((u) => u === "https://api.weather.gov/gridpoints/MTR/85,105/forecast"));
    assert.ok(urls.some((u) => u === "https://api.weather.gov/gridpoints/MTR/85,105/forecast/hourly"));
    assert.ok(urls.some((u) => u === "https://api.weather.gov/gridpoints/MTR/85,105/stations"));
    assert.ok(urls.some((u) => u === "https://api.weather.gov/stations/KSFO/observations/latest"));
    assert.ok(urls.some((u) => u === "https://api.weather.gov/alerts/active?point=37.7749,-122.4194"));
    for (const c of calls.filter((c) => c.url.includes("api.weather.gov"))) {
      assert.equal(c.headers["User-Agent"], DEFAULT_NWS_USER_AGENT);
      assert.equal(c.headers.Accept, "application/geo+json");
    }
    assert.equal(urls.some((u) => u.includes("openweathermap")), false);
  });

  it("sends NWS_USER_AGENT when that env var is set", async () => {
    process.env.NWS_USER_AGENT = "ConcordOS-test (example.test, a@b.c)";
    const calls = installNws();
    const r = await loadUsWeather({ city: "San Francisco" });
    assert.equal(r.ok, true);
    const nws = calls.filter((c) => c.url.includes("api.weather.gov"));
    assert.ok(nws.length >= 4);
    for (const c of nws) assert.equal(c.headers["User-Agent"], "ConcordOS-test (example.test, a@b.c)");
  });

  it("returns unavailable outside the US when weather.gov 404s and no OpenWeatherMap key exists", async () => {
    const calls = installNws({ pointsStatus: 404 });
    const r = await loadUsWeather({ city: "London" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "unavailable_outside_us");
    assert.match(r.error, /unavailable outside the US/);
    assert.equal(r.forecasts, undefined);
    assert.equal(r.temp, undefined);
    assert.ok(calls.some((c) => c.url.includes("api.weather.gov/points/")));
    assert.equal(calls.some((c) => c.url.includes("openweathermap")), false);
  });

  it("uses OpenWeatherMap only as a non-US fallback when the key exists", async () => {
    process.env.OPENWEATHERMAP_API_KEY = "owm-test";
    const calls = installNws({ pointsStatus: 404 });
    const r = await loadUsWeather({ city: "London" });
    assert.equal(r.ok, true);
    assert.equal(r.source, "OpenWeatherMap");
    assert.equal(r.city, "London");
    assert.equal(r.country, "GB");
    assert.equal(r.forecasts[0].temp, 14.2);
    assert.equal(r.forecasts[0].description, "broken clouds");
    const owm = calls.find((c) => c.url.includes("openweathermap.org"));
    assert.ok(owm);
    assert.match(owm.url, /appid=owm-test/);
    assert.match(owm.url, /lat=51\.5085/);
  });

  it("surfaces a weather.gov timeout without a fabricated forecast", async () => {
    __setAtmosphereTimeoutForTests(20);
    setAtmosphereFetchForTests(async (url, init) => {
      if (String(url).includes("geocoding-api.open-meteo.com")) return json(sfGeocode());
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    });
    const r = await loadUsWeather({ city: "San Francisco" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "timeout");
    assert.equal(r.forecasts, undefined);
  });

  it("live_forecast macro is the same keyless US path", async () => {
    const seen = new Map();
    registerKeyRequiredLiveMacros((domain, name, fn) => seen.set(`${domain}.${name}`, fn));
    installNws();
    const r = await seen.get("weather.live_forecast")({}, { city: "San Francisco" });
    assert.equal(r.ok, true);
    assert.equal(r.source, "NWS api.weather.gov");
    assert.equal(r.forecasts[0].temp, 68);
    assert.equal(r.alerts[0].event, "Wind Advisory");
  });
});
