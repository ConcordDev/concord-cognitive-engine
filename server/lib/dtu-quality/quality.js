// DTU quality gates. Each check returns {code, ok, weight, detail}; ok may be a fraction (0..1) for partial credit.
// Nothing here deletes or rewrites content: the result is a score, the reasons behind it, and a gate outcome.
import { textOf, hasUnitFigures } from "./classify.js";

const VERIFY_KINDS = new Set(["theory", "math_proof", "hypothesis", "mega", "hyper"]);
const FIGURE_KINDS = new Set(["empirical", "theory", "mega", "hyper", "autogen", "hypothesis"]);

const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();

function hash32(str, seed = 0) { // FNV-1a
  let h = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

// Bottom-k sketch of word 3-grams: two DTUs with Jaccard ~ J share about J of their sketch.
export function sketch(text, k = 16) {
  const words = norm(text).replace(/[^\p{L}\p{N}\s]/gu, " ").split(" ").filter(Boolean);
  if (words.length < 8) return [];
  const set = new Set();
  for (let i = 0; i + 3 <= words.length; i++) set.add(hash32(words.slice(i, i + 3).join(" ")));
  return [...set].sort((a, b) => a - b).slice(0, k);
}

export function sketchSimilarity(a, b) {
  if (!a.length || !b.length) return 0;
  const bs = new Set(b);
  let both = 0;
  for (const x of a) if (bs.has(x)) both++;
  return both / Math.min(a.length, b.length);
}

/** Bounded in-memory index for duplicate detection: smallest-hash bucket -> ids, oldest dropped first. */
export function createDuplicateIndex({ maxEntries = 50000 } = {}) {
  const sketches = new Map(); // id -> sketch
  const buckets = new Map(); // min hash -> id[]
  return {
    size: () => sketches.size,
    find(id, sk, threshold = 0.85) {
      if (!sk.length) return null;
      const seen = new Set();
      for (const h of sk.slice(0, 4)) {
        for (const other of buckets.get(h) || []) {
          if (other === id || seen.has(other)) continue;
          seen.add(other);
          const sim = sketchSimilarity(sk, sketches.get(other) || []);
          if (sim >= threshold) return { id: other, similarity: Math.round(sim * 100) / 100 };
        }
      }
      return null;
    },
    add(id, sk) {
      if (!sk.length || sketches.has(id)) return;
      if (sketches.size >= maxEntries) {
        const oldest = sketches.keys().next().value;
        const old = sketches.get(oldest);
        for (const h of old.slice(0, 4)) { const b = buckets.get(h); if (b) { const i = b.indexOf(oldest); if (i >= 0) b.splice(i, 1); if (!b.length) buckets.delete(h); } }
        sketches.delete(oldest);
      }
      sketches.set(id, sk);
      for (const h of sk.slice(0, 4)) { if (!buckets.has(h)) buckets.set(h, []); buckets.get(h).push(id); }
    },
  };
}

export function citedIds(d) {
  const ids = new Set();
  for (const p of Array.isArray(d?.lineage?.parents) ? d.lineage.parents : []) if (typeof p === "string" && p !== d.id) ids.add(p);
  for (const p of Array.isArray(d?.meta?.cites) ? d.meta.cites : []) if (typeof p === "string") ids.add(p);
  for (const m of textOf(d).matchAll(/\bdtu_[a-z0-9_]{6,}\b/gi)) if (m[0] !== d.id) ids.add(m[0]);
  return [...ids].slice(0, 50);
}

/**
 * ctx: { exists(id) -> bool, dupIndex? , kind }
 * Returns { score, gate, reasons, checks }.
 */
export function scoreQuality(d, { kind, exists = () => true, dupIndex = null } = {}) {
  const text = textOf(d);
  const checks = [];
  const add = (code, ok, weight, detail) => checks.push({ code, ok: ok === true ? 1 : ok === false ? 0 : ok, weight, detail });

  const hasSource = Boolean(d?.source) && (d?.author || d?.createdBy || d?.meta?.sourceUrl || d?.meta?.feedName || d?.lineage?.parents?.length || d?.meta?.authoredBy);
  add("provenance", Boolean(hasSource), 0.25, hasSource ? "source and author/origin present" : "no source with an author, URL or parent");

  const cites = citedIds(d);
  if (cites.length) {
    const missing = cites.filter((id) => !exists(id));
    add("citations_resolve", cites.length ? (cites.length - missing.length) / cites.length : 1, 0.2,
      missing.length ? `${missing.length}/${cites.length} cited ids do not exist: ${missing.slice(0, 3).join(", ")}` : `${cites.length} cited ids resolve`);
  }

  const sk = sketch(text);
  let dup = null;
  if (dupIndex) { dup = dupIndex.find(d.id, sk); }
  add("not_duplicate", !dup, 0.15, dup ? `near-duplicate of ${dup.id} (${dup.similarity})` : "no near-duplicate seen");

  const words = norm(text).split(" ").filter(Boolean).length;
  const claims = (d?.core?.claims?.length || 0) + (d?.core?.definitions?.length || 0);
  add("substance", words >= 25 || claims > 0, 0.15, words >= 25 || claims > 0 ? `${words} words, ${claims} claims/definitions` : `only ${words} words and no claims`);

  const v = d?.meta?.verification;
  if (FIGURE_KINDS.has(kind)) {
    const figs = hasUnitFigures(text);
    if (figs) {
      const traced = Boolean(d?.meta?.sourceUrl || d?.sources?.length || d?.lineage?.parents?.length || v?.outcome === "VERIFIED");
      add("numbers_traceable", traced, 0.15, traced ? `${figs} figures with a source or verification` : `${figs} figures with no source, parent or verification`);
    }
  }

  let gate = null;
  if (VERIFY_KINDS.has(kind)) {
    const out = v?.outcome;
    if (out === "VERIFIED") add("verified", true, 0.1, "verify gate: VERIFIED");
    else if (out === "PARTIAL") add("verified", 0.5, 0.1, "verify gate: PARTIAL, some claims unchecked or failed");
    else if (out === "REFUTED") { add("verified", false, 0.1, "verify gate: REFUTED"); gate = "refuted"; }
    else { add("verified", false, 0.1, out === "UNTESTABLE" ? "verify gate: UNTESTABLE" : "not verified yet: route to the verify gate"); gate = out === "UNTESTABLE" ? null : "needs_verify"; }
  }

  const total = checks.reduce((s, c) => s + c.weight, 0) || 1;
  const score = Math.round((checks.reduce((s, c) => s + c.weight * c.ok, 0) / total) * 100) / 100;
  if (!gate) gate = score >= 0.75 ? "pass" : score >= 0.5 ? "review" : "low_quality";
  else if (gate === "needs_verify" && score < 0.4) gate = "low_quality";
  const reasons = checks.filter((c) => c.ok < 1).map((c) => `${c.code}: ${c.detail}`);
  return { score, gate, reasons, checks: checks.map((c) => ({ code: c.code, ok: c.ok, weight: c.weight })), duplicateOf: dup?.id || null, sketch: sk };
}
