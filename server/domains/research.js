// server/domains/research.js
// Domain actions for research: citation network analysis, methodology scoring,
// reproducibility assessment, and literature gap detection.

import { guardAnonWrites, refuseAnonWrite } from "../lib/lens-authz.js";
import { autoSource, publishAutoSourceSummary, buildSummaryPrompt, autoSourceEnabled, autoSourceUsage } from "../lib/auto-source.js";
import { callVision, callVisionUrl, visionPromptForDomain } from "../lib/vision-inference.js";
import { cachedFetchJson } from "../lib/external-fetch.js";
import { computeContentHash } from "../lib/dtu-protocol.js";

export default function registerResearchActions(registerLensAction) {
  registerLensAction = guardAnonWrites(registerLensAction); // anonymous callers can read, not write (lib/lens-authz.js)
  registerLensAction("research", "vision", async (ctx, artifact, _params) => {
    const { imageB64, imageUrl } = artifact.data || {};
    if (!imageB64 && !imageUrl) return { ok: false, error: "imageB64 or imageUrl required" };
    const prompt = visionPromptForDomain("research");
    return imageUrl ? callVisionUrl(imageUrl, prompt) : callVision(imageB64, prompt);
  });
  /**
   * citationNetwork
   * Analyze citation relationships between papers to find influential works,
   * research clusters, and citation patterns.
   * artifact.data.papers = [{ id, title, authors?, year?, citations?: string[],
   *   references?: string[], abstract?, keywords? }]
   */
  registerLensAction("research", "citationNetwork", (ctx, artifact, params = {}) => {
  try {
    let papers = artifact.data?.papers || [];
    let libraryMode = false;
    if (papers.length === 0 && params?.fromLibrary) {
      // S5 (F3): the Research Analysis rail used to run this macro through
      // /api/lens/research/{id}/run with the id of the first DTU in the
      // platform feed — an artifact that endpoint could not resolve
      // ("not found"), and whose data was never the user's library in the
      // first place. Library mode builds the paper set from the caller's
      // own references instead: related-reference links are the citation
      // edges, tags are the keywords. Artifact mode is unchanged.
      const s = getResearchState();
      if (!s) return { ok: false, error: "STATE unavailable" };
      const refs = s.references.get(rfAid(ctx)) || [];
      const inLibrary = new Set(refs.map((r) => r.id));
      papers = refs.map((r) => ({
        id: r.id, title: r.title, year: r.year,
        references: (r.relatedIds || []).filter((id) => inLibrary.has(id)),
        keywords: r.tags || [],
      }));
      libraryMode = true;
    }
    if (papers.length === 0) return { ok: true, result: { message: "No papers." } };

    const paperMap = {};
    for (const p of papers) paperMap[p.id] = { ...p, inDegree: 0, outDegree: 0, citedBy: [] };

    // Build citation graph
    for (const p of papers) {
      const refs = p.references || p.citations || [];
      paperMap[p.id].outDegree = refs.length;
      for (const ref of refs) {
        if (paperMap[ref]) {
          paperMap[ref].inDegree++;
          paperMap[ref].citedBy.push(p.id);
        }
      }
    }

    // PageRank (simplified, 20 iterations)
    const n = papers.length;
    const d = 0.85; // damping factor
    let scores = {};
    for (const p of papers) scores[p.id] = 1 / n;

    for (let iter = 0; iter < 20; iter++) {
      const newScores = {};
      for (const p of papers) {
        let incoming = 0;
        for (const citerId of (paperMap[p.id].citedBy || [])) {
          if (paperMap[citerId] && paperMap[citerId].outDegree > 0) {
            incoming += scores[citerId] / paperMap[citerId].outDegree;
          }
        }
        newScores[p.id] = (1 - d) / n + d * incoming;
      }
      scores = newScores;
    }

    // H-index of the collection
    const citationCounts = Object.values(paperMap).map(p => p.inDegree).sort((a, b) => b - a);
    let hIndex = 0;
    for (let i = 0; i < citationCounts.length; i++) {
      if (citationCounts[i] >= i + 1) hIndex = i + 1;
      else break;
    }

    // Ranked papers
    const ranked = papers.map(p => ({
      id: p.id, title: p.title, year: p.year,
      inDegree: paperMap[p.id].inDegree,
      outDegree: paperMap[p.id].outDegree,
      pageRank: Math.round(scores[p.id] * 100000) / 100000,
    })).sort((a, b) => b.pageRank - a.pageRank);

    // Keyword co-occurrence for topic clusters
    const kwPairs = {};
    for (const p of papers) {
      const kws = p.keywords || [];
      for (let i = 0; i < kws.length; i++) {
        for (let j = i + 1; j < kws.length; j++) {
          const pair = [kws[i], kws[j]].sort().join("|");
          kwPairs[pair] = (kwPairs[pair] || 0) + 1;
        }
      }
    }
    const topicClusters = Object.entries(kwPairs)
      .filter(([, count]) => count >= 2)
      .map(([pair, count]) => ({ keywords: pair.split("|"), coOccurrences: count }))
      .sort((a, b) => b.coOccurrences - a.coOccurrences)
      .slice(0, 10);

    // Year distribution
    const yearDist = {};
    for (const p of papers) {
      if (p.year) yearDist[p.year] = (yearDist[p.year] || 0) + 1;
    }

    // Identify foundational papers (high in-degree, older)
    const foundational = ranked.filter(p => p.inDegree >= 3 && p.year)
      .sort((a, b) => (a.year || 9999) - (b.year || 9999))
      .slice(0, 5);

    // Identify frontier papers (recent, citing many, low in-degree)
    const frontier = ranked.filter(p => p.outDegree >= 3 && p.inDegree <= 1 && p.year)
      .sort((a, b) => (b.year || 0) - (a.year || 0))
      .slice(0, 5);

    const result = {
      totalPapers: papers.length,
      hIndex,
      rankedPapers: ranked.slice(0, 15),
      foundationalWorks: foundational.map(p => ({ id: p.id, title: p.title, year: p.year, citations: p.inDegree })),
      frontierWorks: frontier.map(p => ({ id: p.id, title: p.title, year: p.year, references: p.outDegree })),
      topicClusters,
      yearDistribution: yearDist,
      networkDensity: n > 1 ? Math.round(ranked.reduce((s, p) => s + p.outDegree, 0) / (n * (n - 1)) * 10000) / 10000 : 0,
    };
    if (libraryMode) {
      // Name what the network was computed from (S5's naming rule) and say
      // plainly when the library carries no links to compute over.
      const pairs = new Set();
      for (const p of papers) {
        for (const ref of p.references || []) pairs.add([p.id, ref].sort().join("|"));
      }
      result.source = "library";
      result.linkCount = pairs.size;
      if (pairs.size === 0) {
        result.message = "No related-reference links in your library yet — link related references from a reference's detail view and the network is computed from those links.";
      }
    }
    return { ok: true, result };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * methodologyScore
   * Evaluate research methodology quality against a scoring rubric.
   * artifact.data.methodology = {
   *   sampleSize?, controlGroup?, randomization?, blinding?,
   *   measurementValidation?, statisticalTests?, effectSize?,
   *   confidenceIntervals?, reproducibilityInfo?, preregistered?,
   *   conflictsOfInterest?, ethicsApproval?, dataAvailability?
   * }
   */
  registerLensAction("research", "methodologyScore", (ctx, artifact, _params) => {
  try {
    const m = artifact.data?.methodology || {};

    // Rubric criteria with weights
    const criteria = [
      { name: "Sample Size", key: "sampleSize", weight: 12, evaluate: (v) => {
        if (!v) return { score: 0, note: "Not reported" };
        const n = parseInt(v);
        if (isNaN(n)) return { score: 6, note: "Reported but not numeric" };
        if (n >= 1000) return { score: 12, note: "Large sample (≥1000)" };
        if (n >= 100) return { score: 10, note: "Adequate sample (≥100)" };
        if (n >= 30) return { score: 7, note: "Small sample (30-99)" };
        return { score: 3, note: "Very small sample (<30)" };
      }},
      { name: "Control Group", key: "controlGroup", weight: 10, evaluate: (v) =>
        v === true ? { score: 10, note: "Control group present" }
        : v === "partial" ? { score: 5, note: "Partial control" }
        : { score: 0, note: "No control group" }
      },
      { name: "Randomization", key: "randomization", weight: 10, evaluate: (v) =>
        v === true ? { score: 10, note: "Randomized" }
        : v === "quasi" ? { score: 5, note: "Quasi-randomized" }
        : { score: 0, note: "Not randomized" }
      },
      { name: "Blinding", key: "blinding", weight: 8, evaluate: (v) =>
        v === "double" ? { score: 8, note: "Double-blind" }
        : v === "single" ? { score: 5, note: "Single-blind" }
        : v === true ? { score: 5, note: "Blinded" }
        : { score: 0, note: "Not blinded" }
      },
      { name: "Measurement Validation", key: "measurementValidation", weight: 8, evaluate: (v) =>
        v === true ? { score: 8, note: "Validated instruments" } : { score: 0, note: "Not reported" }
      },
      { name: "Statistical Tests", key: "statisticalTests", weight: 8, evaluate: (v) =>
        v === true || (Array.isArray(v) && v.length > 0) ? { score: 8, note: "Appropriate tests used" }
        : { score: 0, note: "Not specified" }
      },
      { name: "Effect Size", key: "effectSize", weight: 8, evaluate: (v) =>
        v === true || v != null ? { score: 8, note: "Reported" } : { score: 0, note: "Not reported" }
      },
      { name: "Confidence Intervals", key: "confidenceIntervals", weight: 7, evaluate: (v) =>
        v === true ? { score: 7, note: "Reported" } : { score: 0, note: "Not reported" }
      },
      { name: "Reproducibility Info", key: "reproducibilityInfo", weight: 8, evaluate: (v) =>
        v === true ? { score: 8, note: "Materials/procedures documented" } : { score: 0, note: "Not provided" }
      },
      { name: "Pre-registration", key: "preregistered", weight: 7, evaluate: (v) =>
        v === true ? { score: 7, note: "Pre-registered" } : { score: 0, note: "Not pre-registered" }
      },
      { name: "Conflicts of Interest", key: "conflictsOfInterest", weight: 5, evaluate: (v) =>
        v === "none" || v === false ? { score: 5, note: "No conflicts declared" }
        : v === true || v === "declared" ? { score: 3, note: "Conflicts declared" }
        : { score: 0, note: "Not addressed" }
      },
      { name: "Ethics Approval", key: "ethicsApproval", weight: 5, evaluate: (v) =>
        v === true ? { score: 5, note: "Ethics approved" } : { score: 0, note: "Not reported" }
      },
      { name: "Data Availability", key: "dataAvailability", weight: 4, evaluate: (v) =>
        v === true || v === "open" ? { score: 4, note: "Open data" }
        : v === "upon-request" ? { score: 2, note: "Available on request" }
        : { score: 0, note: "Not available" }
      },
    ];

    const results = criteria.map(c => {
      const result = c.evaluate(m[c.key]);
      return { criterion: c.name, maxScore: c.weight, ...result, percentage: Math.round((result.score / c.weight) * 100) };
    });

    const totalScore = results.reduce((s, r) => s + r.score, 0);
    const maxTotal = results.reduce((s, r) => s + r.maxScore, 0);
    const percentage = Math.round((totalScore / maxTotal) * 100);

    const strengths = results.filter(r => r.percentage >= 80).map(r => r.criterion);
    const weaknesses = results.filter(r => r.percentage === 0).map(r => r.criterion);

    // Evidence level classification (simplified Oxford levels)
    let evidenceLevel;
    if (m.randomization === true && m.controlGroup === true && m.blinding === "double") evidenceLevel = "1a (Systematic review of RCTs)";
    else if (m.randomization === true && m.controlGroup === true) evidenceLevel = "1b (Individual RCT)";
    else if (m.controlGroup === true) evidenceLevel = "2b (Cohort study)";
    else if (m.sampleSize) evidenceLevel = "3 (Case-control study)";
    else evidenceLevel = "4 (Case series / expert opinion)";

    return {
      ok: true, result: {
        totalScore, maxTotal, percentage,
        grade: percentage >= 90 ? "A" : percentage >= 75 ? "B" : percentage >= 60 ? "C" : percentage >= 40 ? "D" : "F",
        criteria: results,
        strengths, weaknesses,
        evidenceLevel,
        recommendations: weaknesses.map(w => `Address: ${w}`).slice(0, 5),
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * reproducibilityCheck
   * Assess reproducibility indicators from reported methodology and results.
   * artifact.data.study = { pValues?, sampleSizes?, effectSizes?,
   *   materialsSections?, codeAvailable?, dataAvailable?, protocolRegistered?,
   *   replicationAttempts?, title? }
   *
   * Opt-in persistence: pass artifact.data.mint === true (or params.mint === true)
   * to also mint the computed assessment as a real, citable DTU. The DTU's
   * creti/meta are built ONLY from the `result` this handler actually computed
   * — never invented — and are bound to the exact `study` input via a real
   * SHA-256 content hash (reusing dtu-protocol.js's canonical hasher, not new
   * crypto). This turns a reproducibility score from a one-off API response
   * into a durable, checkable claim (the "reproducible research forge" gap).
   */
  registerLensAction("research", "reproducibilityCheck", async (ctx, artifact, params = {}) => {
  try {
    const study = artifact.data?.study || {};

    const checks = [];
    let totalWeight = 0, totalScore = 0;

    // 1. P-value distribution check (p-hacking detection)
    const pValues = study.pValues || [];
    if (pValues.length > 0) {
      const justBelow05 = pValues.filter(p => p >= 0.04 && p < 0.05).length;
      const justAbove05 = pValues.filter(p => p > 0.05 && p <= 0.06).length;
      const suspiciousRatio = pValues.length > 0 ? justBelow05 / pValues.length : 0;
      const pHackingRisk = suspiciousRatio > 0.3 ? "high" : suspiciousRatio > 0.1 ? "moderate" : "low";

      // P-curve shape: healthy = right-skewed (more small p-values)
      const below01 = pValues.filter(p => p < 0.01).length;
      const between01and05 = pValues.filter(p => p >= 0.01 && p < 0.05).length;
      const pCurveHealthy = below01 > between01and05;

      const score = pHackingRisk === "low" && pCurveHealthy ? 20 : pHackingRisk === "low" ? 15 : pHackingRisk === "moderate" ? 8 : 2;
      checks.push({
        name: "P-value distribution",
        score, maxScore: 20,
        details: { totalPValues: pValues.length, justBelow05, justAbove05, pHackingRisk, pCurveHealthy },
      });
      totalWeight += 20; totalScore += score;
    }

    // 2. Statistical power check
    const sampleSizes = study.sampleSizes || [];
    const effectSizes = study.effectSizes || [];
    if (sampleSizes.length > 0 && effectSizes.length > 0) {
      // Rough power estimate: small effects need large samples
      const avgN = sampleSizes.reduce((s, n) => s + n, 0) / sampleSizes.length;
      const avgEffect = effectSizes.reduce((s, d) => s + Math.abs(d), 0) / effectSizes.length;
      const estimatedPower = Math.min(1, avgEffect * Math.sqrt(avgN) / 2.8); // rough approximation

      const adequate = estimatedPower >= 0.8;
      const score = adequate ? 20 : estimatedPower >= 0.5 ? 12 : 5;
      checks.push({
        name: "Statistical power",
        score, maxScore: 20,
        details: { avgSampleSize: Math.round(avgN), avgEffectSize: Math.round(avgEffect * 1000) / 1000, estimatedPower: Math.round(estimatedPower * 100), adequate },
      });
      totalWeight += 20; totalScore += score;
    }

    // 3. Transparency checks
    const transparencyItems = [
      { name: "Materials/methods detail", available: !!study.materialsSections, weight: 10 },
      { name: "Code availability", available: !!study.codeAvailable, weight: 10 },
      { name: "Data availability", available: !!study.dataAvailable, weight: 10 },
      { name: "Protocol pre-registered", available: !!study.protocolRegistered, weight: 10 },
    ];

    for (const item of transparencyItems) {
      const score = item.available ? item.weight : 0;
      checks.push({ name: item.name, score, maxScore: item.weight, details: { available: item.available } });
      totalWeight += item.weight; totalScore += score;
    }

    // 4. Prior replications
    const reps = study.replicationAttempts || [];
    if (reps.length > 0) {
      const successful = reps.filter(r => r.replicated === true).length;
      const rate = successful / reps.length;
      const score = rate >= 0.8 ? 20 : rate >= 0.5 ? 12 : rate > 0 ? 6 : 0;
      checks.push({
        name: "Replication record",
        score, maxScore: 20,
        details: { attempts: reps.length, successful, rate: Math.round(rate * 100) },
      });
      totalWeight += 20; totalScore += score;
    }

    const percentage = totalWeight > 0 ? Math.round((totalScore / totalWeight) * 100) : 0;

    const result = {
      checks,
      overallScore: totalScore, maxScore: totalWeight,
      reproducibilityPercentage: percentage,
      assessment: percentage >= 80 ? "highly-reproducible"
        : percentage >= 60 ? "moderately-reproducible"
          : percentage >= 40 ? "concerns-noted"
            : "low-reproducibility",
      criticalIssues: checks.filter(c => c.score < c.maxScore * 0.3).map(c => c.name),
    };

    // ── Opt-in mint: persist this exact computed result as a citable DTU ──
    const wantsMint = artifact.data?.mint === true || params?.mint === true;
    if (wantsMint && ctx?.macro?.run) {
      const studyContentHash = computeContentHash(study);
      const studyLabel = String(study.title || study.studyTitle || "").trim()
        || `study-${studyContentHash.slice(0, 8)}`;
      const title = `Reproducibility assessment: ${studyLabel}`;
      const creti = [
        title,
        "",
        `Reproducibility: ${result.reproducibilityPercentage}% (${result.assessment})`,
        `Score: ${result.overallScore}/${result.maxScore}`,
        result.criticalIssues.length
          ? `Critical issues: ${result.criticalIssues.join(", ")}`
          : "No critical issues flagged.",
      ].join("\n");
      // Real, non-fabricated `core` — every entry traces directly to a
      // field already present on `result`. This is what makes the DTU
      // substantive enough to legitimately clear councilGate's structured-
      // field bar (>=2 for an automated/system write) on its own merit,
      // rather than by weakening the gate.
      const coreClaims = [
        `Reproducibility: ${result.reproducibilityPercentage}% (${result.assessment})`,
        ...result.checks.map(c => `${c.name}: ${c.score}/${c.maxScore}`),
      ];
      const coreInvariants = result.criticalIssues.map(
        name => `Critical issue flagged: ${name} scored below 30% of its available weight.`
      );
      const mintRes = await ctx.macro.run("dtu", "create", {
        title,
        creti,
        core: {
          claims: coreClaims,
          ...(coreInvariants.length ? { invariants: coreInvariants } : {}),
        },
        tags: ["research", "reproducibility", "verification"],
        source: "research-reproducibility-check",
        meta: {
          check: result,
          // C2PA-style binding: proves this assessment was computed from
          // THIS exact study payload — reuses dtu-protocol.js's canonical
          // sha256 hasher rather than inventing new crypto.
          provenance: {
            studyContentHash,
            stampedAt: new Date().toISOString(),
          },
        },
      });
      if (mintRes?.ok && mintRes.dtu) {
        result.minted = true;
        result.dtuId = mintRes.dtu.id;
      } else {
        result.minted = false;
        result.mintError = mintRes?.error || "dtu_create_failed";
      }
    }

    return { ok: true, result };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ─── 2026 parity — Notion/Roam/Obsidian/Logseq second-brain ──

  function getResearchState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.researchLens) {
      STATE.researchLens = {
        notes: new Map(),         // userId -> Map<noteId, note>
        dailyByDate: new Map(),   // userId -> Map<YYYY-MM-DD, noteId>
      };
    }
    const s = STATE.researchLens;
    // Zotero-parity buckets (backfilled append-only).
    for (const k of ["references", "collections", "annotations"]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }
  function saveResearchState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  function researchActor(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }
  function nextResId(p) { return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
  function nowIsoRes() { return new Date().toISOString(); }
  function todayIso() { return nowIsoRes().slice(0, 10); }

  const TEMPLATES = {
    meeting:       { title: "Meeting notes",       body: "## Date\n\n## Attendees\n\n## Agenda\n\n## Decisions\n\n## Action items\n- [ ] " },
    weekly_review: { title: "Weekly review",       body: "## What I shipped\n\n## What I learned\n\n## What's stuck\n\n## Next week priorities\n- [ ] " },
    book_note:     { title: "Book note",           body: "## Title\n## Author\n## Why I read it\n\n## Key ideas\n\n## Quotes\n\n## My take" },
    paper_note:    { title: "Paper note",          body: "## Citation\n## TL;DR\n\n## Methods\n\n## Findings\n\n## Critique\n\n## Cited references" },
    project_brief: { title: "Project brief",       body: "## Goal\n\n## Success criteria\n\n## Out of scope\n\n## Open questions\n\n## Plan" },
    decision_log:  { title: "Decision log",        body: "## Decision\n\n## Context\n\n## Options considered\n\n## Chosen path\n\n## Tradeoffs" },
  };

  // ── Notes CRUD ──

  registerLensAction("research", "note-create", (ctx, _artifact, params = {}) => {
  try {
    const s = getResearchState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = researchActor(ctx);
    const title = String(params.title || "").trim();
    if (!title) return { ok: false, error: "title required" };
    if (title.length > 200) return { ok: false, error: "title too long (max 200)" };
    const body = String(params.body || "");
    if (body.length > 100_000) return { ok: false, error: "body too long (max 100000)" };
    const tags = Array.isArray(params.tags) ? params.tags.slice(0, 20).map(String) : [];
    const note = {
      id: nextResId("note"),
      title, body, tags,
      createdAt: nowIsoRes(),
      updatedAt: nowIsoRes(),
    };
    if (!s.notes.has(userId)) s.notes.set(userId, new Map());
    s.notes.get(userId).set(note.id, note);
    saveResearchState();
    return { ok: true, result: { note } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("research", "note-update", (ctx, _artifact, params = {}) => {
    const s = getResearchState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = researchActor(ctx);
    const id = String(params.id || "");
    if (!id) return { ok: false, error: "id required" };
    const map = s.notes.get(userId);
    if (!map || !map.has(id)) return { ok: false, error: "not found" };
    const n = map.get(id);
    if (typeof params.title === "string") n.title = params.title.trim().slice(0, 200);
    if (typeof params.body === "string") n.body = params.body.slice(0, 100_000);
    if (Array.isArray(params.tags)) n.tags = params.tags.slice(0, 20).map(String);
    n.updatedAt = nowIsoRes();
    saveResearchState();
    return { ok: true, result: { note: n } };
  });

  registerLensAction("research", "note-delete", (ctx, _artifact, params = {}) => {
    const s = getResearchState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = researchActor(ctx);
    const id = String(params.id || "");
    if (!id) return { ok: false, error: "id required" };
    const map = s.notes.get(userId);
    if (!map || !map.has(id)) return { ok: false, error: "not found" };
    map.delete(id);
    saveResearchState();
    return { ok: true, result: { deleted: id } };
  });

  registerLensAction("research", "notes-list", (ctx, _artifact, _params = {}) => {
    const s = getResearchState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = researchActor(ctx);
    const map = s.notes.get(userId);
    if (!map) return { ok: true, result: { notes: [] } };
    const notes = Array.from(map.values())
      .reverse()
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .map(({ body, ...rest }) => ({ ...rest, preview: body.slice(0, 200) }));
    return { ok: true, result: { notes } };
  });

  registerLensAction("research", "note-get", (ctx, _artifact, params = {}) => {
    const s = getResearchState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = researchActor(ctx);
    const id = String(params.id || "");
    if (!id) return { ok: false, error: "id required" };
    const map = s.notes.get(userId);
    if (!map || !map.has(id)) return { ok: false, error: "not found" };
    return { ok: true, result: { note: map.get(id) } };
  });

  // ── Daily journal ──

  registerLensAction("research", "daily-note", (ctx, _artifact, params = {}) => {
    const s = getResearchState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = researchActor(ctx);
    const date = String(params.date || todayIso());
    if (!s.dailyByDate.has(userId)) s.dailyByDate.set(userId, new Map());
    const dailyMap = s.dailyByDate.get(userId);
    let noteId = dailyMap.get(date);
    if (!noteId) {
      // Create new daily note
      if (!s.notes.has(userId)) s.notes.set(userId, new Map());
      const note = {
        id: nextResId("daily"),
        title: `Daily — ${date}`,
        body: `# ${date}\n\n## What I'm working on today\n\n## Notes\n\n## Tomorrow`,
        tags: ["daily"],
        createdAt: nowIsoRes(),
        updatedAt: nowIsoRes(),
      };
      s.notes.get(userId).set(note.id, note);
      dailyMap.set(date, note.id);
      saveResearchState();
      return { ok: true, result: { note, created: true } };
    }
    const note = s.notes.get(userId).get(noteId);
    return { ok: true, result: { note, created: false } };
  });

  // ── Templates ──

  registerLensAction("research", "templates-list", (_ctx, _artifact, _params = {}) => {
    return { ok: true, result: { templates: Object.entries(TEMPLATES).map(([id, t]) => ({ id, ...t })) } };
  });

  registerLensAction("research", "template-apply", (_ctx, _artifact, params = {}) => {
    const id = String(params.id || "");
    const t = TEMPLATES[id];
    if (!t) return { ok: false, error: `unknown template: ${id}` };
    return { ok: true, result: { template: { id, ...t } } };
  });

  // ── Backlinks (mentions of [[note title]]) ──

  registerLensAction("research", "backlinks-for", (ctx, _artifact, params = {}) => {
  try {
    const s = getResearchState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = researchActor(ctx);
    const title = String(params.title || "").trim();
    if (!title) return { ok: false, error: "title required" };
    const wikiRef = `[[${title}]]`;
    const map = s.notes.get(userId);
    if (!map) return { ok: true, result: { backlinks: [] } };
    const hits = [];
    for (const n of map.values()) {
      if (n.title === title) continue;
      if (n.body.includes(wikiRef)) {
        // Find context around the mention
        const idx = n.body.indexOf(wikiRef);
        const start = Math.max(0, idx - 80);
        const end = Math.min(n.body.length, idx + wikiRef.length + 80);
        hits.push({
          noteId: n.id,
          noteTitle: n.title,
          context: n.body.slice(start, end),
        });
      }
    }
    return { ok: true, result: { backlinks: hits, count: hits.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Note search (full-text) ──

  registerLensAction("research", "notes-search", (ctx, _artifact, params = {}) => {
  try {
    const s = getResearchState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = researchActor(ctx);
    const query = String(params.query || "").trim().toLowerCase();
    if (!query) return { ok: false, error: "query required" };
    if (query.length < 2) return { ok: false, error: "query too short" };
    const map = s.notes.get(userId);
    if (!map) return { ok: true, result: { hits: [] } };
    const terms = query.split(/\s+/).filter(Boolean);
    const hits = [];
    for (const n of map.values()) {
      const titleLower = n.title.toLowerCase();
      const bodyLower = n.body.toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (titleLower.includes(t)) score += 5;
        if (bodyLower.includes(t)) score += 1;
      }
      if (score > 0) {
        hits.push({ id: n.id, title: n.title, score, preview: n.body.slice(0, 200), updatedAt: n.updatedAt });
      }
    }
    hits.sort((a, b) => b.score - a.score);
    return { ok: true, result: { hits: hits.slice(0, 50), count: hits.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ─── Zotero 2026 parity — reference manager ─────────────────────────
  // A library of references, collections, tags, reading status,
  // annotations, related items and citation/bibliography formatting.

  const rfId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const rfNow = () => new Date().toISOString();
  const rfAid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const rfListB = (map, k) => { if (!map.has(k)) map.set(k, []); return map.get(k); };
  const rfNum = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const rfClean = (v, max = 400) => String(v == null ? "" : v).trim().slice(0, max);
  const findRef = (s, userId, id) => (s.references.get(userId) || []).find((r) => r.id === id) || null;
  const REF_TYPES = ["article", "book", "chapter", "conference", "thesis", "report", "webpage", "preprint", "dataset"];
  const READ_STATUS = ["to_read", "reading", "read"];

  function normTags(raw) {
    if (!Array.isArray(raw)) return [];
    return [...new Set(raw.map((t) => rfClean(t, 40).toLowerCase()).filter(Boolean))].slice(0, 30);
  }
  function citationKey(ref) {
    const firstAuthor = rfClean(ref.authors, 400).split(/[,;&]/)[0].trim().split(/\s+/).pop() || "ref";
    return `${firstAuthor.toLowerCase().replace(/[^a-z]/g, "")}${ref.year || ""}`;
  }

  // ── S7 (F10): citation strictness — CSL-as-data ────────────────────
  // The four styles genuinely reformatted before S7, but the output was
  // not strict: APA printed full first names ("David Silver, Aja
  // Huang, …") where APA requires surnames + initials. Style rules now
  // live in CITATION_STYLES as data (author form, list truncation /
  // et-al rule, separators, year placement, title casing, DOI form),
  // and formatCitation — the ONE engine behind reference-detail,
  // cite-format, bibliography-build and generate-bibliography —
  // consumes the table. No external CSL processor and no new
  // dependency: the style set is small and the rules are data, per
  // research.md §7 S7 ("CSL-as-data rather than hand-rolled formats").
  //
  // Stored refs carry authors as ONE display string in natural order
  // ("David Silver, Aja Huang, …"): every importer joins display names
  // with ", " (Crossref maps given+family, OpenAlex uses display_name,
  // the arXiv parser takes feed names). parseAuthors therefore treats
  // comma/semicolon segments as natural-order names, with two guarded
  // recognitions for hand-entered inverted text: alternating
  // "Family, Initials" pairs ("Vaswani, A.", "Silver, D., Hassabis,
  // D."), and a lone single-token "Family, Given…" pair ("Silver,
  // David" — the manual-add fixture form). Anything that cannot be
  // split safely — a single token, an organisation, an all-caps name —
  // is kept literal and renders exactly as stored: the parser never
  // invents a split it cannot justify.
  const NAME_PARTICLES = new Set(["van", "von", "der", "den", "ten", "ter", "de", "del", "della", "di", "da", "du", "la", "le", "bin", "ibn", "al"]);
  const NAME_SUFFIXES = { jr: "Jr.", sr: "Sr.", ii: "II", iii: "III", iv: "IV" };
  const ORG_TOKENS = new Set(["university", "institute", "institution", "organization", "organisation", "association", "society", "committee", "commission", "council", "foundation", "consortium", "group", "team", "corporation", "company", "inc", "ltd", "llc", "gmbh", "laboratory", "laboratories", "centre", "center", "department", "ministry", "agency", "academy", "college", "school", "hospital", "press", "publishers", "publishing", "editors", "editorial", "board", "network", "initiative", "project", "consortium"]);
  const isInitialsOnly = (seg) => seg.length > 0 && seg.split(/\s+/).every((t) => /^(\p{Lu}\.)+$/u.test(t) || /^\p{Lu}$/u.test(t));

  function splitSuffix(tokens) {
    const out = [...tokens];
    let suffix = null;
    while (out.length > 1) {
      const key = out[out.length - 1].toLowerCase().replace(/\.$/, "");
      if (NAME_SUFFIXES[key]) { suffix = NAME_SUFFIXES[key]; out.pop(); } else break;
    }
    return { tokens: out, suffix };
  }
  function makeInvertedAuthor(familyRaw, givenTokens) {
    const fam = splitSuffix(familyRaw.split(/\s+/).filter(Boolean));
    return { family: fam.tokens.join(" "), given: givenTokens, suffix: fam.suffix, literal: false, raw: null };
  }
  function parseNaturalAuthor(seg) {
    const tokens = seg.split(/\s+/).filter(Boolean);
    if (tokens.length <= 1) return { family: tokens[0] || seg, given: [], suffix: null, literal: true, raw: seg };
    // Organisations and all-caps names render as stored, never split.
    const plain = tokens.map((t) => t.toLowerCase().replace(/[^\p{L}]/gu, ""));
    if (plain.some((t) => ORG_TOKENS.has(t))) return { family: seg, given: [], suffix: null, literal: true, raw: seg };
    if (seg === seg.toUpperCase() && /\p{L}{2,}/u.test(seg)) return { family: seg, given: [], suffix: null, literal: true, raw: seg };
    const { tokens: rest, suffix } = splitSuffix(tokens);
    if (rest.length <= 1) return { family: rest[0] || seg, given: [], suffix, literal: true, raw: seg };
    // Family name = last token plus any preceding name particles
    // ("George van den Driessche" → family "van den Driessche"),
    // always leaving at least one given-name token.
    let famStart = rest.length - 1;
    while (famStart > 1 && NAME_PARTICLES.has(rest[famStart - 1].toLowerCase())) famStart -= 1;
    return { family: rest.slice(famStart).join(" "), given: rest.slice(0, famStart), suffix, literal: false, raw: null };
  }
  function parseAuthors(rawAuthors) {
    const raw = rfClean(rawAuthors, 400);
    if (!raw) return [];
    const segments = raw
      .replace(/\bet\s+al\.?\s*$/i, "")
      .split(/\s*[;,]\s*|\s+&\s+/)
      .map((s) => s.replace(/^and\s+/i, "").trim())
      .filter((s) => s && !/^et\s+al\.?$/i.test(s));
    if (!segments.length) return [];
    // Inverted text, recognised only when the pattern is unambiguous:
    // an even run of segments alternating family / initials-only, or a
    // lone pair whose first segment is a single token ("Silver, David"
    // / "Silver, David J") — importers never produce either shape for
    // a multi-author natural-order list (their first segment always
    // carries a given name), so the recognition cannot misfire on
    // imported records.
    if (segments.length >= 2 && segments.length % 2 === 0) {
      let inverted = true;
      for (let i = 0; i < segments.length; i += 2) {
        if (isInitialsOnly(segments[i]) || !isInitialsOnly(segments[i + 1])) { inverted = false; break; }
      }
      if (inverted) {
        const out = [];
        for (let i = 0; i < segments.length; i += 2) out.push(makeInvertedAuthor(segments[i], segments[i + 1].split(/\s+/)));
        return out;
      }
    }
    if (segments.length === 2 && !segments[0].includes(" ")) {
      return [makeInvertedAuthor(segments[0], segments[1].split(/\s+/))];
    }
    return segments.map(parseNaturalAuthor);
  }
  function initialGroups(author) {
    return author.given
      .map((tok) => tok.split("-").map((part) => {
        const m = part.match(/\p{L}/u);
        return m ? m[0].toUpperCase() : "";
      }).filter(Boolean))
      .filter((g) => g.length);
  }
  // "C. J." — hyphenated given names keep the hyphen: "Jean-Luc" → "J.-L."
  const initialsSpaced = (a) => initialGroups(a).map((g) => g.map((l) => `${l}.`).join("-")).join(" ");
  const initialsCompact = (a) => initialGroups(a).flat().join("");
  function authorApaForm(a) {
    if (a.literal) return a.raw;
    const ini = initialsSpaced(a);
    let out = ini ? `${a.family}, ${ini}` : a.family;
    if (a.suffix) out += `, ${a.suffix}`;
    return out;
  }
  function authorInvertedFull(a) {
    if (a.literal) return a.raw;
    const given = a.given.join(" ");
    let out = given ? `${a.family}, ${given}` : a.family;
    if (a.suffix) out += `, ${a.suffix}`;
    return out;
  }
  function authorNaturalForm(a) {
    if (a.literal) return a.raw;
    const given = a.given.join(" ");
    let out = given ? `${given} ${a.family}` : a.family;
    if (a.suffix) out += ` ${a.suffix}`;
    return out;
  }
  function authorVancouverForm(a) {
    if (a.literal) return a.raw;
    const ini = initialsCompact(a);
    let out = ini ? `${a.family} ${ini}` : a.family;
    if (a.suffix) out += ` ${a.suffix}`;
    return out;
  }
  function formatAuthorList(authors, def) {
    let forms;
    if (def.authorForm === "first-inverted-rest-natural") {
      forms = authors.map((a, i) => (i === 0 ? authorInvertedFull(a) : authorNaturalForm(a)));
    } else if (def.authorForm === "family-initials-compact") {
      forms = authors.map(authorVancouverForm);
    } else {
      forms = authors.map(authorApaForm);
    }
    if (def.etAl && authors.length >= def.etAl.minAuthors) {
      return `${forms.slice(0, def.etAl.listCount).join(def.separator)}, et al.`;
    }
    if (def.ellipsisAfter && authors.length > def.ellipsisAfter) {
      // APA 7 §9.8: 21+ authors → first 19, an ellipsis, the last one.
      return `${forms.slice(0, def.ellipsisAfter - 1).join(def.separator)}, … ${forms[forms.length - 1]}`;
    }
    if (forms.length === 1) return forms[0];
    if (def.lastSeparator) return forms.slice(0, -1).join(def.separator) + def.lastSeparator + forms[forms.length - 1];
    return forms.join(def.separator);
  }
  const HEADLINE_MINOR = new Set(["a", "an", "the", "and", "but", "or", "nor", "for", "so", "yet", "at", "by", "from", "in", "into", "of", "off", "on", "onto", "out", "over", "past", "to", "up", "upon", "with", "as", "via", "per"]);
  function capFirstLetter(s, from = 0) {
    const rest = s.slice(from);
    const idx = rest.search(/\p{L}/u);
    if (idx < 0) return s;
    const i = from + idx;
    return s.slice(0, i) + rest[idx].toUpperCase() + s.slice(i + 1);
  }
  // APA sentence case: capitalise the first word and the first word of
  // a subtitle. The rest of the title is left EXACTLY as stored —
  // downcasing would corrupt proper nouns the record carries ("Go",
  // "COVID-19"), so the transform only ever raises, never lowers.
  function sentenceCaseTitle(t) {
    if (!t) return t;
    let out = capFirstLetter(t);
    const colon = out.indexOf(": ");
    if (colon >= 0) out = capFirstLetter(out, colon + 2);
    return out;
  }
  function headlineCaseTitle(t) {
    if (!t) return t;
    const parts = t.split(/(\s+)/);
    const wordIdx = [];
    parts.forEach((p, i) => { if (p.trim()) wordIdx.push(i); });
    let prevEndsColon = true; // first word always capitalised
    for (const i of wordIdx) {
      const w = parts[i];
      const isLast = i === wordIdx[wordIdx.length - 1];
      const minor = !prevEndsColon && !isLast && HEADLINE_MINOR.has(w.toLowerCase().replace(/[^\p{L}]/gu, ""));
      if (!minor) {
        parts[i] = w.split("-").map((part, j) =>
          (j > 0 && HEADLINE_MINOR.has(part.toLowerCase())) || /\p{Lu}/u.test(part.slice(1))
            ? part : capFirstLetter(part)).join("-");
      }
      prevEndsColon = /:$/.test(w);
    }
    return parts.join("");
  }
  const withDot = (s) => (/[.!?…]$/.test(s) ? s : `${s}.`);
  // Author lists can already end a sentence ("…, et al."); never double it.
  const endSentence = (s) => (/[.!?…]$/.test(s) ? s : `${s}.`);
  const quotedTitle = (t) => (/[.!?]$/.test(t) ? t : `${t}.`);

  // The style table (CSL-as-data). journalForm is "as-stored" for every
  // style: the records carry no abbreviation source (Vancouver's NLM
  // abbreviations are not in the data), so no style invents one.
  const CITATION_STYLES = {
    apa: {
      authorForm: "family-initials", // Silver, D.
      separator: ", ", lastSeparator: ", & ",
      ellipsisAfter: 20,
      year: "paren-after-authors", titleCase: "sentence", journalForm: "as-stored",
      doi: "url", // https://doi.org/…
    },
    mla: {
      authorForm: "first-inverted-rest-natural", // Silver, David / David Silver
      separator: ", ", lastSeparator: ", and ",
      etAl: { minAuthors: 3, listCount: 1 },
      year: "end-after-journal", titleCase: "headline", journalForm: "as-stored",
      doi: "url-end",
    },
    chicago: {
      authorForm: "first-inverted-rest-natural",
      separator: ", ", lastSeparator: ", and ",
      etAl: { minAuthors: 11, listCount: 7 }, // bibliography: ≤10 listed in full
      year: "paren-after-journal", titleCase: "headline", journalForm: "as-stored",
      doi: "url-end",
    },
    vancouver: {
      authorForm: "family-initials-compact", // Silver D
      separator: ", ", lastSeparator: null,
      etAl: { minAuthors: 7, listCount: 6 },
      year: "after-journal", titleCase: "as-stored", journalForm: "as-stored",
      doi: "doi-tag", // doi:10.…
    },
  };
  const CITATION_STYLE_NAMES = [...Object.keys(CITATION_STYLES), "bibtex"];

  function formatCitation(ref, style) {
    const year = ref.year || "n.d.";
    const title = rfClean(ref.title, 400);
    const journal = rfClean(ref.journal, 200);
    const doi = rfClean(ref.doi, 120);
    if (style === "bibtex") {
      const authors = rfClean(ref.authors, 400) || "Unknown";
      const fields = [
        `  title={${title}}`,
        `  author={${authors}}`,
        ref.year ? `  year={${ref.year}}` : null,
        journal ? `  journal={${journal}}` : null,
        doi ? `  doi={${doi}}` : null,
      ].filter(Boolean).join(",\n");
      return `@${ref.type === "book" ? "book" : "article"}{${citationKey(ref)},\n${fields}\n}`;
    }
    const def = CITATION_STYLES[style] || CITATION_STYLES.apa;
    const parsed = parseAuthors(ref.authors);
    const authorStr = parsed.length ? formatAuthorList(parsed, def) : "Unknown";
    const titleOut = def.titleCase === "sentence" ? sentenceCaseTitle(title)
      : def.titleCase === "headline" ? headlineCaseTitle(title) : title;
    switch (style) {
      case "mla": {
        let out = `${endSentence(authorStr)} "${quotedTitle(titleOut)}"`;
        if (journal) out += ` ${journal},`;
        out += ` ${year}`;
        if (doi) out += `, https://doi.org/${doi}`;
        return `${out}.`;
      }
      case "chicago": {
        let out = `${endSentence(authorStr)} "${quotedTitle(titleOut)}"`;
        if (journal) out += ` ${journal}`;
        out += ` (${year}).`;
        if (doi) out += ` https://doi.org/${doi}.`;
        return out;
      }
      case "vancouver": {
        let out = `${endSentence(authorStr)} ${withDot(titleOut)}`;
        if (journal) out += ` ${withDot(journal)}`;
        out += ` ${year}.`;
        if (doi) out += ` doi:${doi}.`;
        return out;
      }
      case "apa":
      default: {
        let out = `${authorStr} (${year}). ${withDot(titleOut)}`;
        if (journal) out += ` ${withDot(journal)}`;
        if (doi) out += ` https://doi.org/${doi}`;
        return out;
      }
    }
  }

  // ── References ──────────────────────────────────────────────────────
  registerLensAction("research", "reference-add", (ctx, _a, params = {}) => {
  try {
    const s = getResearchState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const title = rfClean(params.title, 400);
    if (!title) return { ok: false, error: "title required" };
    // S3 (F8): manual adds pass the same duplicate gate as imports —
    // answering with the existing record beats filing a twin by hand.
    const dup = findDuplicateRef(rfListB(s.references, rfAid(ctx)), {
      doi: params.doi, title,
      year: Number.isFinite(Number(params.year)) ? Math.round(Number(params.year)) : null,
    });
    if (dup) return { ok: true, result: { reference: dup, duplicate: true } };
    const ref = {
      id: rfId("ref"), title,
      authors: rfClean(params.authors, 400) || null,
      year: Number.isFinite(Number(params.year)) ? Math.round(Number(params.year)) : null,
      type: REF_TYPES.includes(String(params.type).toLowerCase()) ? String(params.type).toLowerCase() : "article",
      journal: rfClean(params.journal, 200) || null,
      doi: rfClean(params.doi, 120) || null,
      url: rfClean(params.url, 500) || null,
      abstract: rfClean(params.abstract, 4000) || null,
      tags: normTags(params.tags),
      status: "to_read",
      relatedIds: [],
      createdAt: rfNow(),
    };
    rfListB(s.references, rfAid(ctx)).push(ref);
    saveResearchState();
    return { ok: true, result: { reference: ref } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("research", "reference-list", (ctx, _a, params = {}) => {
    const s = getResearchState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let refs = [...(s.references.get(rfAid(ctx)) || [])];
    if (params.type) refs = refs.filter((r) => r.type === String(params.type).toLowerCase());
    if (params.tag) refs = refs.filter((r) => r.tags.includes(String(params.tag).toLowerCase()));
    if (params.status) refs = refs.filter((r) => r.status === String(params.status).toLowerCase());
    const q = rfClean(params.query, 80).toLowerCase();
    if (q) {
      refs = refs.filter((r) =>
        r.title.toLowerCase().includes(q) ||
        (r.authors || "").toLowerCase().includes(q) ||
        (r.journal || "").toLowerCase().includes(q) ||
        (r.doi || "").toLowerCase().includes(q) ||
        (r.tags || []).some((t) => t.includes(q)));
    }
    refs.sort((a, b) => (b.year || 0) - (a.year || 0) || b.createdAt.localeCompare(a.createdAt));
    return { ok: true, result: { references: refs, count: refs.length } };
  });

  registerLensAction("research", "reference-detail", (ctx, _a, params = {}) => {
  try {
    const s = getResearchState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = rfAid(ctx);
    const ref = findRef(s, userId, params.id);
    if (!ref) return { ok: false, error: "reference not found" };
    const annotations = (s.annotations.get(userId) || []).filter((a) => a.referenceId === ref.id);
    return {
      ok: true,
      result: {
        reference: ref,
        annotations,
        citations: {
          apa: formatCitation(ref, "apa"),
          mla: formatCitation(ref, "mla"),
          chicago: formatCitation(ref, "chicago"),
          vancouver: formatCitation(ref, "vancouver"),
          bibtex: formatCitation(ref, "bibtex"),
        },
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("research", "reference-update", (ctx, _a, params = {}) => {
    const s = getResearchState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const ref = findRef(s, rfAid(ctx), params.id);
    if (!ref) return { ok: false, error: "reference not found" };
    if (params.title != null) { const t = rfClean(params.title, 400); if (t) ref.title = t; }
    if (params.authors != null) ref.authors = rfClean(params.authors, 400) || null;
    if (params.year != null) ref.year = Number.isFinite(Number(params.year)) ? Math.round(Number(params.year)) : null;
    if (params.journal != null) ref.journal = rfClean(params.journal, 200) || null;
    if (params.doi != null) ref.doi = rfClean(params.doi, 120) || null;
    if (params.abstract != null) ref.abstract = rfClean(params.abstract, 4000) || null;
    if (Array.isArray(params.tags)) ref.tags = normTags(params.tags);
    saveResearchState();
    return { ok: true, result: { reference: ref } };
  });

  registerLensAction("research", "reference-delete", (ctx, _a, params = {}) => {
    const s = getResearchState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = rfAid(ctx);
    const arr = s.references.get(userId) || [];
    const i = arr.findIndex((r) => r.id === params.id);
    if (i < 0) return { ok: false, error: "reference not found" };
    arr.splice(i, 1);
    for (const c of s.collections.get(userId) || []) c.referenceIds = c.referenceIds.filter((x) => x !== params.id);
    for (const r of arr) r.relatedIds = r.relatedIds.filter((x) => x !== params.id);
    saveResearchState();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("research", "reference-set-status", (ctx, _a, params = {}) => {
    const s = getResearchState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const ref = findRef(s, rfAid(ctx), params.id);
    if (!ref) return { ok: false, error: "reference not found" };
    if (!READ_STATUS.includes(String(params.status).toLowerCase())) {
      return { ok: false, error: `status must be one of ${READ_STATUS.join("/")}` };
    }
    ref.status = String(params.status).toLowerCase();
    saveResearchState();
    return { ok: true, result: { reference: ref } };
  });

  registerLensAction("research", "reading-queue", (ctx, _a, _params = {}) => {
    const s = getResearchState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const refs = (s.references.get(rfAid(ctx)) || [])
      .filter((r) => r.status === "to_read" || r.status === "reading")
      .sort((a, b) => (a.status === "reading" ? -1 : 1) - (b.status === "reading" ? -1 : 1));
    return {
      ok: true,
      result: {
        queue: refs,
        reading: refs.filter((r) => r.status === "reading").length,
        toRead: refs.filter((r) => r.status === "to_read").length,
      },
    };
  });

  // ── Tags ────────────────────────────────────────────────────────────
  registerLensAction("research", "tag-list", (ctx, _a, _params = {}) => {
    const s = getResearchState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const counts = new Map();
    for (const r of s.references.get(rfAid(ctx)) || []) {
      for (const t of r.tags) counts.set(t, (counts.get(t) || 0) + 1);
    }
    const tags = [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count);
    return { ok: true, result: { tags } };
  });

  // ── Collections ─────────────────────────────────────────────────────
  registerLensAction("research", "collection-create", (ctx, _a, params = {}) => {
    const s = getResearchState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = rfClean(params.name, 120);
    if (!name) return { ok: false, error: "collection name required" };
    const collection = { id: rfId("col"), name, referenceIds: [], createdAt: rfNow() };
    rfListB(s.collections, rfAid(ctx)).push(collection);
    saveResearchState();
    return { ok: true, result: { collection } };
  });

  registerLensAction("research", "collection-list", (ctx, _a, _params = {}) => {
    const s = getResearchState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const collections = (s.collections.get(rfAid(ctx)) || [])
      .map((c) => ({ ...c, referenceCount: c.referenceIds.length }));
    return { ok: true, result: { collections, count: collections.length } };
  });

  registerLensAction("research", "collection-add-reference", (ctx, _a, params = {}) => {
    const s = getResearchState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = rfAid(ctx);
    const col = (s.collections.get(userId) || []).find((c) => c.id === params.collectionId);
    if (!col) return { ok: false, error: "collection not found" };
    if (!findRef(s, userId, params.referenceId)) return { ok: false, error: "reference not found" };
    if (params.remove === true) col.referenceIds = col.referenceIds.filter((x) => x !== params.referenceId);
    else if (!col.referenceIds.includes(params.referenceId)) col.referenceIds.push(String(params.referenceId));
    saveResearchState();
    return { ok: true, result: { collectionId: col.id, referenceCount: col.referenceIds.length } };
  });

  registerLensAction("research", "collection-detail", (ctx, _a, params = {}) => {
    const s = getResearchState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = rfAid(ctx);
    const col = (s.collections.get(userId) || []).find((c) => c.id === params.id);
    if (!col) return { ok: false, error: "collection not found" };
    const references = col.referenceIds.map((id) => findRef(s, userId, id)).filter(Boolean);
    return { ok: true, result: { collection: col, references } };
  });

  registerLensAction("research", "collection-delete", (ctx, _a, params = {}) => {
    const s = getResearchState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.collections.get(rfAid(ctx)) || [];
    const i = arr.findIndex((c) => c.id === params.id);
    if (i < 0) return { ok: false, error: "collection not found" };
    arr.splice(i, 1);
    saveResearchState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Related references ──────────────────────────────────────────────
  registerLensAction("research", "reference-relate", (ctx, _a, params = {}) => {
    const s = getResearchState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = rfAid(ctx);
    const a = findRef(s, userId, params.referenceId);
    const b = findRef(s, userId, params.relatedId);
    if (!a || !b) return { ok: false, error: "reference not found" };
    if (a.id === b.id) return { ok: false, error: "cannot relate a reference to itself" };
    const unrelate = params.unrelate === true;
    if (unrelate) {
      a.relatedIds = a.relatedIds.filter((x) => x !== b.id);
      b.relatedIds = b.relatedIds.filter((x) => x !== a.id);
    } else {
      if (!a.relatedIds.includes(b.id)) a.relatedIds.push(b.id);
      if (!b.relatedIds.includes(a.id)) b.relatedIds.push(a.id);
    }
    saveResearchState();
    return { ok: true, result: { related: !unrelate } };
  });

  registerLensAction("research", "reference-related", (ctx, _a, params = {}) => {
    const s = getResearchState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = rfAid(ctx);
    const ref = findRef(s, userId, params.id);
    if (!ref) return { ok: false, error: "reference not found" };
    const related = ref.relatedIds.map((id) => findRef(s, userId, id)).filter(Boolean);
    return { ok: true, result: { related, count: related.length } };
  });

  // ── Annotations ─────────────────────────────────────────────────────
  // S4 (F2): a structured anchor for reader-created annotations — the
  // page a passage sits on, plus the passage's character offsets within
  // that page's text. Offsets are null in this build: the platform has
  // no PDF text layer yet (no pdf.js in the frontend bundle, no text
  // extraction server-side — see server/domains/document.js's own
  // header), so nothing can measure them honestly. The shape is fixed
  // now so a text layer fills the same fields with no data migration.
  function cleanAnchor(raw) {
    if (!raw || typeof raw !== "object") return null;
    const pg = (v) => { if (v == null) return null; const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 1 ? n : null; };
    const off = (v) => { if (v == null) return null; const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 ? n : null; };
    const page = pg(raw.page);
    let startOffset = off(raw.startOffset);
    let endOffset = off(raw.endOffset);
    if (startOffset != null && endOffset != null && endOffset < startOffset) { startOffset = null; endOffset = null; }
    if (page == null && startOffset == null && endOffset == null) return null;
    return { page, startOffset, endOffset };
  }

  registerLensAction("research", "annotation-add", (ctx, _a, params = {}) => {
    const s = getResearchState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = rfAid(ctx);
    if (!findRef(s, userId, params.referenceId)) return { ok: false, error: "reference not found" };
    const text = rfClean(params.text, 2000);
    const quote = rfClean(params.quote, 2000);
    if (!text && !quote) return { ok: false, error: "text or quote required" };
    const anchor = cleanAnchor(params.anchor);
    const annotation = {
      id: rfId("ann"), referenceId: String(params.referenceId),
      // An explicit page param wins; an anchor's page fills in when the
      // caller (the reader) only supplied the anchor, so the existing
      // page-sorted lists and "(p.N)" surfaces keep working unchanged.
      page: (Math.max(0, Math.round(rfNum(params.page))) || null) ?? anchor?.page ?? null,
      quote: quote || null, text: text || null,
      ...(anchor ? { anchor } : {}),
      color: ["yellow", "green", "blue", "pink", "purple"].includes(String(params.color).toLowerCase())
        ? String(params.color).toLowerCase() : "yellow",
      createdAt: rfNow(),
    };
    rfListB(s.annotations, userId).push(annotation);
    saveResearchState();
    return { ok: true, result: { annotation } };
  });

  registerLensAction("research", "annotation-list", (ctx, _a, params = {}) => {
    const s = getResearchState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let annotations = [...(s.annotations.get(rfAid(ctx)) || [])];
    if (params.referenceId) annotations = annotations.filter((a) => a.referenceId === params.referenceId);
    annotations.sort((a, b) => (a.page || 0) - (b.page || 0));
    return { ok: true, result: { annotations, count: annotations.length } };
  });

  // ── Citations + bibliography ────────────────────────────────────────
  registerLensAction("research", "cite-format", (ctx, _a, params = {}) => {
  try {
    const s = getResearchState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const ref = findRef(s, rfAid(ctx), params.id);
    if (!ref) return { ok: false, error: "reference not found" };
    const style = CITATION_STYLE_NAMES.includes(String(params.style).toLowerCase())
      ? String(params.style).toLowerCase() : "apa";
    return { ok: true, result: { style, citation: formatCitation(ref, style), key: citationKey(ref) } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("research", "bibliography-build", (ctx, _a, params = {}) => {
  try {
    const s = getResearchState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = rfAid(ctx);
    const style = CITATION_STYLE_NAMES.includes(String(params.style).toLowerCase())
      ? String(params.style).toLowerCase() : "apa";
    let refs;
    if (params.collectionId) {
      const col = (s.collections.get(userId) || []).find((c) => c.id === params.collectionId);
      if (!col) return { ok: false, error: "collection not found" };
      refs = col.referenceIds.map((id) => findRef(s, userId, id)).filter(Boolean);
    } else {
      refs = [...(s.references.get(userId) || [])];
    }
    refs.sort((a, b) => rfClean(a.authors, 400).localeCompare(rfClean(b.authors, 400)));
    const entries = refs.map((r) => formatCitation(r, style));
    return {
      ok: true,
      result: {
        style, count: entries.length,
        entries,
        bibliography: entries.join(style === "bibtex" ? "\n\n" : "\n"),
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Library stats ───────────────────────────────────────────────────
  registerLensAction("research", "library-stats", (ctx, _a, _params = {}) => {
  try {
    const s = getResearchState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = rfAid(ctx);
    const refs = s.references.get(userId) || [];
    const byType = {};
    const byStatus = { to_read: 0, reading: 0, read: 0 };
    const tagSet = new Set();
    for (const r of refs) {
      byType[r.type] = (byType[r.type] || 0) + 1;
      byStatus[r.status] = (byStatus[r.status] || 0) + 1;
      for (const t of r.tags) tagSet.add(t);
    }
    return {
      ok: true,
      result: {
        references: refs.length,
        collections: (s.collections.get(userId) || []).length,
        annotations: (s.annotations.get(userId) || []).length,
        tags: tagSet.size,
        byType, byStatus,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ─── 2026 parity backlog — Obsidian graph + Elicit + live search ────
  // Backfill the extra STATE buckets used by the backlog macros.
  function getResearchStateExt() {
    const s = getResearchState();
    if (!s) return null;
    for (const k of ["snapshots", "canvases", "pdfs", "reviews", "analyses"]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }
  // Extract [[wikilink]] targets from note body.
  function wikiLinksOf(body) {
    const out = [];
    const re = /\[\[([^\]]{1,200})\]\]/g;
    let m;
    while ((m = re.exec(String(body || ""))) !== null) {
      const t = m[1].trim();
      if (t) out.push(t);
    }
    return out;
  }

  // ── Note graph — backlink network for Obsidian-style graph view ─────
  registerLensAction("research", "note-graph", (ctx, _a, _params = {}) => {
  try {
    const s = getResearchStateExt(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = researchActor(ctx);
    const map = s.notes.get(userId);
    if (!map || map.size === 0) return { ok: true, result: { nodes: [], edges: [], orphans: [] } };
    const notes = [...map.values()];
    const byTitle = new Map();
    for (const n of notes) byTitle.set(n.title, n);
    const nodes = notes.map((n) => ({
      id: n.id,
      title: n.title,
      tags: n.tags || [],
      degree: 0,
      updatedAt: n.updatedAt,
    }));
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const edges = [];
    const edgeSeen = new Set();
    for (const n of notes) {
      for (const link of wikiLinksOf(n.body)) {
        const target = byTitle.get(link);
        if (!target || target.id === n.id) continue;
        const key = `${n.id}->${target.id}`;
        if (edgeSeen.has(key)) continue;
        edgeSeen.add(key);
        edges.push({ source: n.id, target: target.id, sourceTitle: n.title, targetTitle: target.title });
        const a = nodeById.get(n.id); const b = nodeById.get(target.id);
        if (a) a.degree++;
        if (b) b.degree++;
      }
    }
    const orphans = nodes.filter((n) => n.degree === 0).map((n) => ({ id: n.id, title: n.title }));
    return {
      ok: true,
      result: {
        nodes: nodes.sort((a, b) => b.degree - a.degree),
        edges,
        orphans,
        stats: { noteCount: nodes.length, linkCount: edges.length, orphanCount: orphans.length },
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Note titles — autocomplete source for inline [[wikilinks]] ──────
  registerLensAction("research", "note-titles", (ctx, _a, params = {}) => {
    const s = getResearchState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = researchActor(ctx);
    const map = s.notes.get(userId);
    if (!map) return { ok: true, result: { titles: [] } };
    const q = String(params.query || "").trim().toLowerCase();
    let titles = [...map.values()].reverse().map((n) => ({ id: n.id, title: n.title, updatedAt: n.updatedAt }));
    if (q) titles = titles.filter((t) => t.title.toLowerCase().includes(q));
    titles.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return { ok: true, result: { titles: titles.slice(0, 30), count: titles.length } };
  });

  // ── Note snapshots — version history per note ───────────────────────
  registerLensAction("research", "note-snapshot", (ctx, _a, params = {}) => {
    const s = getResearchStateExt(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = researchActor(ctx);
    const noteId = String(params.noteId || params.id || "");
    if (!noteId) return { ok: false, error: "noteId required" };
    const map = s.notes.get(userId);
    if (!map || !map.has(noteId)) return { ok: false, error: "note not found" };
    const n = map.get(noteId);
    if (!s.snapshots.has(userId)) s.snapshots.set(userId, new Map());
    const userSnaps = s.snapshots.get(userId);
    if (!userSnaps.has(noteId)) userSnaps.set(noteId, []);
    const list = userSnaps.get(noteId);
    const snap = {
      id: nextResId("snap"),
      noteId,
      title: n.title,
      body: n.body,
      tags: [...(n.tags || [])],
      label: String(params.label || "").trim().slice(0, 120) || null,
      createdAt: nowIsoRes(),
    };
    list.unshift(snap);
    if (list.length > 50) list.length = 50; // cap version history
    saveResearchState();
    return { ok: true, result: { snapshot: { ...snap, body: undefined, bodyLength: snap.body.length } } };
  });

  registerLensAction("research", "note-snapshots", (ctx, _a, params = {}) => {
    const s = getResearchStateExt(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = researchActor(ctx);
    const noteId = String(params.noteId || params.id || "");
    if (!noteId) return { ok: false, error: "noteId required" };
    const list = (s.snapshots.get(userId) || new Map()).get(noteId) || [];
    return {
      ok: true,
      result: {
        snapshots: list.map((sn) => ({
          id: sn.id, noteId: sn.noteId, title: sn.title, label: sn.label,
          createdAt: sn.createdAt, bodyLength: sn.body.length, tags: sn.tags,
        })),
        count: list.length,
      },
    };
  });

  registerLensAction("research", "note-snapshot-get", (ctx, _a, params = {}) => {
    const s = getResearchStateExt(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = researchActor(ctx);
    const noteId = String(params.noteId || "");
    const snapshotId = String(params.snapshotId || params.id || "");
    if (!noteId || !snapshotId) return { ok: false, error: "noteId and snapshotId required" };
    const list = (s.snapshots.get(userId) || new Map()).get(noteId) || [];
    const snap = list.find((sn) => sn.id === snapshotId);
    if (!snap) return { ok: false, error: "snapshot not found" };
    return { ok: true, result: { snapshot: snap } };
  });

  registerLensAction("research", "note-restore", (ctx, _a, params = {}) => {
    const s = getResearchStateExt(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = researchActor(ctx);
    const noteId = String(params.noteId || "");
    const snapshotId = String(params.snapshotId || "");
    if (!noteId || !snapshotId) return { ok: false, error: "noteId and snapshotId required" };
    const map = s.notes.get(userId);
    if (!map || !map.has(noteId)) return { ok: false, error: "note not found" };
    const list = (s.snapshots.get(userId) || new Map()).get(noteId) || [];
    const snap = list.find((sn) => sn.id === snapshotId);
    if (!snap) return { ok: false, error: "snapshot not found" };
    const n = map.get(noteId);
    // Snapshot the current state before overwriting so restore is reversible.
    if (!s.snapshots.has(userId)) s.snapshots.set(userId, new Map());
    if (!s.snapshots.get(userId).has(noteId)) s.snapshots.get(userId).set(noteId, []);
    s.snapshots.get(userId).get(noteId).unshift({
      id: nextResId("snap"), noteId, title: n.title, body: n.body,
      tags: [...(n.tags || [])], label: "auto: before restore", createdAt: nowIsoRes(),
    });
    n.title = snap.title;
    n.body = snap.body;
    n.tags = [...snap.tags];
    n.updatedAt = nowIsoRes();
    saveResearchState();
    return { ok: true, result: { note: n, restoredFrom: snapshotId } };
  });

  // ── Canvas / spatial board for arranging notes ──────────────────────
  registerLensAction("research", "canvas-save", (ctx, _a, params = {}) => {
  try {
    const s = getResearchStateExt(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = researchActor(ctx);
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    if (name.length > 120) return { ok: false, error: "name too long (max 120)" };
    const rawCards = Array.isArray(params.cards) ? params.cards : [];
    if (rawCards.length > 200) return { ok: false, error: "too many cards (max 200)" };
    const cards = rawCards.map((c) => ({
      id: String(c.id || nextResId("card")),
      kind: ["note", "text", "link", "reference"].includes(String(c.kind)) ? String(c.kind) : "text",
      noteId: c.noteId ? String(c.noteId) : null,
      referenceId: c.referenceId ? String(c.referenceId) : null,
      text: String(c.text || "").slice(0, 2000),
      x: Number.isFinite(Number(c.x)) ? Math.round(Number(c.x)) : 0,
      y: Number.isFinite(Number(c.y)) ? Math.round(Number(c.y)) : 0,
      w: Number.isFinite(Number(c.w)) ? Math.max(80, Math.round(Number(c.w))) : 200,
      h: Number.isFinite(Number(c.h)) ? Math.max(60, Math.round(Number(c.h))) : 120,
      color: String(c.color || "slate"),
    }));
    const rawEdges = Array.isArray(params.edges) ? params.edges : [];
    const edges = rawEdges.slice(0, 400).map((e) => ({
      id: String(e.id || nextResId("cedge")),
      from: String(e.from || ""),
      to: String(e.to || ""),
      label: String(e.label || "").slice(0, 80),
    })).filter((e) => e.from && e.to);
    if (!s.canvases.has(userId)) s.canvases.set(userId, new Map());
    const userCanvases = s.canvases.get(userId);
    let canvas;
    const id = String(params.id || "");
    if (id && userCanvases.has(id)) {
      canvas = userCanvases.get(id);
      canvas.name = name;
      canvas.cards = cards;
      canvas.edges = edges;
      canvas.updatedAt = nowIsoRes();
    } else {
      canvas = {
        id: nextResId("canvas"), name, cards, edges,
        createdAt: nowIsoRes(), updatedAt: nowIsoRes(),
      };
      userCanvases.set(canvas.id, canvas);
    }
    saveResearchState();
    return { ok: true, result: { canvas } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("research", "canvas-list", (ctx, _a, _params = {}) => {
    const s = getResearchStateExt(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = researchActor(ctx);
    const map = s.canvases.get(userId);
    if (!map) return { ok: true, result: { canvases: [] } };
    const canvases = [...map.values()]
      .reverse()
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .map((c) => ({ id: c.id, name: c.name, cardCount: c.cards.length, edgeCount: c.edges.length, updatedAt: c.updatedAt }));
    return { ok: true, result: { canvases, count: canvases.length } };
  });

  registerLensAction("research", "canvas-get", (ctx, _a, params = {}) => {
    const s = getResearchStateExt(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = researchActor(ctx);
    const id = String(params.id || "");
    if (!id) return { ok: false, error: "id required" };
    const map = s.canvases.get(userId);
    if (!map || !map.has(id)) return { ok: false, error: "canvas not found" };
    return { ok: true, result: { canvas: map.get(id) } };
  });

  registerLensAction("research", "canvas-delete", (ctx, _a, params = {}) => {
    const s = getResearchStateExt(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = researchActor(ctx);
    const id = String(params.id || "");
    if (!id) return { ok: false, error: "id required" };
    const map = s.canvases.get(userId);
    if (!map || !map.has(id)) return { ok: false, error: "canvas not found" };
    map.delete(id);
    saveResearchState();
    return { ok: true, result: { deleted: id } };
  });

  // ── PDF attachment for references ───────────────────────────────────
  registerLensAction("research", "reference-attach-pdf", (ctx, _a, params = {}) => {
    const s = getResearchStateExt(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = rfAid(ctx);
    const ref = findRef(s, userId, params.referenceId);
    if (!ref) return { ok: false, error: "reference not found" };
    const url = rfClean(params.url, 1000);
    const filename = rfClean(params.filename, 240);
    if (!url) return { ok: false, error: "url required" };
    // S4 (F2): a platform-artifact path is the uploaded-file form — the
    // upload endpoint (POST /api/artifact/upload) stores the file and it
    // is served, ACL-gated, from /api/artifact/:dtuId/stream. Only that
    // exact prefix is allowed through; other relative URLs stay refused.
    if (!/^https?:\/\//i.test(url) && !url.startsWith("/api/artifact/")) {
      return { ok: false, error: "url must be http(s) or a platform artifact path" };
    }
    const attachment = {
      id: rfId("pdf"),
      referenceId: ref.id,
      url,
      filename: filename || url.split("/").pop() || "document.pdf",
      pages: Number.isFinite(Number(params.pages)) ? Math.max(0, Math.round(Number(params.pages))) : null,
      createdAt: rfNow(),
    };
    rfListB(s.pdfs, userId).push(attachment);
    ref.hasPdf = true;
    saveResearchState();
    return { ok: true, result: { attachment } };
  });

  registerLensAction("research", "reference-pdfs", (ctx, _a, params = {}) => {
    const s = getResearchStateExt(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = rfAid(ctx);
    let pdfs = [...(s.pdfs.get(userId) || [])];
    if (params.referenceId) pdfs = pdfs.filter((p) => p.referenceId === String(params.referenceId));
    pdfs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { ok: true, result: { pdfs, count: pdfs.length } };
  });

  registerLensAction("research", "reference-pdf-delete", (ctx, _a, params = {}) => {
    const s = getResearchStateExt(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = rfAid(ctx);
    const arr = s.pdfs.get(userId) || [];
    const i = arr.findIndex((p) => p.id === params.id);
    if (i < 0) return { ok: false, error: "attachment not found" };
    const removed = arr.splice(i, 1)[0];
    const stillHas = arr.some((p) => p.referenceId === removed.referenceId);
    const ref = findRef(s, userId, removed.referenceId);
    if (ref && !stillHas) ref.hasPdf = false;
    saveResearchState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Resolve a readable PDF for a reference (S4, F2) ──────────────────
  // The reader's front door: given a library reference, answer with the
  // PDF the in-app reader should render, or an honest no-PDF answer.
  // Ladder, most-authoritative first:
  //  (1) a PDF the user attached to this reference — a platform-artifact
  //      URL (/api/artifact/…) is an upload and is named as one;
  //  (2) arXiv — the ID is derivable locally from an arXiv DOI or an
  //      arxiv.org URL on the record, no network needed;
  //  (3) the record's own URL when it already points at a .pdf;
  //  (4) Unpaywall's best_oa_location.url_for_pdf for the record's DOI.
  // There is no `live_unpaywall` macro to compose with — scholarly-
  // apis.js (read-verified for this slice) registers only live_crossref
  // / live_openalex / live_datamuse / live_dictionary — so the call is
  // made here via cachedFetchJson, the same pattern academic-search and
  // academic-resolve-import already use in this domain, and scholarly-
  // apis.js stays untouched. Honesty discipline follows S1: an
  // Unpaywall 404 (it has no record of the DOI) or a no-OA answer is a
  // definitive `no_open_access_pdf`; a transport failure is reported as
  // `lookup_failed`, never dressed up as "no open copy exists".
  function deriveArxivId(ref) {
    const m = normDoiKey(ref?.doi).match(/^10\.48550\/arxiv\.(.+)$/);
    if (m) return m[1];
    const parsed = parseScholarlyIdentifier(ref?.url || "");
    return parsed?.kind === "arxiv" ? parsed.id : null;
  }

  registerLensAction("research", "reference-pdf", async (ctx, _a, params = {}) => {
    const s = getResearchStateExt(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = rfAid(ctx);
    const ref = findRef(s, userId, params.referenceId || params.id);
    if (!ref) return { ok: false, error: "reference not found" };
    const base = { referenceId: ref.id, title: ref.title };
    const atts = (s.pdfs.get(userId) || [])
      .filter((p) => p.referenceId === ref.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (atts.length) {
      const att = atts[0];
      return { ok: true, result: { ...base,
        pdfUrl: att.url, source: att.url.startsWith("/api/artifact/") ? "upload" : "attached",
        filename: att.filename, attachmentId: att.id, pages: att.pages ?? null } };
    }
    const arxivId = deriveArxivId(ref);
    if (arxivId) {
      return { ok: true, result: { ...base,
        pdfUrl: `https://arxiv.org/pdf/${arxivId}.pdf`, source: "arxiv",
        filename: `${arxivId}.pdf`, attachmentId: null, pages: null } };
    }
    if (ref.url && /\.pdf($|[?#])/i.test(ref.url)) {
      return { ok: true, result: { ...base,
        pdfUrl: ref.url, source: "direct",
        filename: ref.url.split("/").pop() || "document.pdf", attachmentId: null, pages: null } };
    }
    if (ref.doi) {
      const email = process.env.UNPAYWALL_EMAIL || process.env.OPENALEX_MAILTO || "hello@concord-os.org";
      try {
        const data = await cachedFetchJson(
          `https://api.unpaywall.org/v2/${encodeURIComponent(normDoiKey(ref.doi))}?email=${encodeURIComponent(email)}`,
          { ttlMs: 60 * 60 * 1000, timeoutMs: 9000, opts: { headers: { "User-Agent": SCHOLARLY_UA } } },
        );
        const pdfUrl = data?.best_oa_location?.url_for_pdf
          || (data?.oa_locations || []).find((l) => l?.url_for_pdf)?.url_for_pdf || null;
        if (pdfUrl) {
          return { ok: true, result: { ...base,
            pdfUrl, source: "unpaywall",
            filename: pdfUrl.split("/").pop() || "document.pdf", attachmentId: null, pages: null } };
        }
        return { ok: true, result: { ...base, pdfUrl: null, source: null, reason: "no_open_access_pdf",
          message: "No open-access PDF was found for this reference. Attach or upload a PDF to read it here." } };
      } catch (e) {
        if (/HTTP 404/.test(String(e?.message || e))) {
          return { ok: true, result: { ...base, pdfUrl: null, source: null, reason: "no_open_access_pdf",
            message: "No open-access PDF was found for this reference. Attach or upload a PDF to read it here." } };
        }
        return { ok: true, result: { ...base, pdfUrl: null, source: null, reason: "lookup_failed",
          message: "The open-access lookup didn't answer, so this paper may still have an open PDF. Attach or upload a PDF to read it here." } };
      }
    }
    return { ok: true, result: { ...base, pdfUrl: null, source: null, reason: "no_open_access_pdf",
      message: "No PDF is attached and this reference has no DOI or arXiv ID to look up an open copy. Attach or upload a PDF to read it here." } };
  });

  // ── Live academic search — OpenAlex / arXiv (free, keyless) ─────────
  function mapOpenAlexWork(w) {
    const authors = (w.authorships || [])
      .map((a) => a.author?.display_name)
      .filter(Boolean);
    let abstract = null;
    if (w.abstract_inverted_index && typeof w.abstract_inverted_index === "object") {
      const positions = [];
      for (const [word, idxs] of Object.entries(w.abstract_inverted_index)) {
        for (const i of idxs) positions[i] = word;
      }
      abstract = positions.filter(Boolean).join(" ").slice(0, 4000) || null;
    }
    const doi = w.doi ? String(w.doi).replace(/^https?:\/\/doi\.org\//i, "") : null;
    return {
      id: w.id || null,
      title: w.display_name || w.title || "Untitled",
      authors,
      year: w.publication_year || null,
      venue: w.primary_location?.source?.display_name || w.host_venue?.display_name || null,
      doi,
      citationCount: typeof w.cited_by_count === "number" ? w.cited_by_count : 0,
      openAccessUrl: w.open_access?.oa_url || w.primary_location?.pdf_url || null,
      url: w.id || (doi ? `https://doi.org/${doi}` : null),
      abstract,
      source: "openalex",
    };
  }

  function mapArxivWork(xml) {
    const entries = [];
    const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
    let m;
    while ((m = entryRe.exec(xml)) !== null) {
      const e = m[1];
      const get = (tag) => {
        const mm = e.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
        return mm ? mm[1].replace(/\s+/g, " ").trim() : null;
      };
      const id = get("id");
      const authors = [];
      const ar = /<author>\s*<name>([^<]+)<\/name>/g;
      let am;
      while ((am = ar.exec(e)) !== null) authors.push(am[1].trim());
      const published = get("published");
      const arxivId = id?.match(/arxiv\.org\/abs\/(.+)$/)?.[1] || null;
      entries.push({
        id, title: get("title"), authors,
        year: published ? Number(published.slice(0, 4)) : null,
        venue: "arXiv", doi: null, citationCount: null,
        openAccessUrl: arxivId ? `https://arxiv.org/pdf/${arxivId}.pdf` : null,
        url: id, abstract: get("summary"), source: "arxiv",
      });
    }
    return entries;
  }

  // arXiv search_query for free text (S8, F9): one `all:` clause per
  // term, AND-joined. Encoding the whole query as a single field value
  // makes arXiv's parser OR its words (live-verified — see
  // research-live.js buildArxivRequest, which builds the same way).
  function arxivTextSearchQuery(query) {
    const terms = String(query || "").split(/\s+/)
      .map((t) => t.replace(/["()]/g, ""))
      .filter(Boolean)
      .slice(0, 10);
    return terms.map((t) => `all:${encodeURIComponent(t)}`).join("+AND+");
  }

  registerLensAction("research", "academic-search", async (_ctx, _a, params = {}) => {
    const query = String(params.query || "").trim();
    if (!query) return { ok: false, error: "query required" };
    if (query.length < 2) return { ok: false, error: "query too short" };
    const limit = Math.min(Math.max(Number(params.limit) || 15, 1), 25);
    const provider = ["openalex", "arxiv"].includes(String(params.provider))
      ? String(params.provider) : "openalex";
    try {
      if (provider === "arxiv") {
        const url = `http://export.arxiv.org/api/query?search_query=${arxivTextSearchQuery(query)}&start=0&max_results=${limit}&sortBy=relevance`;
        const xml = await (await fetch(url, { signal: AbortSignal.timeout(9000) })).text();
        const results = mapArxivWork(xml);
        return { ok: true, result: { provider, query, count: results.length, results } };
      }
      // Match research.live_openalex (scholarly-apis.js): no `select=` —
      // OpenAlex 400s when select includes abstract_inverted_index. Full
      // works payloads still carry that field when present for mapOpenAlexWork.
      const mailto = process.env.OPENALEX_MAILTO || "hello@concord-os.org";
      const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=${limit}&mailto=${encodeURIComponent(mailto)}&sort=relevance_score:desc`;
      const data = await cachedFetchJson(url, { ttlMs: 10 * 60 * 1000, timeoutMs: 9000 });
      if (!data || typeof data !== "object") {
        return { ok: false, error: "academic search failed: empty OpenAlex response" };
      }
      const results = (data.results || []).map(mapOpenAlexWork);
      return { ok: true, result: { provider, query, count: results.length, results } };
    } catch (e) {
      return { ok: false, error: `academic search failed: ${String(e?.message || e)}` };
    }
  });

  // ── Duplicate detection (S3, F8) ────────────────────────────────────
  // One gate for every filing path (academic-import,
  // academic-resolve-import, manual reference-add): a paper already in
  // the user's library is answered with the EXISTING record, never a
  // twin. Ladder:
  //  (1) normalised DOI equality — lowercase, doi.org prefix and
  //      whitespace stripped, so case/prefix variants of the same DOI
  //      still collide;
  //  (2) normalised title + year, when both years are known;
  //  (3) normalised title where the STORED record carries no DOI but
  //      the incoming work does — a hand-filed record cannot disprove
  //      identity against a DOI'd import of the same title, and an
  //      upstream year quirk (F8: OpenAlex showed 2025 for a 2017
  //      paper) must not smuggle a duplicate past the year check in
  //      exactly that hand-filed-then-imported case.
  // A stored record carrying a DIFFERENT DOI disproves identity and is
  // never matched on title alone.
  function normDoiKey(v) {
    return String(v == null ? "" : v).trim().toLowerCase()
      .replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "")
      .replace(/^doi:\s*/, "");
  }
  function normTitleKey(v) {
    return String(v == null ? "" : v).trim().toLowerCase().replace(/\s+/g, " ");
  }
  function findDuplicateRef(refs, cand) {
    const list = Array.isArray(refs) ? refs : [];
    const doi = normDoiKey(cand?.doi);
    if (doi) {
      const byDoi = list.find((r) => normDoiKey(r.doi) === doi);
      if (byDoi) return byDoi;
    }
    const title = normTitleKey(cand?.title);
    if (!title) return null;
    const yearRaw = cand?.year == null ? NaN : Number(cand.year);
    const year = Number.isFinite(yearRaw) ? Math.round(yearRaw) : null;
    for (const r of list) {
      if (normTitleKey(r.title) !== title) continue;
      const rDoi = normDoiKey(r.doi);
      if (doi && rDoi && rDoi !== doi) continue; // a different DOI disproves identity
      const rYearRaw = r.year == null ? NaN : Number(r.year);
      const rYear = Number.isFinite(rYearRaw) ? Math.round(rYearRaw) : null;
      if (year != null && rYear != null && year === rYear) return r;
      if (doi && !rDoi) return r;
    }
    return null;
  }

  // ── Import a search result straight into the reference library ──────
  // The single ref construction every import path persists through
  // (academic-import, academic-resolve-import). `source` records where
  // the metadata came from (S1: the record names its source). Returns
  // { reference, duplicate } — on a duplicate the reference is the
  // record already in the library and nothing new is filed (S3, F8).
  function importWorkToLibrary(s, ctx, w, tags) {
    const title = rfClean(w?.title, 400);
    if (!title) return null;
    const list = rfListB(s.references, rfAid(ctx));
    const dup = findDuplicateRef(list, { doi: w.doi, title, year: w.year });
    if (dup) return { reference: dup, duplicate: true };
    const authors = Array.isArray(w.authors) ? w.authors.join(", ") : rfClean(w.authors, 400);
    const ref = {
      id: rfId("ref"), title,
      authors: rfClean(authors, 400) || null,
      year: Number.isFinite(Number(w.year)) ? Math.round(Number(w.year)) : null,
      type: w.source === "arxiv" ? "preprint" : "article",
      journal: rfClean(w.venue, 200) || null,
      doi: rfClean(w.doi, 120) || null,
      url: rfClean(w.url || w.openAccessUrl, 500) || null,
      abstract: rfClean(w.abstract, 4000) || null,
      source: rfClean(w.source, 40).toLowerCase() || null,
      tags: normTags(tags),
      status: "to_read",
      relatedIds: [],
      citationCount: Number.isFinite(Number(w.citationCount)) ? Number(w.citationCount) : null,
      createdAt: rfNow(),
    };
    list.push(ref);
    saveResearchState();
    return { reference: ref, duplicate: false };
  }

  registerLensAction("research", "academic-import", (ctx, _a, params = {}) => {
    const s = getResearchStateExt(); if (!s) return { ok: false, error: "STATE unavailable" };
    const w = params.work || params;
    if (!rfClean(w?.title, 400)) return { ok: false, error: "title required" };
    const out = importWorkToLibrary(s, ctx, w, params.tags);
    if (!out) return { ok: false, error: "title required" };
    return { ok: true, result: { reference: out.reference, ...(out.duplicate ? { duplicate: true } : {}) } };
  });

  // ── Resolve an identifier (DOI / arXiv ID / paper URL) and import ───
  // S1 (F1): until this macro the lens had no identifier resolution
  // anywhere — every scholarly macro was keyword-search-only, and a DOI
  // typed into CrossRef search was treated as keywords. Crossref's
  // single-work endpoint is tried first; OpenAlex answers when Crossref
  // has no record. Unknown identifier → honest 'not_found', no record.
  const SCHOLARLY_UA = "ConcordOS/5.0 (+https://concord-os.org; mailto:hello@concord-os.org)";

  // Parse the identifier forms S1 covers. Arbitrary publisher URLs are
  // NOT resolvable without fetch-and-scrape and return null here, so
  // the caller can say so honestly instead of guessing.
  function parseScholarlyIdentifier(raw) {
    let v = String(raw || "").trim();
    if (!v) return null;
    v = v.replace(/^doi:\s*/i, "");
    const arxivUrl = v.match(/^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\/([0-9]{4}\.[0-9]{4,5}(?:v\d+)?|[a-z-]+\/\d{7}(?:v\d+)?)(?:\.pdf)?\/?$/i);
    if (arxivUrl) return { kind: "arxiv", id: arxivUrl[1] };
    const doiUrl = v.match(/^https?:\/\/(?:dx\.)?doi\.org\/(10\.\d{4,9}\/\S+)$/i);
    if (doiUrl) return { kind: "doi", doi: doiUrl[1].replace(/[).,;]+$/, "") };
    if (/^10\.\d{4,9}\/\S+$/.test(v)) return { kind: "doi", doi: v.replace(/[).,;]+$/, "") };
    if (/^(?:arxiv:)?([0-9]{4}\.[0-9]{4,5}(?:v\d+)?)$/i.test(v)) return { kind: "arxiv", id: v.replace(/^arxiv:/i, "") };
    if (/^[a-z-]+\/\d{7}(?:v\d+)?$/i.test(v)) return { kind: "arxiv", id: v };
    return null;
  }

  // Crossref GET /works/{doi} returns one `message` object (not items[])
  // with the same fields live_crossref maps for its list. Local mapper —
  // scholarly-apis.js serves the Paper lens too and stays untouched.
  function mapCrossrefWorkMessage(msg) {
    if (!msg || typeof msg !== "object") return null;
    const abstract = typeof msg.abstract === "string"
      ? msg.abstract.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 4000) || null
      : null;
    return {
      id: msg.URL || (msg.DOI ? `https://doi.org/${msg.DOI}` : null),
      title: (msg.title || [])[0] || null,
      authors: (msg.author || []).slice(0, 50).map((a) =>
        [a.given, a.family].filter(Boolean).join(" ") || a.name || "Unknown"),
      year: msg["published-print"]?.["date-parts"]?.[0]?.[0]
        || msg["published-online"]?.["date-parts"]?.[0]?.[0]
        || msg.issued?.["date-parts"]?.[0]?.[0] || null,
      venue: (msg["container-title"] || [])[0] || null,
      doi: msg.DOI || null,
      citationCount: typeof msg["is-referenced-by-count"] === "number" ? msg["is-referenced-by-count"] : null,
      openAccessUrl: (msg.link || []).find((l) => /pdf/i.test(l?.["content-type"] || ""))?.URL || null,
      url: msg.URL || (msg.DOI ? `https://doi.org/${msg.DOI}` : null),
      abstract,
      source: "crossref",
    };
  }

  // Both resolvers return null on a definitive miss (HTTP 404, or a
  // payload with no work in it) and throw on transport/upstream
  // failure — the caller only reports 'not_found' when at least one
  // source actually answered.
  async function fetchCrossrefWork(doi) {
    try {
      const data = await cachedFetchJson(
        `https://api.crossref.org/works/${encodeURIComponent(doi)}`,
        { ttlMs: 60 * 60 * 1000, timeoutMs: 9000, opts: { headers: { "User-Agent": SCHOLARLY_UA } } },
      );
      return mapCrossrefWorkMessage(data?.message);
    } catch (e) {
      if (/HTTP 404/.test(String(e?.message || e))) return null;
      throw e;
    }
  }

  async function fetchOpenAlexWorkByDoi(doi) {
    const mailto = process.env.OPENALEX_MAILTO || "hello@concord-os.org";
    let data;
    try {
      data = await cachedFetchJson(
        `https://api.openalex.org/works/doi:${encodeURIComponent(doi)}?mailto=${encodeURIComponent(mailto)}`,
        { ttlMs: 60 * 60 * 1000, timeoutMs: 9000 },
      );
    } catch (e) {
      if (/HTTP 404/.test(String(e?.message || e))) return null;
      throw e;
    }
    if (!data || typeof data !== "object" || (!data.id && !data.display_name)) return null;
    return mapOpenAlexWork(data);
  }

  async function fetchArxivWork(id) {
    const xml = await (await fetch(
      `http://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`,
      { signal: AbortSignal.timeout(9000) },
    )).text();
    return mapArxivWork(xml)[0] || null;
  }

  registerLensAction("research", "academic-resolve-import", async (ctx, _a, params = {}) => {
    const s = getResearchStateExt(); if (!s) return { ok: false, error: "STATE unavailable" };
    const raw = String(params.identifier || params.query || "").trim();
    if (!raw) return { ok: false, error: "identifier required" };
    const parsed = parseScholarlyIdentifier(raw);
    if (!parsed) {
      return { ok: false, error: "unsupported_identifier",
        message: "That doesn't look like a DOI, an arXiv ID, or a doi.org / arxiv.org link — those are the identifiers this library can resolve." };
    }
    let work = null;
    let hardFailures = 0;
    let sourcesTried = 0;
    if (parsed.kind === "arxiv") {
      sourcesTried = 1;
      try { work = await fetchArxivWork(parsed.id); }
      catch { hardFailures = 1; }
    } else {
      sourcesTried = 2;
      try { work = await fetchCrossrefWork(parsed.doi); }
      catch { hardFailures += 1; }
      if (!work) {
        try { work = await fetchOpenAlexWorkByDoi(parsed.doi); }
        catch { hardFailures += 1; }
      }
    }
    if (!work) {
      if (hardFailures >= sourcesTried) {
        return { ok: false, error: "resolve failed: scholarly APIs unreachable" };
      }
      return { ok: false, error: "not_found",
        message: parsed.kind === "arxiv"
          ? "No paper found for that arXiv ID."
          : "No reference found for that identifier in Crossref or OpenAlex." };
    }
    if (!rfClean(work.title, 400)) {
      return { ok: false, error: "not_found",
        message: "The identifier resolved but carries no title metadata to file." };
    }
    // preview: resolve-only (the CrossRef panel's DOI lookup shows the
    // exact work first; filing happens on the user's explicit import).
    if (params.preview) {
      return { ok: true, result: { reference: null, work, source: work.source || null } };
    }
    const out = importWorkToLibrary(s, ctx, work, params.tags);
    if (!out) return { ok: false, error: "title required" };
    return { ok: true, result: { reference: out.reference, work, source: work.source || null, ...(out.duplicate ? { duplicate: true } : {}) } };
  });

  // ── CrossRef browse search with canonical preference (S8, F9) ──────
  // The shared live_crossref handler (scholarly-apis.js — untouched; it
  // also serves the Paper lens) runs Crossref's generic `query=` over a
  // shallow page and presents Crossref's order uncritically. For a
  // title search that buries the paper being looked for: live-verified
  // 2026-10-29, "attention is all you need" via `query=` returns
  // derivative works and a swarm of near-identical clone deposits
  // (Crossref member 54718, "Shenzhen Medical Academy of Research and
  // Translation", DOIs under 10.65215 copying the real author list,
  // deposited 2025) ahead of any record of the actual paper. This
  // research-domain macro therefore:
  //   • searches a DEEP pool via query.title (Crossref's title-weighted
  //     parameter) so the ranking below has something to work with;
  //   • collapses duplicate deposits of the same work (same normalised
  //     title + first-author family) into their most complete record,
  //     counting what was collapsed onto the record itself;
  //   • ranks canonical-first: exact-title matches, then records whose
  //     title covers every query term, then the rest — each group by
  //     metadata completeness, citations, Crossref's own score.
  // Honest limit, also live-verified: for some papers Crossref holds
  // NO canonical record at all — "Attention Is All You Need"'s
  // registration is a DataCite DOI (10.48550/arXiv.1706.03762 → 404 at
  // Crossref), so there the surface collapses the clone swarm to one
  // representative and says so on the record; it cannot mint the
  // canonical record Crossref doesn't hold. Discover/OpenAlex remains
  // the surface that ranks the true record first.
  function mapCrossrefBrowseWork(w) {
    if (!w || typeof w !== "object") return null;
    return {
      doi: w.DOI || null,
      title: (w.title || [])[0] || null,
      authors: (w.author || []).slice(0, 8).map((a) => ({
        name: [a.given, a.family].filter(Boolean).join(" ") || a.name || "Unknown",
        orcid: a.ORCID || null,
      })),
      publishedYear: w["published-print"]?.["date-parts"]?.[0]?.[0]
        || w["published-online"]?.["date-parts"]?.[0]?.[0] || null,
      containerTitle: (w["container-title"] || [])[0] || null,
      publisher: w.publisher || null,
      type: w.type || null,
      subjects: (w.subject || []).slice(0, 6),
      citationCount: typeof w["is-referenced-by-count"] === "number" ? w["is-referenced-by-count"] : null,
      url: w.URL || (w.DOI ? `https://doi.org/${w.DOI}` : null),
      crossrefScore: typeof w.score === "number" ? w.score : null,
    };
  }

  function crossrefCompleteness(w) {
    let n = 0;
    if (w.authors.length) n += 1;
    if (w.publishedYear) n += 1;
    if (w.containerTitle) n += 1;
    if (w.publisher) n += 1;
    if (w.citationCount != null) n += 1;
    if (w.subjects.length) n += 1;
    if (w.type) n += 1;
    return n;
  }

  // The more trustworthy representative of a duplicate group / the
  // higher rank within a title group: completeness, then citations,
  // then Crossref's own relevance score.
  function crossrefWorkBeats(a, b) {
    const ca = crossrefCompleteness(a);
    const cb = crossrefCompleteness(b);
    if (ca !== cb) return ca > cb;
    const na = a.citationCount ?? -1;
    const nb = b.citationCount ?? -1;
    if (na !== nb) return na > nb;
    return (a.crossrefScore ?? -1) > (b.crossrefScore ?? -1);
  }

  function rankCrossrefWorks(items, query, limit) {
    const squash = (v) => String(v || "").toLowerCase()
      .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
    const qSquash = squash(query);
    const qTerms = qSquash.split(" ").filter(Boolean);
    // Collapse duplicate deposits of the same work into one record.
    const groups = new Map();
    for (const w of items) {
      if (!w || !w.doi) continue;
      const family = squash(w.authors[0]?.name).split(" ").pop() || "";
      // Untitled records never group with anything but themselves.
      const key = w.title ? `${squash(w.title)}|${family}` : `doi:${normDoiKey(w.doi)}`;
      const cur = groups.get(key);
      if (!cur) groups.set(key, { rep: w, count: 1 });
      else {
        cur.count += 1;
        if (crossrefWorkBeats(w, cur.rep)) cur.rep = w;
      }
    }
    const works = [...groups.values()].map(({ rep, count }) => {
      const t = squash(rep.title);
      const tTerms = t.split(" ").filter(Boolean);
      return {
        ...rep,
        exactTitleMatch: qSquash.length > 0 && t === qSquash,
        titleCoversQuery: qTerms.length > 1 && qTerms.every((term) => tTerms.includes(term)),
        duplicatesCollapsed: count - 1,
        metadataComplete: !!(rep.authors.length && rep.publishedYear && rep.containerTitle),
      };
    });
    const groupOf = (w) => (w.exactTitleMatch ? 0 : w.titleCoversQuery ? 1 : 2);
    works.sort((a, b) => {
      const g = groupOf(a) - groupOf(b);
      if (g) return g;
      // Within a title group, a record that absorbed duplicate deposits
      // outranks a same-titled record nobody re-deposited: the swarm
      // copies the work the title actually refers to, so the deposit
      // count is evidence this record IS that work (live case: the
      // Attention clone representative vs a complete but different
      // handbook chapter sharing the exact title).
      const d = b.duplicatesCollapsed - a.duplicatesCollapsed;
      if (d) return d;
      if (crossrefWorkBeats(a, b)) return -1;
      if (crossrefWorkBeats(b, a)) return 1;
      return 0;
    });
    const collapsedCount = works.reduce((n, w) => n + w.duplicatesCollapsed, 0);
    return { works: works.slice(0, limit), collapsedCount };
  }

  registerLensAction("research", "crossref-search", async (_ctx, _a, params = {}) => {
    const query = String(params.query || "").trim();
    if (!query) return { ok: false, error: "query required" };
    if (query.length > 300) return { ok: false, error: "query too long" };
    const limit = Math.min(Math.max(Number(params.limit) || 15, 1), 25);
    const pool = 50;
    const select = "DOI,title,author,published-print,published-online,container-title,publisher,type,subject,is-referenced-by-count,URL,score";
    const url = `https://api.crossref.org/works?query.title=${encodeURIComponent(query)}&rows=${pool}&sort=relevance&select=${select}`;
    let data;
    try {
      data = await cachedFetchJson(url, {
        ttlMs: 10 * 60 * 1000, timeoutMs: 9000,
        opts: { headers: { "User-Agent": SCHOLARLY_UA } },
      });
    } catch (e) {
      return { ok: false, error: `crossref search failed: ${String(e?.message || e)}` };
    }
    const items = (data?.message?.items || []).map(mapCrossrefBrowseWork).filter(Boolean);
    const { works, collapsedCount } = rankCrossrefWorks(items, query, limit);
    return { ok: true, result: {
      source: "CrossRef", query,
      total: data?.message?.["total-results"] || items.length,
      collapsedCount, works,
    } };
  });

  // ── LLM literature review — comparison table across many papers ─────
  // Builds an Elicit-style finding-extraction matrix. Without an LLM it
  // falls back to a deterministic heuristic extraction (no fake data —
  // every value is derived from the real paper input).
  function heuristicExtract(paper, dimension) {
    const text = `${paper.abstract || ""} ${paper.title || ""}`.toLowerCase();
    const sentences = String(paper.abstract || "").split(/(?<=[.!?])\s+/).filter(Boolean);
    const dim = String(dimension).toLowerCase();
    const cueMap = {
      method: ["method", "approach", "model", "framework", "algorithm", "technique", "architecture"],
      finding: ["find", "result", "show", "demonstrate", "achiev", "report", "observ", "improv"],
      sample: ["participant", "sample", "subject", "dataset", "n =", "patients", "respondents"],
      limitation: ["limit", "however", "caveat", "weakness", "constrain", "future work"],
      outcome: ["outcome", "effect", "impact", "performance", "accuracy", "score"],
    };
    const cues = cueMap[dim] || dim.split(/\s+/);
    const hit = sentences.find((sn) => cues.some((c) => sn.toLowerCase().includes(c)));
    return hit ? hit.trim().slice(0, 280) : (sentences[0]?.slice(0, 200) || "Not reported in abstract");
  }

  registerLensAction("research", "literature-review", async (ctx, _a, params = {}) => {
    const s = getResearchStateExt(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = rfAid(ctx);
    let papers = Array.isArray(params.papers) ? params.papers : null;
    // Pull from the library if reference IDs were given instead of raw papers.
    if (!papers && Array.isArray(params.referenceIds)) {
      papers = params.referenceIds
        .map((id) => findRef(s, userId, id))
        .filter(Boolean)
        .map((r) => ({ id: r.id, title: r.title, authors: r.authors, year: r.year, abstract: r.abstract }));
    }
    if (!papers || papers.length === 0) {
      return { ok: false, error: "papers or referenceIds required" };
    }
    if (papers.length > 30) papers = papers.slice(0, 30);
    const rawDims = Array.isArray(params.dimensions) && params.dimensions.length
      ? params.dimensions : ["method", "finding", "sample", "limitation"];
    const dimensions = rawDims.map((d) => String(d).trim().slice(0, 60)).filter(Boolean).slice(0, 8);
    const usableForLlm = papers.filter((p) => p.abstract && p.abstract.length > 40);
    const llm = ctx?.llm;
    let matrix = null;
    let summary = null;
    let mode = "heuristic";
    if (llm && typeof llm.chat === "function" && usableForLlm.length > 0
        && process.env.CONCORD_LITERATURE_REVIEW_LLM !== "0") {
      try {
        const corpus = papers.map((p, i) =>
          `[${i + 1}] ${p.title || "Untitled"} (${p.year || "n.d."})\nAbstract: ${(p.abstract || "no abstract").slice(0, 1200)}`
        ).join("\n\n");
        const prompt = `You are a research synthesis assistant. For each paper below, extract these dimensions: ${dimensions.join(", ")}.
Respond ONLY with strict JSON: {"rows":[{"paper":<index 1-based>,${dimensions.map((d) => `"${d}":"..."`).join(",")}}],"synthesis":"2-3 sentence cross-paper synthesis"}.
Keep each cell under 200 characters. Use only information present in the abstract; write "Not reported" if absent.

${corpus}`;
        const out = await llm.chat(prompt, { maxTokens: 2000, temperature: 0.2 });
        const txt = typeof out === "string" ? out : (out?.content || out?.text || "");
        const jsonMatch = txt.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (Array.isArray(parsed.rows)) {
            matrix = parsed.rows.map((r) => {
              const idx = Math.max(0, Math.min(papers.length - 1, (Number(r.paper) || 1) - 1));
              const cells = {};
              for (const d of dimensions) cells[d] = String(r[d] || "Not reported").slice(0, 280);
              return { paperIndex: idx, title: papers[idx]?.title || "Untitled", year: papers[idx]?.year || null, cells };
            });
            summary = String(parsed.synthesis || "").slice(0, 800) || null;
            mode = "llm";
          }
        }
      } catch (_e) { /* fall through to heuristic */ }
    }
    if (!matrix) {
      matrix = papers.map((p, idx) => {
        const cells = {};
        for (const d of dimensions) cells[d] = heuristicExtract(p, d);
        return { paperIndex: idx, title: p.title || "Untitled", year: p.year || null, cells };
      });
      const yearsKnown = papers.map((p) => p.year).filter((y) => Number.isFinite(Number(y)));
      const span = yearsKnown.length ? `${Math.min(...yearsKnown)}–${Math.max(...yearsKnown)}` : "unknown period";
      summary = `Compared ${papers.length} paper(s) spanning ${span} across ${dimensions.length} dimension(s). Heuristic extraction — open an LLM-enabled session for deeper synthesis.`;
    }
    const review = {
      id: nextResId("review"),
      title: String(params.title || "Literature review").trim().slice(0, 200),
      dimensions,
      paperCount: papers.length,
      matrix,
      summary,
      mode,
      createdAt: nowIsoRes(),
    };
    if (params.save === true) {
      if (!s.reviews.has(userId)) s.reviews.set(userId, []);
      const list = s.reviews.get(userId);
      list.unshift(review);
      if (list.length > 50) list.length = 50;
      saveResearchState();
    }
    return { ok: true, result: { review } };
  });

  // Hypothesis analysis — scaffolds a rigorous research framing from a free-text
  // hypothesis for the lens "Analyze" surface (app/lenses/research/page.tsx
  // handleRunAnalysis, which POSTs research.generate and renders result.content).
  // Deterministic by default; optional LLM enrichment with a deterministic fallback,
  // matching the literature-review convention above. (Was called by the frontend but
  // never registered — the Analyze button 404'd until this landed.)
  registerLensAction("research", "generate", async (ctx, _a, params = {}) => {
    const hypothesis = String(params.hypothesis || "").trim();
    if (!hypothesis) return { ok: false, error: "hypothesis required" };
    const kind = String(params.type || "analysis").trim().slice(0, 40);
    const title = hypothesis.length > 80 ? hypothesis.slice(0, 77) + "…" : hypothesis;

    // Deterministic keyword extraction (stopword-filtered frequency) → candidate constructs.
    const STOP = new Set("the a an of to in is are be on for and or with that this it as by from at we our their they will would can could does do how why what which than then so such into over under more most less between among also can may".split(" "));
    const freq = new Map();
    for (const w of (hypothesis.toLowerCase().match(/[a-z][a-z-]{2,}/g) || [])) {
      if (STOP.has(w)) continue;
      freq.set(w, (freq.get(w) || 0) + 1);
    }
    const constructs = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([w]) => w);
    const c = constructs.length ? constructs.join(", ") : "the stated variables";
    const deterministic = () => [
      `# Research analysis`,
      ``,
      `**Hypothesis.** ${hypothesis}`,
      ``,
      `**Key constructs.** ${c}.`,
      ``,
      `**Testable framing.** Identify the independent and dependent variables among (${c}), state the null hypothesis explicitly, and pick a design — controlled experiment, quasi-experiment, or observational study — that can establish the direction of the relationship.`,
      ``,
      `**Operationalization.** Define a concrete, measurable proxy for each construct, and a sampling frame that keeps the comparison fair (matched groups or randomization where possible).`,
      ``,
      `**Threats to validity.** Watch for confounds, selection bias, and reverse causation; pre-register the analysis and report effect sizes with confidence intervals, not just p-values.`,
      ``,
      `**Next steps.** Run a power analysis to size the study, draft the protocol, and search prior work on ${constructs[0] || "this question"} (use the Literature tab).`,
      ``,
      `_Deterministic scaffold — open an LLM-enabled session for a richer synthesis._`,
    ].join("\n");

    const llm = ctx?.llm;
    if (llm && typeof llm.chat === "function" && process.env.CONCORD_RESEARCH_GENERATE_LLM !== "0") {
      try {
        const prompt = `You are a research-methods advisor. Give a concise, rigorous analysis of this ${kind}:\n\n"${hypothesis}"\n\nCover: key constructs, a testable framing (variables + null hypothesis), a suitable study design, operationalization, threats to validity, and concrete next steps. Use markdown headings. Be specific; do not invent citations.`;
        const out = await llm.chat(prompt, { maxTokens: 900, temperature: 0.4 });
        const content = (typeof out === "string" ? out : (out?.content || out?.text || "")).trim();
        if (content) return { ok: true, result: { title, content, mode: "llm" } };
      } catch (_e) { /* fall through to deterministic */ }
    }
    return { ok: true, result: { title, content: deterministic(), mode: "heuristic" } };
  });

  registerLensAction("research", "literature-reviews-list", (ctx, _a, _params = {}) => {
    const s = getResearchStateExt(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = s.reviews.get(rfAid(ctx)) || [];
    return {
      ok: true,
      result: {
        reviews: list.map((r) => ({
          id: r.id, title: r.title, dimensions: r.dimensions,
          paperCount: r.paperCount, mode: r.mode, createdAt: r.createdAt,
        })),
        count: list.length,
      },
    };
  });

  registerLensAction("research", "literature-review-get", (ctx, _a, params = {}) => {
    const s = getResearchStateExt(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = s.reviews.get(rfAid(ctx)) || [];
    const review = list.find((r) => r.id === String(params.id || ""));
    if (!review) return { ok: false, error: "review not found" };
    return { ok: true, result: { review } };
  });

  registerLensAction("research", "literature-review-delete", (ctx, _a, params = {}) => {
    const s = getResearchStateExt(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = rfAid(ctx);
    const list = s.reviews.get(userId) || [];
    const i = list.findIndex((r) => r.id === String(params.id || ""));
    if (i < 0) return { ok: false, error: "review not found" };
    list.splice(i, 1);
    saveResearchState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── INC-SWEEP research F7 — replace DOMAIN_ACTION_MANIFEST brain stubs ──
  // These names were registered as utility/subconscious brain catch-alls that
  // returned ok:true model prose citing fabricated ids. Prefer the real
  // library (references / collections) or refuse honestly.
  registerLensAction("research", "generate-bibliography", (ctx, _a, params = {}) => {
    try {
      const s = getResearchState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = rfAid(ctx);
      const style = CITATION_STYLE_NAMES.includes(String(params.style).toLowerCase())
        ? String(params.style).toLowerCase() : "apa";
      let refs;
      if (params.collectionId) {
        const col = (s.collections.get(userId) || []).find((c) => c.id === params.collectionId);
        if (!col) return { ok: false, error: "collection not found" };
        refs = col.referenceIds.map((id) => findRef(s, userId, id)).filter(Boolean);
      } else {
        refs = [...(s.references.get(userId) || [])];
      }
      if (refs.length === 0) {
        return { ok: false, error: "references required", reason: "no_references" };
      }
      refs.sort((a, b) => rfClean(a.authors, 400).localeCompare(rfClean(b.authors, 400)));
      const entries = refs.map((r) => formatCitation(r, style));
      return {
        ok: true,
        result: {
          style,
          count: entries.length,
          entries,
          bibliography: entries.join(style === "bibtex" ? "\n\n" : "\n"),
          source: "library",
        },
      };
    } catch (e) {
      return { ok: false, error: "handler_error", message: String(e?.message || e) };
    }
  });

  // S5 (F3): the three library-analysis cores live outside their macro
  // handlers so the analyze-library job runs the SAME code the macros
  // expose — one implementation, two callers, no drift.
  function evaluateSourceResult(s, userId, id) {
    const ref = findRef(s, userId, id);
    if (!ref) return { ok: false, error: "reference not found" };
    const signals = [];
    if (ref.doi) signals.push("has_doi");
    if (ref.journal) signals.push("has_venue");
    if (ref.year) signals.push("has_year");
    if (ref.abstract) signals.push("has_abstract");
    if (ref.authors) signals.push("has_authors");
    const credibility =
      signals.length >= 4 ? "high" : signals.length >= 2 ? "moderate" : "low";
    return {
      ok: true,
      result: {
        referenceId: ref.id,
        title: ref.title,
        credibility,
        signals,
        status: ref.status,
        source: "library",
      },
    };
  }

  registerLensAction("research", "evaluate-source", (ctx, _a, params = {}) => {
    try {
      const s = getResearchState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const id = params.id || params.referenceId || params.sourceId;
      if (!id) return { ok: false, error: "reference id required" };
      return evaluateSourceResult(s, rfAid(ctx), id);
    } catch (e) {
      return { ok: false, error: "handler_error", message: String(e?.message || e) };
    }
  });

  function findGapsResult(s, userId, topic) {
      const refs = [...(s.references.get(userId) || [])];
      if (refs.length === 0 && !topic) {
        return { ok: false, error: "references or topic required" };
      }
      if (refs.length === 0) {
        return { ok: false, error: "references required", reason: "no_references" };
      }
      const byYear = {};
      const tagCounts = {};
      const missingAbstract = [];
      for (const r of refs) {
        const y = r.year || "unknown";
        byYear[y] = (byYear[y] || 0) + 1;
        for (const t of r.tags || []) tagCounts[t] = (tagCounts[t] || 0) + 1;
        if (!r.abstract) missingAbstract.push(r.id);
      }
      const years = Object.keys(byYear).filter((y) => y !== "unknown").map(Number).sort((a, b) => a - b);
      const gaps = [];
      if (missingAbstract.length) {
        gaps.push({ kind: "missing_abstract", count: missingAbstract.length, referenceIds: missingAbstract.slice(0, 20) });
      }
      if (years.length >= 2) {
        for (let y = years[0]; y < years[years.length - 1]; y++) {
          if (!byYear[y]) gaps.push({ kind: "year_gap", year: y });
        }
      }
      const thinTags = Object.entries(tagCounts).filter(([, n]) => n === 1).map(([t]) => t);
      if (thinTags.length) gaps.push({ kind: "singleton_tags", tags: thinTags.slice(0, 20) });
      return {
        ok: true,
        result: {
          referenceCount: refs.length,
          topic: topic || null,
          gaps,
          byYear,
          source: "library",
        },
      };
  }

  registerLensAction("research", "find-gaps", (ctx, _a, params = {}) => {
    try {
      const s = getResearchState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const topic = rfClean(params.topic || params.query || "", 200);
      return findGapsResult(s, rfAid(ctx), topic);
    } catch (e) {
      return { ok: false, error: "handler_error", message: String(e?.message || e) };
    }
  });

  function matchQuestionsResult(s, userId, question) {
      if (!question) return { ok: false, error: "question required" };
      const refs = [...(s.references.get(userId) || [])];
      if (refs.length === 0) {
        return { ok: false, error: "references required", reason: "no_references" };
      }
      const q = question.toLowerCase();
      const tokens = q.split(/\W+/).filter((t) => t.length >= 3);
      const matches = [];
      for (const r of refs) {
        const hay = `${r.title} ${r.abstract || ""} ${(r.tags || []).join(" ")}`.toLowerCase();
        const hit = tokens.filter((t) => hay.includes(t));
        if (hit.length) {
          matches.push({
            referenceId: r.id,
            title: r.title,
            score: hit.length,
            matchedTokens: hit.slice(0, 12),
          });
        }
      }
      matches.sort((a, b) => b.score - a.score);
      return {
        ok: true,
        result: {
          question,
          matchCount: matches.length,
          matches: matches.slice(0, 25),
          source: "library",
        },
      };
  }

  registerLensAction("research", "match-questions", (ctx, _a, params = {}) => {
    try {
      const s = getResearchState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const question = rfClean(params.question || params.query || params.text || "", 500);
      return matchQuestionsResult(s, rfAid(ctx), question);
    } catch (e) {
      return { ok: false, error: "handler_error", message: String(e?.message || e) };
    }
  });

  // ── S5 (F3) — "Analyze library": a user-triggered background job over
  // the three library-analysis cores above. Before this slice the lens
  // had NO library analysis at all: "Analyze" ran `generate` (a question
  // template that never reads the library) and Deep Research scans DTUs.
  // The job follows the house pattern (Deep Research's pending state):
  // analyze-library files a job record and returns immediately; the work
  // completes off the request path; the surface polls analysis-get.
  // Every output names the items it read — itemsRead lists each
  // reference, evaluations carry titles, gap entries resolve their
  // reference ids to titles, matches carry titles. An analysis that
  // names none of its inputs fails §7 S5 by definition.
  function runLibraryAnalysis(s, userId, job) {
    try {
      const refs = [...(s.references.get(userId) || [])];
      const titleOf = (id) => (findRef(s, userId, id) || {}).title || id;
      const evaluations = refs.map((r) => {
        const out = evaluateSourceResult(s, userId, r.id);
        return out.ok ? out.result : { referenceId: r.id, title: r.title, error: out.error };
      });
      const gapsOut = findGapsResult(s, userId, job.question || "");
      const gaps = gapsOut.ok ? gapsOut.result : null;
      if (gaps) {
        for (const g of gaps.gaps || []) {
          if (g.kind === "missing_abstract" && Array.isArray(g.referenceIds)) {
            g.references = g.referenceIds.map((id) => ({ id, title: titleOf(id) }));
          }
        }
      }
      let matches = null;
      if (job.question) {
        const m = matchQuestionsResult(s, userId, job.question);
        matches = m.ok ? m.result : null;
      }
      job.status = "complete";
      job.completedAt = rfNow();
      job.result = {
        question: job.question,
        itemsRead: refs.map((r) => ({ id: r.id, title: r.title, year: r.year ?? null })),
        evaluations,
        gaps,
        matches,
        source: "library",
      };
    } catch (e) {
      job.status = "failed";
      job.error = String(e?.message || e);
      job.completedAt = rfNow();
    }
    saveResearchState();
  }

  registerLensAction("research", "analyze-library", (ctx, _a, params = {}) => {
    try {
      const s = getResearchStateExt(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = rfAid(ctx);
      const refs = s.references.get(userId) || [];
      if (refs.length === 0) {
        return { ok: false, error: "references required", reason: "no_references" };
      }
      const job = {
        id: rfId("analysis"),
        status: "running",
        question: rfClean(params.question || params.topic || "", 500) || null,
        itemCount: refs.length,
        createdAt: rfNow(),
        completedAt: null,
        result: null,
        error: null,
      };
      const list = rfListB(s.analyses, userId);
      list.unshift(job);
      while (list.length > 10) list.pop();
      saveResearchState();
      // Background completion: the caller gets the pending job now and
      // polls analysis-get — the same pending-state contract Deep
      // Research's surface uses.
      setTimeout(() => { try { runLibraryAnalysis(s, userId, job); } catch (_e) { /* recorded on the job */ } }, 0);
      return {
        ok: true,
        result: {
          job: {
            id: job.id, status: job.status, question: job.question,
            itemCount: job.itemCount, createdAt: job.createdAt,
          },
        },
      };
    } catch (e) {
      return { ok: false, error: "handler_error", message: String(e?.message || e) };
    }
  });

  registerLensAction("research", "analysis-get", (ctx, _a, params = {}) => {
    try {
      const s = getResearchStateExt(); if (!s) return { ok: false, error: "STATE unavailable" };
      const list = (s.analyses instanceof Map && s.analyses.get(rfAid(ctx))) || [];
      const job = list.find((j) => j.id === String(params.id || ""));
      if (!job) return { ok: false, error: "analysis not found" };
      return { ok: true, result: { job } };
    } catch (e) {
      return { ok: false, error: "handler_error", message: String(e?.message || e) };
    }
  });

  registerLensAction("research", "analysis-list", (ctx, _a, _params = {}) => {
    try {
      const s = getResearchStateExt(); if (!s) return { ok: false, error: "STATE unavailable" };
      const list = ((s.analyses instanceof Map && s.analyses.get(rfAid(ctx))) || []).map((j) => ({
        id: j.id, status: j.status, question: j.question,
        itemCount: j.itemCount, createdAt: j.createdAt, completedAt: j.completedAt,
      }));
      return { ok: true, result: { analyses: list, count: list.length } };
    } catch (e) {
      return { ok: false, error: "handler_error", message: String(e?.message || e) };
    }
  });

  // ── Phase 9a: auto-source (lib/auto-source.js) ─────────────────────
  // Gated by CONCORD_AUTOSOURCE_ENABLED (default off until reviewed).
  // Limits live in the lib (5 runs/user/hour, 200/day by default). The
  // action sets nothing about visibility itself: the lib writes public
  // citations and ONE private summary; only the summary's author can
  // publish it (auto-source-publish).
  // Read-only status for the 9b button: enabled flag, caps and current usage.
  registerLensAction("research", "auto-source-status", async (ctx) => {
    const signedIn = !refuseAnonWrite(ctx);
    const userId = signedIn ? researchActor(ctx) : null;
    return { ok: true, result: { enabled: autoSourceEnabled(), signedIn, ...autoSourceUsage(userId) } };
  });

  registerLensAction("research", "auto-source", async (ctx, _a, params = {}) => {
    // Writes public citation DTUs: never for signed-out callers. ("auto-source"
    // is not write-shaped by name, so guardAnonWrites alone would let it through.)
    const no = refuseAnonWrite(ctx);
    if (no) return no;
    if (!autoSourceEnabled()) return { ok: false, status: 503, error: "auto_source_disabled" };
    const topic = String(params.topic || "").trim();
    if (!topic) return { ok: false, status: 400, error: "topic_required" };
    const userId = researchActor(ctx);
    const r = await autoSource(
      { topic, lensDomain: params.lensDomain ? String(params.lensDomain).slice(0, 60) : null, userId },
      {
        searchDtus: async (q) => {
          const res = await ctx.macro.run("dtu", "search", { q, limit: 25 });
          return res?.dtus || [];
        },
        runMacro: (d, a, input) => ctx.macro.run(d, a, input),
        summarize: typeof ctx.llm?.chat === "function"
          ? async ({ topic: t, sources }) => {
              const res = await ctx.llm.chat({
                system: "You write short, strictly source-bound research summaries. Every sentence carries a citation like [1]. You never state a fact that is not in the provided sources.",
                messages: [{ role: "user", content: buildSummaryPrompt(t, sources) }],
                temperature: 0.2,
                maxTokens: 900,
                slot: "conscious",
              });
              return String(res?.text || res?.content || res?.message?.content || "").trim();
            }
          : null,
      },
    );
    try {
      ctx.log("research.auto-source", `auto-source "${topic}" -> ${r.ok ? (r.covered ? "covered" : "created") : (r.reason || r.error || "failed")}`, { providersUsed: r.providersUsed || [], userId });
    } catch { /* logging is best-effort */ }
    if (!r.ok) return { ok: false, status: r.status || 422, error: r.error || r.reason || "auto_source_failed", ...(r.reason ? { reason: r.reason } : {}) };
    return { ok: true, result: r };
  });

  registerLensAction("research", "auto-source-publish", async (ctx, _a, params = {}) => {
    const no = refuseAnonWrite(ctx);
    if (no) return no;
    const summaryId = String(params.summaryId || params.id || "");
    if (!summaryId) return { ok: false, status: 400, error: "summary_id_required" };
    const r = await publishAutoSourceSummary(
      { summaryId, userId: researchActor(ctx) },
      {
        getDtu: async (id) => {
          const res = await ctx.macro.run("dtu", "get", { id });
          return res?.dtu || null;
        },
      },
    );
    if (!r.ok) return { ok: false, status: r.status || 400, error: r.error || "publish_failed", ...(r.missing ? { missing: r.missing } : {}) };
    return { ok: true, result: r };
  });
}
