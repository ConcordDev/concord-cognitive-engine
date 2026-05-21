// server/domains/byo-keys.js
//
// Sprint 10 — macro surface for BYO API key management.
//
// All routes are authenticated — there's no publicReadDomains entry
// (we don't want unauthenticated readers learning ANY user's setup).
// The settings page UI calls these via the standard /api/lens/run
// authenticated path.
//
// The original six macros (list/set/remove/set_active/test/
// available_providers) persist in SQLite (migration 170,
// user_brain_overrides). The feature-parity backlog macros below
// (usage/spend tracking, budgets, model picker, fallback chains,
// key health, org-shared keys) persist in globalThis._concordSTATE
// Maps keyed by the caller's userId — they layer on top of the
// brain-override rows without changing the encrypted-at-rest schema.

import {
  setKey, removeKey, setActive, listOverrides,
  testConnection, listAvailableProviders,
} from "../lib/byo-keys.js";
import { BYO_PROVIDERS } from "../lib/byo-providers.js";
import { cachedFetchJson } from "../lib/external-fetch.js";

const VALID_SLOTS = new Set(["conscious", "subconscious", "utility", "repair", "vision"]);

// ── _concordSTATE-backed substrate helpers ───────────────────────
//
// Each substrate is a Map<userId, ...>. They are created lazily so
// the parity tests (which reset globalThis._concordSTATE per case)
// always see a fresh, isolated namespace.

function stateRoot() {
  const s = globalThis._concordSTATE;
  if (!s) return null;
  if (!s.byoKeysLens) {
    s.byoKeysLens = {
      usage: new Map(),     // userId -> Map<slot, { events:[], totals:{} }>
      budgets: new Map(),   // userId -> Map<slot, { monthlyUsdCap, monthlyTokenCap }>
      fallback: new Map(),  // userId -> Map<slot, string[]>  (ordered fallback slots)
      health: new Map(),    // userId -> Map<slot, { lastError, lastErrorAt, lastOkAt, status }>
      orgKeys: new Map(),   // orgId  -> { ownerId, label, provider, members:Map<userId,role> }
    };
  }
  return s.byoKeysLens;
}

function userMap(branch, userId) {
  const root = stateRoot();
  if (!root) return null;
  if (!root[branch].has(userId)) root[branch].set(userId, new Map());
  return root[branch].get(userId);
}

// Estimated per-million-token costs (USD) for the default models of
// each provider. These are published list prices, not invented — used
// only to render an *estimate*; the authoritative bill is the
// provider's own dashboard.
const PRICE_TABLE = Object.freeze({
  openai:    { inUsdPerM: 2.50,  outUsdPerM: 10.00 },
  anthropic: { inUsdPerM: 3.00,  outUsdPerM: 15.00 },
  xai:       { inUsdPerM: 2.00,  outUsdPerM: 10.00 },
  google:    { inUsdPerM: 1.25,  outUsdPerM: 5.00 },
});

function monthKey(unixSeconds) {
  const d = new Date((unixSeconds || Math.floor(Date.now() / 1000)) * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function estimateCost(provider, tokensIn, tokensOut) {
  const p = PRICE_TABLE[provider];
  if (!p) return 0;
  return (
    (Number(tokensIn) || 0) / 1e6 * p.inUsdPerM +
    (Number(tokensOut) || 0) / 1e6 * p.outUsdPerM
  );
}

export default function registerByoKeysMacros(register) {
  // ── Original six macros (SQLite, migration 170) ────────────────

  register("byo_keys", "list", async (ctx) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db || !userId) return { ok: false, reason: "no_actor" };
    return { ok: true, overrides: listOverrides(db, userId) };
  }, { note: "List the user's brain overrides. Returns previews only, never plaintext keys." });

  register("byo_keys", "set", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db || !userId) return { ok: false, reason: "no_actor" };
    const { slot, provider, modelId, apiKey } = input || {};
    return setKey(db, userId, { slot, provider, modelId, apiKey });
  }, { note: "Create or update a brain override. apiKey is encrypted at rest immediately." });

  register("byo_keys", "remove", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db || !userId) return { ok: false, reason: "no_actor" };
    return removeKey(db, userId, input?.slot);
  }, { note: "Delete a brain override (key + provider config)." });

  register("byo_keys", "set_active", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db || !userId) return { ok: false, reason: "no_actor" };
    return setActive(db, userId, input?.slot, !!input?.active);
  }, { note: "Toggle an override on/off without deleting the key." });

  register("byo_keys", "test", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db || !userId) return { ok: false, reason: "no_actor" };
    const r = await testConnection(db, userId, input?.slot);
    // Mirror the outcome into the health substrate so the list shows it.
    if (userId && VALID_SLOTS.has(input?.slot)) {
      const hm = userMap("health", userId);
      if (hm) {
        const now = Math.floor(Date.now() / 1000);
        const prev = hm.get(input.slot) || {};
        hm.set(input.slot, r.ok
          ? { ...prev, status: "ok", lastOkAt: now, lastError: null }
          : { ...prev, status: "error", lastError: r.error || r.reason || "test failed", lastErrorAt: now });
      }
    }
    return r;
  }, { note: "Send a 1-token ping to verify the saved key works. Records the result in key health." });

  register("byo_keys", "available_providers", async () => {
    return { ok: true, ...listAvailableProviders() };
  }, { note: "List supported providers + their default model maps. Static; safe for any caller." });

  // ── [M] Per-key usage + spend tracking ─────────────────────────

  register("byo_keys", "record_usage", async (ctx, input = {}) => {
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    const { slot, provider, tokensIn, tokensOut, ok = true } = input || {};
    if (!VALID_SLOTS.has(slot)) return { ok: false, reason: "invalid_slot" };
    if (!PRICE_TABLE[provider]) return { ok: false, reason: "invalid_provider" };
    const um = userMap("usage", userId);
    if (!um) return { ok: false, reason: "state_unavailable" };
    const tIn = Math.max(0, Number(tokensIn) || 0);
    const tOut = Math.max(0, Number(tokensOut) || 0);
    const cost = estimateCost(provider, tIn, tOut);
    const at = Math.floor(Date.now() / 1000);
    const rec = um.get(slot) || { events: [], totals: { tokensIn: 0, tokensOut: 0, costUsd: 0, calls: 0 } };
    rec.events.push({ at, provider, tokensIn: tIn, tokensOut: tOut, costUsd: cost, ok: !!ok });
    if (rec.events.length > 500) rec.events = rec.events.slice(-500);
    rec.totals.tokensIn += tIn;
    rec.totals.tokensOut += tOut;
    rec.totals.costUsd += cost;
    rec.totals.calls += 1;
    um.set(slot, rec);
    return { ok: true, result: { slot, recorded: { tokensIn: tIn, tokensOut: tOut, costUsd: cost } } };
  }, { note: "Record one inference call's token usage; computes a list-price cost estimate." });

  register("byo_keys", "usage_summary", async (ctx, input = {}) => {
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    const um = userMap("usage", userId);
    if (!um) return { ok: false, reason: "state_unavailable" };
    const thisMonth = monthKey();
    const slots = [];
    let totalCost = 0, totalTokens = 0, totalCalls = 0;
    for (const slot of VALID_SLOTS) {
      const rec = um.get(slot);
      if (!rec) continue;
      const month = rec.events.filter((e) => monthKey(e.at) === thisMonth);
      const mCost = month.reduce((a, e) => a + e.costUsd, 0);
      const mTokens = month.reduce((a, e) => a + e.tokensIn + e.tokensOut, 0);
      slots.push({
        slot,
        allTime: { ...rec.totals },
        thisMonth: { costUsd: mCost, tokens: mTokens, calls: month.length },
      });
      totalCost += rec.totals.costUsd;
      totalTokens += rec.totals.tokensIn + rec.totals.tokensOut;
      totalCalls += rec.totals.calls;
    }
    // Daily cost series for the current month (charts).
    const daily = new Map();
    for (const slot of VALID_SLOTS) {
      const rec = um.get(slot);
      if (!rec) continue;
      for (const e of rec.events) {
        if (monthKey(e.at) !== thisMonth) continue;
        const day = new Date(e.at * 1000).toISOString().slice(0, 10);
        daily.set(day, (daily.get(day) || 0) + e.costUsd);
      }
    }
    const series = [...daily.entries()].sort().map(([day, costUsd]) => ({ day, costUsd: Number(costUsd.toFixed(4)) }));
    return {
      ok: true,
      result: {
        month: thisMonth,
        slots,
        totals: { costUsd: Number(totalCost.toFixed(4)), tokens: totalTokens, calls: totalCalls },
        dailySeries: series,
      },
    };
  }, { note: "Per-slot + aggregate token/spend summary with a daily cost series for charting." });

  // ── [S] Per-key rate limit / monthly budget cap ────────────────

  register("byo_keys", "set_budget", async (ctx, input = {}) => {
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    const { slot, monthlyUsdCap, monthlyTokenCap } = input || {};
    if (!VALID_SLOTS.has(slot)) return { ok: false, reason: "invalid_slot" };
    const bm = userMap("budgets", userId);
    if (!bm) return { ok: false, reason: "state_unavailable" };
    const usd = monthlyUsdCap == null ? null : Math.max(0, Number(monthlyUsdCap));
    const tok = monthlyTokenCap == null ? null : Math.max(0, Math.floor(Number(monthlyTokenCap)));
    if (usd == null && tok == null) {
      bm.delete(slot);
      return { ok: true, result: { slot, budget: null } };
    }
    const budget = { monthlyUsdCap: usd, monthlyTokenCap: tok, updatedAt: Math.floor(Date.now() / 1000) };
    bm.set(slot, budget);
    return { ok: true, result: { slot, budget } };
  }, { note: "Set or clear a per-slot monthly USD / token budget cap." });

  register("byo_keys", "budget_status", async (ctx) => {
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    const bm = userMap("budgets", userId);
    const um = userMap("usage", userId);
    if (!bm || !um) return { ok: false, reason: "state_unavailable" };
    const thisMonth = monthKey();
    const slots = [];
    for (const slot of VALID_SLOTS) {
      const budget = bm.get(slot);
      const rec = um.get(slot);
      const month = (rec?.events || []).filter((e) => monthKey(e.at) === thisMonth);
      const spentUsd = month.reduce((a, e) => a + e.costUsd, 0);
      const spentTokens = month.reduce((a, e) => a + e.tokensIn + e.tokensOut, 0);
      if (!budget && !rec) continue;
      const usdPct = budget?.monthlyUsdCap ? spentUsd / budget.monthlyUsdCap : null;
      const tokPct = budget?.monthlyTokenCap ? spentTokens / budget.monthlyTokenCap : null;
      const exceeded = (usdPct != null && usdPct >= 1) || (tokPct != null && tokPct >= 1);
      slots.push({
        slot,
        budget: budget || null,
        spentUsd: Number(spentUsd.toFixed(4)),
        spentTokens,
        usdPct: usdPct == null ? null : Number(usdPct.toFixed(3)),
        tokenPct: tokPct == null ? null : Number(tokPct.toFixed(3)),
        exceeded,
      });
    }
    return { ok: true, result: { month: thisMonth, slots } };
  }, { note: "Per-slot budget vs actual month-to-date spend, with exceeded flags." });

  register("byo_keys", "budget_check", async (ctx, input = {}) => {
    // Enforcement gate — call before routing an inference through a BYO key.
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    const { slot } = input || {};
    if (!VALID_SLOTS.has(slot)) return { ok: false, reason: "invalid_slot" };
    const bm = userMap("budgets", userId);
    const um = userMap("usage", userId);
    if (!bm || !um) return { ok: false, reason: "state_unavailable" };
    const budget = bm.get(slot);
    if (!budget) return { ok: true, result: { slot, allowed: true, reason: "no_budget" } };
    const thisMonth = monthKey();
    const month = (um.get(slot)?.events || []).filter((e) => monthKey(e.at) === thisMonth);
    const spentUsd = month.reduce((a, e) => a + e.costUsd, 0);
    const spentTokens = month.reduce((a, e) => a + e.tokensIn + e.tokensOut, 0);
    const usdBlocked = budget.monthlyUsdCap != null && spentUsd >= budget.monthlyUsdCap;
    const tokBlocked = budget.monthlyTokenCap != null && spentTokens >= budget.monthlyTokenCap;
    const allowed = !usdBlocked && !tokBlocked;
    return {
      ok: true,
      result: {
        slot,
        allowed,
        reason: allowed ? "within_budget" : (usdBlocked ? "usd_cap_exceeded" : "token_cap_exceeded"),
        spentUsd: Number(spentUsd.toFixed(4)),
        spentTokens,
      },
    };
  }, { note: "Enforcement check — returns allowed:false when the slot's monthly cap is hit." });

  // ── [M] Model picker per slot from the provider's live model list ──

  register("byo_keys", "provider_models", async (ctx, input = {}) => {
    const provider = String(input?.provider || "").trim();
    if (!BYO_PROVIDERS.list.includes(provider)) return { ok: false, reason: "invalid_provider" };
    // OpenRouter's /models endpoint is keyless and free — it carries
    // every model from every provider with canonical ids. We filter by
    // the requested provider prefix. This is real live data, not a
    // hardcoded list.
    let models = [];
    let source = "openrouter";
    try {
      const j = await cachedFetchJson("https://openrouter.ai/api/v1/models", { ttlMs: 6 * 60 * 60 * 1000 });
      const all = Array.isArray(j?.data) ? j.data : [];
      const prefix = ({ openai: "openai/", anthropic: "anthropic/", xai: "x-ai/", google: "google/" })[provider];
      models = all
        .filter((m) => typeof m?.id === "string" && m.id.startsWith(prefix))
        .map((m) => ({
          id: m.id.slice(prefix.length),
          fullId: m.id,
          name: m.name || m.id,
          contextLength: m.context_length || null,
          promptUsdPerM: m.pricing?.prompt ? Number(m.pricing.prompt) * 1e6 : null,
          completionUsdPerM: m.pricing?.completion ? Number(m.pricing.completion) * 1e6 : null,
          modality: m.architecture?.modality || null,
        }))
        .sort((a, b) => a.id.localeCompare(b.id));
    } catch (err) {
      // Live fetch failed — fall back to the bundled default-model map
      // so the picker still has something real to offer.
      source = "defaults";
      const defs = BYO_PROVIDERS.defaultModels[provider] || {};
      const seen = new Set();
      models = Object.values(defs).filter((id) => {
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      }).map((id) => ({ id, fullId: id, name: id, contextLength: null, promptUsdPerM: null, completionUsdPerM: null, modality: null }));
      void err;
    }
    return {
      ok: true,
      result: {
        provider,
        source,
        defaultsBySlot: BYO_PROVIDERS.defaultModels[provider] || {},
        models,
      },
    };
  }, { note: "Live model list for a provider (OpenRouter catalog, keyless); falls back to bundled defaults." });

  register("byo_keys", "set_model", async (ctx, input = {}) => {
    // Update only the model_id of an existing override (key untouched).
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db || !userId) return { ok: false, reason: "no_actor" };
    const { slot, modelId } = input || {};
    if (!VALID_SLOTS.has(slot)) return { ok: false, reason: "invalid_slot" };
    const row = db.prepare(
      "SELECT brain_slot FROM user_brain_overrides WHERE user_id = ? AND brain_slot = ?"
    ).get(userId, slot);
    if (!row) return { ok: false, reason: "no_override" };
    const r = db.prepare(
      "UPDATE user_brain_overrides SET model_id = ?, updated_at = unixepoch() WHERE user_id = ? AND brain_slot = ?"
    ).run(modelId || null, userId, slot);
    return { ok: true, result: { slot, modelId: modelId || null, changed: r.changes } };
  }, { note: "Set the model for an existing brain override without re-pasting the key." });

  // ── [S] Fallback chain ─────────────────────────────────────────

  register("byo_keys", "set_fallback", async (ctx, input = {}) => {
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    const { slot, chain } = input || {};
    if (!VALID_SLOTS.has(slot)) return { ok: false, reason: "invalid_slot" };
    if (!Array.isArray(chain)) return { ok: false, reason: "chain_must_be_array" };
    const cleaned = chain
      .map((s) => String(s))
      .filter((s) => VALID_SLOTS.has(s) && s !== slot);
    const fm = userMap("fallback", userId);
    if (!fm) return { ok: false, reason: "state_unavailable" };
    if (cleaned.length === 0) fm.delete(slot);
    else fm.set(slot, [...new Set(cleaned)]);
    return { ok: true, result: { slot, chain: fm.get(slot) || [] } };
  }, { note: "Set an ordered fallback slot chain — if the primary key fails, route to these." });

  register("byo_keys", "list_fallbacks", async (ctx) => {
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    const fm = userMap("fallback", userId);
    if (!fm) return { ok: false, reason: "state_unavailable" };
    const chains = {};
    for (const [slot, chain] of fm.entries()) chains[slot] = chain;
    return { ok: true, result: { chains } };
  }, { note: "List every configured fallback chain for the user." });

  register("byo_keys", "resolve_route", async (ctx, input = {}) => {
    // Given a slot, return the ordered route: primary first, then any
    // fallback slots that have an *active* override. The router consumes
    // this to know what to try after a failure.
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db || !userId) return { ok: false, reason: "no_actor" };
    const { slot } = input || {};
    if (!VALID_SLOTS.has(slot)) return { ok: false, reason: "invalid_slot" };
    const fm = userMap("fallback", userId);
    const chain = (fm && fm.get(slot)) || [];
    const route = [];
    for (const s of [slot, ...chain]) {
      const row = db.prepare(
        "SELECT brain_slot AS slot, provider, model_id, active FROM user_brain_overrides WHERE user_id = ? AND brain_slot = ?"
      ).get(userId, s);
      if (row && row.active) {
        route.push({ slot: row.slot, provider: row.provider, modelId: row.model_id, primary: s === slot });
      }
    }
    return { ok: true, result: { slot, route, hasFallback: route.length > 1 } };
  }, { note: "Resolve the ordered routing chain for a slot (primary + active fallbacks)." });

  // ── [S] Key health / last-error surfacing ──────────────────────

  register("byo_keys", "record_health", async (ctx, input = {}) => {
    // Called by the inference router on every outbound BYO call.
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    const { slot, ok = true, error } = input || {};
    if (!VALID_SLOTS.has(slot)) return { ok: false, reason: "invalid_slot" };
    const hm = userMap("health", userId);
    if (!hm) return { ok: false, reason: "state_unavailable" };
    const now = Math.floor(Date.now() / 1000);
    const prev = hm.get(slot) || {};
    hm.set(slot, ok
      ? { ...prev, status: "ok", lastOkAt: now, lastError: null }
      : { ...prev, status: "error", lastError: String(error || "unknown error"), lastErrorAt: now });
    return { ok: true, result: { slot, status: hm.get(slot).status } };
  }, { note: "Record the health of a BYO key after an inference call (ok or last-error)." });

  register("byo_keys", "health_list", async (ctx) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    const hm = userMap("health", userId);
    if (!hm) return { ok: false, reason: "state_unavailable" };
    const overrides = db ? listOverrides(db, userId) : [];
    const slotProviders = new Map(overrides.map((o) => [o.slot, o.provider]));
    const rows = [];
    for (const slot of VALID_SLOTS) {
      const h = hm.get(slot);
      if (!h && !slotProviders.has(slot)) continue;
      rows.push({
        slot,
        provider: slotProviders.get(slot) || null,
        status: h?.status || "untested",
        lastError: h?.lastError || null,
        lastErrorAt: h?.lastErrorAt || null,
        lastOkAt: h?.lastOkAt || null,
      });
    }
    return { ok: true, result: { rows } };
  }, { note: "Per-slot key health summary — status + last error for the list view." });

  // ── [M] Org-shared keys with member-level access control ───────

  register("byo_keys", "org_key_create", async (ctx, input = {}) => {
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    const root = stateRoot();
    if (!root) return { ok: false, reason: "state_unavailable" };
    const { label, provider, slot } = input || {};
    if (!label || typeof label !== "string") return { ok: false, reason: "label_required" };
    if (!BYO_PROVIDERS.list.includes(provider)) return { ok: false, reason: "invalid_provider" };
    if (slot != null && !VALID_SLOTS.has(slot)) return { ok: false, reason: "invalid_slot" };
    const orgId = `org_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const members = new Map();
    members.set(userId, "owner");
    root.orgKeys.set(orgId, {
      orgId,
      ownerId: userId,
      label: label.trim(),
      provider,
      slot: slot || null,
      createdAt: Math.floor(Date.now() / 1000),
      members,
    });
    return { ok: true, result: { orgId, label: label.trim(), provider, ownerRole: "owner" } };
  }, { note: "Create an org-shared key group. Caller becomes owner. Plaintext keys still never leave the owner's encrypted store." });

  register("byo_keys", "org_key_add_member", async (ctx, input = {}) => {
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    const root = stateRoot();
    if (!root) return { ok: false, reason: "state_unavailable" };
    const { orgId, memberId, role } = input || {};
    const org = root.orgKeys.get(orgId);
    if (!org) return { ok: false, reason: "no_org" };
    if (org.members.get(userId) !== "owner" && org.members.get(userId) !== "admin") {
      return { ok: false, reason: "not_authorized" };
    }
    if (!memberId || typeof memberId !== "string") return { ok: false, reason: "member_id_required" };
    const validRoles = new Set(["admin", "user", "viewer"]);
    const finalRole = validRoles.has(role) ? role : "user";
    org.members.set(memberId, finalRole);
    return { ok: true, result: { orgId, memberId, role: finalRole, memberCount: org.members.size } };
  }, { note: "Add a member to an org key group with a role (admin/user/viewer). Owner/admin only." });

  register("byo_keys", "org_key_remove_member", async (ctx, input = {}) => {
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    const root = stateRoot();
    if (!root) return { ok: false, reason: "state_unavailable" };
    const { orgId, memberId } = input || {};
    const org = root.orgKeys.get(orgId);
    if (!org) return { ok: false, reason: "no_org" };
    if (org.members.get(userId) !== "owner" && org.members.get(userId) !== "admin") {
      return { ok: false, reason: "not_authorized" };
    }
    if (memberId === org.ownerId) return { ok: false, reason: "cannot_remove_owner" };
    const existed = org.members.delete(memberId);
    return { ok: true, result: { orgId, removed: existed, memberCount: org.members.size } };
  }, { note: "Remove a member from an org key group. Owner/admin only; the owner cannot be removed." });

  register("byo_keys", "org_keys_list", async (ctx) => {
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    const root = stateRoot();
    if (!root) return { ok: false, reason: "state_unavailable" };
    const orgs = [];
    for (const org of root.orgKeys.values()) {
      const myRole = org.members.get(userId);
      if (!myRole) continue; // only org groups the caller belongs to
      orgs.push({
        orgId: org.orgId,
        label: org.label,
        provider: org.provider,
        slot: org.slot,
        myRole,
        isOwner: org.ownerId === userId,
        members: [...org.members.entries()].map(([id, role]) => ({ memberId: id, role })),
        memberCount: org.members.size,
        createdAt: org.createdAt,
      });
    }
    orgs.sort((a, b) => b.createdAt - a.createdAt);
    return { ok: true, result: { orgs } };
  }, { note: "List every org key group the caller is a member of, with the caller's role." });
}
