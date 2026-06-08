// server/lib/confined-ctx.js
//
// Phase 2 — the confined-`ctx` capability sandbox (the safety foundation that
// gates the ConKay build loop). Authority is bounded by what code can *reach*:
// a confined context exposes ONLY an allowlisted macro surface + the LLM + a
// per-user scoped KV — never the raw `db`, never `mintCoins`, never core FS,
// never another user's data. Cross-user/host harm is *unrepresentable*, not
// merely forbidden (object-capability + per-user scoping).
//
// One mechanism, two faces:
//   • security  — "you can only reach the allowlisted surface"
//   • builder   — `ctx.sdk` is a batteries-included, audited, offline SDK
//                 (the allowlisted macros + a scoped KV + the bundled deps).
//
// Built ON TOP of the existing agent-fence (lib/agent-guardrails.js): the
// confined actor is an agent actor (so the server's own runMacro fence + the
// structural "never internal/privileged" bars also apply — defense in depth),
// and the readable-domain whitelist is reused so a newly-added sensitive domain
// is excluded BY DEFAULT.

import {
  AGENT_FORBIDDEN_DOMAINS,
  isAgentDomainAllowed,
  assertAgentContextSafe,
  makeActorActionCap,
} from "./agent-guardrails.js";

const FORBIDDEN = new Set(AGENT_FORBIDDEN_DOMAINS);

// Hard denylist regardless of manifest — privileged money/identity movers. (Most
// are already lib-only, not macros; this is belt-and-suspenders.)
const NEVER_ALLOW = new Set([
  "economy.mint", "economy.withdraw", "economy.transfer",
  "admin.*", "config.*",
]);

/**
 * Compile a capability manifest (list of grant strings) into a (domain,name)
 * matcher. Default-deny: a confined program reaches ONLY what its manifest
 * grants. Grants: "domain.*" or bare "domain" (whole domain), or "domain.macro".
 */
export function compileManifest(grants = []) {
  const exact = new Set();
  const domains = new Set();
  for (const g of Array.isArray(grants) ? grants : []) {
    const s = String(g || "").trim().toLowerCase();
    if (!s) continue;
    if (s.endsWith(".*")) domains.add(s.slice(0, -2));
    else if (s.includes(".")) exact.add(s);
    else domains.add(s);
  }
  return (domain, name) => {
    const d = String(domain || "").toLowerCase();
    const n = String(name || "").toLowerCase();
    return domains.has(d) || exact.has(`${d}.${n}`);
  };
}

/**
 * Build the confined context.
 * @param {object} o
 * @param {string}   o.userId    — the only identity the program can act as.
 * @param {Function} o.runMacro  — the REAL runMacro(domain,name,input,ctx) (DI).
 * @param {object}   [o.llm]     — { chat } (optional).
 * @param {object}   [o.db]      — used ONLY by the scoped KV; never exposed raw.
 * @param {object}   [o.manifest]— { macros: [grant...] } capability declaration.
 * @param {object}   [o.actionCap] — a makeActorActionCap() bucket (shared optional).
 * @returns a frozen ctx: { userId, actor, llm?, runMacro, sdk, confined:true }.
 */
export function makeConfinedCtx({ userId, runMacro, llm, db, manifest, actionCap } = {}) {
  if (!userId) throw new Error("makeConfinedCtx: userId required");
  if (typeof runMacro !== "function") throw new Error("makeConfinedCtx: runMacro required");

  const grants = manifest?.macros || manifest?.grants || [];
  const allow = compileManifest(grants);
  const cap = actionCap || makeActorActionCap({ perActorPerMin: 120 });

  // A confined actor IS an agent actor (hits the server fence) and is NEVER
  // internal/privileged — pinned by assertAgentContextSafe.
  const actor = Object.freeze({
    userId, role: "agent", is_agent: true, internal: false,
    scopes: ["read", "write"], confined: true,
  });

  async function confinedRunMacro(domain, name, input = {}) {
    const d = String(domain || "").toLowerCase();
    const n = String(name || "");
    const key = `${d}.${n}`;
    if (FORBIDDEN.has(d) || !isAgentDomainAllowed(d)) {
      return { ok: false, error: "capability_denied", reason: `domain '${d}' is not reachable from a confined context` };
    }
    if (NEVER_ALLOW.has(key) || NEVER_ALLOW.has(`${d}.*`)) {
      return { ok: false, error: "capability_denied", reason: `'${key}' is hard-denied (privileged)` };
    }
    if (!allow(d, n)) {
      return { ok: false, error: "capability_denied", reason: `'${key}' is not granted by the capability manifest` };
    }
    if (!cap.tryConsume(userId)) {
      return { ok: false, error: "rate_limited", retryAfterMs: 1000 };
    }
    // Delegate to the REAL runMacro with the confined actor. We hand it the actor
    // + userId + llm — NEVER a db handle, mintCoins, or internal flag.
    return runMacro(d, n, input, { actor, userId, llm });
  }

  const sdk = makeConcordSdk({ userId, db, runMacro: confinedRunMacro, llm });

  return Object.freeze({
    userId,
    actor,
    llm: llm ? Object.freeze({ chat: (...a) => llm.chat(...a) }) : undefined,
    runMacro: confinedRunMacro,
    sdk,
    confined: true,
  });
}

// The "Concord-as-stdlib" builder surface — the only things confined code holds.
export function makeConcordSdk({ userId, db, runMacro, llm }) {
  return Object.freeze({
    // Allowlisted macro access (already gated by confinedRunMacro).
    macro: runMacro,
    // LLM (fluency) — bounded surface, no raw provider handle.
    llm: llm ? Object.freeze({ chat: (...a) => llm.chat(...a) }) : undefined,
    // Per-user scoped KV — the only persistence; NO raw SQL escapes, PK-scoped to
    // userId so it can't address another user's data.
    kv: makeScopedKv({ userId, db }),
    // The audited, bundled UI deps lens code may compose with (names only — the
    // actual modules are imported client-side; this is the catalog, not a handle).
    deps: Object.freeze([
      "three", "@react-three/fiber", "@react-three/drei", "@react-three/postprocessing",
      "monaco-editor", "yjs", "zustand", "gsap", "simple-peer",
    ]),
  });
}

function makeScopedKv({ userId, db }) {
  const has = () => {
    if (!db) return false;
    try { db.prepare("SELECT 1 FROM confined_kv LIMIT 1").get(); return true; } catch { return false; }
  };
  return Object.freeze({
    get(key) {
      if (!has()) return null;
      const row = db.prepare("SELECT value_json FROM confined_kv WHERE user_id = ? AND key = ?").get(userId, String(key));
      if (!row) return null;
      try { return JSON.parse(row.value_json); } catch { return null; }
    },
    set(key, value) {
      if (!has()) return false;
      db.prepare(
        `INSERT INTO confined_kv (user_id, key, value_json, updated_at)
         VALUES (?, ?, ?, unixepoch())
         ON CONFLICT(user_id, key) DO UPDATE SET value_json = excluded.value_json, updated_at = unixepoch()`,
      ).run(userId, String(key), JSON.stringify(value ?? null));
      return true;
    },
    keys() {
      if (!has()) return [];
      return db.prepare("SELECT key FROM confined_kv WHERE user_id = ?").all(userId).map((r) => r.key);
    },
    delete(key) {
      if (!has()) return false;
      return db.prepare("DELETE FROM confined_kv WHERE user_id = ? AND key = ?").run(userId, String(key)).changes > 0;
    },
  });
}

/** Test/assert helper: is this a properly-confined context? */
export function assertConfined(ctx) {
  if (!ctx || ctx.confined !== true) return { ok: false, reason: "not_confined" };
  if ("db" in ctx) return { ok: false, reason: "raw_db_exposed" };
  if ("mintCoins" in ctx || (ctx.sdk && "mintCoins" in ctx.sdk)) return { ok: false, reason: "mint_exposed" };
  const safe = assertAgentContextSafe(ctx);
  if (!safe.safe) return { ok: false, reason: safe.reason };
  return { ok: true, reason: "ok" };
}
