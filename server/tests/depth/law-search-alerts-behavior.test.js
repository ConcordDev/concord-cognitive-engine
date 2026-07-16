// tests/depth/law-search-alerts-behavior.test.js — REAL behavioral tests for
// the law "search-alert-*" family (registerLensAction, invoked via lensRun):
// saved-search persistence + honest "what's new since the last check" diffing
// against the REAL courtlistener-search / recap-docket-search handlers
// (search-alert-check calls those exact functions in-process — see
// server/domains/law.js's family header comment above search-alert-add).
//
// Network mocking follows the ESTABLISHED pattern for CourtListener-backed
// law macros in this repo (server/tests/law-real-data-domain-parity.test.js):
// globalThis.fetch is overridden per-test to return controlled JSON. This
// harness (./_harness.js) boots the real server once; the tests/preload/
// no-egress.mjs guard (when the file is run under the depth suite's
// --import flag) only patches the fetch reference at process start — a
// later per-test `globalThis.fetch = ...` assignment fully replaces it, so
// mocking still works exactly as it does in the non-harness law test file.
//
// lens.run wraps a handler's {ok:false,error} as {ok:true, result:{ok:false,
// error}} — the OUTER `r.ok` is dispatch success; the handler verdict is in
// `r.result` (same convention as tests/depth/law-behavior.test.js).
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

beforeEach(() => {
  // Fail loudly on any unmocked fetch — every test below sets its own
  // controlled response before calling search-alert-check.
  globalThis.fetch = async () => { throw new Error("network disabled in tests (unmocked call)"); };
  delete process.env.COURTLISTENER_API_TOKEN;
});

// Shapes match exactly what courtlistener-search / recap-docket-search read
// off the real CourtListener v4 `/search/` endpoint (see server/domains/law.js).
function courtlistenerPage(ids) {
  return {
    count: ids.length,
    results: ids.map((id) => ({
      id,
      caseName: `Case ${id}`,
      court: "Test Court",
      court_id: "test",
      dateFiled: "2026-01-01",
      absolute_url: `/opinion/${id}/case-${id}/`,
      snippet: "s",
      citation: [`${id} F.4th 1`],
      status: "Published",
      docketNumber: String(id),
      judge: "J",
      author: "A",
    })),
  };
}
function recapPage(docketIds) {
  return {
    count: docketIds.length,
    results: docketIds.map((id) => ({
      id,
      caseName: `Docket ${id}`,
      court: "Test Court",
      court_id: "test",
      docketNumber: `1:26-cv-000${id}`,
      dateFiled: "2026-01-01",
      docket_absolute_url: `/docket/${id}/docket-${id}/`,
      more_docs: false,
      recap_documents: [],
    })),
  };
}
const okJson = (data) => ({ ok: true, json: async () => data });

describe("law.search-alert-add / -list / -remove — CRUD round-trip", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("law-search-alerts-crud"); });

  it("search-alert-add: rejects a missing query before creating anything", async () => {
    const bad = await lensRun("law", "search-alert-add", { params: { alertType: "case_law" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /query required/);
  });

  it("search-alert-add: creates a case_law alert with honest manual-check defaults", async () => {
    const r = await lensRun("law", "search-alert-add", {
      params: { query: "qualified immunity", alertType: "case_law", label: "QI watch" },
    }, ctx);
    assert.equal(r.result.alert.query, "qualified immunity");
    assert.equal(r.result.alert.alertType, "case_law");
    assert.equal(r.result.alert.label, "QI watch");
    assert.equal(r.result.alert.checkInterval, "manual");
    assert.deepEqual(r.result.alert.lastSeenResultIds, []);
    assert.equal(r.result.alert.lastCheckedAt, null);
    assert.equal(r.result.alert.checkCount, 0);
  });

  it("search-alert-add: unrecognized alertType falls back to case_law (same convention as contract type)", async () => {
    const r = await lensRun("law", "search-alert-add", { params: { query: "x", alertType: "citation" } }, ctx);
    assert.equal(r.result.alert.alertType, "case_law");
  });

  it("search-alert-add: label defaults to the query when omitted", async () => {
    const r = await lensRun("law", "search-alert-add", { params: { query: "eminent domain" } }, ctx);
    assert.equal(r.result.alert.label, "eminent domain");
  });

  it("search-alert-add: docketNumber is only stored for docket-type alerts", async () => {
    const notDocket = await lensRun("law", "search-alert-add", {
      params: { query: "x", alertType: "case_law", docketNumber: "3:24-cv-00001" },
    }, ctx);
    assert.equal(notDocket.result.alert.docketNumber, null);
    const isDocket = await lensRun("law", "search-alert-add", {
      params: { query: "Concord Data", alertType: "docket", docketNumber: "3:24-cv-00001" },
    }, ctx);
    assert.equal(isDocket.result.alert.docketNumber, "3:24-cv-00001");
  });

  it("search-alert-list → search-alert-remove round-trip; removing a bogus id is rejected honestly", async () => {
    const created = await lensRun("law", "search-alert-add", { params: { query: "removable" } }, ctx);
    const id = created.result.alert.id;
    const listed = await lensRun("law", "search-alert-list", {}, ctx);
    assert.ok(listed.result.alerts.some((a) => a.id === id));
    const removed = await lensRun("law", "search-alert-remove", { params: { id } }, ctx);
    assert.equal(removed.result.removed, id);
    const listedAfter = await lensRun("law", "search-alert-list", {}, ctx);
    assert.ok(!listedAfter.result.alerts.some((a) => a.id === id));
    const bad = await lensRun("law", "search-alert-remove", { params: { id: "alt_nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /alert not found/);
  });

  it("search-alert-list: a freshly-created alert reports neverChecked:true", async () => {
    const created = await lensRun("law", "search-alert-add", { params: { query: "fresh" } }, ctx);
    const listed = await lensRun("law", "search-alert-list", {}, ctx);
    const row = listed.result.alerts.find((a) => a.id === created.result.alert.id);
    assert.equal(row.neverChecked, true);
    assert.equal(row.checkCount, 0);
    assert.equal(row.hoursSinceLastCheck, null);
  });
});

describe("law.search-alert-check — case_law: genuinely calls courtlistener-search + diffs new-vs-seen", () => {
  let ctx, alertId;
  before(async () => {
    ctx = await depthCtx("law-search-alerts-case-law");
    const created = await lensRun("law", "search-alert-add", {
      params: { query: "qualified immunity", alertType: "case_law", court: "scotus" },
    }, ctx);
    alertId = created.result.alert.id;
  });

  it("first check: every fetched result is reported new; firstCheck:true; fetch is called with the saved query", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => { capturedUrl = String(url); return okJson(courtlistenerPage([1, 2])); };
    const r = await lensRun("law", "search-alert-check", { params: { id: alertId } }, ctx);
    assert.equal(r.result.ok, undefined); // no error key on success — see below for the real shape
    assert.equal(r.result.alertId, alertId);
    assert.equal(r.result.alertType, "case_law");
    assert.equal(r.result.newCount, 2);
    assert.equal(r.result.totalResults, 2);
    assert.equal(r.result.totalHits, 2);
    assert.equal(r.result.firstCheck, true);
    assert.deepEqual(r.result.newResults.map((x) => x.id), [1, 2]);
    // Re-ran the REAL courtlistener-search handler — same endpoint, same
    // query, and the saved `court` filter passed through.
    assert.match(capturedUrl, /courtlistener\.com\/api\/rest\/v4\/search/);
    assert.match(capturedUrl, /type=o/);
    assert.match(capturedUrl, /q=qualified\+immunity/);
    assert.match(capturedUrl, /court=scotus/);
  });

  it("second check: only the genuinely-new id (3) is reported; 1 and 2 are no longer new", async () => {
    globalThis.fetch = async () => okJson(courtlistenerPage([1, 2, 3]));
    const r = await lensRun("law", "search-alert-check", { params: { id: alertId } }, ctx);
    assert.equal(r.result.newCount, 1);
    assert.equal(r.result.newResults[0].id, 3);
    assert.equal(r.result.firstCheck, false);
    assert.equal(r.result.totalResults, 3);
  });

  it("third check with no new opinions: newCount is honestly 0 (not a failure)", async () => {
    globalThis.fetch = async () => okJson(courtlistenerPage([1, 2, 3]));
    const r = await lensRun("law", "search-alert-check", { params: { id: alertId } }, ctx);
    assert.equal(r.result.ok, undefined);
    assert.equal(r.result.newCount, 0);
    assert.deepEqual(r.result.newResults, []);
  });

  it("search-alert-list now reflects the checks: neverChecked:false, checkCount and seenResultCount advanced", async () => {
    const listed = await lensRun("law", "search-alert-list", {}, ctx);
    const row = listed.result.alerts.find((a) => a.id === alertId);
    assert.equal(row.neverChecked, false);
    assert.equal(row.checkCount, 3);
    assert.equal(row.seenResultCount, 3);
    assert.equal(row.lastCheckTotalResults, 3);
  });

  it("search-alert-check: an unknown alert id is rejected honestly (no network call made)", async () => {
    let fetchCalled = false;
    globalThis.fetch = async () => { fetchCalled = true; return okJson(courtlistenerPage([])); };
    const r = await lensRun("law", "search-alert-check", { params: { id: "alt_ghost" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /alert not found/);
    assert.equal(fetchCalled, false);
  });
});

describe("law.search-alert-check — docket: genuinely calls recap-docket-search + diffs by docketId", () => {
  let ctx, alertId;
  before(async () => {
    ctx = await depthCtx("law-search-alerts-docket");
    const created = await lensRun("law", "search-alert-add", {
      params: { query: "Concord Data", alertType: "docket" },
    }, ctx);
    alertId = created.result.alert.id;
  });

  it("first check: reports both dockets as new; hits the RECAP (type=r) endpoint", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (url) => { capturedUrl = String(url); return okJson(recapPage([101, 102])); };
    const r = await lensRun("law", "search-alert-check", { params: { id: alertId } }, ctx);
    assert.equal(r.result.alertType, "docket");
    assert.equal(r.result.newCount, 2);
    assert.deepEqual(r.result.newResults.map((x) => x.docketId), [101, 102]);
    assert.match(capturedUrl, /type=r/);
    assert.match(capturedUrl, /q=Concord\+Data/);
  });

  it("second check: only docket 103 is genuinely new", async () => {
    globalThis.fetch = async () => okJson(recapPage([101, 102, 103]));
    const r = await lensRun("law", "search-alert-check", { params: { id: alertId } }, ctx);
    assert.equal(r.result.newCount, 1);
    assert.equal(r.result.newResults[0].docketId, 103);
  });
});

describe("law.search-alert-check — a failed underlying search is an HONEST error, never a fake '0 new results'", () => {
  let ctx, alertId;
  before(async () => {
    ctx = await depthCtx("law-search-alerts-failure");
    const created = await lensRun("law", "search-alert-add", { params: { query: "outage watch", alertType: "case_law" } }, ctx);
    alertId = created.result.alert.id;
  });

  it("a rate-limited (429) underlying search surfaces the real error and leaves the alert's baseline untouched", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 429, json: async () => ({}) });
    const r = await lensRun("law", "search-alert-check", { params: { id: alertId } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /rate limit/);
    // Never silently reported as "checked, 0 new" — the alert stays at its
    // pre-check baseline so the NEXT successful check still diffs correctly.
    const listed = await lensRun("law", "search-alert-list", {}, ctx);
    const row = listed.result.alerts.find((a) => a.id === alertId);
    assert.equal(row.neverChecked, true);
    assert.equal(row.checkCount, 0);
  });

  it("a network-unreachable underlying search also surfaces honestly, and a later successful check still diffs against the untouched baseline", async () => {
    globalThis.fetch = async () => { throw new Error("getaddrinfo ENOTFOUND"); };
    const failed = await lensRun("law", "search-alert-check", { params: { id: alertId } }, ctx);
    assert.equal(failed.result.ok, false);
    assert.match(failed.result.error, /unreachable/);

    // Recovery: the next successful check must still treat this as the
    // FIRST real baseline (the failed attempt above never poisoned it).
    globalThis.fetch = async () => okJson(courtlistenerPage([9, 10])); // case_law shape (default alertType)
    const recovered = await lensRun("law", "search-alert-check", { params: { id: alertId } }, ctx);
    assert.equal(recovered.result.ok, undefined);
    assert.equal(recovered.result.firstCheck, true);
    assert.equal(recovered.result.newCount, 2);
  });
});

describe("law.search-alert-* — per-user isolation", () => {
  let ctxA, ctxB, alertIdA;
  before(async () => {
    ctxA = await depthCtx("law-search-alerts-user-a");
    ctxB = await depthCtx("law-search-alerts-user-b");
    const created = await lensRun("law", "search-alert-add", { params: { query: "user A's private watch" } }, ctxA);
    alertIdA = created.result.alert.id;
  });

  it("user B's list does not include user A's alert", async () => {
    const listedB = await lensRun("law", "search-alert-list", {}, ctxB);
    assert.ok(!listedB.result.alerts.some((a) => a.id === alertIdA));
  });

  it("user B cannot check or remove user A's alert (honest not-found, not a silent no-op)", async () => {
    const checkB = await lensRun("law", "search-alert-check", { params: { id: alertIdA } }, ctxB);
    assert.equal(checkB.result.ok, false);
    assert.match(checkB.result.error, /alert not found/);
    const removeB = await lensRun("law", "search-alert-remove", { params: { id: alertIdA } }, ctxB);
    assert.equal(removeB.result.ok, false);
    assert.match(removeB.result.error, /alert not found/);
    // Still present for user A afterward.
    const listedA = await lensRun("law", "search-alert-list", {}, ctxA);
    assert.ok(listedA.result.alerts.some((a) => a.id === alertIdA));
  });
});
