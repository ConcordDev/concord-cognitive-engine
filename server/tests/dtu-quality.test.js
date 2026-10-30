// DTU classification + quality gates (lib/dtu-quality) and their server.js wiring.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { classifyDtu, KINDS } from "../lib/dtu-quality/classify.js";
import { scoreQuality, sketch, createDuplicateIndex } from "../lib/dtu-quality/quality.js";
import { createDtuQualityService } from "../lib/dtu-quality/service.js";

const long = (s) => `${s} ` + "The relation holds across the measured range and is documented in the cited material. ".repeat(3);

test("kinds: tier, origin, tags and content decide the kind", () => {
  assert.equal(classifyDtu({ id: "a", tier: "mega", title: "x" }).kind, "mega");
  assert.equal(classifyDtu({ id: "a", tier: "hyper" }).kind, "hyper");
  assert.equal(classifyDtu({ id: "a", source: "feed:usgs", title: "Quake" }).kind, "feed_snapshot");
  assert.equal(classifyDtu({ id: "a", source: "import", title: "Chapter 3" }).kind, "ingested_corpus");
  assert.equal(classifyDtu({ id: "a", title: "Lemma", core: { claims: ["Theorem: every even n>2 ... proof by induction"] } }).kind, "math_proof");
  assert.equal(classifyDtu({ id: "a", tags: ["hypothesis"], title: "Maybe X" }).kind, "hypothesis");
  assert.equal(classifyDtu({ id: "a", tags: ["theory"], title: "A theory of Y" }).kind, "theory");
  assert.equal(classifyDtu({ id: "a", tags: ["measured"], title: "Beam test" }).kind, "empirical");
  const auto = classifyDtu({ id: "a", source: "subconscious", title: "Idea" });
  assert.equal(auto.kind, "autogen"); assert.equal(auto.origin, "autogen");
  assert.equal(classifyDtu({ id: "a", source: "user", title: "My note" }).kind, "user_authored");
  assert.equal(classifyDtu({ id: "a" }).kind, "unclassified");
  for (const k of ["mega", "unclassified", "feed_snapshot"]) assert.ok(KINDS.includes(k));
});

test("domain: explicit field or tag wins, then keywords, else general", () => {
  assert.equal(classifyDtu({ id: "a", domain: "Music" }).domain, "music");
  assert.equal(classifyDtu({ id: "a", tags: ["lens:chemistry"] }).domain, "chemistry");
  assert.equal(classifyDtu({ id: "a", title: "Beam buckling under load", core: { claims: ["stress in the truss member"] } }).domain, "engineering");
  assert.equal(classifyDtu({ id: "a", title: "hello" }).domain, "general");
});

test("quality: provenance, resolving citations, substance and numbers each move the score with a reason", () => {
  const good = { id: "d1", source: "user", author: "u1", title: "t", core: { claims: ["c1"], definitions: ["d"] }, lineage: { parents: ["p1"] }, body: long("Beam depth 125 mm") };
  const g = scoreQuality(good, { kind: "empirical", exists: () => true });
  assert.ok(g.score >= 0.9 && g.gate === "pass", JSON.stringify(g));

  const bad = { id: "d2", source: "x", title: "t", body: "short 125 mm per dtu_ghost_one" };
  const b = scoreQuality(bad, { kind: "empirical", exists: () => false });
  assert.ok(b.score < 0.5 && b.gate === "low_quality");
  assert.ok(b.reasons.some((r) => r.startsWith("provenance")));
  assert.ok(b.reasons.some((r) => r.startsWith("citations_resolve")));
  assert.ok(b.reasons.some((r) => r.startsWith("substance")));
  assert.ok(b.reasons.some((r) => r.startsWith("numbers_traceable")));
});

test("quality: theory/math/mega kinds route through the verify gate by outcome", () => {
  const base = { id: "t1", source: "subconscious", author: "sys", core: { claims: ["c"] }, body: long("A theory") };
  assert.equal(scoreQuality(base, { kind: "theory" }).gate, "needs_verify");
  assert.equal(scoreQuality({ ...base, meta: { verification: { outcome: "REFUTED" } } }, { kind: "theory" }).gate, "refuted");
  assert.equal(scoreQuality({ ...base, meta: { verification: { outcome: "VERIFIED" } } }, { kind: "theory" }).gate, "pass");
  assert.equal(scoreQuality({ ...base, meta: { verification: { outcome: "UNTESTABLE" } } }, { kind: "theory" }).checks.find((c) => c.code === "verified").ok, 0);
  assert.equal(scoreQuality(base, { kind: "user_authored" }).checks.some((c) => c.code === "verified"), false, "non-verify kinds are not asked");
});

test("duplicates: identical and near-identical text is flagged, unrelated text is not; the index is bounded", () => {
  const idx = createDuplicateIndex({ maxEntries: 3 });
  const a = long("Alpha study of bearing wear in rotating shafts and how lubrication changes it");
  idx.add("A", sketch(a));
  assert.equal(idx.find("B", sketch(a))?.id, "A");
  assert.equal(idx.find("B", sketch(a + " One extra closing sentence."))?.id, "A");
  assert.equal(idx.find("B", sketch("Completely different text about royalty cascades and citation ledgers in a creator economy with many words here")), null);
  for (const n of ["C", "D", "E", "F"]) idx.add(n, sketch(`${n} unique text ${n.repeat(5)} with enough distinct words to build a sketch over many different tokens ${n}${n} alpha${n} beta${n} gamma${n}`));
  assert.ok(idx.size() <= 3);
});

test("service: annotateInPlace is additive, labels low quality, never removes content, and skips current records", () => {
  const svc = createDtuQualityService({});
  const d = { id: "x1", source: "z", title: "t", body: "tiny 5 kg", tags: ["keep"] };
  const body = d.body;
  const rec = svc.annotateInPlace(d);
  assert.equal(d.meta.classification.kind, rec.kind);
  assert.equal(d.body, body);
  assert.ok(d.tags.includes("keep") && d.tags.includes("quality:low"));
  assert.ok(d.meta.rankPenalty > 0);
  assert.equal(svc.annotateInPlace(d), null, "second call is a no-op");
  d.meta.verification = { outcome: "VERIFIED" };
  assert.ok(svc.annotateInPlace(d), "a new verify outcome re-scores");
});

test("service: cycle backfills in small budgeted batches, tallies a full pass, and refuses re-entry", async () => {
  const dtus = Array.from({ length: 50 }, (_, i) => ({ id: `d${i}`, source: i % 2 ? "user" : "subconscious", author: "a", title: `T${i}`, body: long(`Distinct body number ${i} about topic ${i * 7}`), core: { claims: ["c"] } }));
  let i = 0;
  const written = [];
  const store = {
    scan: (maxExamine, maxNeeds) => {
      const needs = []; const counted = []; let examined = 0; let done = false;
      while (examined < maxExamine && needs.length < maxNeeds) {
        if (i >= dtus.length) { done = true; i = 0; break; }
        const d = dtus[i++]; examined++;
        if (svc.isCurrent(d)) counted.push(d.meta.classification); else needs.push(d);
      }
      return { examined, needs, counted, done };
    },
    write: (id, rec) => { const d = dtus.find((x) => x.id === id); d.meta = { ...(d.meta || {}), classification: rec }; written.push(id); },
  };
  const svc = createDtuQualityService({ store, deps: { yieldNow: () => new Promise((r) => setTimeout(r, 5)) } });
  const r1 = await svc.cycle({ maxExamine: 20, maxWrite: 10, budgetMs: 1000 });
  assert.equal(r1.written, 10);
  assert.ok(r1.examined <= 20);
  const overlap = svc.cycle({ maxExamine: 40, maxWrite: 30, budgetMs: 1000 });
  const second = await svc.cycle({ maxWrite: 5 });
  assert.equal(second.skipped, "in_flight");
  await overlap;
  let guard = 0;
  while (!svc.metrics().lastPass && guard++ < 30) await svc.cycle({ maxExamine: 25, maxWrite: 25, budgetMs: 1000 });
  const m = svc.metrics();
  assert.ok(m.lastPass, "a full pass completes");
  assert.equal(m.lastPass.total, 50);
  assert.equal(Object.values(m.lastPass.byKind).reduce((a, b) => a + b, 0), 50);
  assert.ok(Object.keys(m.lastPass.byGate).length >= 1);
});

test("server.js wiring: annotate before the write, heartbeat registered, admin endpoint role-gated", () => {
  const src = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
  const up = src.indexOf("function upsertDTU(");
  assert.ok(up > 0);
  const ann = src.indexOf("getDtuQuality().annotateInPlace(dtu)", up);
  const set = src.indexOf("STATE.dtus.set(dtu.id, dtu);", up);
  assert.ok(ann > 0 && ann < set, "annotation precedes the map write");
  assert.match(src, /registerHeartbeat\("dtu-quality-backfill"/);
  assert.match(src, /app\.get\("\/api\/admin\/dtu-quality", requireRole\("owner", "admin", "sovereign", "founder"\)/);
});
