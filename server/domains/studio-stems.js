// server/domains/studio-stems.js
//
// Studio Sprint C Item #4 — stem splitter macro surface.
//
// Input: audio path or audio DTU id.
// Output: 4 stem DTUs (kind='audio_stem', meta.stem_role in
// {vocals, drums, bass, other}, meta.parent_audio_dtu_id for
// lineage so the cascade pays the source-track creator on stem
// usage).

import crypto from "node:crypto";
import { splitStems } from "../lib/studio/stem-splitter.js";

const MAX_AUDIO_PATH_LEN = 1024;

export default function registerStudioStemMacros(register) {
  register("studio", "split_audio", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };

    let inputPath = input.audio_path ? String(input.audio_path).slice(0, MAX_AUDIO_PATH_LEN) : null;
    let parentAudioDtuId = input.parent_audio_dtuId ? String(input.parent_audio_dtuId) : null;
    let parentTitle = null;

    if (parentAudioDtuId) {
      let row;
      try { row = db.prepare("SELECT id, creator_id, title, meta_json FROM dtus WHERE id = ?").get(parentAudioDtuId); }
      catch { /* dtus optional */ }
      if (!row) return { ok: false, reason: "parent_audio_not_found" };
      parentTitle = row.title;
      // Try to find a local file path in meta.
      try {
        const meta = JSON.parse(row.meta_json || "{}");
        if (!inputPath && typeof meta.audio_path === "string") inputPath = meta.audio_path;
      } catch { /* meta optional */ }
      if (!inputPath) return { ok: false, reason: "parent_audio_has_no_path" };
    }
    if (!inputPath) return { ok: false, reason: "audio_path_required" };

    const split = splitStems({ inputPath });
    if (!split.ok) return split;

    // Mint one DTU per stem.
    const stemDtus = [];
    try {
      for (const role of Object.keys(split.stems)) {
        const stemId = `stm_${crypto.randomUUID()}`;
        const title = parentTitle ? `${parentTitle} — ${role}` : `Stem (${role})`;
        const meta = {
          type: "audio_stem",
          stem_role: role,
          audio_path: split.stems[role],
          parent_audio_dtu_id: parentAudioDtuId || null,
          source_sha1: split.cachedSha,
          from_cache: split.fromCache,
        };
        db.prepare(`
          INSERT INTO dtus (id, kind, title, creator_id, meta_json, created_at)
          VALUES (?, 'audio_stem', ?, ?, ?, unixepoch())
        `).run(stemId, title, userId, JSON.stringify(meta));
        stemDtus.push({ id: stemId, role, path: split.stems[role] });
      }
    } catch (err) {
      return { ok: false, reason: "stem_dtu_insert_failed", error: err?.message };
    }

    // Register cascade citations from each stem → parent track DTU
    // when one was supplied. Best-effort.
    if (parentAudioDtuId && stemDtus.length > 0) {
      try {
        const cascade = await import("../economy/royalty-cascade.js");
        const parent = db.prepare("SELECT id, creator_id FROM dtus WHERE id = ?").get(parentAudioDtuId);
        if (parent && cascade?.registerCitation) {
          for (const s of stemDtus) {
            try {
              cascade.registerCitation(db, {
                childId: s.id, parentId: parent.id,
                creatorId: userId, parentCreatorId: parent.creator_id,
                parentDtu: { ...parent, visibility: "public" },
                generation: 1,
              });
            } catch { /* per-stem cascade best-effort */ }
          }
        }
      } catch { /* cascade optional */ }
    }

    return {
      ok: true,
      cachedSha: split.cachedSha,
      fromCache: split.fromCache,
      durationMs: split.durationMs,
      stems: stemDtus,
    };
  }, { note: "split an audio file into 4 stems via Demucs and mint each as a DTU", destructive: false });

  register("studio", "stems_status", async (_ctx, _input = {}) => {
    const { MODALITY } = await import("../lib/modality-config.js");
    return {
      ok: true,
      available: !!MODALITY.stems?.enabled,
      backend: MODALITY.stems?.backend || null,
      stats: { ...(MODALITY.stems?.stats || {}) },
    };
  }, { note: "report stem splitter availability + last error" });
}
