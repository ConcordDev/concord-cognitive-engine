// server/tests/lattice-seed.test.js
//
// Behavioral tests for the recovered Auto-DTU + ingest-scheduler loop
// (server/lib/lattice-seed.js + migration 416). Runs against a real
// in-memory better-sqlite3 DB. LLM and fetch are injected — no live
// brain, no live network. Expected values come from the engine.
//
// Run: node --test server/tests/lattice-seed.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as upLatticeSeed } from "../migrations/444_lattice_seed.js";
import {
  MEMBER_PAGES_PER_DAY,
  ADMIN_PAGES_PER_DAY,
  pagesPerDayForRole,
  slugify,
  excerptFromHtml,
  todayStartIso,
  createSource,
  listSources,
  queuePage,
  listPages,
  executeNext,
  proposeHypotheses,
  listHypotheses,
  createResearchJob,
  processResearchJob,
  listResearchJobs,
  mintFromHypothesis,
  mintFromResearchJob,
  setTrust,
  listAutoDtus,
  status,
  generateUniqueDtuKey,
} from "../lib/lattice-seed.js";

let db;
beforeEach(() => {
  db = new Database(":memory:");
  upLatticeSeed(db);
});
afterEach(() => { try { db?.close(); } catch { /* intentional */ } });

const U = "user_a";
const OTHER = "user_b";

function htmlFetch(body, status = 200) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  });
}

describe("pagesPerDayForRole — privilege from role, never from a body field", () => {
  it("admin-family roles get 100, everyone else 10", () => {
    for (const role of ["owner", "admin", "founder", "sovereign"]) {
      assert.equal(pagesPerDayForRole(role), ADMIN_PAGES_PER_DAY, role);
    }
    for (const role of ["guest", "member", "paid", "researcher", "", undefined]) {
      assert.equal(pagesPerDayForRole(role), MEMBER_PAGES_PER_DAY, String(role));
    }
  });
});

describe("slugify / excerptFromHtml", () => {
  it("slugify lowercases and strips to 60 chars", () => {
    assert.equal(slugify("Hello, World!!"), "hello-world");
    assert.equal(slugify(""), "dtu");
    assert.equal(slugify("x".repeat(80)).length, 60);
  });

  it("excerptFromHtml strips tags and scripts, caps length", () => {
    const html = "<html><script>alert(1)</script><style>p{}</style><p>Ice on Ceres.</p></html>";
    assert.equal(excerptFromHtml(html), "Ice on Ceres.");
    assert.equal(excerptFromHtml("<p>" + "ab".repeat(2000) + "</p>").length, 2000);
  });
});

describe("sources + pages — ownership and validation", () => {
  it("createSource refuses a missing label and round-trips a labeled source", () => {
    assert.equal(createSource(db, U, { label: "  " }).reason, "label_required");
    const created = createSource(db, U, { label: "ArXiv", rootUrl: "https://arxiv.org", notes: "cs.AI" });
    assert.equal(created.ok, true);
    assert.equal(typeof created.id, "number");
    const list = listSources(db, U);
    assert.equal(list.sources.length, 1);
    assert.equal(list.sources[0].label, "ArXiv");
    assert.equal(list.sources[0].rootUrl, "https://arxiv.org");
    assert.equal(listSources(db, OTHER).sources.length, 0, "other user cannot see this source");
  });

  it("queuePage requires http(s), a real owned source, and stays queued", () => {
    const src = createSource(db, U, { label: "ArXiv" });
    assert.equal(queuePage(db, U, { sourceId: src.id, url: "ftp://x" }).reason, "url_must_be_http");
    assert.equal(queuePage(db, U, { sourceId: 999, url: "https://arxiv.org/abs/1" }).reason, "source_not_found");
    assert.equal(queuePage(db, OTHER, { sourceId: src.id, url: "https://arxiv.org/abs/1" }).reason, "source_not_found");
    const q = queuePage(db, U, { sourceId: src.id, url: "https://arxiv.org/abs/1" });
    assert.equal(q.ok, true);
    const pages = listPages(db, U, { status: "queued" });
    assert.equal(pages.pages.length, 1);
    assert.equal(pages.pages[0].url, "https://arxiv.org/abs/1");
    assert.equal(pages.pages[0].status, "queued");
  });

  it("missing db is an honest no_db, not a fabricated empty list", () => {
    assert.equal(createSource(null, U, { label: "x" }).reason, "no_db");
    assert.equal(listSources(null, U).reason, "no_db");
  });
});

describe("executeNext — fetch, excerpt, hypotheses, quota", () => {
  it("processes the oldest queued page, stores excerpt, mints a hypothesis, counts quota", async () => {
    const src = createSource(db, U, { label: "Ceres notes" });
    queuePage(db, U, { sourceId: src.id, url: "https://example.com/ceres" });
    const r = await executeNext(db, U, {
      role: "member",
      fetchImpl: htmlFetch("<html><p>Water ice confirmed in Ceres' mid-latitude shadowed craters.</p></html>"),
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.excerpt, "Water ice confirmed in Ceres' mid-latitude shadowed craters.");
    assert.equal(r.quotaUsed, 1);
    assert.equal(r.quotaLimit, MEMBER_PAGES_PER_DAY);
    assert.equal(r.composer, "deterministic");
    assert.match(r.hypotheses, /Ceres/);
    const pages = listPages(db, U);
    assert.equal(pages.pages[0].status, "processed");
    assert.equal(listHypotheses(db, U).hypotheses.length, 1);
    const st = status(db, U, { role: "member" });
    assert.equal(st.quotaUsed, 1);
    assert.equal(st.queuedPages, 0);
    assert.equal(st.memoryCount, 2); // ingest memory + hypothesis memory
  });

  it("empty page is an honest empty_page and does not consume quota", async () => {
    const src = createSource(db, U, { label: "Empty" });
    queuePage(db, U, { sourceId: src.id, url: "https://example.com/empty" });
    const r = await executeNext(db, U, {
      role: "member",
      fetchImpl: htmlFetch("<html><script>void 0</script></html>"),
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "empty_page");
    assert.equal(status(db, U, { role: "member" }).quotaUsed, 0);
    assert.equal(listPages(db, U).pages[0].status, "error");
  });

  it("HTTP failure is fetch_failed, page marked error, quota untouched", async () => {
    const src = createSource(db, U, { label: "Down" });
    queuePage(db, U, { sourceId: src.id, url: "https://example.com/404" });
    const r = await executeNext(db, U, {
      role: "member",
      fetchImpl: htmlFetch("nope", 404),
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "fetch_failed");
    assert.equal(status(db, U, { role: "member" }).quotaUsed, 0);
  });

  it("no queued pages is honest, not a fabricated success", async () => {
    const r = await executeNext(db, U, { role: "member", fetchImpl: htmlFetch("x") });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_queued_pages");
  });

  it("member quota is 10; the 11th execute-next is quota_reached without fetching", async () => {
    const src = createSource(db, U, { label: "Burst" });
    for (let i = 0; i < 11; i++) {
      queuePage(db, U, { sourceId: src.id, url: `https://example.com/p${i}` });
    }
    let fetches = 0;
    const fetchImpl = async () => {
      fetches += 1;
      return { ok: true, status: 200, text: async () => `<p>Page body ${fetches}</p>` };
    };
    for (let i = 0; i < 10; i++) {
      const r = await executeNext(db, U, { role: "member", fetchImpl });
      assert.equal(r.ok, true, `page ${i} should ingest: ${JSON.stringify(r)}`);
    }
    const blocked = await executeNext(db, U, { role: "member", fetchImpl });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.reason, "quota_reached");
    assert.equal(blocked.quotaUsed, 10);
    assert.equal(blocked.quotaLimit, 10);
    assert.equal(fetches, 10, "quota refusal must not fetch the 11th page");
    assert.equal(listPages(db, U, { status: "queued" }).pages.length, 1);
  });

  it("admin-family quota is 100, not the member 10", async () => {
    const src = createSource(db, U, { label: "Admin burst" });
    for (let i = 0; i < 11; i++) {
      queuePage(db, U, { sourceId: src.id, url: `https://example.com/a${i}` });
    }
    const fetchImpl = htmlFetch("<p>ok</p>");
    for (let i = 0; i < 11; i++) {
      const r = await executeNext(db, U, { role: "admin", fetchImpl });
      assert.equal(r.ok, true, `admin page ${i}: ${JSON.stringify(r)}`);
    }
    assert.equal(status(db, U, { role: "admin" }).quotaUsed, 11);
    assert.equal(status(db, U, { role: "admin" }).quotaLimit, ADMIN_PAGES_PER_DAY);
  });

  it("a request-body-shaped mode field cannot raise the quota — role is the only input", async () => {
    // The old backend read `mode === "admin"` off the body. If someone
    // later wires that back, this documents the contract: executeNext
    // has no `mode` argument. Quota is pagesPerDayForRole(role) only.
    assert.equal(pagesPerDayForRole("member"), 10);
    assert.notEqual(pagesPerDayForRole("member"), ADMIN_PAGES_PER_DAY);
  });
});

describe("hypotheses + auto-DTU mint + trust ladder", () => {
  it("proposeHypotheses persists deterministic directions when no LLM is present", async () => {
    const r = await proposeHypotheses(db, U, {
      text: "Ceres has water ice in permanently shadowed craters.",
      sourceLabel: "manual",
    });
    assert.equal(r.ok, true);
    assert.equal(r.composer, "deterministic");
    assert.match(r.hypotheses, /Ceres has water ice/);
    assert.equal(listHypotheses(db, U).hypotheses.length, 1);
    assert.equal(listHypotheses(db, OTHER).hypotheses.length, 0);
  });

  it("mintFromHypothesis writes an experimental auto-DTU with a unique key", async () => {
    const hyp = await proposeHypotheses(db, U, { text: "Phobos may be a captured asteroid." });
    const minted = await mintFromHypothesis(db, U, { hypothesisId: hyp.id, layerHint: "HLM" });
    assert.equal(minted.ok, true, JSON.stringify(minted));
    assert.equal(minted.dtu.trustLevel, "experimental");
    assert.equal(minted.dtu.layer, "HLM");
    assert.equal(minted.dtu.kind, "auto-hypothesis");
    assert.equal(minted.dtu.composer, "deterministic");
    assert.equal(minted.dtu.mintedDtuId, null, "no dtu.create hook → honest null, not a fake id");
    const listed = listAutoDtus(db, U);
    assert.equal(listed.dtus.length, 1);
    assert.equal(listed.dtus[0].key, minted.dtu.key);
  });

  it("setTrust promotes experimental → trusted; trusted-only listing hides the rest", async () => {
    const hyp = await proposeHypotheses(db, U, { text: "A testable claim about Enceladus plumes." });
    const minted = await mintFromHypothesis(db, U, { hypothesisId: hyp.id });
    assert.equal(setTrust(db, U, { key: minted.dtu.key, trustLevel: "nope" }).reason, "invalid_trust_level");
    assert.equal(setTrust(db, U, { key: "ghost", trustLevel: "trusted" }).reason, "auto_dtu_not_found");
    assert.equal(setTrust(db, OTHER, { key: minted.dtu.key, trustLevel: "trusted" }).reason, "auto_dtu_not_found");
    const promoted = setTrust(db, U, { key: minted.dtu.key, trustLevel: "trusted" });
    assert.equal(promoted.ok, true);
    assert.equal(promoted.trustLevel, "trusted");
    assert.equal(listAutoDtus(db, U, { includeExperimental: false }).dtus.length, 1);
  });

  it("generateUniqueDtuKey suffixes colliding slugs", async () => {
    const hyp = await proposeHypotheses(db, U, { text: "Same slug seed about Titan lakes." });
    const a = await mintFromHypothesis(db, U, { hypothesisId: hyp.id });
    const b = await mintFromHypothesis(db, U, { hypothesisId: hyp.id });
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    assert.notEqual(a.dtu.key, b.dtu.key);
    assert.ok(b.dtu.key.startsWith(a.dtu.key) || b.dtu.key.endsWith("-2") || a.dtu.key.endsWith("-2"));
    const k1 = await generateUniqueDtuKey(db, U, a.dtu.key);
    assert.notEqual(k1, a.dtu.key);
  });

  it("LLM JSON mint uses the model body; malformed JSON falls back without failing", async () => {
    const hyp = await proposeHypotheses(db, U, { text: "Europa's ice shell may hide a global ocean." });
    const minted = await mintFromHypothesis(db, U, {
      hypothesisId: hyp.id,
      llm: {
        chat: async () => ({
          ok: true,
          content: '```json\n{"key":"europa-ocean","title":"Europa Ocean Hypothesis","summary":"A global ocean may sit under Europa ice.","tags":["europa","ocean"],"layer":"HLR"}\n```',
        }),
      },
    });
    assert.equal(minted.ok, true);
    assert.equal(minted.dtu.key, "europa-ocean");
    assert.equal(minted.dtu.title, "Europa Ocean Hypothesis");
    assert.equal(minted.dtu.layer, "HLR");
    assert.equal(minted.dtu.composer, "llm");
    assert.deepEqual(minted.dtu.tags, ["europa", "ocean"]);

    const fallback = await mintFromHypothesis(db, U, {
      hypothesisId: hyp.id,
      llm: { chat: async () => ({ ok: true, content: "not-json at all" }) },
    });
    assert.equal(fallback.ok, true);
    assert.equal(fallback.dtu.composer, "deterministic");
  });

  it("optional mintDtu hook stamps minted_dtu_id; a throwing hook stays null", async () => {
    const hyp = await proposeHypotheses(db, U, { text: "Io's torus is sourced from volcanic sulfur." });
    const okMint = await mintFromHypothesis(db, U, {
      hypothesisId: hyp.id,
      mintDtu: async () => ({ dtu: { id: "dtu_real_1" } }),
    });
    assert.equal(okMint.dtu.mintedDtuId, "dtu_real_1");
    const boom = await mintFromHypothesis(db, U, {
      hypothesisId: hyp.id,
      mintDtu: async () => { throw new Error("substrate down"); },
    });
    assert.equal(boom.ok, true, "auto-DTU row still lands when substrate mint throws");
    assert.equal(boom.dtu.mintedDtuId, null);
  });
});

describe("research jobs — persist + mint", () => {
  it("create + process with no LLM writes a deterministic consult list and can mint an experimental DTU", async () => {
    const created = createResearchJob(db, U, { topic: "Ceres ice", dtuKeys: ["ceres-ice"], layer: "HLR" });
    assert.equal(created.ok, true);
    assert.equal(created.status, "pending");
    const processed = await processResearchJob(db, U, created.id, {
      listDtus: async () => [
        { key: "ceres-ice", title: "Ceres Ice", summary: "Mid-latitude ice.", layer: "HLR" },
        { key: "other", title: "Other", summary: "Unrelated", layer: "domain" },
      ],
    });
    assert.equal(processed.ok, true);
    assert.equal(processed.status, "done");
    assert.equal(processed.composer, "deterministic");
    assert.match(processed.resultSummary, /Ceres Ice/);
    assert.doesNotMatch(processed.resultSummary, /Unrelated/);
    const minted = await mintFromResearchJob(db, U, { jobId: created.id });
    assert.equal(minted.ok, true);
    assert.equal(minted.dtu.trustLevel, "experimental");
    assert.equal(minted.dtu.kind, "auto-research");
  });

  it("mintFromResearchJob refuses a still-pending job", async () => {
    const created = createResearchJob(db, U, { topic: "not done" });
    const r = await mintFromResearchJob(db, U, { jobId: created.id });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "job_not_completed");
  });

  it("listResearchJobs is per-user", async () => {
    createResearchJob(db, U, { topic: "mine" });
    assert.equal(listResearchJobs(db, U).jobs.length, 1);
    assert.equal(listResearchJobs(db, OTHER).jobs.length, 0);
  });
});

describe("todayStartIso is UTC midnight", () => {
  it("pins hour/min/sec to 0Z", () => {
    const iso = todayStartIso(new Date("2026-09-03T15:04:05.000Z"));
    assert.equal(iso, "2026-09-03T00:00:00.000Z");
  });
});
