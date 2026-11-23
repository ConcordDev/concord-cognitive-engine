// server/domains/dtus-binder.js
//
// The Binder (the DTUs lens): every DTU is a card on a shelf.
//
//   shelf-facets      how many cards each shelf holds (hidden shelves counted too, so nothing is secretly dropped)
//   shelf-browse      a page of cards: default shelves are the valuable ones (works, specs, documents,
//                     knowledge); data, records, parts and system only when asked for
//   card-get          the front and the back: claims, sources, check receipt, lineage, why it's on its shelf
//   card-design       the owner designs how the card looks (frame, palette, accent, layout, art, type)
//   card-connections  cards that connect to this one, each with the reason (links, shared sources,
//                     shared terms; a complementary pair is a fusion candidate)
//   card-fuse         make a new card from two, crediting both (lineage → royalties on sale)
//   card-remix        build on one card: a new draft that credits it
//   card-check        run the verification gate's real checkers on the card's claims; stores the receipt
//   card-publish      publish through the gated lattice publish; card-unpublish takes it down
//
// Reads go through the same visibility rule as the DTU list routes
// (globalThis._concordUserVisibleDTUs); nothing here can show a DTU its viewer may not read.

import { shelfOf, SHELVES, DEFAULT_SHELVES, HIDDEN_SHELVES, needsPublishCheck } from "../lib/dtu-shelf.js";
import { publishGateDenial, currentReceipt, bodyHashOf } from "../lib/dtu-publish-gate.js";
import { verifyCandidate } from "../lib/verify-gate/gate.js";
import { candidateOf } from "../lib/verify-gate/service.js";
import { collectWebSources } from "../lib/dtu-grounding.js";
import { dtuListedOwner } from "../lib/dtu-list-source.js";

const STATE = () => globalThis._concordSTATE;
const persist = (d) => { try { globalThis._concordUpsertDTU?.(d); } catch { /* in-memory copy still serves */ } };
const actorOf = (ctx) => { const id = ctx?.actor?.userId || ctx?.actor?.id || ctx?.userId || null; return id && id !== "anon" && id !== "anonymous" ? String(id) : null; };
const ID_RE = /^[A-Za-z0-9_:.-]{3,160}$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

export const FRAMES = Object.freeze(["plain", "gilt", "ink", "neon", "field", "blueprint"]);
export const PALETTES = Object.freeze(["paper", "midnight", "ember", "sea", "moss", "rose", "slate", "sun"]);
export const LAYOUTS = Object.freeze(["art-top", "art-full", "text"]);
export const TYPEFACES = Object.freeze(["serif", "grotesk", "mono"]);

const STOP = new Set("about above after again against also among another because been before being below between both cannot could does doing down during each from further have having here hers herself himself into itself just more most myself none nor once only other ought ours ourselves over same should some such than that their theirs them themselves then there these they this those through under until upon very were what when where which while whom with within without would your yours yourself yourselves will shall make made using used uses based like into onto than then than also each many much summary definitions definition claims claim examples example invariants notes note title content core human machine nextactions untitled".split(" "));

// ── reading ─────────────────────────────────────────────────────────────

function visibleTo(viewer) {
  const f = globalThis._concordUserVisibleDTUs;
  const base = typeof f === "function" ? (f(viewer) || []) : [...(STATE()?.dtus?.values?.() || [])].filter((d) => (d.visibility || "public") === "public");
  // Published cards are public by the owner's explicit choice (the public
  // lattice serves them to anyone), even when the DTU's federation tier is
  // still "local". Add them; never anything else.
  const ids = typeof globalThis._concordPublishedDTUIds === "function" ? globalThis._concordPublishedDTUIds() : [];
  if (!ids.length) return base;
  const have = new Set(base.map((d) => d.id));
  const extra = [];
  for (const id of ids) {
    if (have.has(id)) continue;
    const d = STATE()?.dtus?.get?.(id);
    if (d) extra.push(d);
  }
  return extra.length ? [...base, ...extra] : base;
}
function isPublished(d) {
  if (globalThis._concordIsPublishedDTU?.(d.id)) return true;
  const v = String(d.visibility || d.meta?.visibility || "").toLowerCase();
  return v === "public" || v === "published";
}
function readable(viewer, id) {
  if (!ID_RE.test(String(id || ""))) return null;
  const d = STATE()?.dtus?.get?.(id);
  if (!d) return null;
  const owner = dtuListedOwner(d);
  if (owner && owner === viewer) return d;
  if (isPublished(d)) return d;
  return visibleTo(viewer).some((x) => x.id === id) ? d : null;
}

const shelfCache = new WeakMap();
function shelfCached(d) {
  const key = `${d.updatedAt || d.createdAt || ""}|${d.title || ""}|${(d.tags || []).length}`;
  const hit = shelfCache.get(d);
  if (hit && hit.key === key) return hit.s;
  const s = shelfOf(d);
  shelfCache.set(d, { key, s });
  return s;
}

function textOf(d) {
  const core = d?.core || {};
  return [d?.title, d?.human?.summary, d?.cretiHuman, d?.body, d?.content, ...(core.definitions || []), ...(core.claims || [])]
    .filter((x) => typeof x === "string").join("\n");
}
function summaryOf(d) {
  const t = d?.human?.summary || d?.cretiHuman || d?.description || d?.content || d?.body || (d?.core?.definitions || [])[0] || (d?.core?.claims || [])[0] || "";
  return clean(t, 280);
}
function imageOf(d) {
  const design = d?.meta?.card || {};
  if (design.coverDtuId) return `/api/artifact/${encodeURIComponent(design.coverDtuId)}/thumbnail`;
  if (design.coverMediaId) return `/api/media/${encodeURIComponent(design.coverMediaId)}/stream`;
  const mt = String(d?.meta?.type || "");
  if (mt === "artwork" || d?.artifact?.diskPath || d?.artifact?.type?.startsWith?.("image/")) return `/api/artifact/${encodeURIComponent(d.id)}/thumbnail`;
  if (d?.type === "media" && d?.mediaType === "image") return `/api/media/${encodeURIComponent(d.id)}/stream`;
  if (d?.meta?.coverDtuId) return `/api/artifact/${encodeURIComponent(d.meta.coverDtuId)}/thumbnail`;
  return null;
}
function parentsOf(d) {
  const p = d?.lineage?.parents;
  return Array.isArray(p) ? p.map(String) : [];
}
function childIndex(all) {
  const kids = new Map();
  for (const d of all) for (const p of parentsOf(d)) { if (!kids.has(p)) kids.set(p, []); kids.get(p).push(d.id); }
  return kids;
}

function cardOf(d, viewer, kids) {
  const s = shelfCached(d);
  const owner = dtuListedOwner(d);
  const receipt = currentReceipt(d);
  const v = d?.meta?.verification;
  return {
    id: d.id,
    title: clean(d.title || "Untitled", 200),
    summary: summaryOf(d),
    shelf: s.shelf, shelfReason: s.reason, kind: s.kind, domain: s.domain,
    tier: d.tier || "regular",
    image: imageOf(d),
    design: normaliseDesign(d?.meta?.card),
    owner: owner === "system" ? "system" : owner ? (owner === viewer ? "me" : "someone") : null,
    isMine: !!viewer && owner === viewer,
    published: isPublished(d),
    check: v ? { outcome: v.outcome, checkedAt: v.checkedAt, current: !!receipt } : null,
    foil: !!receipt && receipt.outcome === "VERIFIED",
    needsCheck: needsPublishCheck(d),
    cites: parentsOf(d).length,
    builtOn: kids ? (kids.get(d.id) || []).length : 0,
    createdAt: d.createdAt || null,
  };
}

function normaliseDesign(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  return {
    frame: FRAMES.includes(r.frame) ? r.frame : "plain",
    palette: PALETTES.includes(r.palette) ? r.palette : "paper",
    accent: HEX_RE.test(r.accent || "") ? r.accent : null,
    layout: LAYOUTS.includes(r.layout) ? r.layout : "art-top",
    typeface: TYPEFACES.includes(r.typeface) ? r.typeface : "serif",
    subtitle: r.subtitle ? clean(r.subtitle, 80) : null,
    coverDtuId: r.coverDtuId || null,
    coverMediaId: r.coverMediaId || null,
  };
}

/** Significant terms of a text, for explainable similarity. */
function termsOf(text) {
  const out = new Map();
  for (const w of String(text).toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) || []) {
    if (STOP.has(w) || /^\d/.test(w)) continue;
    out.set(w, (out.get(w) || 0) + 1);
  }
  return out;
}

function inScope(d, viewer, scope) {
  const owner = dtuListedOwner(d);
  if (scope === "mine") return !!viewer && owner === viewer;
  // library: what's public, plus your own
  return isPublished(d) || d.scope === "global" && String(d.visibility || "public").toLowerCase() !== "private" || (!!viewer && owner === viewer);
}

export default function registerDtusBinder(registerLensAction) {
  registerLensAction("dtus", "shelf-facets", (ctx, _a, params = {}) => {
    const viewer = actorOf(ctx);
    const scope = params.scope === "library" ? "library" : "mine";
    const counts = Object.fromEntries(SHELVES.map((s) => [s, 0]));
    const domains = new Map();
    for (const d of visibleTo(viewer)) {
      if (!inScope(d, viewer, scope)) continue;
      const s = shelfCached(d);
      counts[s.shelf]++;
      if (DEFAULT_SHELVES.includes(s.shelf)) domains.set(s.domain, (domains.get(s.domain) || 0) + 1);
    }
    return {
      ok: true,
      result: {
        scope, counts,
        shown: DEFAULT_SHELVES, hidden: HIDDEN_SHELVES,
        hiddenTotal: HIDDEN_SHELVES.reduce((a, s) => a + counts[s], 0),
        domains: [...domains.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24).map(([name, n]) => ({ name, n })),
      },
    };
  });

  registerLensAction("dtus", "shelf-browse", (ctx, _a, params = {}) => {
    const viewer = actorOf(ctx);
    const scope = params.scope === "library" ? "library" : "mine";
    let shelves = Array.isArray(params.shelves) ? params.shelves.filter((s) => SHELVES.includes(s)) : [];
    if (!shelves.length) shelves = [...DEFAULT_SHELVES];
    const q = clean(params.q, 120).toLowerCase();
    const domain = params.domain ? clean(params.domain, 40).toLowerCase() : null;
    const sort = ["newest", "built-on", "checked", "title"].includes(params.sort) ? params.sort : "newest";
    const limit = Math.max(1, Math.min(60, Math.round(Number(params.limit) || 24)));
    const offset = Math.max(0, Math.round(Number(params.offset) || 0));
    const all = visibleTo(viewer);
    const kids = childIndex(all);
    let rows = [];
    for (const d of all) {
      if (!inScope(d, viewer, scope)) continue;
      const s = shelfCached(d);
      if (!shelves.includes(s.shelf)) continue;
      if (domain && s.domain !== domain) continue;
      if (q && !textOf(d).toLowerCase().includes(q) && !(d.tags || []).some((t) => String(t).toLowerCase().includes(q))) continue;
      rows.push(d);
    }
    const cards = rows.map((d) => cardOf(d, viewer, kids));
    const rank = { VERIFIED: 0, PARTIAL: 1, UNTESTABLE: 2, PENDING: 3, REFUTED: 4 };
    if (sort === "built-on") cards.sort((a, b) => b.builtOn - a.builtOn || String(b.createdAt).localeCompare(String(a.createdAt)));
    else if (sort === "checked") cards.sort((a, b) => (a.check?.current ? rank[a.check.outcome] ?? 5 : 6) - (b.check?.current ? rank[b.check.outcome] ?? 5 : 6) || String(b.createdAt).localeCompare(String(a.createdAt)));
    else if (sort === "title") cards.sort((a, b) => a.title.localeCompare(b.title));
    else cards.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return { ok: true, result: { scope, shelves, total: cards.length, offset, cards: cards.slice(offset, offset + limit) } };
  });

  registerLensAction("dtus", "card-get", (ctx, _a, params = {}) => {
    const viewer = actorOf(ctx);
    const d = readable(viewer, params.id);
    if (!d) return { ok: false, error: "card not found" };
    const all = visibleTo(viewer);
    const kids = childIndex(all);
    const card = cardOf(d, viewer, kids);
    const core = d.core || {};
    const v = d.meta?.verification;
    const titleOf = (id) => { const x = readable(viewer, id); return x ? { id, title: clean(x.title || "Untitled", 120), shelf: shelfCached(x).shelf } : null; };
    return {
      ok: true,
      result: {
        card,
        back: {
          claims: (core.claims || []).map((c) => clean(c, 400)).slice(0, 40),
          definitions: (core.definitions || []).map((c) => clean(c, 400)).slice(0, 20),
          body: typeof d.content === "string" ? d.content.slice(0, 6000) : typeof d.body === "string" ? d.body.slice(0, 6000) : null,
          tags: (d.tags || []).map((t) => clean(t, 40)).slice(0, 30),
          sources: collectWebSources(d).slice(0, 20),
          receipt: v ? {
            outcome: v.outcome, checkedAt: v.checkedAt, current: !!currentReceipt(d),
            claims: (v.claims || []).slice(0, 40).map((c) => ({ kind: c.kind, checker: c.checker, result: c.result, detail: c.detail, text: c.text })),
          } : null,
          parents: parentsOf(d).map(titleOf).filter(Boolean),
          children: (kids.get(d.id) || []).slice(0, 20).map(titleOf).filter(Boolean),
          publishBlock: card.isMine && !card.published ? publishGateDenial(d) : null,
        },
      },
    };
  });

  registerLensAction("dtus", "card-design", (ctx, _a, params = {}) => {
    const viewer = actorOf(ctx);
    if (!viewer) return { ok: false, error: "sign in to design a card" };
    const d = readable(viewer, params.id);
    if (!d || dtuListedOwner(d) !== viewer) return { ok: false, error: "only the card's owner can design it" };
    const p = params.design && typeof params.design === "object" ? params.design : {};
    for (const [k, list] of [["frame", FRAMES], ["palette", PALETTES], ["layout", LAYOUTS], ["typeface", TYPEFACES]]) {
      if (p[k] !== undefined && !list.includes(p[k])) return { ok: false, error: `${k} must be one of ${list.join(", ")}` };
    }
    if (p.accent !== undefined && p.accent !== null && !HEX_RE.test(String(p.accent))) return { ok: false, error: "accent must be a colour like #ff5a1f" };
    let coverDtuId = undefined;
    if (p.coverDtuId !== undefined) {
      if (p.coverDtuId === null) coverDtuId = null;
      else {
        const img = STATE()?.dtus?.get?.(String(p.coverDtuId));
        if (!img || dtuListedOwner(img) !== viewer) return { ok: false, error: "the art must be an image of yours" };
        const isImage = String(img.meta?.type) === "artwork" || String(img.artifact?.type || "").startsWith("image/") || img.mediaType === "image";
        if (!isImage) return { ok: false, error: "the art must be an image" };
        coverDtuId = img.id;
      }
    }
    const prev = normaliseDesign(d.meta?.card);
    const next = {
      ...prev,
      ...(p.frame !== undefined ? { frame: p.frame } : {}),
      ...(p.palette !== undefined ? { palette: p.palette } : {}),
      ...(p.layout !== undefined ? { layout: p.layout } : {}),
      ...(p.typeface !== undefined ? { typeface: p.typeface } : {}),
      ...(p.accent !== undefined ? { accent: p.accent } : {}),
      ...(p.subtitle !== undefined ? { subtitle: p.subtitle ? clean(p.subtitle, 80) : null } : {}),
      ...(coverDtuId !== undefined ? { coverDtuId } : {}),
    };
    d.meta = { ...(d.meta || {}), card: next };
    d.updatedAt = new Date().toISOString();
    persist(d);
    return { ok: true, result: { design: normaliseDesign(next), image: imageOf(d) } };
  });

  registerLensAction("dtus", "card-connections", (ctx, _a, params = {}) => {
    const viewer = actorOf(ctx);
    const d = readable(viewer, params.id);
    if (!d) return { ok: false, error: "card not found" };
    const me = shelfCached(d);
    const all = visibleTo(viewer).filter((x) => x.id !== d.id && !["system", "records"].includes(shelfCached(x).shelf));
    const kids = childIndex([...all, d]);
    const myParents = new Set(parentsOf(d));
    const myKids = new Set(kids.get(d.id) || []);
    // document frequency over the candidate set, for idf weighting
    const df = new Map();
    const termSets = new Map();
    for (const x of all) { const t = termsOf(textOf(x)); termSets.set(x.id, t); for (const w of t.keys()) df.set(w, (df.get(w) || 0) + 1); }
    const mine = termsOf(textOf(d));
    const N = Math.max(1, all.length);
    const out = [];
    for (const x of all) {
      const xs = shelfCached(x);
      const reasons = [];
      let score = 0;
      let relation = "similar";
      if (myParents.has(x.id)) { score += 5; reasons.push("this card builds on it"); relation = "linked"; }
      if (myKids.has(x.id)) { score += 5; reasons.push("it builds on this card"); relation = "linked"; }
      const shared = parentsOf(x).filter((p) => myParents.has(p));
      if (shared.length) { score += 2 * shared.length; reasons.push(`both build on ${shared.length} of the same source${shared.length > 1 ? "s" : ""}`); if (relation === "similar") relation = "shared-source"; }
      const overlap = [];
      for (const [w] of mine) if (termSets.get(x.id)?.has(w)) overlap.push([w, Math.log(1 + N / (df.get(w) || 1))]);
      overlap.sort((a, b) => b[1] - a[1]);
      const top = overlap.slice(0, 5).map(([w]) => w);
      const termScore = overlap.slice(0, 8).reduce((a, [, idf]) => a + idf, 0) / 4;
      score += termScore;
      const complement = xs.shelf !== me.shelf && overlap.length >= 2 && ["works", "specs", "documents", "knowledge", "data"].includes(xs.shelf);
      if (complement) { score += 1.5; relation = relation === "linked" ? "linked" : "complement"; reasons.push(`a ${xs.shelf.replace(/s$/, "")} to go with this ${me.shelf.replace(/s$/, "")}`); }
      if (top.length >= 2) reasons.push(`shares ${top.slice(0, 3).map((w) => `“${w}”`).join(", ")}`);
      if (score < 1.2 || !reasons.length) continue;
      out.push({ card: cardOf(x, viewer, kids), score: Math.round(score * 10) / 10, relation, reasons, sharedTerms: top });
    }
    out.sort((a, b) => b.score - a.score);
    return { ok: true, result: { id: d.id, connections: out.slice(0, 12), considered: all.length } };
  });

  async function derive(ctx, viewer, parents, { title, note, citationType }) {
    for (const p of parents) {
      const owner = dtuListedOwner(p);
      if (owner !== viewer && !isPublished(p)) return { ok: false, error: `“${clean(p.title, 60)}” is private to its owner; only published cards can be built on` };
      const s = shelfCached(p).shelf;
      if (s === "records" || s === "system") return { ok: false, error: `“${clean(p.title, 60)}” is ${shelfCached(p).reason}; it can't be built on` };
    }
    if (!ctx?.macro?.run) return { ok: false, error: "macro runtime unavailable" };
    const t = clean(title, 160);
    if (!t) return { ok: false, error: "give the new card a title" };
    const claims = [], defs = [], tags = new Set();
    for (const p of parents) {
      for (const c of (p.core?.claims || [])) if (claims.length < 20 && !claims.includes(c)) claims.push(String(c).slice(0, 400));
      for (const c of (p.core?.definitions || [])) if (defs.length < 12 && !defs.includes(c)) defs.push(String(c).slice(0, 400));
      for (const tg of (p.tags || []).slice(0, 6)) tags.add(String(tg).slice(0, 40));
    }
    const summary = clean(note, 1200) || (parents.length > 1
      ? `Combines “${clean(parents[0].title, 80)}” with “${clean(parents[1].title, 80)}”.`
      : `Builds on “${clean(parents[0].title, 80)}”.`);
    const domain = shelfCached(parents[0]).domain;
    const created = await ctx.macro.run("dtu", "create", {
      title: t, domain, source: parents.length > 1 ? "binder-fuse" : "binder-remix",
      tags: [...tags].slice(0, 12),
      human: { summary },
      core: { definitions: defs, claims, examples: [], invariants: [], nextActions: [] },
      lineage: { parents: parents.map((p) => p.id), citationType },
    });
    if (!created?.ok || !created.dtu) return { ok: false, error: created?.error || created?.reason || "the new card could not be made" };
    const dtu = STATE()?.dtus?.get?.(created.dtu.id) || created.dtu;
    if (!parentsOf(dtu).length) { dtu.lineage = { ...(dtu.lineage || {}), parents: parents.map((p) => p.id), citationType }; persist(dtu); }
    return { ok: true, result: { card: cardOf(dtu, viewer, null), parents: parents.map((p) => p.id) } };
  }

  registerLensAction("dtus", "card-fuse", async (ctx, _a, params = {}) => {
    const viewer = actorOf(ctx);
    if (!viewer) return { ok: false, error: "sign in to fuse cards" };
    if (String(params.aId) === String(params.bId)) return { ok: false, error: "pick two different cards" };
    const a = readable(viewer, params.aId), b = readable(viewer, params.bId);
    if (!a || !b) return { ok: false, error: "card not found" };
    return derive(ctx, viewer, [a, b], { title: params.title, note: params.note, citationType: "composition" });
  });

  registerLensAction("dtus", "card-remix", async (ctx, _a, params = {}) => {
    const viewer = actorOf(ctx);
    if (!viewer) return { ok: false, error: "sign in to build on a card" };
    const a = readable(viewer, params.id);
    if (!a) return { ok: false, error: "card not found" };
    return derive(ctx, viewer, [a], { title: params.title, note: params.note, citationType: "remix" });
  });

  registerLensAction("dtus", "card-check", async (ctx, _a, params = {}) => {
    const viewer = actorOf(ctx);
    const d = readable(viewer, params.id);
    if (!d || dtuListedOwner(d) !== viewer) return { ok: false, error: "only the card's owner can check it" };
    const cand = candidateOf(d);
    if (!cand.body.trim()) return { ok: false, error: "there is nothing on this card to check" };
    const deps = typeof globalThis._concordVerifyDeps === "function" ? globalThis._concordVerifyDeps() : {};
    const { outcome, receipt } = await verifyCandidate(cand, deps);
    const verification = {
      outcome, mode: "on-demand", checkedAt: receipt.checkedAt, version: receipt.version, bodyHash: bodyHashOf(d),
      unverified: (receipt.unverified || []).slice(0, 10),
      claims: (receipt.claims || []).slice(0, 40).map((c) => ({ id: c.claimId, kind: c.kind, checker: c.checker, result: c.result, detail: String(c.detail || "").slice(0, 200), text: String(c.text || "").slice(0, 200) })),
    };
    d.meta = { ...(d.meta || {}), verification };
    persist(d);
    return {
      ok: true,
      result: {
        outcome, claims: verification.claims, sources: collectWebSources(d).length,
        publishBlock: publishGateDenial(d),
      },
    };
  });

  /** The outside sources a card cites (what an empirical claim must have). Owner only; http(s) links. */
  registerLensAction("dtus", "card-sources", (ctx, _a, params = {}) => {
    const viewer = actorOf(ctx);
    const d = readable(viewer, params.id);
    if (!d || dtuListedOwner(d) !== viewer) return { ok: false, error: "only the card's owner can change its sources" };
    if (!Array.isArray(params.sources)) return { ok: false, error: "sources must be a list" };
    if (params.sources.length > 30) return { ok: false, error: "30 sources at most" };
    const out = [];
    for (const raw of params.sources) {
      const url = String(raw?.url ?? raw ?? "").trim();
      let u;
      try { u = new URL(url); } catch { return { ok: false, error: `not a link: ${url.slice(0, 60)}` }; }
      if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, error: "sources must be http(s) links" };
      out.push({ url: u.toString().slice(0, 500), title: raw?.title ? clean(raw.title, 160) : null });
    }
    d.meta = { ...(d.meta || {}), sources: out };
    d.updatedAt = new Date().toISOString();
    persist(d);
    return { ok: true, result: { sources: out, publishBlock: publishGateDenial(d) } };
  });

  registerLensAction("dtus", "card-publish", (ctx, _a, params = {}) => {
    const viewer = actorOf(ctx);
    const d = readable(viewer, params.id);
    if (!d || dtuListedOwner(d) !== viewer) return { ok: false, error: "only the card's owner can publish it" };
    const deny = publishGateDenial(d);
    if (deny) return { ok: false, ...deny };
    const r = globalThis._concordPublishDTU?.(d.id);
    if (!r?.ok) return { ok: false, error: r?.error || "could not publish", message: r?.message };
    d.visibility = "public";
    d.meta = { ...(d.meta || {}), visibility: "public", publishedAt: new Date().toISOString() };
    persist(d);
    return { ok: true, result: { id: d.id, published: true, foil: !!currentReceipt(d) && currentReceipt(d).outcome === "VERIFIED" } };
  });

  registerLensAction("dtus", "card-unpublish", (ctx, _a, params = {}) => {
    const viewer = actorOf(ctx);
    const d = readable(viewer, params.id);
    if (!d || dtuListedOwner(d) !== viewer) return { ok: false, error: "only the card's owner can take it down" };
    globalThis._concordUnpublishDTU?.(d.id);
    d.visibility = "private";
    d.meta = { ...(d.meta || {}), visibility: "private" };
    persist(d);
    return { ok: true, result: { id: d.id, published: false } };
  });
}
