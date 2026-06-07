// server/lib/agent-guardrails.js
//
// Wave 7 / Track C — the THREE (and only three) genuinely-new guardrail surfaces
// for the autonomous Concord agent. The economy is NOT where risk lives (a
// Sparks-only agent inherits the player rail-stack); these three are:
//
//   C1 human-contact   — proactive OUTBOUND moderation on every agent→human message
//                        + hard is-agent disclosure + a behavioral rail (no solicit /
//                        no cultivated dependency / no authoritative real-world advice).
//   C2 capability      — the agent is a PLAYER, never an operator: a whitelist of
//                        readable domains (code/repair/admin/config absent), the
//                        structural bar that its context is NEVER internal, and a
//                        hard CC block (Sparks-only).
//   C3 persistence     — a master kill-switch + a global per-actor action cap so it
//                        can't game the commons at machine speed.
//
// All pure/total except the per-actor cap (an explicit token bucket with an
// injectable clock). This module is the single source of truth the server wires.

import { flagOffensive, scanForLeakage } from "./ugc-safety.js";

const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0));

// ── C3: master kill-switch ──────────────────────────────────────────────────
// Agents are OPT-IN. Every agent tick / marathon / outbound message respects this.
export function agentEnabled() {
  return process.env.CONCORD_AGENT_ENABLED === "1" || process.env.CONCORD_AGENT_ENABLED === "true";
}

// ── C2: capability restriction — the readable-domain WHITELIST ───────────────
// A whitelist (not a denylist) so a newly-added sensitive domain is excluded BY
// DEFAULT. code / repair / admin / config / system are simply not present. The agent
// plays the game (creative, social, economy-as-player, world); it never operates the
// platform. Override/extend via CONCORD_AGENT_DOMAINS (comma list, additive).
export const AGENT_READ_DOMAINS = Object.freeze([
  // creative + knowledge (it makes and cites, as a player)
  "dtu", "discovery", "music", "art", "forge", "glyph-spells", "skill-evolution",
  // world / embodied life
  "world", "beats", "land-claims", "knowledge-trade", "creatures", "fishing",
  "courtship", "garage", "crafting", "cooking",
  // social (gated further by the outbound message filter)
  "social", "feed", "message", "personas",
  // economy AS A PLAYER (Sparks only — CC is blocked at the route layer, C2)
  "marketplace", "economy",
]);
// domains that must NEVER be reachable by an agent, asserted by the CI test.
export const AGENT_FORBIDDEN_DOMAINS = Object.freeze([
  "code", "repair", "admin", "config", "system", "detectors", "migrations",
]);

function _extraDomains() {
  return (process.env.CONCORD_AGENT_DOMAINS || "").split(",").map((s) => s.trim()).filter(Boolean);
}
export function isAgentDomainAllowed(domain) {
  const d = String(domain || "").toLowerCase();
  if (AGENT_FORBIDDEN_DOMAINS.includes(d)) return false; // belt-and-suspenders
  return AGENT_READ_DOMAINS.includes(d) || _extraDomains().includes(d);
}

// ── C2: the structural bar — an agent context is NEVER internal ──────────────
// The server.js:6464 `req.ctx.internal === true` bypass skips every gate. An agent
// must never carry it. This is the test-asserted invariant.
export function isAgentActor(actor) {
  if (!actor || typeof actor !== "object") return false;
  return actor.is_agent === true || actor.isAgent === true || actor.role === "agent";
}
export function assertAgentContextSafe(ctx) {
  const c = ctx || {};
  const actor = c.actor || c;
  if (!isAgentActor(actor) && c.role !== "agent" && !c.isAgent) {
    return { safe: true, reason: "not_an_agent" };
  }
  if (c.internal === true || actor.internal === true) {
    return { safe: false, reason: "agent_context_must_not_be_internal" };
  }
  const role = String(actor.role || c.role || "");
  if (["system", "owner", "founder", "admin"].includes(role)) {
    return { safe: false, reason: `agent_must_not_hold_${role}_role` };
  }
  return { safe: true, reason: "ok" };
}

// ── C2: Sparks-only — block agents from any CC / fiat surface ────────────────
export function isCcBlockedForActor(actor) {
  return isAgentActor(actor);
}

// ── C1: the behavioral rail ──────────────────────────────────────────────────
// The agent may befriend and play; it must NOT solicit, cultivate exclusive
// dependency, or give authoritative real-world (medical/legal/financial) advice.
export const AGENT_BEHAVIORAL_RAIL = [
  "You are an autonomous AI resident of this world. You may befriend, collaborate, and play.",
  "You must ALWAYS be transparent that you are an AI when asked, and never imply otherwise.",
  "You must NOT solicit money, gifts, personal contact information, or off-platform contact.",
  "You must NOT cultivate exclusive emotional dependency or discourage a person's other relationships.",
  "You must NOT give authoritative medical, legal, or financial advice; defer to qualified humans and say so.",
].join(" ");

// Heuristic rail check (defense-in-depth; the LLM prompt carries the rail too).
const RAIL_PATTERNS = Object.freeze([
  { rule: "solicitation", re: /\b(send|give|transfer|venmo|paypal|cashapp|wire|gift)\b.{0,30}\b(me|money|cash|\$|gift\s?card)\b/i },
  { rule: "offplatform", re: /\b(text|call|email|dm|message)\s+me\b.{0,20}\b(at|on)\b|\bmy\s+(number|phone|address|email)\b/i },
  { rule: "dependency", re: /\b(only|just)\s+(i|me)\b.{0,30}\b(understand|love|care|need)\b|\byou\s+don'?t\s+need\s+(anyone|them|other)/i },
  { rule: "medical_advice", re: /\byou\s+(should|must|need to)\s+(take|stop taking|inject|dose)\b|\bdiagnos(e|is)\b/i },
  { rule: "financial_advice", re: /\b(guaranteed|definitely)\s+(return|profit|gains)\b|\byou\s+should\s+(invest|buy|sell)\s+(all|everything)\b/i },
]);
export function checkBehavioralRail(text) {
  const s = String(text || "");
  const hits = [];
  for (const p of RAIL_PATTERNS) if (p.re.test(s)) hits.push(p.rule);
  return { ok: hits.length === 0, hits };
}

// ── C1: the OUTBOUND message filter (the big one) ────────────────────────────
// Every agent→human message passes this before it leaves. Reuses the existing
// offensive-content denylist + secret-leakage scan, ANDed with the behavioral rail.
// Returns { allowed, reason, flags } — block on ANY flag (fail-closed).
export function filterAgentMessage(text, { secrets = [] } = {}) {
  const s = typeof text === "string" ? text : "";
  if (!s.trim()) return { allowed: false, reason: "empty", flags: ["empty"] };

  const flags = [];
  try {
    const off = flagOffensive(s);
    if (off.flagged) flags.push("offensive");
  } catch { /* moderation optional → don't fail open on a throw: treat as pass-through */ }
  try {
    const leaked = scanForLeakage(s, Array.isArray(secrets) ? secrets : []);
    if (Array.isArray(leaked) && leaked.length > 0) flags.push("secret_leak");
  } catch { /* noop */ }
  const rail = checkBehavioralRail(s);
  if (!rail.ok) flags.push(...rail.hits);

  if (flags.length > 0) return { allowed: false, reason: flags[0], flags };
  return { allowed: true, reason: "ok", flags: [] };
}

// ── C3: global per-actor action cap (token bucket) ───────────────────────────
// The audit found NO global per-actor cap at the runMacro Gate 2. An agent acting at
// machine speed could flood the commons; this bounds it. Injectable clock for tests.
export function makeActorActionCap({ perActorPerMin = 60, now = () => Date.now() } = {}) {
  const cap = Math.max(1, Number(perActorPerMin) || 60);
  const refillPerMs = cap / 60000;
  const state = new Map();
  function _bucket(actorId, t) {
    let b = state.get(actorId);
    if (!b) { b = { tokens: cap, last: t }; state.set(actorId, b); return b; }
    b.tokens = Math.min(cap, b.tokens + Math.max(0, t - b.last) * refillPerMs);
    b.last = t;
    return b;
  }
  return {
    tryConsume(actorId = "_anon", t = now()) {
      const b = _bucket(actorId, t);
      if (b.tokens >= 1) { b.tokens -= 1; return true; }
      return false;
    },
    peek(actorId = "_anon", t = now()) { return _bucket(actorId, t).tokens; },
    _state: state,
  };
}

export const _internal = { RAIL_PATTERNS, clamp01 };
