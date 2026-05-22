// Contract tests for server/domains/privacy.js — the OneTrust / Apple-Privacy
// parity macros. Covers the four artifact-driven analysis macros plus the
// seven per-user data-control macros (DSAR, per-lens sharing, access log,
// data export, cookie banner config, retention policy, data-flow map).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerPrivacyActions from "../domains/privacy.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`privacy.${name}`);
  if (!fn) throw new Error(`privacy.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => { registerPrivacyActions(register); });

// Isolate per-user STATE between tests so DSAR/flow counts don't bleed.
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

// ── Original analysis macros ───────────────────────────────────────────────

describe("privacy.dataInventory / consentAudit / impactAssessment / breachResponse", () => {
  it("dataInventory classifies sensitive items + risk", () => {
    const r = call("dataInventory", ctxA, {
      data: { dataItems: [{ category: "id", pii: true }, { category: "logs" }] },
    }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.totalItems, 2);
    assert.equal(r.result.sensitiveItems, 1);
    assert.equal(r.result.gdprRelevant, true);
  });

  it("consentAudit computes compliance rate", () => {
    const r = call("consentAudit", ctxA, {
      data: { consents: [{ status: "active" }, { status: "withdrawn" }] },
    }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.totalConsents, 2);
    assert.equal(r.result.complianceRate, 50);
  });

  it("impactAssessment flags DPIA on multiple risk factors", () => {
    const r = call("impactAssessment", ctxA, {
      data: { involvesMinors: true, crossBorderTransfer: true, dataTypes: [] },
    }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.dpiaRequired, true);
  });

  it("breachResponse produces a regulatory timeline", () => {
    const r = call("breachResponse", ctxA, {
      data: { severity: "high", affectedUsers: 100, compromisedData: ["email"] },
    }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.notificationRequired, true);
    assert.ok(Array.isArray(r.result.timeline.immediate));
  });
});

// ── DSAR ───────────────────────────────────────────────────────────────────

describe("privacy.dsar* (data subject requests)", () => {
  it("submits, lists and advances a DSAR through its lifecycle", () => {
    const sub = call("dsarSubmit", ctxA, {}, { kind: "deletion", note: "remove me" });
    assert.equal(sub.ok, true);
    const id = sub.result.request.id;
    assert.equal(sub.result.request.status, "received");

    const list = call("dsarList", ctxA, {}, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.totalRequests, 1);
    assert.equal(list.result.openCount, 1);

    const adv = call("dsarAdvance", ctxA, {}, { dsarId: id, status: "completed" });
    assert.equal(adv.ok, true);
    assert.equal(adv.result.request.status, "completed");
    assert.ok(adv.result.request.resolvedAt);
  });

  it("rejects an invalid DSAR kind and an unknown id", () => {
    assert.equal(call("dsarSubmit", ctxA, {}, { kind: "nonsense" }).ok, false);
    assert.equal(call("dsarAdvance", ctxA, {}, { dsarId: "missing", status: "completed" }).ok, false);
  });

  it("isolates DSARs per user", () => {
    call("dsarSubmit", ctxA, {}, { kind: "access" });
    assert.equal(call("dsarList", ctxB, {}, {}).result.totalRequests, 0);
  });
});

// ── Per-lens sharing ───────────────────────────────────────────────────────

describe("privacy.lensSharing* (per-lens toggles)", () => {
  it("returns a full toggle grid with defaults", () => {
    const r = call("lensSharingGet", ctxA, {}, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.lenses.length > 0);
  });

  it("setting share implies read; rejects unknown lens", () => {
    const set = call("lensSharingSet", ctxA, {}, { lensId: "chat", share: true });
    assert.equal(set.ok, true);
    assert.equal(set.result.read, true);
    assert.equal(set.result.share, true);
    assert.equal(call("lensSharingSet", ctxA, {}, { lensId: "bogus", read: false }).ok, false);
  });
});

// ── Access log ─────────────────────────────────────────────────────────────

describe("privacy.accessLog / recordAccess", () => {
  it("records an access event and surfaces it in the log", () => {
    const rec = call("recordAccess", ctxA, {}, {
      actor: "chat-lens", operation: "read", dataCategory: "messages",
    });
    assert.equal(rec.ok, true);
    const log = call("accessLog", ctxA, {}, { limit: 10 });
    assert.equal(log.ok, true);
    assert.equal(log.result.totalEvents, 1);
    assert.equal(log.result.byOperation.read, 1);
  });
});

// ── Data export ────────────────────────────────────────────────────────────

describe("privacy.dataExport", () => {
  it("bundles all privacy sections with counts + a size estimate", () => {
    call("dsarSubmit", ctxA, {}, { kind: "access" });
    call("recordAccess", ctxA, {}, { actor: "world-lens", operation: "read" });
    const r = call("dataExport", ctxA, {}, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.bundle.spec, "concord-privacy-export/v1");
    assert.ok(r.result.totalRecords >= 2);
    assert.ok(r.result.estimatedBytes > 0);
  });
});

// ── Cookie banner config ───────────────────────────────────────────────────

describe("privacy.cookieConfig*", () => {
  it("returns a default config and persists an update with a consent string", () => {
    const got = call("cookieConfigGet", ctxA, {}, {});
    assert.equal(got.ok, true);
    assert.equal(got.result.config.categories.essential.locked, true);

    const set = call("cookieConfigSet", ctxA, {}, {
      config: { bannerEnabled: true, position: "modal", categories: { analytics: { enabled: true } } },
    });
    assert.equal(set.ok, true);
    assert.equal(set.result.config.position, "modal");
    assert.equal(set.result.config.categories.analytics.enabled, true);
    assert.equal(typeof set.result.config.consentString, "string");
  });
});

// ── Retention policy ───────────────────────────────────────────────────────

describe("privacy.retention*", () => {
  it("returns default policies and persists an override", () => {
    const got = call("retentionGet", ctxA, {}, {});
    assert.equal(got.ok, true);
    assert.ok(got.result.policies.length > 0);

    const set = call("retentionSet", ctxA, {}, {
      category: "chat_history", windowDays: 90, action: "anonymize",
    });
    assert.equal(set.ok, true);
    assert.equal(set.result.windowDays, 90);
    assert.equal(set.result.action, "anonymize");
    assert.equal(call("retentionSet", ctxA, {}, { category: "nope" }).ok, false);
  });
});

// ── Data-flow map ──────────────────────────────────────────────────────────

describe("privacy.flow* (third-party data-flow map)", () => {
  it("registers a flow, builds a graph and toggles it", () => {
    const reg = call("flowRegister", ctxA, {}, {
      destination: "peer.example.org", direction: "outbound",
    });
    assert.equal(reg.ok, true);
    const id = reg.result.flow.id;

    const map = call("flowMap", ctxA, {}, {});
    assert.equal(map.ok, true);
    assert.equal(map.result.outboundCount, 1);
    assert.ok(map.result.graph.nodes.length >= 2);
    assert.ok(map.result.graph.edges.length >= 1);

    const tog = call("flowToggle", ctxA, {}, { flowId: id, active: false });
    assert.equal(tog.ok, true);
    assert.equal(tog.result.flow.active, false);
  });

  it("rejects an empty destination and an unknown flow id", () => {
    assert.equal(call("flowRegister", ctxA, {}, { destination: "" }).ok, false);
    assert.equal(call("flowToggle", ctxA, {}, { flowId: "missing" }).ok, false);
  });
});
