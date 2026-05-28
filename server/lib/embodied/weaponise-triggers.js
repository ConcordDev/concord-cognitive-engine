// server/lib/embodied/weaponise-triggers.js
//
// T2.1 — weaponise_at consumption.
//
// Authored NPCs carry `narrative_context.weaponise_at`, a one-line trigger:
//   "Befriend Kit; the pact's details surface."
//   "Bring Kor to Taro; the Sifu's secret resurfaces, with consequences."
//   "Expose Jin and the patrol loses its only competent officer."
//   "Cross-reference Brann and Kiren; the impossible-print arc crosses worlds."
//
// These were dead content — mined for cold-start stress (T1.3) but never fired.
// This module parses the prose into a structured trigger, seeds it at boot, and
// fires it once when the player satisfies the condition, surfacing the payoff
// as a citable `kind='revelation'` DTU and a `weaponise:fired` socket event.
//
// Determinism: the parser keys on the leading verb + named capitalised
// entities; the signature is a sha1 of (npcId|kind|consequence) so seeding is
// idempotent and a trigger fires exactly once.
//
// Secret-omission invariant (narrative-bridge.js:105): the *secret* never
// enters an LLM prompt. Weaponising is the authored moment the secret becomes
// public to the *player*, so we surface a short excerpt in the revelation DTU's
// human layer — but it is never piped into any brain prompt.

import crypto from "node:crypto";

export const BEFRIEND_OPINION_THRESHOLD = 45; // NPC→player opinion that reads as "befriended"

const STOP = new Set([
  "Befriend", "Bring", "Expose", "Cross-reference", "Cross", "Cut", "Burn",
  "Both", "Four", "The", "Court", "Quarter",
]);

/** Extract capitalised proper-noun tokens (candidate NPC names) from prose. */
function properNouns(text) {
  const out = [];
  const re = /\b([A-Z][a-z]{2,})\b/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (!STOP.has(m[1])) out.push(m[1]);
  }
  return [...new Set(out)];
}

/**
 * Parse a weaponise_at line into a structured trigger.
 * Returns { kind, requires, consequence } — kind is one of
 * befriend | convene | expose | cross_reference | narrative.
 * `narrative` is the catch-all for prose we can't bind to a player action; it's
 * still persisted (so authors see it tracked) but only fires manually.
 */
export function parseWeaponiseTrigger(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  // Consequence = everything after the first ';' (or the whole line).
  const semi = raw.indexOf(";");
  const condition = semi >= 0 ? raw.slice(0, semi).trim() : raw;
  const consequence = semi >= 0 ? raw.slice(semi + 1).trim() : raw;
  const lower = condition.toLowerCase();
  const names = properNouns(condition);

  // Cross-reference X and Y
  if (/^cross-reference\b/i.test(condition) && names.length >= 2) {
    return { kind: "cross_reference", requires: { names: names.slice(0, 2) }, consequence };
  }
  // Befriend X
  if (/^befriend\b/i.test(condition) && names.length >= 1) {
    return { kind: "befriend", requires: { name: names[0] }, consequence };
  }
  // Expose X / Expose the chain/truce/route
  if (/^expose\b/i.test(condition)) {
    return { kind: "expose", requires: { name: names[0] || null, what: lower.replace(/^expose\s+/, "").trim() }, consequence };
  }
  // Bring X to Y / Bring X and Y together / Bring them together
  if (/^bring\b/i.test(condition)) {
    if (names.length >= 2) return { kind: "convene", requires: { names: names.slice(0, 2) }, consequence };
    return { kind: "narrative", requires: { hint: "convene" }, consequence };
  }
  return { kind: "narrative", requires: {}, consequence };
}

function signatureFor(npcId, kind, consequence) {
  return crypto.createHash("sha1").update(`${npcId}|${kind}|${consequence}`).digest("hex").slice(0, 24);
}

function tableExists(db, name) {
  try {
    return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name);
  } catch { return false; }
}

/**
 * Resolve a parsed `requires.name` (a proper noun from the prose) to an actual
 * NPC id in the same world, by case-insensitive name prefix match. Returns the
 * id or null. Best-effort — the trigger still seeds with the raw name.
 */
export function resolveNpcIdByName(db, worldId, name) {
  if (!db || !name || !tableExists(db, "world_npcs")) return null;
  try {
    const row = db.prepare(`
      SELECT id FROM world_npcs
      WHERE world_id = ? AND LOWER(name) LIKE LOWER(?) LIMIT 1
    `).get(worldId, `${name}%`);
    return row?.id || null;
  } catch { return null; }
}

/**
 * Seed one NPC's weaponise trigger. Idempotent on signature. Reads
 * narrative_context.weaponise_at + narrative_context.secret (for the excerpt).
 */
export function seedWeaponiseTrigger(db, npc, defaultWorldId = "concordia-hub") {
  if (!db || !npc?.id || !tableExists(db, "weaponise_triggers")) return { ok: false, reason: "unavailable" };
  const nc = (npc.narrative_context && typeof npc.narrative_context === "object" && !Array.isArray(npc.narrative_context))
    ? npc.narrative_context : {};
  if (!nc.weaponise_at) return { ok: false, reason: "no_trigger" };

  const parsed = parseWeaponiseTrigger(nc.weaponise_at);
  if (!parsed) return { ok: false, reason: "unparseable" };

  const worldId = npc.world_id || defaultWorldId;
  // Resolve any named NPC to a live id (best-effort) so firing can match it.
  const requires = { ...parsed.requires };
  if (requires.name) requires.resolvedId = resolveNpcIdByName(db, worldId, requires.name);
  if (Array.isArray(requires.names)) {
    requires.resolvedIds = requires.names.map((n) => resolveNpcIdByName(db, worldId, n)).filter(Boolean);
  }

  const sig = signatureFor(npc.id, parsed.kind, parsed.consequence);
  const secretExcerpt = nc.secret ? String(nc.secret).slice(0, 240) : null;

  try {
    db.prepare(`
      INSERT INTO weaponise_triggers
        (id, npc_id, world_id, trigger_kind, requires_json, consequence_text, secret_excerpt, signature)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(signature) DO UPDATE SET
        requires_json    = excluded.requires_json,
        consequence_text = excluded.consequence_text,
        secret_excerpt   = COALESCE(weaponise_triggers.secret_excerpt, excluded.secret_excerpt)
    `).run(
      `wt_${sig}`, npc.id, worldId, parsed.kind,
      JSON.stringify(requires), parsed.consequence, secretExcerpt, sig,
    );
    return { ok: true, kind: parsed.kind, signature: sig };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/** Seed every authored NPC's weaponise trigger. Returns the count seeded. */
export function seedAllWeaponiseTriggers(db, npcs, defaultWorldId = "concordia-hub") {
  let seeded = 0;
  for (const npc of npcs || []) {
    try {
      const r = seedWeaponiseTrigger(db, npc, defaultWorldId);
      if (r?.ok) seeded++;
    } catch { /* per-NPC best-effort */ }
  }
  return seeded;
}

/**
 * Fire a trigger: mark it fired, mint a citable revelation DTU surfacing the
 * authored consequence (+ secret excerpt in the human layer), and emit a
 * `weaponise:fired` socket event. Idempotent — a fired trigger is skipped.
 * Returns { ok, fired, revelationDtuId? }.
 */
export function fireTrigger(db, triggerRow, { userId = null, io = null } = {}) {
  if (!db || !triggerRow) return { ok: false, reason: "no_trigger" };
  if (triggerRow.fired_at) return { ok: true, fired: false, reason: "already_fired" };

  const dtuId = `rev_${crypto.randomUUID().slice(0, 16)}`;
  const human = [
    `A long-held secret surfaces. ${triggerRow.consequence_text}`,
    triggerRow.secret_excerpt ? `What was hidden: ${triggerRow.secret_excerpt}` : null,
  ].filter(Boolean).join(" ");

  let revelationDtuId = null;
  try {
    const tx = db.transaction(() => {
      // Mint the revelation DTU when the dtus table exists (player-facing,
      // citable; never a prompt input).
      if (tableExists(db, "dtus")) {
        db.prepare(`
          INSERT INTO dtus (id, creator_id, type, title, data, created_at)
          VALUES (?, ?, 'revelation', ?, ?, unixepoch())
        `).run(
          dtuId,
          triggerRow.npc_id,
          `Revelation: ${triggerRow.consequence_text.slice(0, 80)}`,
          JSON.stringify({
            kind: "revelation",
            human,
            npcId: triggerRow.npc_id,
            worldId: triggerRow.world_id,
            triggerKind: triggerRow.trigger_kind,
            firedBy: userId,
          }),
        );
        revelationDtuId = dtuId;
      }
      db.prepare(`
        UPDATE weaponise_triggers
        SET fired_at = unixepoch(), fired_by_user = ?, revelation_dtu = ?
        WHERE signature = ? AND fired_at IS NULL
      `).run(userId, revelationDtuId, triggerRow.signature);
    });
    tx();
  } catch (e) {
    return { ok: false, reason: e.message };
  }

  try {
    io?.to?.(`world:${triggerRow.world_id}`).emit("weaponise:fired", {
      npcId: triggerRow.npc_id,
      worldId: triggerRow.world_id,
      triggerKind: triggerRow.trigger_kind,
      consequence: triggerRow.consequence_text,
      revelationDtuId,
      firedBy: userId,
      ts: Date.now(),
    });
  } catch { /* socket optional */ }

  return { ok: true, fired: true, revelationDtuId };
}

/**
 * Consume befriend triggers: when an NPC's opinion of the player crosses the
 * befriend threshold, fire any unfired `befriend` trigger that names this NPC
 * (the befriended NPC is the gate, the secret-holder is the trigger owner —
 * "Befriend Kit; the pact's details surface" means befriending Kit fires the
 * trigger owned by whoever holds the pact). We match by resolvedId == befriended
 * NPC, or by the trigger's own npc_id == befriended NPC (self-reveal authors).
 */
export function checkBefriendTriggers(db, { userId, worldId, befriendedNpcId, opinionScore, io = null }) {
  if (!db || !tableExists(db, "weaponise_triggers")) return { fired: [] };
  if (!Number.isFinite(opinionScore) || opinionScore < BEFRIEND_OPINION_THRESHOLD) return { fired: [] };

  let rows = [];
  try {
    rows = db.prepare(`
      SELECT * FROM weaponise_triggers
      WHERE world_id = ? AND trigger_kind = 'befriend' AND fired_at IS NULL
    `).all(worldId);
  } catch { return { fired: [] }; }

  const fired = [];
  for (const row of rows) {
    let requires = {};
    try { requires = JSON.parse(row.requires_json || "{}"); } catch { /* */ }
    const matchesBefriended =
      requires.resolvedId === befriendedNpcId || row.npc_id === befriendedNpcId;
    if (!matchesBefriended) continue;
    const r = fireTrigger(db, row, { userId, io });
    if (r.ok && r.fired) fired.push({ signature: row.signature, npcId: row.npc_id, revelationDtuId: r.revelationDtuId });
  }
  return { fired };
}

/**
 * Consume expose triggers: when a scheme involving an NPC is exposed/discovered,
 * fire any unfired `expose` trigger naming that NPC.
 */
export function checkExposeTriggers(db, { userId, worldId, exposedNpcId, io = null }) {
  if (!db || !tableExists(db, "weaponise_triggers") || !exposedNpcId) return { fired: [] };
  let rows = [];
  try {
    rows = db.prepare(`
      SELECT * FROM weaponise_triggers
      WHERE world_id = ? AND trigger_kind = 'expose' AND fired_at IS NULL
    `).all(worldId);
  } catch { return { fired: [] }; }

  const fired = [];
  for (const row of rows) {
    let requires = {};
    try { requires = JSON.parse(row.requires_json || "{}"); } catch { /* */ }
    if (requires.resolvedId !== exposedNpcId && row.npc_id !== exposedNpcId) continue;
    const r = fireTrigger(db, row, { userId, io });
    if (r.ok && r.fired) fired.push({ signature: row.signature, npcId: row.npc_id, revelationDtuId: r.revelationDtuId });
  }
  return { fired };
}
