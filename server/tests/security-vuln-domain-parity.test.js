// Contract tests for the security lens — vulnerability-management
// substrate + CVE feed in server/domains/security.js.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerSecurityActions from "../domains/security.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`security.${name}`);
  assert.ok(fn, `security.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerSecurityActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("security.assets", () => {
  it("adds an asset scoped per user", () => {
    call("asset-add", ctxA, { name: "api-server", type: "service", vendor: "nginx", version: "1.25" });
    assert.equal(call("asset-list", ctxA, {}).result.count, 1);
    assert.equal(call("asset-list", ctxB, {}).result.count, 0);
  });
  it("rejects a nameless asset; delete detaches it from vulns", () => {
    assert.equal(call("asset-add", ctxA, {}).ok, false);
    const a = call("asset-add", ctxA, { name: "db" }).result.asset;
    call("vuln-add", ctxA, { title: "SQLi", cvss: 9.1, affectedAssetIds: [a.id] });
    call("asset-delete", ctxA, { id: a.id });
    assert.equal(call("vuln-list", ctxA, {}).result.vulns[0].affectedAssetIds.length, 0);
  });
});

describe("security.vulnerabilities", () => {
  it("derives severity from CVSS and sorts critical first", () => {
    call("vuln-add", ctxA, { title: "Low issue", cvss: 3.2 });
    call("vuln-add", ctxA, { title: "Critical RCE", cvss: 9.8 });
    const list = call("vuln-list", ctxA, {}).result.vulns;
    assert.equal(list[0].title, "Critical RCE");
    assert.equal(list[0].severity, "critical");
  });
  it("filters by status and updates remediation state", () => {
    const v = call("vuln-add", ctxA, { title: "XSS", cvss: 6.1 }).result.vuln;
    assert.equal(v.severity, "medium");
    call("vuln-update", ctxA, { id: v.id, status: "remediated" });
    assert.equal(call("vuln-list", ctxA, { status: "open" }).result.count, 0);
    assert.equal(call("vuln-list", ctxA, { status: "remediated" }).result.count, 1);
  });
  it("rejects a titleless vuln and deletes one", () => {
    assert.equal(call("vuln-add", ctxA, {}).ok, false);
    const v = call("vuln-add", ctxA, { title: "tmp" }).result.vuln;
    call("vuln-delete", ctxA, { id: v.id });
    assert.equal(call("vuln-list", ctxA, {}).result.count, 0);
  });
});

describe("security.dashboard", () => {
  it("computes a risk score + posture from open vulns", () => {
    call("vuln-add", ctxA, { title: "C", cvss: 9.5 });
    call("vuln-add", ctxA, { title: "H", cvss: 7.5 });
    const d = call("security-dashboard", ctxA, {});
    assert.equal(d.result.openVulns, 2);
    assert.equal(d.result.bySeverity.critical, 1);
    assert.equal(d.result.riskScore, 37);
    assert.equal(d.result.posture, "needs-attention");
  });
});

describe("security.feed — CIRCL CVE-Search → DTUs", () => {
  it("ingests recent CVEs as DTUs", async () => {
    globalThis.fetch = async () => ({ ok: true, json: async () => ([
      { id: "CVE-2026-0001", summary: "Remote code execution in widget.", cvss: 9.8 },
      { id: "CVE-2026-0002", summary: "Information disclosure.", cvss: 5.3 },
    ]) });
    const created = [];
    const ctx = {
      actor: { userId: "user_a" }, userId: "user_a",
      macro: { run: async (d, n, input) => { const dtu = { id: `dtu${created.length}`, ...input }; created.push(dtu); return { ok: true, dtu }; } },
    };
    const r = await call("feed", ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.ingested, 2);
    assert.match(created[0].title, /CVE-2026-0001/);
    assert.ok(created[0].tags.includes("critical"));
    const r2 = await call("feed", ctx);
    assert.equal(r2.result.ingested, 0); // deduped
  });
});

describe("security — analysis macros still intact", () => {
  it("threatAssessment still responds", () => {
    assert.equal(call("threatAssessment", ctxA, {}).ok, true);
  });
});
