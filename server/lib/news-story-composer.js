// server/lib/news-story-composer.js
//
// Phase II Wave 21 — auto-compose news stories from emergent events.
//
// Reads the highest-impact events that have happened recently across
// the substrate (scheme reveals, faction wars, sports results,
// realm decrees, dynasty successions, election outcomes, crime
// bounties, religious crusades) and composes a news story DTU per
// event grounded in the event payload — never inventing facts the
// event didn't carry.
//
// Mirrors the lattice-quest-composer pattern: deterministic baseline
// + optional LLM enhancement (CONCORD_NEWS_LLM=true) routed through
// the subconscious brain for cheap composition. Failures fall back
// to the deterministic prose.

import crypto from "node:crypto";

const EVENT_SOURCES = Object.freeze([
  { kind: "scheme_revealed",      table: "npc_schemes",       since: 3600 * 24,     limit: 5  },
  { kind: "faction_war_declared", table: "faction_strategy_log", since: 3600 * 24 * 2, limit: 5 },
  { kind: "realm_decree",         table: "realm_decrees",     since: 3600 * 24,     limit: 5  },
  { kind: "dynasty_succession",   table: "npc_legacies",      since: 3600 * 24 * 3, limit: 3  },
  { kind: "lattice_alert",        table: "lattice_drift_alerts", since: 3600 * 12, limit: 3  },
]);

// Legibility W3 — human-readable cause phrases for the trigger tags the faction
// strategy engine stamps onto each move (faction-strategy.js#_triggerFor).
const TRIGGER_PHRASE = Object.freeze({
  retaliation: "in retaliation",
  expansion_collision: "as expansion turned to collision",
  momentum_collapse: "after their momentum collapsed",
  shared_interest: "on a shared interest",
  ambition: "out of naked ambition",
  rout: "in the middle of a rout",
  overextension: "having overextended",
  consolidation: "to consolidate",
  opportunity: "seizing an opening",
});

const HEADLINE_TEMPLATES = {
  scheme_revealed: [
    "Scheme uncovered in {context}",
    "{npc} caught plotting {context}",
    "Plot exposed: {npc}'s {context}",
  ],
  faction_war_declared: [
    "{a} declares war on {b}",
    "Hostilities open between {a} and {b}",
    "{a} and {b} now at war",
  ],
  realm_decree: [
    "Realm announces {context}",
    "New decree: {context}",
    "{npc} signs {context} into law",
  ],
  dynasty_succession: [
    "{heir} inherits from {npc}",
    "{npc} passes; {heir} ascends",
    "Succession: {heir} takes the seat of {npc}",
  ],
  lattice_alert: [
    "Substrate strain detected: {context}",
    "Lattice flag: {context}",
    "Concord substrate warns of {context}",
  ],
};

function pickDeterministicTemplate(kind, signature) {
  const templates = HEADLINE_TEMPLATES[kind] || ["{context}"];
  const hash = crypto.createHash("sha1").update(String(signature)).digest();
  const idx = hash[0] % templates.length;
  return templates[idx];
}

function fillTemplate(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? "—"));
}

/* ───────── Event harvesters ────────────────────────────────────────── */

function harvestSchemeReveals(db, sinceUnix, limit) {
  const exists = tableExists(db, "npc_schemes");
  if (!exists) return [];
  // A scheme is "revealed" when it resolves to the 'exposed' phase.
  return db.prepare(`
    SELECT id, plotter_id AS npc_id, kind AS scheme_kind, target_id, resolved_at AS revealed_at
    FROM npc_schemes
    WHERE phase = 'exposed' AND resolved_at IS NOT NULL AND resolved_at >= ?
    ORDER BY resolved_at DESC
    LIMIT ?
  `).all(sinceUnix, limit).map((r) => ({
    kind: "scheme_revealed",
    sourceId: r.id,
    signature: `scheme:${r.id}`,
    vars: { npc: r.npc_id, context: r.scheme_kind, target: r.target_id },
    timestamp: r.revealed_at,
  }));
}

function harvestFactionWars(db, sinceUnix, limit) {
  const exists = tableExists(db, "faction_strategy_log");
  if (!exists) return [];
  return db.prepare(`
    SELECT id, faction_id, move AS move_kind, target_id, payload_json, occurred_at AS executed_at
    FROM faction_strategy_log
    WHERE move IN ('DECLARE_WAR','RAID') AND occurred_at >= ?
    ORDER BY occurred_at DESC
    LIMIT ?
  `).all(sinceUnix, limit).map((r) => {
    // Legibility W3 — show the cause, not just the effect. Read the trigger the
    // strategy engine stamped (retaliation / expansion_collision / …) so the
    // story reads "War Declared — retaliation" rather than a bare move name.
    let trigger = null;
    try { trigger = JSON.parse(r.payload_json || "{}").trigger ?? null; } catch { /* default */ }
    const cause = TRIGGER_PHRASE[trigger] || r.move_kind.toLowerCase().replace(/_/g, " ");
    return {
      kind: "faction_war_declared",
      sourceId: r.id,
      signature: `war:${r.id}`,
      vars: { a: r.faction_id, b: r.target_id, move: r.move_kind, context: cause, trigger },
      timestamp: r.executed_at,
    };
  });
}

function harvestRealmDecrees(db, sinceUnix, limit) {
  const exists = tableExists(db, "realm_decrees");
  if (!exists) return [];
  return db.prepare(`
    SELECT id, kingdom_id AS realm_id, kind AS decree_kind,
           json_extract(body_json, '$.title') AS title, issued_at,
           issued_by_id AS issued_by_npc_id
    FROM realm_decrees
    WHERE issued_at >= ? AND issued_by_kind = 'npc'
    ORDER BY issued_at DESC
    LIMIT ?
  `).all(sinceUnix, limit).map((r) => ({
    kind: "realm_decree",
    sourceId: r.id,
    signature: `decree:${r.id}`,
    vars: { npc: r.issued_by_npc_id, context: r.title || r.decree_kind },
    timestamp: r.issued_at,
  }));
}

function harvestDynastySuccessions(db, sinceUnix, limit) {
  const exists = tableExists(db, "npc_legacies") && tableExists(db, "npc_inheritance_links");
  if (!exists) return [];
  // Heir linkage lives in npc_inheritance_links; legacy death time is died_at.
  return db.prepare(`
    SELECT l.id, l.npc_id, il.heir_npc_id, l.died_at AS composed_at
    FROM npc_legacies l
    JOIN npc_inheritance_links il ON il.deceased_npc_id = l.npc_id
    WHERE l.died_at >= ? AND il.heir_npc_id IS NOT NULL
    ORDER BY l.died_at DESC
    LIMIT ?
  `).all(sinceUnix, limit).map((r) => ({
    kind: "dynasty_succession",
    sourceId: r.id,
    signature: `succession:${r.id}`,
    vars: { npc: r.npc_id, heir: r.heir_npc_id, context: "succession" },
    timestamp: r.composed_at,
  }));
}

function harvestLatticeAlerts(db, sinceUnix, limit) {
  const exists = tableExists(db, "lattice_drift_alerts");
  if (!exists) return [];
  return db.prepare(`
    SELECT id, drift_type, severity, signature, detected_at
    FROM lattice_drift_alerts
    WHERE severity IN ('HIGH','CRITICAL') AND detected_at >= ?
    ORDER BY detected_at DESC
    LIMIT ?
  `).all(sinceUnix, limit).map((r) => ({
    kind: "lattice_alert",
    sourceId: r.id,
    signature: `lattice:${r.signature}`,
    vars: { context: r.drift_type.replace(/_/g, " ") },
    timestamp: r.detected_at,
  }));
}

function tableExists(db, name) {
  const r = db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name);
  return !!r;
}

/* ───────── Composition ─────────────────────────────────────────────── */

/**
 * Compose a news-story DTU from one harvested event. Idempotent on
 * (kind, sourceId) signature — re-running the same event returns
 * { ok: true, alreadyComposed: true }.
 */
export function composeStoryFromEvent(db, event, options = {}) {
  if (!event?.kind || !event?.sourceId) return { ok: false, reason: "invalid_event" };
  // Idempotency: check if a DTU with this signature already exists
  const tagSig = `news:${event.kind}:${event.sourceId}`;
  const existing = db.prepare(`
    SELECT id FROM dtus WHERE tags_json LIKE ? LIMIT 1
  `).get(`%"${tagSig}"%`);
  if (existing) return { ok: true, alreadyComposed: true, dtuId: existing.id };

  const template = pickDeterministicTemplate(event.kind, event.signature || event.sourceId);
  const headline = fillTemplate(template, event.vars || {});
  const body = options.composer === "llm" && options.llmBody
    ? options.llmBody
    : `${headline}.\n\nReported by the Concord lattice.`;

  const dtuId = `news_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const tags = [
    "news_story",
    `news:${event.kind}`,
    tagSig,
    "auto_composed",
  ];
  const bodyJson = JSON.stringify({
    type: "news_story",
    kind: event.kind,
    headline,
    body,
    eventSourceId: event.sourceId,
    composer: options.composer || "deterministic",
    eventTimestamp: event.timestamp,
  });

  db.prepare(`
    INSERT INTO dtus (id, owner_user_id, title, body_json, tags_json, visibility, tier)
    VALUES (?, NULL, ?, ?, ?, 'public', 'regular')
  `).run(dtuId, headline.slice(0, 200), bodyJson, JSON.stringify(tags));

  return { ok: true, dtuId, kind: event.kind, headline };
}

/**
 * Run one composition pass: harvest every event source, compose stories
 * for any new events. Returns a summary of what was composed.
 */
export function runNewsComposePass(db, options = {}) {
  const now = Math.floor(Date.now() / 1000);
  const harvested = [];
  for (const src of EVENT_SOURCES) {
    const since = now - src.since;
    let rows = [];
    try {
      switch (src.kind) {
        case "scheme_revealed":      rows = harvestSchemeReveals(db, since, src.limit); break;
        case "faction_war_declared": rows = harvestFactionWars(db, since, src.limit); break;
        case "realm_decree":         rows = harvestRealmDecrees(db, since, src.limit); break;
        case "dynasty_succession":   rows = harvestDynastySuccessions(db, since, src.limit); break;
        case "lattice_alert":        rows = harvestLatticeAlerts(db, since, src.limit); break;
      }
    } catch {
      /* table may not exist in some test envs; skip */
    }
    harvested.push(...rows);
  }

  const composed = [];
  for (const event of harvested) {
    const r = composeStoryFromEvent(db, event, options);
    if (r.ok && !r.alreadyComposed) composed.push(r);
  }
  return {
    ok: true,
    harvested: harvested.length,
    composed: composed.length,
    skippedExisting: harvested.length - composed.length,
    stories: composed,
  };
}

export function listRecentStories(db, opts = {}) {
  const limit = Math.max(1, Math.min(200, Number(opts.limit) || 50));
  const kind = opts.kind ? String(opts.kind) : null;
  const where = kind ? "AND tags_json LIKE ?" : "";
  const args = kind ? [`%"news:${kind}"%`, limit] : [limit];
  return db.prepare(`
    SELECT id, title, body_json, created_at FROM dtus
    WHERE tags_json LIKE '%news_story%' ${where}
    ORDER BY created_at DESC LIMIT ?
  `).all(...args);
}
