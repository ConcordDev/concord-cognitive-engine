// server/domains/research.js
// Domain actions for research: citation network analysis, methodology scoring,
// reproducibility assessment, and literature gap detection.

import { callVision, callVisionUrl, visionPromptForDomain } from "../lib/vision-inference.js";
import { cachedFetchJson } from "../lib/external-fetch.js";

export default function registerResearchActions(registerLensAction) {
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
  registerLensAction("research", "citationNetwork", (ctx, artifact, _params) => {
  try {
    const papers = artifact.data?.papers || [];
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

    return {
      ok: true, result: {
        totalPapers: papers.length,
        hIndex,
        rankedPapers: ranked.slice(0, 15),
        foundationalWorks: foundational.map(p => ({ id: p.id, title: p.title, year: p.year, citations: p.inDegree })),
        frontierWorks: frontier.map(p => ({ id: p.id, title: p.title, year: p.year, references: p.outDegree })),
        topicClusters,
        yearDistribution: yearDist,
        networkDensity: n > 1 ? Math.round(ranked.reduce((s, p) => s + p.outDegree, 0) / (n * (n - 1)) * 10000) / 10000 : 0,
      },
    };
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
   *   replicationAttempts? }
   */
  registerLensAction("research", "reproducibilityCheck", (ctx, artifact, _params) => {
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

    return {
      ok: true, result: {
        checks,
        overallScore: totalScore, maxScore: totalWeight,
        reproducibilityPercentage: percentage,
        assessment: percentage >= 80 ? "highly-reproducible"
          : percentage >= 60 ? "moderately-reproducible"
            : percentage >= 40 ? "concerns-noted"
              : "low-reproducibility",
        criticalIssues: checks.filter(c => c.score < c.maxScore * 0.3).map(c => c.name),
      },
    };
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
  function formatCitation(ref, style) {
    const authors = rfClean(ref.authors, 400) || "Unknown";
    const year = ref.year || "n.d.";
    const title = rfClean(ref.title, 400);
    const journal = rfClean(ref.journal, 200);
    const doi = rfClean(ref.doi, 120);
    switch (style) {
      case "mla":
        return `${authors}. "${title}." ${journal ? `${journal}, ` : ""}${year}.`;
      case "chicago":
        return `${authors}. "${title}." ${journal ? `${journal} ` : ""}(${year}).`;
      case "bibtex": {
        const fields = [
          `  title={${title}}`,
          `  author={${authors}}`,
          ref.year ? `  year={${ref.year}}` : null,
          journal ? `  journal={${journal}}` : null,
          doi ? `  doi={${doi}}` : null,
        ].filter(Boolean).join(",\n");
        return `@${ref.type === "book" ? "book" : "article"}{${citationKey(ref)},\n${fields}\n}`;
      }
      case "apa":
      default:
        return `${authors} (${year}). ${title}.${journal ? ` ${journal}.` : ""}${doi ? ` https://doi.org/${doi}` : ""}`;
    }
  }

  // ── References ──────────────────────────────────────────────────────
  registerLensAction("research", "reference-add", (ctx, _a, params = {}) => {
  try {
    const s = getResearchState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const title = rfClean(params.title, 400);
    if (!title) return { ok: false, error: "title required" };
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
        (r.journal || "").toLowerCase().includes(q));
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
  registerLensAction("research", "annotation-add", (ctx, _a, params = {}) => {
    const s = getResearchState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = rfAid(ctx);
    if (!findRef(s, userId, params.referenceId)) return { ok: false, error: "reference not found" };
    const text = rfClean(params.text, 2000);
    const quote = rfClean(params.quote, 2000);
    if (!text && !quote) return { ok: false, error: "text or quote required" };
    const annotation = {
      id: rfId("ann"), referenceId: String(params.referenceId),
      page: Math.max(0, Math.round(rfNum(params.page))) || null,
      quote: quote || null, text: text || null,
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
    const style = ["apa", "mla", "chicago", "bibtex"].includes(String(params.style).toLowerCase())
      ? String(params.style).toLowerCase() : "apa";
    return { ok: true, result: { style, citation: formatCitation(ref, style), key: citationKey(ref) } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("research", "bibliography-build", (ctx, _a, params = {}) => {
  try {
    const s = getResearchState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = rfAid(ctx);
    const style = ["apa", "mla", "chicago", "bibtex"].includes(String(params.style).toLowerCase())
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
    for (const k of ["snapshots", "canvases", "pdfs", "reviews"]) {
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
    let titles = [...map.values()].map((n) => ({ id: n.id, title: n.title, updatedAt: n.updatedAt }));
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
      kind: ["note", "text", "link"].includes(String(c.kind)) ? String(c.kind) : "text",
      noteId: c.noteId ? String(c.noteId) : null,
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
    if (!/^https?:\/\//i.test(url)) return { ok: false, error: "url must be http(s)" };
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

  registerLensAction("research", "academic-search", async (_ctx, _a, params = {}) => {
    const query = String(params.query || "").trim();
    if (!query) return { ok: false, error: "query required" };
    if (query.length < 2) return { ok: false, error: "query too short" };
    const limit = Math.min(Math.max(Number(params.limit) || 15, 1), 25);
    const provider = ["openalex", "arxiv"].includes(String(params.provider))
      ? String(params.provider) : "openalex";
    try {
      if (provider === "arxiv") {
        const url = `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=${limit}&sortBy=relevance`;
        const xml = await (await fetch(url, { signal: AbortSignal.timeout(9000) })).text();
        const results = mapArxivWork(xml);
        return { ok: true, result: { provider, query, count: results.length, results } };
      }
      const fields = "id,display_name,publication_year,authorships,cited_by_count,primary_location,host_venue,open_access,doi,abstract_inverted_index";
      const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=${limit}&select=${fields}&sort=relevance_score:desc`;
      const data = await cachedFetchJson(url, { ttlMs: 10 * 60 * 1000, timeoutMs: 9000 });
      const results = (data.results || []).map(mapOpenAlexWork);
      return { ok: true, result: { provider, query, count: results.length, results } };
    } catch (e) {
      return { ok: false, error: `academic search failed: ${String(e?.message || e)}` };
    }
  });

  // ── Import a search result straight into the reference library ──────
  registerLensAction("research", "academic-import", (ctx, _a, params = {}) => {
    const s = getResearchStateExt(); if (!s) return { ok: false, error: "STATE unavailable" };
    const w = params.work || params;
    const title = rfClean(w.title, 400);
    if (!title) return { ok: false, error: "title required" };
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
      tags: normTags(params.tags),
      status: "to_read",
      relatedIds: [],
      citationCount: Number.isFinite(Number(w.citationCount)) ? Number(w.citationCount) : null,
      createdAt: rfNow(),
    };
    rfListB(s.references, rfAid(ctx)).push(ref);
    saveResearchState();
    return { ok: true, result: { reference: ref } };
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
}
