// Contract tests for the lens `feed` macros — each ingests real
// free-API data into visible DTUs via ctx.macro.run("dtu","create").
// fetch + dtu.create are stubbed so the suite is hermetic.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerGeology from "../domains/geology.js";
import registerSpace from "../domains/space.js";
import registerHistory from "../domains/history.js";
import registerAnswers from "../domains/answers.js";
import registerLaw from "../domains/law.js";
import registerPoetry from "../domains/poetry.js";
import registerPaper from "../domains/paper.js";
import registerCalendar from "../domains/calendar.js";
import registerMusic from "../domains/music.js";
import registerDaily from "../domains/daily.js";
import registerOcean from "../domains/ocean.js";
import registerGallery from "../domains/gallery.js";
import registerAstronomy from "../domains/astronomy.js";
import registerAviation from "../domains/aviation.js";
import registerEnvironment from "../domains/environment.js";
import registerAutomotive from "../domains/automotive.js";
import registerCrypto from "../domains/crypto.js";
import registerAgriculture from "../domains/agriculture.js";
import registerCooking from "../domains/cooking.js";
import registerEducation from "../domains/education.js";
import registerEnergy from "../domains/energy.js";
import registerFashion from "../domains/fashion.js";
import registerFinance from "../domains/finance.js";
import registerFitness from "../domains/fitness.js";
import registerFood from "../domains/food.js";
import registerLandscaping from "../domains/landscaping.js";
import registerPets from "../domains/pets.js";
import registerPharmacy from "../domains/pharmacy.js";
import registerPhotography from "../domains/photography.js";
import registerRealEstate from "../domains/realestate.js";
import registerRetail from "../domains/retail.js";
import registerSports from "../domains/sports.js";
import registerTravel from "../domains/travel.js";
import registerVeterinary from "../domains/veterinary.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }

before(() => {
  registerGeology(register); registerSpace(register); registerHistory(register);
  registerAnswers(register); registerLaw(register); registerPoetry(register);
  registerPaper(register); registerCalendar(register); registerMusic(register);
  registerDaily(register); registerOcean(register); registerGallery(register);
  registerAstronomy(register); registerAviation(register); registerEnvironment(register);
  registerAutomotive(register); registerCrypto(register);
  registerAgriculture(register); registerCooking(register); registerEducation(register);
  registerEnergy(register); registerFashion(register); registerFinance(register);
  registerFitness(register); registerFood(register); registerLandscaping(register);
  registerPets(register); registerPharmacy(register); registerPhotography(register);
  registerRealEstate(register); registerRetail(register); registerSports(register);
  registerTravel(register); registerVeterinary(register);
});

let createdDtus;
function makeCtx() {
  return {
    actor: { userId: "feed_user" }, userId: "feed_user",
    macro: {
      run: async (domain, name, input) => {
        if (domain === "dtu" && name === "create") {
          const dtu = { id: `dtu_${createdDtus.length}`, title: input.title, tags: input.tags, source: input.source, meta: input.meta };
          createdDtus.push(dtu);
          return { ok: true, dtu };
        }
        return { ok: false, error: "unexpected macro" };
      },
    },
  };
}
function callFeed(domain, ctx, params = {}) {
  const fn = ACTIONS.get(`${domain}.feed`);
  assert.ok(fn, `${domain}.feed not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  createdDtus = [];
});

describe("geology.feed — USGS earthquakes → DTUs", () => {
  it("ingests earthquakes and dedupes on re-run", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({
      features: [
        { id: "us1", properties: { mag: 5.2, place: "off Japan", time: 1700000000000, url: "https://u/1" }, geometry: { coordinates: [140, 35, 30] } },
        { id: "us2", properties: { mag: 4.8, place: "Chile", time: 1700000100000, url: "https://u/2" }, geometry: { coordinates: [-70, -30, 60] } },
      ],
    }) });
    const ctx = makeCtx();
    const r1 = await callFeed("geology", ctx);
    assert.equal(r1.ok, true);
    assert.equal(r1.result.ingested, 2);
    assert.equal(createdDtus.length, 2);
    assert.ok(createdDtus[0].tags.includes("geology") && createdDtus[0].tags.includes("feed"));
    const r2 = await callFeed("geology", ctx);
    assert.equal(r2.result.ingested, 0);
    assert.equal(r2.result.skipped, 2);
  });
  it("returns an error shape when USGS is unreachable", async () => {
    globalThis.fetch = async () => { throw new Error("network"); };
    const r = await callFeed("geology", makeCtx());
    assert.equal(r.ok, false);
  });
});

describe("space.feed — Launch Library → DTUs", () => {
  it("ingests upcoming launches", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({
      results: [
        { id: "L1", name: "Starship F12", net: "2099-01-01", status: { name: "Go" }, launch_service_provider: { name: "SpaceX" }, pad: { name: "OLP-1" } },
      ],
    }) });
    const r = await callFeed("space", makeCtx());
    assert.equal(r.result.ingested, 1);
    assert.match(createdDtus[0].title, /Starship F12/);
  });
});

describe("history.feed — Wikimedia on-this-day → DTUs", () => {
  it("ingests historical events", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({
      events: [
        { year: 1969, text: "Apollo 11 lands on the Moon.", pages: [{ content_urls: { desktop: { page: "https://w/a" } } }] },
        { year: 1789, text: "Storming of the Bastille.", pages: [] },
      ],
    }) });
    const r = await callFeed("history", makeCtx());
    assert.equal(r.result.ingested, 2);
    assert.match(createdDtus[0].title, /1969/);
  });
});

describe("answers.feed — Stack Exchange → DTUs", () => {
  it("ingests hot questions and decodes HTML entities", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({
      items: [
        { question_id: 901, title: "Why is &quot;this&quot; undefined?", score: 42, answer_count: 3, is_answered: true, tags: ["javascript"], link: "https://so/901" },
      ],
    }) });
    const r = await callFeed("answers", makeCtx());
    assert.equal(r.result.ingested, 1);
    assert.match(createdDtus[0].title, /Why is "this" undefined/);
    assert.ok(createdDtus[0].tags.includes("javascript"));
  });
});

describe("law.feed — CourtListener → DTUs", () => {
  it("ingests recent court opinions", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({
      results: [
        { id: 5001, caseName: "Doe v. Roe", court: "scotus", dateFiled: "2026-05-01", citation: "600 U.S. 1", snippet: "...", absolute_url: "/opinion/5001/" },
      ],
    }) });
    const r = await callFeed("law", makeCtx());
    assert.equal(r.result.ingested, 1);
    assert.match(createdDtus[0].title, /Doe v\. Roe/);
  });
});

describe("poetry.feed — PoetryDB → DTUs", () => {
  it("ingests public-domain poems", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ([
      { title: "The Road Not Taken", author: "Robert Frost", lines: ["Two roads diverged", "in a yellow wood"] },
    ]) });
    const r = await callFeed("poetry", makeCtx());
    assert.equal(r.result.ingested, 1);
    assert.match(createdDtus[0].title, /Road Not Taken/);
    assert.ok(createdDtus[0].tags.includes("public-domain"));
  });
});

describe("paper.feed — Crossref → DTUs", () => {
  it("ingests recent scholarly works", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({
      message: { items: [
        { DOI: "10.1/abc", title: ["A New Result"], author: [{ given: "A", family: "Smith" }], "container-title": ["Nature"] },
      ] },
    }) });
    const r = await callFeed("paper", makeCtx());
    assert.equal(r.result.ingested, 1);
    assert.match(createdDtus[0].title, /A New Result/);
  });
});

describe("calendar.feed — Nager.Date holidays → DTUs", () => {
  it("ingests upcoming public holidays", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ([
      { date: "2026-07-04", name: "Independence Day", localName: "Independence Day", countryCode: "US", global: true },
    ]) });
    const r = await callFeed("calendar", makeCtx());
    assert.equal(r.result.ingested, 1);
    assert.match(createdDtus[0].title, /Independence Day/);
  });
});

describe("music.feed — Apple RSS top albums → DTUs", () => {
  it("ingests top albums", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({
      feed: { results: [
        { id: "alb1", name: "Greatest Hits", artistName: "The Band", releaseDate: "2026-01-01", genres: [{ name: "Rock" }], url: "https://a/1" },
      ] },
    }) });
    const r = await callFeed("music", makeCtx());
    assert.equal(r.result.ingested, 1);
    assert.match(createdDtus[0].title, /Greatest Hits/);
  });
});

describe("daily.feed — ZenQuotes → DTUs", () => {
  it("ingests inspirational quotes", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ([
      { q: "The only way out is through.", a: "Robert Frost", h: "" },
    ]) });
    const r = await callFeed("daily", makeCtx());
    assert.equal(r.result.ingested, 1);
    assert.match(createdDtus[0].title, /only way out/);
  });
});

describe("ocean.feed — NWS marine alerts → DTUs", () => {
  it("ingests active marine alerts", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({
      features: [
        { id: "nws1", properties: { id: "nws1", event: "Small Craft Advisory", severity: "Moderate", areaDesc: "Coastal waters", effective: "2026-05-20", expires: "2026-05-21", headline: "SCA in effect" } },
      ],
    }) });
    const r = await callFeed("ocean", makeCtx());
    assert.equal(r.result.ingested, 1);
    assert.match(createdDtus[0].title, /Small Craft Advisory/);
  });
});

describe("gallery.feed — Art Institute of Chicago → DTUs", () => {
  it("ingests artworks", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({
      data: [
        { id: 27992, title: "A Sunday on La Grande Jatte", artist_display: "Georges Seurat", date_display: "1884", image_id: "img1", medium_display: "Oil on canvas" },
      ],
    }) });
    const r = await callFeed("gallery", makeCtx());
    assert.equal(r.result.ingested, 1);
    assert.match(createdDtus[0].title, /La Grande Jatte/);
    assert.ok(createdDtus[0].meta.image.includes("img1"));
  });
});

describe("astronomy.feed — NASA APOD → DTUs", () => {
  it("ingests astronomy pictures of the day", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ([
      { date: "2026-05-20", title: "The Andromeda Galaxy", explanation: "A spiral galaxy.", url: "https://a/1", media_type: "image" },
    ]) });
    const r = await callFeed("astronomy", makeCtx());
    assert.equal(r.result.ingested, 1);
    assert.match(createdDtus[0].title, /Andromeda/);
  });
});

describe("aviation.feed — OpenSky → DTUs", () => {
  it("ingests live aircraft states", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({
      time: 1700000000,
      states: [["abc123", "UAL456 ", "United States", null, null, -122.4, 37.6, 10000, false, 250]],
    }) });
    const r = await callFeed("aviation", makeCtx());
    assert.equal(r.result.ingested, 1);
    assert.match(createdDtus[0].title, /UAL456/);
  });
});

describe("environment.feed — NWS severe alerts → DTUs", () => {
  it("ingests severe hazard alerts", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({
      features: [
        { id: "alert1", properties: { id: "alert1", event: "Tornado Warning", severity: "Extreme", areaDesc: "Central County", effective: "2026-05-20", expires: "2026-05-20", headline: "Take shelter now" } },
      ],
    }) });
    const r = await callFeed("environment", makeCtx());
    assert.equal(r.result.ingested, 1);
    assert.match(createdDtus[0].title, /Tornado Warning/);
  });
});

describe("automotive.feed — NHTSA recalls → DTUs", () => {
  it("ingests vehicle recalls", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({
      results: [
        { NHTSACampaignNumber: "26V001000", Component: "BRAKES", Summary: "Brake line may corrode.", Remedy: "Dealers will inspect." },
      ],
    }) });
    const r = await callFeed("automotive", makeCtx());
    assert.equal(r.result.ingested, 1);
    assert.match(createdDtus[0].title, /26V001000/);
  });
});

describe("crypto.feed — CoinGecko trending → DTUs", () => {
  it("ingests trending coins", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({
      coins: [
        { item: { id: "bitcoin", name: "Bitcoin", symbol: "btc", market_cap_rank: 1 } },
      ],
    }) });
    const r = await callFeed("crypto", makeCtx());
    assert.equal(r.result.ingested, 1);
    assert.match(createdDtus[0].title, /Trending: Bitcoin/);
  });
});

// ─── Phase A: 17 domain-app feeds + new substrates ────────────────────

function callAction(domain, name, ctx, params = {}) {
  const fn = ACTIONS.get(`${domain}.${name}`);
  assert.ok(fn, `${domain}.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

describe("agriculture.feed — World Bank crop yields → DTUs", () => {
  it("ingests indicator rows and dedupes on re-run", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ([{ page: 1 }, [
      { value: 4200, countryiso3code: "USA", date: "2022", country: { value: "United States" } },
      { value: 3100, countryiso3code: "BRA", date: "2022", country: { value: "Brazil" } },
    ]]) });
    const ctx = makeCtx();
    const r = await callFeed("agriculture", ctx);
    assert.equal(r.result.ingested, 2);
    assert.match(createdDtus[0].title, /Cereal yield/);
    const r2 = await callFeed("agriculture", ctx);
    assert.equal(r2.result.ingested, 0);
    assert.equal(r2.result.skipped, 2);
  });
});

describe("cooking.feed — TheMealDB recipes → DTUs", () => {
  it("ingests meals with ingredients", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ meals: [
      { idMeal: "1", strMeal: "Beef Stew", strArea: "British", strCategory: "Beef", strInstructions: "Cook it.", strIngredient1: "Beef", strMeasure1: "1 lb" },
    ] }) });
    const r = await callFeed("cooking", makeCtx());
    assert.equal(r.result.ingested, 1);
    assert.match(createdDtus[0].title, /Beef Stew/);
  });
});

describe("education.feed — Open Trivia DB → DTUs", () => {
  it("ingests quiz questions", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ results: [
      { question: "What is 2+2?", correct_answer: "4", category: "Math", difficulty: "easy" },
    ] }) });
    const r = await callFeed("education", makeCtx());
    assert.equal(r.result.ingested, 1);
    assert.match(createdDtus[0].title, /Study question/);
  });
});

describe("energy.feed — UK carbon intensity → DTUs", () => {
  it("ingests intensity periods", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ data: [
      { from: "2026-05-20T00:00Z", to: "2026-05-20T00:30Z", intensity: { actual: 120, forecast: 130, index: "moderate" } },
    ] }) });
    const r = await callFeed("energy", makeCtx());
    assert.equal(r.result.ingested, 1);
    assert.match(createdDtus[0].title, /carbon intensity/i);
  });
});

describe("fashion.feed — Met Museum costume → DTUs", () => {
  it("ingests objects via search + object fetch", async () => {
    globalThis.fetch = async (url) => {
      if (String(url).includes("/search")) {
        return { ok: true, json: async () => ({ objectIDs: [101, 102] }) };
      }
      return { ok: true, json: async () => ({ title: "Silk Gown", artistDisplayName: "House of Worth", objectDate: "1890", medium: "silk" }) };
    };
    const r = await callFeed("fashion", makeCtx());
    assert.equal(r.result.ingested, 2);
    assert.match(createdDtus[0].title, /Silk Gown/);
  });
});

describe("finance.feed — ECB FX rates → DTUs", () => {
  it("ingests currency rates", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ date: "2026-05-20", rates: { EUR: 0.92, GBP: 0.79 } }) });
    const r = await callFeed("finance", makeCtx());
    assert.equal(r.result.ingested, 2);
    assert.match(createdDtus[0].title, /FX rate/);
  });
});

describe("fitness.feed — wger exercises → DTUs", () => {
  it("ingests exercises and strips HTML", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ results: [
      { id: 9, uuid: "abc", name: "Squat", description: "<p>Bend knees.</p>" },
    ] }) });
    const r = await callFeed("fitness", makeCtx());
    assert.equal(r.result.ingested, 1);
    assert.match(createdDtus[0].title, /Squat/);
  });
});

describe("food.feed — Open Food Facts → DTUs", () => {
  it("ingests food products", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ products: [
      { code: "555", product_name: "Granola", brands: "Acme", nutriscore_grade: "a" },
    ] }) });
    const r = await callFeed("food", makeCtx());
    assert.equal(r.result.ingested, 1);
    assert.match(createdDtus[0].title, /Granola/);
  });
});

describe("landscaping — substrate + GBIF feed", () => {
  it("manages garden beds, plantings and care log per user", () => {
    const ctxA = { actor: { userId: "ls_a" }, userId: "ls_a" };
    const bed = callAction("landscaping", "bed-add", ctxA, { name: "Front Border", sizeSqft: 120, sunExposure: "partial" }).result.bed;
    callAction("landscaping", "planting-add", ctxA, { bedId: bed.id, plant: "Lavender", quantity: 6 });
    callAction("landscaping", "care-log", ctxA, { bedId: bed.id, kind: "mulch" });
    const list = callAction("landscaping", "bed-list", ctxA, {});
    assert.equal(list.result.count, 1);
    assert.equal(list.result.beds[0].plantingCount, 1);
    const dash = callAction("landscaping", "landscaping-dashboard", ctxA, {});
    assert.equal(dash.result.plantings, 1);
  });
  it("ingests GBIF plant species", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ results: [
      { key: 1, scientificName: "Acer rubrum L.", canonicalName: "Acer rubrum", family: "Sapindaceae", genus: "Acer" },
    ] }) });
    const r = await callFeed("landscaping", makeCtx());
    assert.equal(r.result.ingested, 1);
    assert.match(createdDtus[0].title, /Acer rubrum/);
  });
});

describe("pets.feed — The Dog API → DTUs", () => {
  it("ingests dog breeds", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ([
      { id: 1, name: "Beagle", temperament: "Friendly", life_span: "12 - 15 years", weight: { imperial: "20 - 30" }, height: { imperial: "13 - 15" } },
    ]) });
    const r = await callFeed("pets", makeCtx());
    assert.equal(r.result.ingested, 1);
    assert.match(createdDtus[0].title, /Beagle/);
  });
});

describe("pharmacy.feed — openFDA drug recalls → DTUs", () => {
  it("ingests recall reports", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ results: [
      { recall_number: "D-001", product_description: "Aspirin 100ct", classification: "Class II", status: "Ongoing", reason_for_recall: "Mislabel" },
    ] }) });
    const r = await callFeed("pharmacy", makeCtx());
    assert.equal(r.result.ingested, 1);
    assert.match(createdDtus[0].title, /Aspirin/);
  });
});

describe("photography.feed — Art Institute of Chicago → DTUs", () => {
  it("ingests photograph artworks with image URL", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ data: [
      { id: 7, title: "Migrant Mother", artist_title: "Dorothea Lange", date_display: "1936", medium_display: "Gelatin silver print", image_id: "xyz" },
    ] }) });
    const r = await callFeed("photography", makeCtx());
    assert.equal(r.result.ingested, 1);
    assert.ok(createdDtus[0].meta.imageUrl.includes("xyz"));
  });
});

describe("realestate.feed — Census home values → DTUs", () => {
  it("ingests median home values by state", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ([
      ["NAME", "B25077_001E", "state"],
      ["California", "750000", "06"],
      ["Texas", "300000", "48"],
    ]) });
    const r = await callFeed("realestate", makeCtx());
    assert.equal(r.result.ingested, 2);
    assert.match(createdDtus[0].title, /California/);
  });
});

describe("retail.feed — Open Beauty Facts → DTUs", () => {
  it("ingests retail products", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ products: [
      { code: "888", product_name: "Hand Cream", brands: "Acme", categories: "Cosmetics" },
    ] }) });
    const r = await callFeed("retail", makeCtx());
    assert.equal(r.result.ingested, 1);
    assert.match(createdDtus[0].title, /Hand Cream/);
  });
});

describe("sports.feed — TheSportsDB fixtures → DTUs", () => {
  it("ingests past fixtures", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ events: [
      { idEvent: "e1", strEvent: "Arsenal vs Chelsea", strLeague: "EPL", dateEvent: "2026-05-18", strHomeTeam: "Arsenal", strAwayTeam: "Chelsea", intHomeScore: "2", intAwayScore: "1", strVenue: "Emirates" },
    ] }) });
    const r = await callFeed("sports", makeCtx());
    assert.equal(r.result.ingested, 1);
    assert.match(createdDtus[0].title, /Arsenal vs Chelsea/);
  });
});

describe("travel.feed — REST Countries → DTUs", () => {
  it("ingests country guides", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ([
      { name: { common: "Japan" }, capital: ["Tokyo"], region: "Asia", subregion: "Eastern Asia", population: 125000000, currencies: { JPY: { name: "yen" } }, languages: { jpn: "Japanese" }, timezones: ["UTC+09:00"] },
    ]) });
    const r = await callFeed("travel", makeCtx());
    assert.equal(r.result.ingested, 1);
    assert.match(createdDtus[0].title, /Japan/);
  });
});

describe("veterinary — substrate + openFDA feed", () => {
  it("manages patients, visits and vaccinations per user", () => {
    const ctxA = { actor: { userId: "vt_a" }, userId: "vt_a" };
    const ctxB = { actor: { userId: "vt_b" }, userId: "vt_b" };
    const pat = callAction("veterinary", "patient-add", ctxA, { name: "Rex", species: "dog", owner: "Sam" }).result.patient;
    callAction("veterinary", "visit-log", ctxA, { patientId: pat.id, kind: "surgery", cost: 1200 });
    callAction("veterinary", "vaccine-record", ctxA, { patientId: pat.id, vaccine: "Rabies" });
    const list = callAction("veterinary", "patient-list", ctxA, {});
    assert.equal(list.result.count, 1);
    assert.equal(list.result.patients[0].visitCount, 1);
    assert.equal(callAction("veterinary", "patient-list", ctxB, {}).result.count, 0);
    const dash = callAction("veterinary", "vet-dashboard", ctxA, {});
    assert.equal(dash.result.revenue, 1200);
  });
  it("rejects a nameless patient and keeps calculators intact", () => {
    assert.equal(callAction("veterinary", "patient-add", { userId: "vt_a" }, {}).ok, false);
    assert.equal(callAction("veterinary", "triageAssess", { userId: "vt_a" }, {}).ok, true);
  });
  it("ingests openFDA vet adverse events", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ results: [
      { unique_aer_id_number: "AER-1", animal: { species: "Dog", breed: { breed_component: "Labrador" } }, drug: [{ brand_name: "Apoquel" }], reaction: [{ veddra_term_name: "Vomiting" }], original_receive_date: "20260510" },
    ] }) });
    const r = await callFeed("veterinary", makeCtx());
    assert.equal(r.result.ingested, 1);
    assert.ok(createdDtus[0].tags.includes("adverse-event"));
  });
});
