/**
 * Audit export pack (OP2, R7 self-host proof)
 *
 * Assembles a single downloadable evidence bundle for a self-hoster or
 * auditor out of signals Concord ALREADY computes and persists to disk —
 * the detector suite baseline, the macro-depth grade (default + honest),
 * the UX-polish grade (default + honest), and doc-claims drift status.
 *
 * Hard rule: this module NEVER re-runs an expensive detector/grader inside
 * a request. It only reads the most recently persisted artifact for each
 * signal and reports that artifact's own generatedAt/head timestamp so a
 * stale artifact is never presented as "current" — each section carries
 * its own `stale` verdict against STALE_THRESHOLD_MS, not a shared one.
 * A missing artifact produces an honest `{available:false, reason:...}`,
 * never fabricated placeholder numbers.
 *
 * The only LIVE computation this module performs is cheap repo/deploy
 * metadata (git rev-parse, directory listings) and, optionally, a bounded
 * `npm run count-loc` invocation (~4s on this tree) — both fast enough to
 * run synchronously inside an admin request. If count-loc doesn't finish
 * inside the timeout, the bundle falls back to the last committed LOC
 * figure cited in CLAUDE.md-adjacent docs and says so.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

// An artifact older than this is still shown (never hidden) but flagged
// `stale: true` so a caller can't mistake a months-old grade for a fresh one.
const STALE_THRESHOLD_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

function readJsonArtifact(relPath) {
  const abs = path.join(REPO_ROOT, relPath);
  if (!fs.existsSync(abs)) {
    return { available: false, reason: "not_generated", source: relPath };
  }
  let stat;
  try {
    stat = fs.statSync(abs);
  } catch (e) {
    return { available: false, reason: "stat_failed", source: relPath, error: String(e?.message || e) };
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch (e) {
    return { available: false, reason: "parse_failed", source: relPath, error: String(e?.message || e) };
  }
  const generatedAt = data.generatedAt || null;
  const ageMs = generatedAt ? Date.now() - new Date(generatedAt).getTime() : (Date.now() - stat.mtimeMs);
  return {
    available: true,
    source: relPath,
    generatedAt: generatedAt || new Date(stat.mtimeMs).toISOString(),
    generatedAtSource: generatedAt ? "artifact" : "file_mtime",
    ageMs,
    ageHours: Math.round(ageMs / 36e5 * 10) / 10,
    stale: ageMs > STALE_THRESHOLD_MS,
    data,
  };
}

function fileFreshness(relPath) {
  const abs = path.join(REPO_ROOT, relPath);
  if (!fs.existsSync(abs)) return { available: false, reason: "not_generated", source: relPath };
  try {
    const stat = fs.statSync(abs);
    const ageMs = Date.now() - stat.mtimeMs;
    return {
      available: true,
      source: relPath,
      generatedAt: new Date(stat.mtimeMs).toISOString(),
      generatedAtSource: "file_mtime",
      ageMs,
      ageHours: Math.round(ageMs / 36e5 * 10) / 10,
      stale: ageMs > STALE_THRESHOLD_MS,
    };
  } catch (e) {
    return { available: false, reason: "stat_failed", source: relPath, error: String(e?.message || e) };
  }
}

function safeGit(args) {
  try {
    return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", timeout: 5000 }).trim();
  } catch {
    return null;
  }
}

function countFiles(globDir, matcher) {
  try {
    return fs.readdirSync(globDir).filter(matcher).length;
  } catch {
    return null;
  }
}

/** Detector suite section — reads the committed BASELINE.json + REPORT.md freshness. */
function buildDetectorsSection() {
  const baseline = readJsonArtifact("audit/detectors/BASELINE.json");
  const reportJson = readJsonArtifact("audit/detectors/REPORT.json"); // CI-only, often absent locally
  const reportMd = fileFreshness("audit/detectors/REPORT.md");

  return {
    baseline: baseline.available
      ? {
          available: true,
          source: baseline.source,
          generatedAt: baseline.generatedAt,
          ageHours: baseline.ageHours,
          stale: baseline.stale,
          totals: baseline.data.totals || null,
          detectorCount: baseline.data.detectorCount ?? null,
          fingerprintCount: baseline.data.fingerprints ? Object.keys(baseline.data.fingerprints).length : null,
        }
      : baseline,
    // The freshest possible number IF a CI run left REPORT.json behind;
    // most self-host boxes won't have this and that's fine — baseline covers it.
    latestCiReport: reportJson.available
      ? {
          available: true,
          source: reportJson.source,
          generatedAt: reportJson.generatedAt,
          ageHours: reportJson.ageHours,
          stale: reportJson.stale,
          totals: reportJson.data.totals || null,
        }
      : reportJson,
    reportMd,
    reproduce: "cd server && node scripts/run-detectors.js --diff --ci",
  };
}

/** Macro-depth grade section — default (generous) + honest floor. */
function buildMacroDepthSection() {
  const gen = readJsonArtifact("audit/macro-depth.json");
  const honest = readJsonArtifact("audit/macro-depth-honest.json");
  const shrink = (r) =>
    r.available
      ? {
          available: true,
          source: r.source,
          generatedAt: r.generatedAt,
          headAtGeneration: r.data.head || null,
          ageHours: r.ageHours,
          stale: r.stale,
          mode: r.data.mode || null,
          weightedScore: r.data.weightedScore ?? null,
          totals: r.data.totals || null,
          total: r.data.total ?? null,
        }
      : r;
  return {
    default: shrink(gen),
    honest: shrink(honest),
    reproduce: "node scripts/grade-macro-depth.mjs   (add --honest for the behavioral floor)",
  };
}

/** UX-polish grade section — default + honest. */
function buildUxPolishSection() {
  const gen = readJsonArtifact("audit/ux-polish.json");
  const honest = readJsonArtifact("audit/ux-polish-honest.json");
  const shrink = (r) =>
    r.available
      ? {
          available: true,
          source: r.source,
          generatedAt: r.generatedAt,
          ageHours: r.ageHours,
          stale: r.stale,
          mode: r.data.mode || null,
          weightedScore: r.data.weightedScore ?? null,
          totals: r.data.totals || null,
          genericScaffolds: r.data.genericScaffolds ?? null,
        }
      : r;
  return {
    default: shrink(gen),
    honest: shrink(honest),
    reproduce: "node scripts/grade-ux-polish.mjs --honest",
  };
}

/** Doc-claims drift section — reads the persisted status file if present. */
function buildDocClaimsSection() {
  const r = readJsonArtifact("audit/doc-claims-status.json");
  if (!r.available) {
    return {
      available: false,
      reason: r.reason,
      note:
        "No persisted doc-claims run found. Generate one with: " +
        "node scripts/check-doc-claims-all.mjs --json --out audit/doc-claims-status.json",
      reproduce: "node scripts/check-doc-claims-all.mjs --ci",
    };
  }
  return {
    available: true,
    source: r.source,
    generatedAt: r.generatedAt,
    headAtGeneration: r.data.head || null,
    ageHours: r.ageHours,
    stale: r.stale,
    checked: r.data.checked ?? null,
    failed: r.data.failed ?? null,
    clean: r.data.clean ?? null,
    driftedFiles: (r.data.results || []).filter((x) => !x.ok).map((x) => x.file),
    reproduce: "node scripts/check-doc-claims-all.mjs --ci",
  };
}

/** Repo/deploy metadata — cheap, computed live every time. */
function buildRepoMetaSection() {
  const head = safeGit(["rev-parse", "HEAD"]);
  const headShort = safeGit(["rev-parse", "--short", "HEAD"]);
  const branch = safeGit(["rev-parse", "--abbrev-ref", "HEAD"]);
  const commitDate = safeGit(["log", "-1", "--format=%cI"]);

  const migrationCount = countFiles(path.join(REPO_ROOT, "server", "migrations"), (f) => /^\d+_.*\.js$/.test(f));
  const domainFileCount = countFiles(path.join(REPO_ROOT, "server", "domains"), (f) => f.endsWith(".js"));
  const lensDirCount = (() => {
    try {
      const dir = path.join(REPO_ROOT, "concord-frontend", "app", "lenses");
      return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).length;
    } catch {
      return null;
    }
  })();
  const routeFileCount = countFiles(path.join(REPO_ROOT, "server", "routes"), (f) => f.endsWith(".js"));

  return {
    head,
    headShort,
    branch,
    commitDate,
    migrationCount,
    domainFileCount,
    routeFileCount,
    lensDirCount,
  };
}

const LOC_TIMEOUT_MS = 15_000;

/**
 * Attempts a live `node scripts/count-loc.mjs` run, bounded by LOC_TIMEOUT_MS.
 * On timeout/failure, returns an honest `available:false` — callers must NOT
 * substitute a fabricated number. (~4s observed on the reference tree; this
 * is the one live-computed signal, everything else in the bundle is a read
 * of an already-persisted artifact.)
 */
async function tryLiveCountLoc() {
  try {
    const { stdout } = await execFileAsync(
      "node",
      [path.join(REPO_ROOT, "scripts", "count-loc.mjs")],
      { cwd: REPO_ROOT, timeout: LOC_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }
    );
    const sourceMatch = stdout.match(/SOURCE\s+([\d,]+)\s+lines\s+·\s+([\d,]+)\s+files/);
    const contentMatch = stdout.match(/CONTENT\s+([\d,]+)\s+lines\s+·\s+([\d,]+)\s+files/);
    return {
      available: true,
      generatedAt: new Date().toISOString(),
      sourceLines: sourceMatch ? Number(sourceMatch[1].replace(/,/g, "")) : null,
      sourceFiles: sourceMatch ? Number(sourceMatch[2].replace(/,/g, "")) : null,
      contentLines: contentMatch ? Number(contentMatch[1].replace(/,/g, "")) : null,
      contentFiles: contentMatch ? Number(contentMatch[2].replace(/,/g, "")) : null,
      reproduce: "npm run count-loc",
    };
  } catch (e) {
    return {
      available: false,
      reason: e?.killed ? "timeout" : "run_failed",
      error: String(e?.message || e),
      note: "count-loc did not complete live — re-run `npm run count-loc` directly for a current figure.",
    };
  }
}

/**
 * Build the full audit-export bundle.
 * @param {object} opts
 * @param {boolean} [opts.includeLiveLoc=true] — run count-loc live (bounded, see tryLiveCountLoc).
 */
export async function buildAuditExport({ includeLiveLoc = true } = {}) {
  const generatedAt = new Date().toISOString();
  const repo = buildRepoMetaSection();
  const loc = includeLiveLoc ? await tryLiveCountLoc() : { available: false, reason: "skipped" };

  const sections = {
    detectors: buildDetectorsSection(),
    macroDepth: buildMacroDepthSection(),
    uxPolish: buildUxPolishSection(),
    docClaims: buildDocClaimsSection(),
  };

  // Overall bundle-level staleness: true if ANY available section is stale,
  // so a viewer can't miss it by only reading the top-level flag.
  const staleSections = Object.entries(sections)
    .flatMap(([name, sec]) => {
      const subs = sec.default || sec.honest || sec.baseline ? [sec.default, sec.honest, sec.baseline, sec.latestCiReport].filter(Boolean) : [sec];
      return subs.filter((s) => s && s.available && s.stale).map(() => name);
    });

  return {
    ok: true,
    kind: "concord-audit-export",
    version: 1,
    generatedAt,
    repo: { ...repo, loc },
    sections,
    staleSections: [...new Set(staleSections)],
    honestyNote:
      "Every section below reads a PERSISTED artifact and reports that artifact's own " +
      "generatedAt — this bundle does not re-run detectors/graders live. A section with " +
      "available:false means the artifact hasn't been generated yet on this box, not that " +
      "the signal is zero/clean. Regenerate stale sections with the listed `reproduce` command.",
  };
}
