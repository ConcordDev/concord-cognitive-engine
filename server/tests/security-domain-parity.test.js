// Contract tests for server/domains/security.js — SOC console parity backlog.
// Covers: SIEM event pipeline + correlation, incident response playbooks,
// alert rules engine, CVE-to-asset matching, badge audit, surveillance camera
// tiles, EPSS + IOC threat-intel enrichment.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerSecurityActions from "../domains/security.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`security.${name}`);
  if (!fn) throw new Error(`security.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerSecurityActions(register); });

beforeEach(() => {
  // fresh STATE per test so user buckets don't bleed across cases
  globalThis._concordSTATE = {};
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
});

const ctx = { actor: { userId: "soc_user" }, userId: "soc_user" };

describe("security — SIEM event pipeline + correlation", () => {
  it("event-ingest requires a message", () => {
    const r = call("event-ingest", ctx, {});
    assert.equal(r.ok, false);
  });

  it("event-ingest stores a real event from user input", () => {
    const r = call("event-ingest", ctx, { message: "failed login", severity: "high", srcIp: "10.0.0.5", user: "alice" });
    assert.equal(r.ok, true);
    assert.equal(r.result.event.message, "failed login");
    assert.equal(r.result.event.severity, "high");
  });

  it("event-list returns ingested events with count", () => {
    call("event-ingest", ctx, { message: "auth failure one", srcIp: "10.0.0.9" });
    call("event-ingest", ctx, { message: "auth failure two", srcIp: "10.0.0.9" });
    const r = call("event-list", ctx, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 2);
    assert.ok(Array.isArray(r.result.events));
  });

  it("event-correlate clusters events sharing a pivot", () => {
    for (let i = 0; i < 4; i++) call("event-ingest", ctx, { message: `brute ${i}`, srcIp: "203.0.113.7", severity: "high" });
    const r = call("event-correlate", ctx, { minEvents: 3 });
    assert.equal(r.ok, true);
    assert.ok(r.result.correlations.length >= 1);
    assert.equal(r.result.correlations[0].pivot, "ip:203.0.113.7");
  });
});

describe("security — alert rules engine", () => {
  it("rule-add requires name and pattern", () => {
    assert.equal(call("rule-add", ctx, { name: "x" }).ok, false);
    assert.equal(call("rule-add", ctx, { pattern: "y" }).ok, false);
  });

  it("rule-add / rule-list / rule-toggle / rule-delete round-trip", () => {
    const add = call("rule-add", ctx, { name: "Brute force", pattern: "failed login", threshold: 2 });
    assert.equal(add.ok, true);
    const id = add.result.rule.id;
    assert.equal(call("rule-list", ctx, {}).result.count, 1);
    const tog = call("rule-toggle", ctx, { id });
    assert.equal(tog.result.rule.enabled, false);
    assert.equal(call("rule-delete", ctx, { id }).ok, true);
    assert.equal(call("rule-list", ctx, {}).result.count, 0);
  });

  it("rule-evaluate auto-creates an incident when threshold met", () => {
    call("rule-add", ctx, { name: "Failed logins", pattern: "failed login", threshold: 2, minSeverity: "info" });
    call("event-ingest", ctx, { message: "failed login a" });
    call("event-ingest", ctx, { message: "failed login b" });
    const r = call("rule-evaluate", ctx, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.incidentsCreated, 1);
    assert.ok(call("incident-list", ctx, {}).result.count >= 1);
  });
});

describe("security — incident response workflow with playbooks", () => {
  it("playbook-list returns the built-in playbook library", () => {
    const r = call("playbook-list", ctx, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.count >= 5);
    assert.ok(r.result.playbooks.every((p) => Array.isArray(p.steps)));
  });

  it("incident-open requires a title", () => {
    assert.equal(call("incident-open", ctx, {}).ok, false);
  });

  it("incident lifecycle: open -> attach playbook -> advance -> close", () => {
    const open = call("incident-open", ctx, { title: "Suspicious traffic", severity: "P2" });
    assert.equal(open.ok, true);
    const id = open.result.incident.id;
    const attach = call("incident-attach-playbook", ctx, { incidentId: id, playbookId: "malware" });
    assert.equal(attach.ok, true);
    assert.ok(attach.result.incident.playbookSteps.length > 0);
    const step = call("incident-advance", ctx, { incidentId: id, completeStep: 0 });
    assert.equal(step.result.incident.playbookSteps[0].done, true);
    const closed = call("incident-advance", ctx, { incidentId: id, phase: "closed" });
    assert.equal(closed.result.incident.status, "closed");
  });

  it("incident-list filters open incidents", () => {
    call("incident-open", ctx, { title: "Open one" });
    const r = call("incident-list", ctx, { open: true });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 1);
  });
});

describe("security — CVE-to-asset matching", () => {
  it("cve-asset-match flags assets a vuln affects", () => {
    call("asset-add", ctx, { name: "web01", vendor: "Apache", type: "server", version: "2.4" });
    call("vuln-add", ctx, { title: "Apache HTTP Server RCE", cveId: "CVE-2024-0001", cvss: 9.1 });
    const r = call("cve-asset-match", ctx, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.totalMatches, 1);
    assert.equal(r.result.matches[0].affectedAssets[0].vendor, "Apache");
  });
});

describe("security — access-control / badge audit", () => {
  it("badge-event-add requires badgeId and zone", () => {
    assert.equal(call("badge-event-add", ctx, { badgeId: "B1" }).ok, false);
  });

  it("badge-audit surfaces repeated-denial anomalies", () => {
    for (let i = 0; i < 3; i++) call("badge-event-add", ctx, { badgeId: "B9", zone: "Vault", result: "denied" });
    const r = call("badge-audit", ctx, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.anomalies.some((a) => a.kind === "repeated-denial"));
  });
});

describe("security — surveillance camera tiles", () => {
  it("camera-add requires a name", () => {
    assert.equal(call("camera-add", ctx, {}).ok, false);
  });

  it("camera CRUD round-trip", () => {
    const add = call("camera-add", ctx, { name: "Lobby Cam", zone: "Lobby" });
    assert.equal(add.ok, true);
    const id = add.result.camera.id;
    assert.equal(call("camera-list", ctx, {}).result.count, 1);
    const upd = call("camera-update", ctx, { id, status: "maintenance" });
    assert.equal(upd.result.camera.status, "maintenance");
    assert.equal(call("camera-delete", ctx, { id }).ok, true);
    assert.equal(call("camera-list", ctx, {}).result.count, 0);
  });
});

describe("security — EPSS + IOC threat-intel enrichment", () => {
  it("threat-enrich requires cveId or ioc", async () => {
    const r = await call("threat-enrich", ctx, {});
    assert.equal(r.ok, false);
  });

  it("threat-enrich derives IOC reputation from the live event stream", async () => {
    for (let i = 0; i < 5; i++) call("event-ingest", ctx, { message: `beacon ${i}`, srcIp: "198.51.100.4", severity: "high" });
    const r = await call("threat-enrich", ctx, { ioc: "198.51.100.4" });
    assert.equal(r.ok, true);
    assert.equal(r.result.iocIntel.sightings, 5);
    assert.equal(r.result.iocIntel.reputation, "malicious");
  });

  it("threat-enrich shapes EPSS from a real FIRST.org response", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ data: [{ cve: "CVE-2021-44228", epss: "0.97", percentile: "0.99", date: "2026-05-01" }] }),
    });
    const r = await call("threat-enrich", ctx, { cveId: "CVE-2021-44228" });
    assert.equal(r.ok, true);
    assert.equal(r.result.epss.exploitability, "high");
    assert.equal(r.result.epss.score, 0.97);
  });
});
