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

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }

before(() => {
  registerGeology(register); registerSpace(register); registerHistory(register);
  registerAnswers(register); registerLaw(register); registerPoetry(register);
  registerPaper(register); registerCalendar(register); registerMusic(register);
  registerDaily(register); registerOcean(register); registerGallery(register);
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
