// Contract tests for server/domains/history.js — pure-compute helpers
// plus real Wikipedia REST + On This Day integration.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerHistoryActions from "../domains/history.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`history.${name}`);
  if (!fn) throw new Error(`history.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => { registerHistoryActions(register); });

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("history.timelineBuild (pure compute)", () => {
  it("sorts events chronologically + flags pivotal", () => {
    const events = [
      { name: "Industrial Rev", date: "1760", significance: "high", era: "modern" },
      { name: "WWI", date: "1914", significance: "critical", era: "modern" },
      { name: "Renaissance", date: "1400", significance: "high", era: "early modern" },
    ];
    const r = call("timelineBuild", ctxA, { data: { events } }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.timeline[0].event, "Renaissance");
    assert.equal(r.result.timeline[2].event, "WWI");
    assert.equal(r.result.pivotalEvents.length, 3);
  });
});

describe("history.wiki-lookup (Wikipedia REST)", () => {
  it("rejects empty title", async () => {
    const r = await call("wiki-lookup", ctxA, {});
    assert.equal(r.ok, false);
  });

  it("fetches summary + sends UA header per Wikimedia policy", async () => {
    let capturedUrl = "", capturedUA = "";
    globalThis.fetch = async (url, opts) => {
      capturedUrl = url;
      capturedUA = opts?.headers?.["User-Agent"] || "";
      return {
        ok: true,
        json: async () => ({
          type: "standard",
          title: "World War II",
          displaytitle: "World War II",
          description: "Global war (1939–1945)",
          extract: "World War II or the Second World War, often abbreviated as WWII or WW2...",
          extract_html: "<p><b>World War II</b>...</p>",
          thumbnail: { source: "https://upload.wikimedia.org/.../480px-WWII.jpg" },
          content_urls: {
            desktop: { page: "https://en.wikipedia.org/wiki/World_War_II" },
            mobile: { page: "https://en.m.wikipedia.org/wiki/World_War_II" },
          },
          lang: "en",
          timestamp: "2026-05-01T12:34:56Z",
        }),
      };
    };
    const r = await call("wiki-lookup", ctxA, { title: "World War II" });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /\/api\/rest_v1\/page\/summary\/World_War_II/);
    assert.match(capturedUA, /Concord-OS/);
    assert.equal(r.result.title, "World War II");
    assert.equal(r.result.description, "Global war (1939–1945)");
    assert.equal(r.result.source, "wikipedia-rest");
  });

  it("flags disambiguation pages with a note", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        type: "disambiguation",
        title: "Mercury",
        description: "Various meanings",
        extract: "Mercury may refer to: Mercury (planet); Mercury (element); ...",
      }),
    });
    const r = await call("wiki-lookup", ctxA, { title: "Mercury" });
    assert.equal(r.ok, true);
    assert.equal(r.result.type, "disambiguation");
    assert.match(r.result.note, /more specific/);
  });

  it("returns clear 404 when page doesn't exist", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
    const r = await call("wiki-lookup", ctxA, { title: "ThisPageDoesNotExistXyz" });
    assert.equal(r.ok, false);
    assert.match(r.error, /not found/);
  });
});

describe("history.wiki-search (Wikipedia opensearch)", () => {
  it("rejects empty / 1-char queries", async () => {
    assert.equal((await call("wiki-search", ctxA, {})).ok, false);
    assert.equal((await call("wiki-search", ctxA, { query: "a" })).ok, false);
  });

  it("hits opensearch + parses [query, titles, descriptions, urls] tuple", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ([
          "renaissance",
          ["Renaissance", "Renaissance art", "Italian Renaissance"],
          ["Cultural movement", "Visual arts", "European cultural movement"],
          [
            "https://en.wikipedia.org/wiki/Renaissance",
            "https://en.wikipedia.org/wiki/Renaissance_art",
            "https://en.wikipedia.org/wiki/Italian_Renaissance",
          ],
        ]),
      };
    };
    const r = await call("wiki-search", ctxA, { query: "renaissance", limit: 3 });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /w\/api\.php\?action=opensearch/);
    assert.match(capturedUrl, /search=renaissance/);
    assert.match(capturedUrl, /limit=3/);
    assert.equal(r.result.results.length, 3);
    assert.equal(r.result.results[0].title, "Renaissance");
    assert.equal(r.result.results[2].url, "https://en.wikipedia.org/wiki/Italian_Renaissance");
    assert.equal(r.result.source, "wikipedia-opensearch");
  });
});

describe("history.on-this-day (Wikipedia)", () => {
  it("rejects invalid month/day", async () => {
    assert.equal((await call("on-this-day", ctxA, { month: 13, day: 1 })).ok, false);
    assert.equal((await call("on-this-day", ctxA, { month: 5, day: 32 })).ok, false);
    assert.equal((await call("on-this-day", ctxA, {})).ok, false);
  });

  it("fetches the correct mm/dd endpoint + shapes the response", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          events: [
            { text: "End of WWII in Europe", year: 1945, pages: [{ title: "Victory in Europe Day", extract: "VE Day...", content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Victory_in_Europe_Day" } } }] },
            { text: "Other event", year: 1900, pages: [] },
          ],
        }),
      };
    };
    const r = await call("on-this-day", ctxA, { month: 5, day: 8 });
    assert.equal(r.ok, true);
    assert.match(capturedUrl, /\/feed\/onthisday\/events\/05\/08/);
    assert.equal(r.result.events.length, 2);
    assert.equal(r.result.events[0].year, 1945);
    assert.equal(r.result.events[0].pages[0].url, "https://en.wikipedia.org/wiki/Victory_in_Europe_Day");
    assert.equal(r.result.source, "wikipedia-onthisday");
  });

  it("supports kind=births / deaths / holidays / selected / all", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => ({}) };
    };
    await call("on-this-day", ctxA, { month: 5, day: 16, kind: "births" });
    assert.match(capturedUrl, /\/feed\/onthisday\/births\/05\/16/);
  });
});

/* ------------------------------------------------------------------ */
/*  Feature-parity backlog — visual render, map, multi-track,         */
/*  publish/embed, media attachments, Wikipedia auto-build.            */
/* ------------------------------------------------------------------ */

function mkTimeline(ctx = ctxA) {
  return call("timeline-create", ctx, {}, { title: "Test Timeline" }).result.timeline;
}
function mkEvent(t, params, ctx = ctxA) {
  return call("event-add", ctx, {}, { timelineId: t.id, ...params }).result.event;
}

describe("history.timeline-render (visual zoomable render)", () => {
  it("returns events, eras, tracks, span + range with date-range filter", () => {
    const t = mkTimeline();
    mkEvent(t, { title: "A", year: 100 });
    mkEvent(t, { title: "B", year: 500 });
    mkEvent(t, { title: "C", year: 900 });
    call("era-add", ctxA, {}, { timelineId: t.id, name: "Era1", startYear: 0, endYear: 600 });
    const all = call("timeline-render", ctxA, {}, { timelineId: t.id });
    assert.equal(all.ok, true);
    assert.equal(all.result.totalEvents, 3);
    assert.deepEqual(all.result.span, { minYear: 100, maxYear: 900 });
    const ranged = call("timeline-render", ctxA, {}, { timelineId: t.id, fromYear: 200, toYear: 600 });
    assert.equal(ranged.result.totalEvents, 1);
    assert.equal(ranged.result.events[0].title, "B");
    assert.equal(ranged.result.range.fromYear, 200);
  });
  it("filters by track and exposes the track set", () => {
    const t = mkTimeline();
    mkEvent(t, { title: "Main", year: 1, track: "main" });
    mkEvent(t, { title: "Side", year: 2, track: "side" });
    const r = call("timeline-render", ctxA, {}, { timelineId: t.id, track: "side" });
    assert.equal(r.result.totalEvents, 1);
    assert.equal(r.result.events[0].title, "Side");
    assert.ok(r.result.tracks.includes("side"));
  });
  it("rejects an unknown timeline", () => {
    assert.equal(call("timeline-render", ctxA, {}, { timelineId: "nope" }).ok, false);
  });
});

describe("history.map-points + event-set-location (map-linked events)", () => {
  it("sets coordinates on an event and lists located points", () => {
    const t = mkTimeline();
    const e = mkEvent(t, { title: "Battle", year: 1066 });
    const set = call("event-set-location", ctxA, {}, {
      timelineId: t.id, eventId: e.id, lat: 50.9, lng: 0.48, place: "Hastings",
    });
    assert.equal(set.ok, true);
    assert.equal(set.result.event.lat, 50.9);
    const pts = call("map-points", ctxA, {}, { timelineId: t.id });
    assert.equal(pts.result.count, 1);
    assert.equal(pts.result.points[0].place, "Hastings");
  });
  it("rejects out-of-range coordinates and clears a location", () => {
    const t = mkTimeline();
    const e = mkEvent(t, { title: "Event", year: 1 });
    assert.equal(call("event-set-location", ctxA, {}, { timelineId: t.id, eventId: e.id, lat: 200, lng: 0 }).ok, false);
    call("event-set-location", ctxA, {}, { timelineId: t.id, eventId: e.id, lat: 10, lng: 20 });
    const cleared = call("event-set-location", ctxA, {}, { timelineId: t.id, eventId: e.id, clear: true });
    assert.equal(cleared.result.event.lat, null);
    assert.equal(call("map-points", ctxA, {}, { timelineId: t.id }).result.count, 0);
  });
});

describe("history.timeline-compare (multi-track / parallel)", () => {
  it("stacks two timelines on a combined span", () => {
    const a = call("timeline-create", ctxA, {}, { title: "Europe" }).result.timeline;
    const b = call("timeline-create", ctxA, {}, { title: "Asia" }).result.timeline;
    mkEvent(a, { title: "EU event", year: 800 });
    mkEvent(b, { title: "AS event", year: 1200 });
    const r = call("timeline-compare", ctxA, {}, { timelineIds: [a.id, b.id] });
    assert.equal(r.ok, true);
    assert.equal(r.result.trackCount, 2);
    assert.deepEqual(r.result.combinedSpan, { minYear: 800, maxYear: 1200 });
  });
  it("rejects fewer than two timeline ids", () => {
    const a = mkTimeline();
    assert.equal(call("timeline-compare", ctxA, {}, { timelineIds: [a.id] }).ok, false);
  });
});

describe("history.timeline-publish / unpublish / public-get (embed + share)", () => {
  it("publishes a timeline, exposes share URL + embed code, fetches public read", () => {
    const t = mkTimeline();
    mkEvent(t, { title: "Founding", year: 1 });
    const pub = call("timeline-publish", ctxA, {}, { timelineId: t.id });
    assert.equal(pub.ok, true);
    assert.match(pub.result.shareUrl, /share=/);
    assert.match(pub.result.embedCode, /<iframe/);
    const pget = call("timeline-public-get", ctxB, {}, { shareId: pub.result.shareId });
    assert.equal(pget.ok, true);
    assert.equal(pget.result.eventCount, 1);
    const un = call("timeline-unpublish", ctxA, {}, { shareId: pub.result.shareId });
    assert.equal(un.ok, true);
    assert.equal(call("timeline-public-get", ctxB, {}, { shareId: pub.result.shareId }).ok, false);
  });
  it("only the owner can unpublish a share", () => {
    const t = mkTimeline();
    const pub = call("timeline-publish", ctxA, {}, { timelineId: t.id });
    assert.equal(call("timeline-unpublish", ctxB, {}, { shareId: pub.result.shareId }).ok, false);
  });
});

describe("history.event-add-media / remove-media (media attachments)", () => {
  it("attaches and removes media on an event", () => {
    const t = mkTimeline();
    const e = mkEvent(t, { title: "Coronation", year: 800 });
    const add = call("event-add-media", ctxA, {}, {
      timelineId: t.id, eventId: e.id, url: "https://example.org/img.jpg",
      kind: "image", caption: "Painting", credit: "Public domain",
    });
    assert.equal(add.ok, true);
    assert.equal(add.result.event.media.length, 1);
    assert.equal(add.result.media.kind, "image");
    const rm = call("event-remove-media", ctxA, {}, {
      timelineId: t.id, eventId: e.id, mediaId: add.result.media.id,
    });
    assert.equal(rm.ok, true);
    assert.equal(rm.result.event.media.length, 0);
  });
  it("rejects a non-http media url", () => {
    const t = mkTimeline();
    const e = mkEvent(t, { title: "E", year: 1 });
    assert.equal(call("event-add-media", ctxA, {}, { timelineId: t.id, eventId: e.id, url: "ftp://bad" }).ok, false);
  });
});

describe("history.timeline-from-wikipedia (auto-build)", () => {
  it("extracts year-bearing sentences from a real article extract", async () => {
    globalThis.fetch = async (url) => {
      assert.match(String(url), /action=query/);
      return {
        ok: true,
        json: async () => ({
          query: {
            pages: {
              "1": {
                title: "Roman Empire",
                extract:
                  "Rome was founded in 753 BC according to tradition. " +
                  "Augustus became the first emperor in 27 BC. " +
                  "The Western Roman Empire fell in 476 AD.",
              },
            },
          },
        }),
      };
    };
    const r = await call("timeline-from-wikipedia", ctxA, {}, { title: "Roman Empire" });
    assert.equal(r.ok, true);
    assert.ok(r.result.usedCount >= 2);
    assert.equal(r.result.timeline.sourceArticle, "Roman Empire");
    const listed = call("timeline-list", ctxA, {}, {});
    assert.equal(listed.result.count, 1);
  });
  it("rejects an empty title and a missing article", async () => {
    assert.equal((await call("timeline-from-wikipedia", ctxA, {}, {})).ok, false);
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ query: { pages: { "-1": { missing: "" } } } }),
    });
    assert.equal((await call("timeline-from-wikipedia", ctxA, {}, { title: "NoSuchPage" })).ok, false);
  });
});

describe("history.history-dashboard (parity counters)", () => {
  it("counts mapped events + published timelines", () => {
    const t = mkTimeline();
    const e = mkEvent(t, { title: "E", year: 1 });
    call("event-set-location", ctxA, {}, { timelineId: t.id, eventId: e.id, lat: 1, lng: 2 });
    call("timeline-publish", ctxA, {}, { timelineId: t.id });
    const d = call("history-dashboard", ctxA, {}, {});
    assert.equal(d.result.mappedEvents, 1);
    assert.equal(d.result.publishedTimelines, 1);
  });
});
