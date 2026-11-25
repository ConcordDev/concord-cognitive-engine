// server/domains/photos-darkroom.js
//
// The Darkroom — Photos as a real photo editor. Lens actions on the
// "photos" domain (beside the older gallery macros in domains/photos.js):
// the library with cull filters, ratings / flags / colour labels /
// keywords, the develop recipe and its history and snapshots, presets and
// copy/paste of settings across many photos, smart albums, and releases
// (free, or sold in Concord Coin through the one marketplace money path:
// dtu.create → marketplace.list → marketplace.purchaseWithRoyalties).
//
// Rendering lives in lib/darkroom (one pipeline for the live preview and
// the export); the HTTP side (upload, preview/thumb, export, release proof
// and download) is in routes/photos.js.

import {
  listLibrary, catalogSet, getEdit, saveEdit, snapshot, revertTo,
  listPresets, createPreset, deletePreset, applyToMany,
  createSmartAlbum, listAlbumsWithSmart, albumPhotos,
} from "../lib/darkroom/store.js";
import {
  prepareRelease, insertRelease, getRelease, releaseView, listReleases, canSee, ownsRelease,
} from "../lib/darkroom/releases.js";

const STATE = () => globalThis._concordSTATE;
const persistDtu = (d) => { try { globalThis._concordUpsertDTU?.(d); } catch { /* the in-memory copy still serves */ } };

export default function registerDarkroomActions(registerLensAction) {
  const me = (ctx) => { const id = ctx?.actor?.userId || ctx?.userId; return id && id !== "anon" ? String(id) : null; };
  const dbOf = (ctx) => ctx?.db || STATE()?.db || null;
  const signedIn = (fn) => async (ctx, _a, params = {}) => {
    const db = dbOf(ctx); if (!db) return { ok: false, error: "the photo store is unavailable" };
    const userId = me(ctx); if (!userId) return { ok: false, error: "sign in to use the darkroom" };
    try { return await fn(db, userId, params || {}, ctx); }
    catch (err) { return { ok: false, error: String(err?.message || err).slice(0, 200) }; }
  };
  const wrap = (r, key) => (r?.ok === false ? r : { ok: true, result: key ? { [key]: r } : r });
  const R = (r) => { if (!r || r.ok === false) return r || { ok: false, error: "failed" }; const { ok: _ok, ...rest } = r; return { ok: true, result: rest }; };

  // ── Library and culling ──
  registerLensAction("photos", "library", signedIn((db, uid, p) => wrap(listLibrary(db, uid, { ...(p.filter || {}), sort: p.sort }))));
  registerLensAction("photos", "photo", signedIn((db, uid, p) => {
    const r = getEdit(db, uid, String(p.id || ""));
    if (!r.ok) return r;
    const releases = db.prepare("SELECT * FROM photo_releases WHERE photo_id = ? AND user_id = ? ORDER BY published_at DESC").all(r.photo.id, uid).map((x) => releaseView(db, x, uid));
    return { ok: true, result: { photo: r.photo, edit: r.edit, history: r.history, releases } };
  }));
  registerLensAction("photos", "catalog-set", signedIn((db, uid, p) => R(catalogSet(db, uid, p.ids ?? p.id, p))));

  // ── Develop ──
  registerLensAction("photos", "edit-save", signedIn((db, uid, p) => R(saveEdit(db, uid, String(p.id || ""), p.edit, p.label))));
  registerLensAction("photos", "edit-revert", signedIn((db, uid, p) => R(revertTo(db, uid, String(p.id || ""), p.historyId))));
  registerLensAction("photos", "snapshot-create", signedIn((db, uid, p) => R(snapshot(db, uid, String(p.id || ""), p.name))));

  // ── Presets, paste, batch ──
  registerLensAction("photos", "preset-list", signedIn((db, uid) => ({ ok: true, result: { presets: listPresets(db, uid) } })));
  registerLensAction("photos", "preset-create", signedIn((db, uid, p) => R(createPreset(db, uid, p.name, p.edit))));
  registerLensAction("photos", "preset-delete", signedIn((db, uid, p) => R(deletePreset(db, uid, p.id))));
  registerLensAction("photos", "preset-apply", signedIn((db, uid, p) => R(applyToMany(db, uid, p.ids, { presetId: p.presetId, parts: p.parts }))));
  registerLensAction("photos", "settings-paste", signedIn((db, uid, p) => R(applyToMany(db, uid, p.ids, { fromPhotoId: p.fromPhotoId, parts: p.parts }))));

  // ── Albums (plain and smart) ──
  registerLensAction("photos", "album-index", signedIn((db, uid) => ({ ok: true, result: { albums: listAlbumsWithSmart(db, uid) } })));
  registerLensAction("photos", "album-smart-create", signedIn((db, uid, p) => R(createSmartAlbum(db, uid, p.name, p.rule))));
  registerLensAction("photos", "album-open", signedIn((db, uid, p) => R(albumPhotos(db, uid, p.albumId))));

  // ── Releases ──
  registerLensAction("photos", "release-create", signedIn(async (db, uid, p, ctx) => {
    const prep = prepareRelease(db, uid, p);
    if (!prep.ok) return prep;
    const rel = prep.rel;
    let dtuId = null;
    if (rel.price_cc > 0) {
      if (!ctx?.macro?.run) return { ok: false, error: "macro runtime unavailable" };
      const created = await ctx.macro.run("dtu", "create", {
        title: `${rel.title} — photograph · ${rel.id.slice(-6)}`, domain: "photos", source: "photo-release", tags: ["photo-release"],
        human: { summary: rel.description || `${rel.title}, a photograph.` },
        core: { definitions: [], claims: [], examples: [], invariants: [], nextActions: [] },
        meta: { type: "photograph", releaseId: rel.id, width: rel.width, height: rel.height },
      });
      if (!created?.ok || !created.dtu) return { ok: false, error: created?.error || "could not mint the photo's DTU" };
      const dtu = STATE()?.dtus?.get?.(created.dtu.id) || created.dtu;
      dtu.scope = "personal";
      dtu.license = { ...(dtu.license || {}), scopes: ["private", "marketplace_sale"] };
      const listed = await ctx.macro.run("marketplace", "list", { dtuId: dtu.id, price: rel.price_cc, currency: "CC", contentType: "photograph", title: rel.title, description: rel.description.slice(0, 500), tags: ["photo-release"] });
      if (!listed?.ok) return { ok: false, error: listed?.error || "could not list the photo" };
      persistDtu(dtu);
      dtuId = dtu.id;
    }
    const saved = insertRelease(db, rel, dtuId);
    return { ok: true, result: { release: releaseView(db, saved, uid) } };
  }));

  registerLensAction("photos", "release-list", async (ctx, _a, p = {}) => {
    const db = dbOf(ctx); if (!db) return { ok: false, error: "the photo store is unavailable" };
    const uid = me(ctx);
    if ((p.mine || p.owned) && !uid) return { ok: false, error: "sign in to see your releases" };
    return { ok: true, result: { releases: listReleases(db, uid, { mine: !!p.mine, owned: !!p.owned }) } };
  });

  registerLensAction("photos", "release-get", async (ctx, _a, p = {}) => {
    const db = dbOf(ctx); if (!db) return { ok: false, error: "the photo store is unavailable" };
    const uid = me(ctx);
    const rel = getRelease(db, String(p.id || ""));
    if (!canSee(db, rel, uid)) return { ok: false, error: "photo not found" };
    return { ok: true, result: { release: releaseView(db, rel, uid) } };
  });

  registerLensAction("photos", "release-buy", signedIn(async (db, uid, p, ctx) => {
    const rel = getRelease(db, String(p.id || ""));
    if (!rel || rel.status !== "published") return { ok: false, error: "photo not found" };
    if (rel.user_id === uid) return { ok: false, error: "this is your own photo" };
    if (ownsRelease(db, rel, uid)) return { ok: false, error: "already in your library" };
    if (!(rel.price_cc > 0)) return { ok: false, error: "this photo is free: just download it" };
    if (!ctx?.macro?.run) return { ok: false, error: "macro runtime unavailable" };
    const paid = await ctx.macro.run("marketplace", "purchaseWithRoyalties", { dtuId: rel.dtu_id });
    if (!paid?.ok) {
      if (paid?.error === "insufficient_balance") return { ok: false, error: `not enough Concord Coin: this photo is ${rel.price_cc} CC and you have ${Math.round((Number(paid.balance) || 0) * 100) / 100} CC`, reason: "insufficient_balance" };
      return { ok: false, error: paid?.error || "the purchase did not go through" };
    }
    db.prepare("INSERT OR IGNORE INTO photo_release_owners (release_id, user_id, price_cc) VALUES (?, ?, ?)").run(rel.id, uid, rel.price_cc);
    return { ok: true, result: { release: releaseView(db, rel, uid), price: rel.price_cc } };
  }));

  registerLensAction("photos", "release-update", signedIn((db, uid, p) => {
    const rel = getRelease(db, String(p.id || ""));
    if (!rel || rel.user_id !== uid) return { ok: false, error: "photo not found" };
    const sets = [], args = [];
    if (p.title !== undefined) { const t = String(p.title || "").trim().slice(0, 160); if (!t) return { ok: false, error: "title required" }; sets.push("title = ?"); args.push(t); }
    if (p.description !== undefined) { sets.push("description = ?"); args.push(String(p.description || "").trim().slice(0, 1000)); }
    if (p.priceCC !== undefined) {
      const v = Number(p.priceCC);
      if (typeof p.priceCC !== "number" || !Number.isFinite(v) || v < 0.5 || v > 1000 || Math.round(v * 100) / 100 !== v) return { ok: false, error: "priceCC must be from 0.5 to 1000 CC, in cents" };
      if (!(rel.price_cc > 0)) return { ok: false, error: "a free photo stays free; release it again to sell it" };
      const dtu = STATE()?.dtus?.get?.(rel.dtu_id);
      if (dtu?.marketplace) { dtu.marketplace.price = v; persistDtu(dtu); }
      sets.push("price_cc = ?"); args.push(v);
    }
    if (!sets.length) return { ok: false, error: "nothing to change" };
    db.prepare(`UPDATE photo_releases SET ${sets.join(", ")} WHERE id = ?`).run(...args, rel.id);
    return { ok: true, result: { release: releaseView(db, getRelease(db, rel.id), uid) } };
  }));

  registerLensAction("photos", "release-withdraw", signedIn((db, uid, p) => {
    const rel = getRelease(db, String(p.id || ""));
    if (!rel || rel.user_id !== uid) return { ok: false, error: "photo not found" };
    if (rel.status !== "published") return { ok: false, error: "already withdrawn" };
    db.prepare("UPDATE photo_releases SET status = 'withdrawn' WHERE id = ?").run(rel.id);
    if (rel.price_cc > 0) { const dtu = STATE()?.dtus?.get?.(rel.dtu_id); if (dtu?.marketplace) { dtu.marketplace.listed = false; persistDtu(dtu); } }
    return { ok: true, result: { release: releaseView(db, getRelease(db, rel.id), uid) } };
  }));

}
