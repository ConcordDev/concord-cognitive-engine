// server/domains/studio-chord.js
//
// Studio Sprint A — Item #3: Chord Stamp Tool. Mint authored chord
// progressions as DTUs so the royalty cascade pays the author every
// time another producer cites or extends the progression.
//
// kind='chord_progression' — kind is unconstrained TEXT per migration
// 202, so no schema change is needed.

import crypto from "node:crypto";

const VALID_QUALITIES = new Set([
  "maj", "min", "7", "maj7", "min7", "sus2", "sus4",
  "dim", "dim7", "aug", "min7b5", "add9", "6", "min6",
]);
const VALID_MODES = new Set(["smooth", "melody-led", "bass-led"]);
const MAX_CHORDS_PER_PROGRESSION = 64;
const MAX_TITLE_LEN = 120;

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function validateProgression(progression) {
  if (!Array.isArray(progression) || progression.length === 0) return null;
  if (progression.length > MAX_CHORDS_PER_PROGRESSION) return null;
  const out = [];
  for (const c of progression) {
    if (!c || typeof c !== "object") return null;
    const root = Number(c.root);
    if (!Number.isInteger(root) || root < 0 || root > 127) return null;
    if (!VALID_QUALITIES.has(String(c.quality))) return null;
    const label = String(c.label || "").slice(0, 20);
    const notes = Array.isArray(c.notes)
      ? c.notes.filter(n => Number.isInteger(n) && n >= 0 && n <= 127).slice(0, 12)
      : [];
    const inversion = Number.isInteger(c.inversion) ? clamp(c.inversion, 0, 6) : 0;
    const variant = ["root", "inv1", "inv2", "inv3", "drop2", "drop3"].includes(c.variant)
      ? c.variant : "root";
    out.push({ root, quality: c.quality, label, notes, inversion, variant });
  }
  return out;
}

export default function registerStudioChordMacros(register) {
  // Mint a chord progression as a kind='chord_progression' DTU.
  // The DTU joins the same kind-agnostic royalty cascade as every
  // other authored thing, so citing it later flows CC to the author.
  register("studio", "mint_progression", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };

    const progression = validateProgression(input.progression);
    if (!progression) return { ok: false, reason: "invalid_progression" };

    const title = String(input.title || "Untitled Progression").trim().slice(0, MAX_TITLE_LEN);
    const keyRoot = Number.isInteger(input.keyRoot) ? clamp(input.keyRoot, 0, 127) : 60;
    const mode = input.mode === "minor" ? "minor" : "major";
    const voiceLeading = VALID_MODES.has(input.voiceLeading) ? input.voiceLeading : "smooth";
    const bpm = Number.isFinite(Number(input.bpm)) ? clamp(Number(input.bpm), 20, 400) : 120;
    const beatsPerChord = Number.isFinite(Number(input.beatsPerChord))
      ? clamp(Number(input.beatsPerChord), 0.25, 32) : 4;

    const meta = {
      title,
      type: "chord_progression",
      keyRoot,
      mode,
      voiceLeading,
      bpm,
      beatsPerChord,
      progression,
      composer: "user",
    };

    const dtuId = `cp_${crypto.randomUUID()}`;
    try {
      db.prepare(`
        INSERT INTO dtus (id, kind, title, creator_id, meta_json, created_at)
        VALUES (?, 'chord_progression', ?, ?, ?, unixepoch())
      `).run(dtuId, title, userId, JSON.stringify(meta));
    } catch (err) {
      return { ok: false, reason: "insert_failed", error: err?.message };
    }

    return { ok: true, dtuId, kind: "chord_progression", title, meta };
  }, { note: "mint an authored chord progression as a kind='chord_progression' DTU" });

  // Cite another producer's chord progression in your own track —
  // flows the royalty cascade exactly like every other citation.
  register("studio", "cite_progression", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    const childId = String(input.childDtuId || "").trim();
    const parentId = String(input.progressionDtuId || "").trim();
    if (!childId || !parentId) return { ok: false, reason: "missing_ids" };
    try {
      const cascade = await import("../economy/royalty-cascade.js");
      if (typeof cascade.registerCitation !== "function") {
        return { ok: false, reason: "cascade_unavailable" };
      }
      return await cascade.registerCitation(db, {
        childId, parentId, citerUserId: userId,
        weight: Number.isFinite(Number(input.weight)) ? Number(input.weight) : 1,
      });
    } catch (err) {
      return { ok: false, reason: "cite_failed", error: err?.message };
    }
  }, { note: "cite an existing chord-progression DTU from your own track" });

  // Read path — list the user's authored progressions.
  register("studio", "list_progressions", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    const limit = Math.min(200, Math.max(1, Number(input.limit) || 50));
    try {
      const rows = db.prepare(`
        SELECT id, title, meta_json, created_at FROM dtus
        WHERE kind = 'chord_progression' AND creator_id = ?
        ORDER BY created_at DESC LIMIT ?
      `).all(userId, limit);
      return {
        ok: true,
        progressions: rows.map(r => {
          let meta = {};
          try { meta = JSON.parse(r.meta_json || "{}"); } catch { /* meta optional */ }
          return { id: r.id, title: r.title, meta, created_at: r.created_at };
        }),
      };
    } catch (err) {
      return { ok: false, reason: "query_failed", error: err?.message };
    }
  }, { note: "list the user's authored chord progressions" });
}
