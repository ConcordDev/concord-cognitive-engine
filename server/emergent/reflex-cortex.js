// server/emergent/reflex-cortex.js
//
// Phase 8 / T3 — Reflex Cortex (governance arm of the detector substrate).
//
// Parallel to lattice-orchestrator.js — wraps four heartbeat-driven handlers
// that consume detector findings and route them into BOTH governance
// proposals AND repair-cortex auto-fix dispatches. Sovereign retains
// override at every step.
//
// Handlers:
//   architectural-drift   (frequency 360, ~90 min)  — runs architectural-hub detector
//   scaling-pressure      (frequency 480, ~2h)      — runs predictive-growth detector
//   dependency-entropy    (frequency 1440, ~6h)     — diff package.json against last sha
//   unsafe-expansion      (frequency 720, ~3h)      — flag new modules without test pin
//
// Each handler is exception-safe — never throws, returns { ok, reason? }.
// The cortex disables itself when CONCORD_REFLEX_GOVERNANCE=0 is set.

import path from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import logger from "../logger.js";

let _STATE_REF = null;
let _DB_REF = null;
let _ROOT = null;

export function initReflexCortex(STATE, opts = {}) {
  _STATE_REF = STATE;
  _DB_REF = opts.db || null;
  _ROOT = opts.root || null;
}

function disabled() {
  return process.env.CONCORD_REFLEX_GOVERNANCE === "0";
}

async function runDet(id, ctx) {
  const mod = await import("../lib/detectors/index.js");
  return mod.runDetector(id, ctx);
}

async function postProposal(kind, finding, extra = {}) {
  try {
    const ap = await import("../lib/governance/auto-proposal.js");
    return ap.postAutoProposal({
      db: _DB_REF,
      kind,
      title: `[reflex] ${finding?.message || "warning"}`.slice(0, 160),
      body: `Detector: ${finding?.detector || "reflex"}\nFinding: ${finding?.id || "n/a"}\n${finding?.location || ""}\n${finding?.message || ""}`,
      evidence: { finding, ...extra },
      suggestedAction: finding?.fixHint || null,
    });
  } catch { return { ok: false, reason: "auto_proposal_unavailable" }; }
}

async function dispatchRepair(taskKind, payload) {
  try {
    const bridge = await import("./repair-cortex/detector-bridge.js");
    if (typeof bridge.configureBridge === "function") {
      // Bridge already configured at boot — no-op here, just route the
      // ingestion pathway through the standard detector delta flow when
      // possible.
    }
    // Lightweight signal — repair-cortex.observe() is the public entry.
    const rc = await import("./repair-cortex.js");
    if (typeof rc.observe === "function") {
      rc.observe(new Error(`reflex:${taskKind}`), `reflex:${taskKind}`);
    }
    return { ok: true, dispatched: taskKind, payload };
  } catch (err) {
    return { ok: false, reason: "dispatch_failed", error: err?.message };
  }
}

// ── Handler 1: Architectural drift ────────────────────────────────────────
export async function runArchitecturalDrift({ db, state } = {}) {
  if (disabled()) return { ok: false, reason: "reflex_disabled" };
  if (db && !_DB_REF) _DB_REF = db;
  try {
    const r = await runDet("architectural-hub", { root: _ROOT, db: db || _DB_REF, state: state || _STATE_REF });
    if (!r.ok) return { ok: false, reason: "detector_failed", detail: r.reason };
    const criticals = (r.findings || []).filter(f => f.severity === "critical");
    let posted = 0;
    for (const f of criticals) {
      const out = await postProposal("architectural_drift", { ...f, detector: "architectural-hub" });
      if (out.ok) posted++;
      await dispatchRepair("architectural_drift", { findingId: f.id, location: f.location });
    }
    return { ok: true, criticals: criticals.length, proposalsPosted: posted };
  } catch (err) {
    return { ok: false, reason: "exception", error: err?.message };
  }
}

// ── Handler 2: Scaling pressure ───────────────────────────────────────────
export async function runScalingPressure({ db, state } = {}) {
  if (disabled()) return { ok: false, reason: "reflex_disabled" };
  if (db && !_DB_REF) _DB_REF = db;
  try {
    const r = await runDet("predictive-growth", { root: _ROOT, db: db || _DB_REF, state: state || _STATE_REF });
    if (!r.ok) return { ok: false, reason: "detector_failed", detail: r.reason };
    const criticals = (r.findings || []).filter(f => f.severity === "critical");
    let posted = 0;
    for (const f of criticals) {
      const out = await postProposal("scaling_pressure", { ...f, detector: "predictive-growth" });
      if (out.ok) posted++;
      await dispatchRepair("scaling_pressure", { findingId: f.id, evidence: f.evidence });
    }
    return { ok: true, criticals: criticals.length, proposalsPosted: posted };
  } catch (err) {
    return { ok: false, reason: "exception", error: err?.message };
  }
}

// ── Handler 3: Dependency entropy ─────────────────────────────────────────
async function readDepHistory(root) {
  try {
    const p = path.join(root, "audit", "detectors", "dependency-history.json");
    return JSON.parse(await readFile(p, "utf-8"));
  } catch { return { lastSha: null, knownDeps: {} }; }
}

async function writeDepHistory(root, hist) {
  const p = path.join(root, "audit", "detectors", "dependency-history.json");
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(hist, null, 2));
}

export async function runDependencyEntropy() {
  if (disabled()) return { ok: false, reason: "reflex_disabled" };
  if (!_ROOT) return { ok: false, reason: "no_root" };
  try {
    const hist = await readDepHistory(_ROOT);
    const newDeps = [];
    for (const pkg of [
      path.join(_ROOT, "server", "package.json"),
      path.join(_ROOT, "concord-frontend", "package.json"),
    ]) {
      try {
        const pj = JSON.parse(await readFile(pkg, "utf-8"));
        const deps = { ...(pj.dependencies || {}), ...(pj.devDependencies || {}) };
        const known = hist.knownDeps[pkg] || {};
        for (const [name, version] of Object.entries(deps)) {
          if (!known[name]) newDeps.push({ pkgFile: pkg, name, version });
        }
        hist.knownDeps[pkg] = deps;
      } catch { /* missing package.json — ignore */ }
    }

    let posted = 0;
    for (const dep of newDeps) {
      // Look for an ADR (best-effort).
      let hasAdr = false;
      try {
        const fs = await import("node:fs/promises");
        const adrDir = path.join(_ROOT, "docs", "adr");
        const entries = await fs.readdir(adrDir).catch(() => []);
        hasAdr = entries.some(e => e.toLowerCase().includes(dep.name.toLowerCase().replace(/[@/]/g, "-")));
      } catch { /* ignore */ }
      if (!hasAdr) {
        const out = await postProposal("dependency_entropy", {
          detector: "reflex-dependency-entropy",
          id: "dep_without_adr",
          severity: "high",
          message: `New dependency \`${dep.name}@${dep.version}\` without ADR`,
          location: path.relative(_ROOT, dep.pkgFile),
        });
        if (out.ok) posted++;
      }
    }

    await writeDepHistory(_ROOT, hist);
    return { ok: true, newDepCount: newDeps.length, proposalsPosted: posted };
  } catch (err) {
    return { ok: false, reason: "exception", error: err?.message };
  }
}

// ── Handler 4: Unsafe expansion ───────────────────────────────────────────
export async function runUnsafeExpansion() {
  if (disabled()) return { ok: false, reason: "reflex_disabled" };
  if (!_ROOT) return { ok: false, reason: "no_root" };
  try {
    // Heuristic, not git-based: walk emergent + lib for newly modified files
    // (mtime within 24h) that declare an @invariant JSDoc tag but have no
    // corresponding test file.
    const fs = await import("node:fs/promises");
    const now = Date.now();
    const dayMs = 1000 * 60 * 60 * 24;

    async function walkRecent(dir, exts = [".js"]) {
      const out = [];
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const e of entries) {
          if (e.name.startsWith(".")) continue;
          const p = path.join(dir, e.name);
          if (e.isDirectory()) out.push(...await walkRecent(p, exts));
          else if (e.isFile() && exts.some(x => e.name.endsWith(x))) {
            try {
              const st = await fs.stat(p);
              if (now - st.mtimeMs < dayMs) out.push(p);
            } catch { /* ignore */ }
          }
        }
      } catch { /* ignore */ }
      return out;
    }

    const targets = [
      ...await walkRecent(path.join(_ROOT, "server", "lib")),
      ...await walkRecent(path.join(_ROOT, "server", "emergent")),
    ];
    const findings = [];
    for (const f of targets) {
      const c = await fs.readFile(f, "utf-8").catch(() => "");
      if (!/@invariant\b/.test(c)) continue;
      // Look for a test pinning this file's path.
      const baseName = path.basename(f, ".js");
      const testHints = [
        path.join(_ROOT, "server", "tests", `${baseName}.test.js`),
        path.join(_ROOT, "server", "tests", `${baseName.replace(/-/g, "_")}.test.js`),
      ];
      let hasTest = false;
      for (const h of testHints) {
        try { await fs.stat(h); hasTest = true; break; } catch { /* ignore */ }
      }
      if (!hasTest) {
        findings.push({
          path: path.relative(_ROOT, f),
        });
      }
    }

    let posted = 0;
    for (const f of findings) {
      const out = await postProposal("unsafe_expansion", {
        detector: "reflex-unsafe-expansion",
        id: "invariant_without_test",
        severity: "critical",
        message: `Module declares @invariant but has no test pin: ${f.path}`,
        location: f.path,
      });
      if (out.ok) posted++;
      await dispatchRepair("unsafe_expansion", { path: f.path });
    }

    return { ok: true, recentFiles: targets.length, unsafeCount: findings.length, proposalsPosted: posted };
  } catch (err) {
    return { ok: false, reason: "exception", error: err?.message };
  }
}

// ── Diagnostic getters for the lens ───────────────────────────────────────
export function reflexStatus() {
  return {
    initialised: !!_STATE_REF || !!_DB_REF || !!_ROOT,
    disabled: disabled(),
    db: !!_DB_REF,
    root: _ROOT,
  };
}
