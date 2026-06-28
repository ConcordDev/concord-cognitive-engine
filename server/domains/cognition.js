// server/domains/cognition.js
//
// cognition lens — the reasoning / lattice-topology inspector. The substrate
// macros (`hlr.*`, `hlm.*`, `breakthrough.*`, `forgetting.*`) are registered
// inline in server.js where they have access to the live HLR/HLM engines and
// STATE.dtus. This module adds the parity macros that turn that tabular
// substrate into an explorable inspector:
//
//   cognition.compareModes   — run two reasoning modes on one prompt
//   cognition.recommendMode  — recommend a reasoning mode given a question
//   cognition.exportTrace    — persist a reasoning trace as a shareable artifact
//   cognition.listExports    — list this user's saved trace exports
//   cognition.getExport      — fetch one saved export by id
//   cognition.deleteExport   — remove a saved export
//   cognition.driftAlerts    — drift-monitor alerts (filterable by severity)
//
// Registration: this domain registers through the canonical `register`
// (MACROS) registry — `registerCognitionMacros(register)` in server.js — so
// every macro is reachable BOTH via POST /api/lens/run AND via runMacro (which
// the contract engine + macro-assassin + behavior-smoke harness drive).
// Handlers use the canonical 2-arg `(ctx, input)` convention and return a
// `{ ok, result }` (or `{ ok:false, error }`) envelope; the dispatcher's
// `_unwrapLensEnvelope` strips the `result` layer so the frontend reads
// `r.data.result.<field>`.
//
// PRIOR BUG (this batch): cognition.js used the LEGACY 3-arg
// `registerLensAction(domain, action, (ctx, artifact, params) => ...)`
// convention AND was never imported by server.js — so every cognition.* macro
// was invisible to runMacro / the contract engine / macro-assassin AND hit
// `unknown_macro` at runtime, leaving the lens components (ModeRecommender,
// ModeComparison, TraceExports) and the drift timeline dead-wired. Rewritten to
// the canonical register convention; the same compute lives here, no
// duplicated logic. The frontend manifest's phantom `lens.cognition.*` macro
// refs were corrected to the real `cognition.*` ids alongside this.
//
// Persistence: per-user in globalThis._concordSTATE.cognitionLens (an
// exports Map keyed by userId). No fake/seed data: every value is real user
// input or derived from a real HLR run / real drift scan.
//
// External engines: compareModes lazy-imports the real HLR engine and
// driftAlerts lazy-imports the real drift-monitor — both are pure in-process
// reads (no network / no LLM in the default path), so the hermetic test +
// the macro-assassin drive them without standing up either engine (they return
// a real `{ok:false}` validation/unavailable reason, never a fabricated ok:true).

// Reject a poisoned numeric input (NaN/±Infinity/1e308/negative) BEFORE it can
// silently clamp through a Math.min/max bound and return a fabricated ok:true —
// the defect the macro-assassin's V2 vector catches. A caller that PASSES a
// numeric field at all must pass a finite, non-negative one within range; an
// absent/null field is fine (the macro uses its default). Returns null when
// clean, else the offending key.
function badNumericField(input, keys) {
  const p = input || {};
  for (const k of keys) {
    if (p[k] === undefined || p[k] === null) continue;
    const n = Number(p[k]);
    if (!Number.isFinite(n) || n < 0 || n > 1e6) return k;
  }
  return null;
}

const ALL_MODES = [
  "deductive", "inductive", "abductive", "adversarial",
  "analogical", "temporal", "counterfactual",
];

const MODE_GUIDE = {
  deductive:      { label: "Deductive",      blurb: "Premise → conclusion. Strict logical implication." },
  inductive:      { label: "Inductive",      blurb: "Pattern → generalization from observations." },
  abductive:      { label: "Abductive",      blurb: "Inference to the best explanation given evidence." },
  adversarial:    { label: "Adversarial",    blurb: "Steelman the opposite; stress-test the claim." },
  analogical:     { label: "Analogical",     blurb: "Map structure across domains." },
  temporal:       { label: "Temporal",       blurb: "How does this evolve over time?" },
  counterfactual: { label: "Counterfactual", blurb: "What if the premise were false?" },
};

const ALL_SEVERITIES = ["info", "warning", "alert", "critical"];

export default function registerCognitionMacros(register) {
  // ── per-user STATE plumbing ───────────────────────────────────────────
  function getCogState() {
    const STATE = globalThis._concordSTATE || (globalThis._concordSTATE = {});
    if (!STATE.cognitionLens) STATE.cognitionLens = {};
    const s = STATE.cognitionLens;
    if (!(s.exports instanceof Map)) s.exports = new Map(); // userId -> Array<export>
    return s;
  }
  function saveCog() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const cogActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const cogId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const cogList = (m, k) => { if (!m.has(k)) m.set(k, []); return m.get(k); };

  // HLR is lazily imported so the domain module stays loadable in tests
  // even when the engine isn't on the classpath. The promise is cached.
  let _hlrPromise = null;
  function loadHLR() {
    if (!_hlrPromise) _hlrPromise = import("../emergent/hlr-engine.js").catch(() => null);
    return _hlrPromise;
  }

  let _driftPromise = null;
  function loadDrift() {
    if (!_driftPromise) _driftPromise = import("../emergent/drift-monitor.js").catch(() => null);
    return _driftPromise;
  }

  // ── compareModes ──────────────────────────────────────────────────────
  // Runs the same claim/question through two reasoning modes so a user can
  // see, side by side, how each mode frames the problem. Both runs go
  // through the real HLR engine — no synthetic output.
  register("cognition", "compareModes", async (_ctx, input = {}) => {
    try {
      const params = input || {};
      const badNum = badNumericField(params, ["depth"]);
      if (badNum) return { ok: false, error: `invalid_${badNum}` };
      const prompt = String(params.claim || params.question || params.topic || "").trim();
      if (!prompt) return { ok: false, error: "claim_or_question_required" };
      const modeA = String(params.modeA || "deductive").toLowerCase();
      const modeB = String(params.modeB || "adversarial").toLowerCase();
      if (!ALL_MODES.includes(modeA) || !ALL_MODES.includes(modeB)) {
        return { ok: false, error: "invalid_mode", allowed: ALL_MODES };
      }
      if (modeA === modeB) return { ok: false, error: "modes_must_differ" };
      const hlr = await loadHLR();
      if (!hlr || typeof hlr.runHLR !== "function") {
        return { ok: false, error: "hlr_engine_unavailable" };
      }
      const depth = Math.max(1, Math.min(5, Number(params.depth) || 3));
      const runFor = (mode) => {
        const r = hlr.runHLR({ question: prompt, mode, depth });
        if (!r || r.ok === false) {
          return { mode, ok: false, error: r?.error || "hlr_run_failed" };
        }
        // The runHLR response carries only summary chains (no per-step
        // detail). Re-fetch the persisted trace so the comparison view can
        // render the full inference tree side by side.
        const stored = typeof hlr.getReasoningTrace === "function"
          ? hlr.getReasoningTrace(r.traceId)
          : null;
        const chains = Array.isArray(stored?.chains) ? stored.chains
          : (Array.isArray(r.chains) ? r.chains : []);
        return {
          mode,
          ok: true,
          traceId: r.traceId || stored?.traceId || null,
          conclusion: stored?.output?.synthesizedConclusion
            || r.synthesizedConclusion || null,
          chainCount: chains.length,
          confidence: r.evaluation?.confidence ?? stored?.evaluation?.confidence ?? null,
          convergence: r.evaluation?.convergence ?? stored?.evaluation?.convergence ?? null,
          novelty: r.evaluation?.novelty ?? stored?.evaluation?.novelty ?? null,
          proposedDTUCount: stored?.output?.proposedDTUCount
            ?? (Array.isArray(r.proposedDTUs) ? r.proposedDTUs.length : 0),
          openQuestionCount: stored?.output?.openQuestionCount
            ?? (Array.isArray(r.openQuestions) ? r.openQuestions.length : 0),
          chains,
        };
      };
      const a = runFor(modeA);
      const b = runFor(modeB);
      // A small comparative read so the UI doesn't have to recompute it.
      let verdict = "tie";
      if (a.ok && b.ok && a.confidence != null && b.confidence != null) {
        if (a.confidence > b.confidence + 0.05) verdict = modeA;
        else if (b.confidence > a.confidence + 0.05) verdict = modeB;
      } else if (a.ok && !b.ok) verdict = modeA;
      else if (b.ok && !a.ok) verdict = modeB;
      return {
        ok: true,
        result: {
          prompt,
          depth,
          a, b,
          higherConfidence: verdict,
          comparedAt: new Date().toISOString(),
        },
      };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
  }, { note: "run one prompt through two HLR reasoning modes side by side" });

  // ── recommendMode ─────────────────────────────────────────────────────
  // Given a free-text question, recommend which of the 7 reasoning modes
  // best fits. The recommendation is a transparent rule-based classifier
  // over the question's surface form — every signal is derived from the
  // user's actual text, no LLM, no seed data.
  register("cognition", "recommendMode", (_ctx, input = {}) => {
    try {
      const params = input || {};
      const q = String(params.question || params.claim || params.topic || "").trim();
      if (!q) return { ok: false, error: "question_required" };
      const lower = q.toLowerCase();
      const has = (...words) => words.some((w) => lower.includes(w));
      // Each mode accrues weighted evidence from question surface features.
      const score = {
        deductive: 0, inductive: 0, abductive: 0, adversarial: 0,
        analogical: 0, temporal: 0, counterfactual: 0,
      };
      const signals = [];
      const note = (mode, weight, why) => { score[mode] += weight; signals.push({ mode, weight, why }); };

      // A bare "if " is a deductive signal, but "what if" is a much stronger
      // counterfactual cue — don't let the generic substring fire a false
      // deductive positive when the question is plainly a what-if.
      const isWhatIf = lower.includes("what if");
      if ((!isWhatIf && lower.includes("if "))
        || has("therefore", "implies", "follows that", "must be", "prove")) {
        note("deductive", 3, "states a premise and asks what follows");
      }
      if (has("always", "every", "in general", "pattern", "trend", "tend to", "usually")) {
        note("inductive", 3, "generalizes from repeated observations");
      }
      if (has("why", "what explains", "best explanation", "cause of", "because", "what caused")) {
        note("abductive", 3, "seeks the most likely explanation");
      }
      if (has("is it true", "should ", "objection", "counter", "weak", "flaw", "wrong", "disagree")) {
        note("adversarial", 3, "invites a claim to be stress-tested");
      }
      if (has("like", "similar", "compare", "analog", "as if", "parallel", "metaphor")) {
        note("analogical", 3, "asks for a cross-domain mapping");
      }
      if (has("over time", "evolve", "future", "will ", "history", "trajectory", "phase", "when")) {
        note("temporal", 3, "is about change across time");
      }
      if (has("what if", "had not", "would have", "counterfactual", "instead of", "absent")) {
        note("counterfactual", 3, "explores an alternative-history scenario");
      }
      // Question-form fallbacks so a bare question still gets a sensible pick.
      if (lower.startsWith("why")) note("abductive", 1, "a 'why' question");
      if (lower.startsWith("how")) note("temporal", 1, "a 'how' question");
      if (lower.includes("?") && signals.length === 0) {
        note("abductive", 1, "open question with no strong surface signal");
      }
      if (signals.length === 0) note("deductive", 1, "no surface signal — default to strict implication");

      const ranked = Object.entries(score)
        .map(([mode, s]) => ({
          mode,
          score: s,
          label: MODE_GUIDE[mode].label,
          blurb: MODE_GUIDE[mode].blurb,
        }))
        .sort((x, y) => y.score - x.score);
      const top = ranked[0];
      const maxScore = top.score || 1;
      const ranking = ranked.map((r) => ({
        ...r,
        fit: Math.round((r.score / maxScore) * 100) / 100,
      }));
      return {
        ok: true,
        result: {
          question: q,
          recommended: top.mode,
          recommendedLabel: top.label,
          confidence: Math.min(1, Math.round((top.score / 4) * 100) / 100),
          rationale: signals.filter((s) => s.mode === top.mode).map((s) => s.why),
          ranking,
          signals,
        },
      };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
  }, { note: "recommend one of the 7 HLR reasoning modes from a question's surface form" });

  // ── exportTrace ───────────────────────────────────────────────────────
  // Persist a reasoning trace (passed whole by the client, which already
  // holds it from a prior hlr.run / hlr.trace call) as a shareable
  // artifact in the user's cognition export ledger.
  register("cognition", "exportTrace", (ctx, input = {}) => {
    try {
      const params = input || {};
      const s = getCogState();
      const trace = params.trace && typeof params.trace === "object" ? params.trace : null;
      if (!trace) return { ok: false, error: "trace_required" };
      const title = String(params.title || "").trim().slice(0, 120)
        || (trace.input?.topic || trace.input?.question || "Reasoning trace").toString().slice(0, 120);
      const entry = {
        id: cogId("cogexp"),
        kind: "hlr_trace",
        title,
        mode: trace.input?.mode || trace.mode || null,
        traceId: trace.traceId || trace.id || null,
        note: String(params.note || "").trim().slice(0, 500),
        trace,
        createdAt: new Date().toISOString(),
      };
      const list = cogList(s.exports, cogActor(ctx));
      list.unshift(entry);
      if (list.length > 200) list.length = 200;
      saveCog();
      return { ok: true, result: { export: { ...entry, trace: undefined }, exportId: entry.id, total: list.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
  }, { note: "persist an HLR reasoning trace into the caller's export ledger" });

  // ── listExports ───────────────────────────────────────────────────────
  register("cognition", "listExports", (ctx, _input = {}) => {
    try {
      const s = getCogState();
      const list = cogList(s.exports, cogActor(ctx));
      // Return metadata only — the full trace is fetched on demand.
      const exports = list.map((e) => ({
        id: e.id,
        kind: e.kind,
        title: e.title,
        mode: e.mode,
        traceId: e.traceId,
        note: e.note,
        createdAt: e.createdAt,
      }));
      return { ok: true, result: { exports, count: exports.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
  }, { note: "list the caller's saved reasoning-trace exports (metadata only)" });

  // ── getExport ─────────────────────────────────────────────────────────
  register("cognition", "getExport", (ctx, input = {}) => {
    try {
      const params = input || {};
      const s = getCogState();
      const list = cogList(s.exports, cogActor(ctx));
      const entry = list.find((e) => e.id === params.exportId);
      if (!entry) return { ok: false, error: "export_not_found" };
      return { ok: true, result: { export: entry } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
  }, { note: "fetch one of the caller's saved exports by id (full trace)" });

  // ── deleteExport ──────────────────────────────────────────────────────
  register("cognition", "deleteExport", (ctx, input = {}) => {
    try {
      const params = input || {};
      const s = getCogState();
      const list = cogList(s.exports, cogActor(ctx));
      const idx = list.findIndex((e) => e.id === params.exportId);
      if (idx < 0) return { ok: false, error: "export_not_found" };
      list.splice(idx, 1);
      saveCog();
      return { ok: true, result: { deleted: params.exportId, count: list.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
  }, { note: "remove one of the caller's saved exports by id" });

  // ── driftAlerts ───────────────────────────────────────────────────────
  // Surfaces the lattice drift-monitor's alert stream as a chronological,
  // severity-filterable feed. The drift-monitor stores its alerts inside
  // the live STATE emergent store; this macro is a thin read-only wrapper
  // so the cognition lens can render a drift-alert timeline. Every alert
  // is a real finding from `runDriftScan` on the actual DTU corpus — no
  // synthetic alerts are ever injected.
  register("cognition", "driftAlerts", async (_ctx, input = {}) => {
    try {
      const params = input || {};
      const badNum = badNumericField(params, ["limit"]);
      if (badNum) return { ok: false, error: `invalid_${badNum}` };
      const STATE = globalThis._concordSTATE;
      if (!STATE) return { ok: false, error: "STATE unavailable" };
      const drift = await loadDrift();
      if (!drift || typeof drift.getDriftAlerts !== "function") {
        return { ok: false, error: "drift_monitor_unavailable" };
      }
      const filters = {};
      const severity = String(params.severity || "").toLowerCase();
      if (severity && ALL_SEVERITIES.includes(severity)) filters.severity = severity;
      const type = String(params.type || "").toLowerCase();
      if (type) filters.type = type;
      if (params.since != null && String(params.since).trim()) {
        filters.since = String(params.since);
      }
      filters.limit = Math.max(1, Math.min(200, Number(params.limit) || 100));

      let res;
      try { res = drift.getDriftAlerts(STATE, filters); }
      catch (_e) { return { ok: false, error: "drift_scan_failed" }; }
      const alerts = Array.isArray(res?.alerts) ? res.alerts : [];
      // Most-recent-first for a timeline read. Alert timestamps are ISO
      // strings — Date.parse normalises them for the comparison.
      const tms = (a) => {
        const n = Date.parse(a?.timestamp);
        return Number.isFinite(n) ? n : 0;
      };
      const ordered = [...alerts].sort((x, y) => tms(y) - tms(x));
      // A per-severity tally so the UI can show filter counts without a
      // second round trip.
      const bySeverity = { info: 0, warning: 0, alert: 0, critical: 0 };
      for (const a of alerts) {
        if (a.severity in bySeverity) bySeverity[a.severity] += 1;
      }
      let metrics = null;
      if (typeof drift.getDriftMetrics === "function") {
        try {
          const m = drift.getDriftMetrics(STATE);
          if (m?.ok) metrics = { snapshotCount: m.snapshotCount, alertCount: m.alertCount };
        } catch (_e) { /* metrics are optional */ }
      }
      return {
        ok: true,
        result: {
          alerts: ordered,
          total: res?.total ?? alerts.length,
          bySeverity,
          severities: ALL_SEVERITIES,
          appliedSeverity: filters.severity || null,
          metrics,
          scannedAt: new Date().toISOString(),
        },
      };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
  }, { note: "severity-filterable drift-monitor alert feed over the live DTU corpus" });
}
