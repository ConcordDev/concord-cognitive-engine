// server/tests/byo-keys-domain-parity.test.js
//
// Tier-2 contract tests for server/domains/byo-keys.js feature-parity macros.
//
// The original six macros (list/set/remove/set_active/test/available_providers)
// persist in SQLite (migration 170, user_brain_overrides). The parity-backlog
// macros below — usage/spend tracking, monthly budgets, live model picker,
// fallback chains, key health, and org-shared keys — persist in
// globalThis._concordSTATE Maps keyed by the caller's userId.
//
// One test (or group) per parity macro. Pins the { ok } envelope, per-user
// isolation, enforcement behaviour, and the never-leak invariant.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import registerByoKeysMacros from "../domains/byo-keys.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(`byo_keys.${name}`);
  if (!fn) throw new Error(`byo_keys.${name} not registered`);
  return fn(ctx, input);
}

before(() => { registerByoKeysMacros(register); });

let db;

function seed() {
  // Fresh STATE so the parity-substrate Maps don't leak between cases.
  globalThis._concordSTATE = { dtus: new Map() };
  db = new Database(":memory:");
  // user_brain_overrides — mirrors migration 170.
  db.prepare(`
    CREATE TABLE user_brain_overrides (
      user_id        TEXT    NOT NULL,
      brain_slot     TEXT    NOT NULL,
      provider       TEXT    NOT NULL,
      model_id       TEXT,
      encrypted_key  BLOB,
      key_preview    TEXT,
      active         INTEGER NOT NULL DEFAULT 1,
      created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at     INTEGER NOT NULL DEFAULT (unixepoch()),
      last_used_at   INTEGER,
      PRIMARY KEY (user_id, brain_slot)
    )
  `).run();
}

function addOverride(userId, slot, provider, modelId, active = 1) {
  db.prepare(`
    INSERT INTO user_brain_overrides
      (user_id, brain_slot, provider, model_id, key_preview, active)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(userId, slot, provider, modelId, "sk-...abcd", active);
}

beforeEach(() => { seed(); });

const ctxA = { actor: { userId: "user_a" }, userId: "user_a", get db() { return db; } };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b", get db() { return db; } };

// ── [M] Per-key usage + spend tracking ─────────────────────────────

describe("byo_keys — usage + spend tracking", () => {
  it("record_usage computes a list-price cost estimate", async () => {
    const r = await call("record_usage", ctxA, {
      slot: "conscious", provider: "anthropic", tokensIn: 1_000_000, tokensOut: 0,
    });
    assert.equal(r.ok, true);
    // anthropic input is $3.00 / M tokens
    assert.equal(Number(r.result.recorded.costUsd.toFixed(2)), 3.0);
  });

  it("record_usage rejects an invalid slot / provider", async () => {
    assert.equal((await call("record_usage", ctxA, { slot: "bogus", provider: "openai" })).ok, false);
    assert.equal((await call("record_usage", ctxA, { slot: "utility", provider: "bogus" })).ok, false);
  });

  it("usage_summary aggregates totals + a daily cost series", async () => {
    await call("record_usage", ctxA, { slot: "conscious", provider: "openai", tokensIn: 500_000, tokensOut: 100_000 });
    await call("record_usage", ctxA, { slot: "utility", provider: "google", tokensIn: 200_000, tokensOut: 50_000 });
    const r = await call("usage_summary", ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.totals.calls, 2);
    assert.ok(r.result.totals.costUsd > 0);
    assert.equal(r.result.slots.length, 2);
    assert.ok(Array.isArray(r.result.dailySeries));
    assert.equal(r.result.dailySeries.length, 1); // both calls land on today
  });

  it("INVARIANT: usage is scoped per-user", async () => {
    await call("record_usage", ctxA, { slot: "conscious", provider: "openai", tokensIn: 1000, tokensOut: 0 });
    const b = await call("usage_summary", ctxB);
    assert.equal(b.ok, true);
    assert.equal(b.result.totals.calls, 0);
  });
});

// ── [S] Per-key monthly budget cap with enforcement ────────────────

describe("byo_keys — budget caps + enforcement", () => {
  it("set_budget stores a USD + token cap", async () => {
    const r = await call("set_budget", ctxA, { slot: "conscious", monthlyUsdCap: 25, monthlyTokenCap: 5_000_000 });
    assert.equal(r.ok, true);
    assert.equal(r.result.budget.monthlyUsdCap, 25);
    assert.equal(r.result.budget.monthlyTokenCap, 5_000_000);
  });

  it("set_budget with null caps clears the budget", async () => {
    await call("set_budget", ctxA, { slot: "utility", monthlyUsdCap: 10 });
    const r = await call("set_budget", ctxA, { slot: "utility", monthlyUsdCap: null, monthlyTokenCap: null });
    assert.equal(r.ok, true);
    assert.equal(r.result.budget, null);
  });

  it("budget_status reports spend vs cap with pct + exceeded flag", async () => {
    await call("set_budget", ctxA, { slot: "conscious", monthlyUsdCap: 3 });
    await call("record_usage", ctxA, { slot: "conscious", provider: "anthropic", tokensIn: 1_000_000, tokensOut: 0 });
    const r = await call("budget_status", ctxA);
    const row = r.result.slots.find((s) => s.slot === "conscious");
    assert.equal(row.spentUsd, 3);
    assert.equal(row.usdPct, 1);
    assert.equal(row.exceeded, true);
  });

  it("budget_check enforcement gate blocks once the cap is hit", async () => {
    await call("set_budget", ctxA, { slot: "conscious", monthlyUsdCap: 3 });
    let chk = await call("budget_check", ctxA, { slot: "conscious" });
    assert.equal(chk.result.allowed, true);
    await call("record_usage", ctxA, { slot: "conscious", provider: "anthropic", tokensIn: 1_000_000, tokensOut: 0 });
    chk = await call("budget_check", ctxA, { slot: "conscious" });
    assert.equal(chk.result.allowed, false);
    assert.equal(chk.result.reason, "usd_cap_exceeded");
  });

  it("budget_check allows freely when no budget is set", async () => {
    const chk = await call("budget_check", ctxA, { slot: "repair" });
    assert.equal(chk.result.allowed, true);
    assert.equal(chk.result.reason, "no_budget");
  });
});

// ── [M] Model picker per slot from a live model list ───────────────

describe("byo_keys — live model picker", () => {
  it("provider_models rejects an unknown provider", async () => {
    const r = await call("provider_models", ctxA, { provider: "not-a-provider" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_provider");
  });

  it("provider_models falls back to bundled defaults when the live fetch fails", async () => {
    globalThis.fetch = async () => { throw new Error("network disabled"); };
    const r = await call("provider_models", ctxA, { provider: "anthropic" });
    assert.equal(r.ok, true);
    assert.equal(r.result.source, "defaults");
    assert.ok(r.result.models.length > 0);
  });

  it("provider_models parses a live OpenRouter catalog response", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        data: [
          { id: "anthropic/claude-3-opus", name: "Claude 3 Opus", context_length: 200000,
            pricing: { prompt: "0.000015", completion: "0.000075" }, architecture: { modality: "text" } },
          { id: "openai/gpt-4o", name: "GPT-4o" },
        ],
      }),
    });
    const r = await call("provider_models", ctxA, { provider: "anthropic" });
    assert.equal(r.ok, true);
    assert.equal(r.result.source, "openrouter");
    assert.equal(r.result.models.length, 1); // only the anthropic/ row
    assert.equal(r.result.models[0].id, "claude-3-opus");
    assert.equal(r.result.models[0].contextLength, 200000);
  });

  it("set_model updates an existing override without touching the key", async () => {
    addOverride("user_a", "conscious", "anthropic", "claude-3-haiku");
    const r = await call("set_model", ctxA, { slot: "conscious", modelId: "claude-3-opus" });
    assert.equal(r.ok, true);
    assert.equal(r.result.changed, 1);
    const row = db.prepare("SELECT model_id FROM user_brain_overrides WHERE user_id='user_a' AND brain_slot='conscious'").get();
    assert.equal(row.model_id, "claude-3-opus");
  });

  it("set_model rejects when there is no override for the slot", async () => {
    const r = await call("set_model", ctxA, { slot: "vision", modelId: "x" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_override");
  });
});

// ── [S] Fallback chain ─────────────────────────────────────────────

describe("byo_keys — fallback chains", () => {
  it("set_fallback stores an ordered, de-duped chain and excludes self", async () => {
    const r = await call("set_fallback", ctxA, {
      slot: "conscious", chain: ["subconscious", "utility", "subconscious", "conscious"],
    });
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.chain, ["subconscious", "utility"]);
  });

  it("set_fallback rejects a non-array chain", async () => {
    const r = await call("set_fallback", ctxA, { slot: "conscious", chain: "subconscious" });
    assert.equal(r.ok, false);
  });

  it("list_fallbacks returns every configured chain", async () => {
    await call("set_fallback", ctxA, { slot: "conscious", chain: ["utility"] });
    await call("set_fallback", ctxA, { slot: "repair", chain: ["utility", "subconscious"] });
    const r = await call("list_fallbacks", ctxA);
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.chains.conscious, ["utility"]);
    assert.deepEqual(r.result.chains.repair, ["utility", "subconscious"]);
  });

  it("resolve_route returns primary first then only active fallbacks", async () => {
    addOverride("user_a", "conscious", "anthropic", "claude-3-opus", 1);
    addOverride("user_a", "utility", "openai", "gpt-4o-mini", 1);
    addOverride("user_a", "subconscious", "google", "gemini-flash", 0); // inactive — skipped
    await call("set_fallback", ctxA, { slot: "conscious", chain: ["subconscious", "utility"] });
    const r = await call("resolve_route", ctxA, { slot: "conscious" });
    assert.equal(r.ok, true);
    assert.equal(r.result.hasFallback, true);
    assert.equal(r.result.route.length, 2); // primary + utility (subconscious inactive)
    assert.equal(r.result.route[0].primary, true);
    assert.equal(r.result.route[1].slot, "utility");
  });
});

// ── [S] Key health / last-error surfacing ──────────────────────────

describe("byo_keys — key health", () => {
  it("record_health stores an ok then an error state", async () => {
    let r = await call("record_health", ctxA, { slot: "conscious", ok: true });
    assert.equal(r.result.status, "ok");
    r = await call("record_health", ctxA, { slot: "conscious", ok: false, error: "401 unauthorized" });
    assert.equal(r.result.status, "error");
  });

  it("health_list surfaces the last error per slot", async () => {
    addOverride("user_a", "conscious", "anthropic", "claude-3-opus");
    await call("record_health", ctxA, { slot: "conscious", ok: false, error: "rate limited" });
    const r = await call("health_list", ctxA);
    assert.equal(r.ok, true);
    const row = r.result.rows.find((x) => x.slot === "conscious");
    assert.equal(row.status, "error");
    assert.equal(row.lastError, "rate limited");
    assert.equal(row.provider, "anthropic");
  });

  it("health_list reports untested for an override with no health record", async () => {
    addOverride("user_a", "vision", "google", "gemini-pro-vision");
    const r = await call("health_list", ctxA);
    const row = r.result.rows.find((x) => x.slot === "vision");
    assert.equal(row.status, "untested");
  });
});

// ── [M] Org-shared keys with member-level access control ───────────

describe("byo_keys — org-shared keys", () => {
  it("org_key_create makes the caller the owner", async () => {
    const r = await call("org_key_create", ctxA, { label: "Team Anthropic", provider: "anthropic" });
    assert.equal(r.ok, true);
    assert.equal(r.result.ownerRole, "owner");
    assert.ok(r.result.orgId.startsWith("org_"));
  });

  it("org_key_create rejects a missing label / invalid provider", async () => {
    assert.equal((await call("org_key_create", ctxA, { provider: "anthropic" })).ok, false);
    assert.equal((await call("org_key_create", ctxA, { label: "X", provider: "bogus" })).ok, false);
  });

  it("org_key_add_member is owner/admin gated", async () => {
    const org = (await call("org_key_create", ctxA, { label: "Team", provider: "openai" })).result;
    // user_b (not a member) cannot add members.
    const denied = await call("org_key_add_member", ctxB, { orgId: org.orgId, memberId: "user_c", role: "user" });
    assert.equal(denied.ok, false);
    assert.equal(denied.reason, "not_authorized");
    // owner can.
    const ok = await call("org_key_add_member", ctxA, { orgId: org.orgId, memberId: "user_c", role: "viewer" });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.role, "viewer");
    assert.equal(ok.result.memberCount, 2);
  });

  it("org_key_remove_member cannot remove the owner", async () => {
    const org = (await call("org_key_create", ctxA, { label: "Team", provider: "openai" })).result;
    const r = await call("org_key_remove_member", ctxA, { orgId: org.orgId, memberId: "user_a" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "cannot_remove_owner");
  });

  it("org_keys_list only returns groups the caller belongs to", async () => {
    const org = (await call("org_key_create", ctxA, { label: "A-team", provider: "openai" })).result;
    await call("org_key_add_member", ctxA, { orgId: org.orgId, memberId: "user_b", role: "user" });
    const a = await call("org_keys_list", ctxA);
    const b = await call("org_keys_list", ctxB);
    assert.equal(a.result.orgs.length, 1);
    assert.equal(a.result.orgs[0].isOwner, true);
    assert.equal(b.result.orgs.length, 1);
    assert.equal(b.result.orgs[0].isOwner, false);
    assert.equal(b.result.orgs[0].myRole, "user");
  });
});

// ── envelope / no-actor guards ─────────────────────────────────────

describe("byo_keys — actor guards", () => {
  it("parity macros fail cleanly without an actor", async () => {
    const anon = { get db() { return db; } };
    for (const m of ["record_usage", "usage_summary", "set_budget", "budget_status",
      "budget_check", "set_fallback", "list_fallbacks", "resolve_route",
      "record_health", "health_list", "org_key_create", "org_keys_list"]) {
      const r = await call(m, anon, { slot: "conscious", provider: "openai", label: "x" });
      assert.equal(r.ok, false, `${m} should fail without actor`);
    }
  });
});
