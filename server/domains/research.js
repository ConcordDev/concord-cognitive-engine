// server/domains/research.js
// Domain actions for research: citation network analysis, methodology scoring,
// reproducibility assessment, and literature gap detection.

import { callVision, callVisionUrl, visionPromptForDomain } from "../lib/vision-inference.js";

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
  });

  /**
   * reproducibilityCheck
   * Assess reproducibility indicators from reported methodology and results.
   * artifact.data.study = { pValues?, sampleSizes?, effectSizes?,
   *   materialsSections?, codeAvailable?, dataAvailable?, protocolRegistered?,
   *   replicationAttempts? }
   */
  registerLensAction("research", "reproducibilityCheck", (ctx, artifact, _params) => {
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
  });

  // ── Note search (full-text) ──

  registerLensAction("research", "notes-search", (ctx, _artifact, params = {}) => {
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
    const s = getResearchState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const ref = findRef(s, rfAid(ctx), params.id);
    if (!ref) return { ok: false, error: "reference not found" };
    const style = ["apa", "mla", "chicago", "bibtex"].includes(String(params.style).toLowerCase())
      ? String(params.style).toLowerCase() : "apa";
    return { ok: true, result: { style, citation: formatCitation(ref, style), key: citationKey(ref) } };
  });

  registerLensAction("research", "bibliography-build", (ctx, _a, params = {}) => {
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
  });

  // ── Library stats ───────────────────────────────────────────────────
  registerLensAction("research", "library-stats", (ctx, _a, _params = {}) => {
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
  });
}
