#!/usr/bin/env node
// scripts/scaffold-lens.mjs
//
// Lens scaffolder — turns CLAUDE.md's "Adding a New Lens" section (5 manual
// doc steps) into a runnable script. A grounding audit found no such
// scaffolder existed; every one of the 261 lenses had been built by hand.
//
// This script generates the two NEW files every lens needs:
//   - server/domains/<lens-id>.js            (a real, working macro domain)
//   - concord-frontend/app/lenses/<lens-id>/page.tsx  (a bespoke, minimal page)
//
// and programmatically, safely extends two SMALL, purely-appendable shared
// registries:
//   - server/lib/lens-manifest.js            (DOMAIN_TAG_MAP entry)
//   - server/lib/lens-features-extended.js   (EXTENDED_FEATURES entry)
//
// It deliberately does NOT touch:
//   - server/server.js (ALL_LENS_DOMAINS array + the `import
//     registerXMacros from "./domains/x.js"` + `registerXMacros(register)`
//     wiring). server.js is a 79,000+ line monolith with a documented
//     boot-order TDZ hazard (CLAUDE.md: "Boot-order TDZ hazard" — code
//     referencing `app`/`LENS_ACTIONS` before their declaration silently
//     dead-mounts). A generic script doing blind text-insertion into that
//     file is exactly the kind of edit that produced real production bugs
//     documented in CLAUDE.md. This script prints the exact snippet to
//     paste instead, so a human picks the right insertion point.
//   - concord-frontend/lib/lenses/manifest.ts (the frontend LENS_MANIFESTS
//     registry — a "Competitor-Level Standard 7/7" contract with fields
//     like dataTier, artifacts, and pipeline steps that require an honest,
//     domain-specific judgment call. Auto-fabricating those values would
//     violate this repo's "honest by construction" invariant — a scaffold
//     can't know whether a lens's data is REAL_LIVE, REAL_FREE, SIM_GRADE_A,
//     or DEMO. Prints instructions instead of guessing.)
//   - concord-frontend/lib/lens-registry.ts (sidebar / command-palette
//     registry — requires picking a lucide icon, a core-lens absorption
//     decision, and a spot in the nav tree; also a human judgment call).
//
// Usage:
//   node scripts/scaffold-lens.mjs <lens-id> "<Display Name>" <CATEGORY> [options]
//
//   <lens-id>       kebab-case, e.g. "beekeeping"  (must match ^[a-z][a-z0-9-]*$)
//   <Display Name>  human label, e.g. "Beekeeping"
//   <CATEGORY>      one of: CORE, KNOWLEDGE, GOVERNANCE, SCIENCE, AI_COGNITION,
//                   SPECIALIZED, INDUSTRY, PLATFORM, AI_EXT, SYSTEM,
//                   BRIDGE, CREATIVE (matches the enum actually used across
//                   server/lib/lens-features{,-extended}.js — read from the
//                   live files, not guessed)
//
// Options:
//   --root <path>     Repo root to operate against. Defaults to the real
//                      repo (two directories up from this script). Tests
//                      MUST pass a temp directory here so the real repo's
//                      lens-manifest.js / lens-features-extended.js /
//                      app/lenses/ are never touched by a test run.
//   --dry-run          Print what would be written/edited; touch nothing.
//   --force            Overwrite an existing domain file / page / registry
//                       entry for the same lens-id. Default: refuse.
//   --skip-registry    Only generate the two new files; skip the
//                       DOMAIN_TAG_MAP / EXTENDED_FEATURES edits entirely.
//
// Self-check: after writing server/domains/<lens-id>.js this script runs
// `node --check` on it directly (fast, no side effects) and reports the
// result. It does NOT run `npm run validate-routes` / `npm run
// score-lenses` itself — those need a full frontend workspace + built
// route manifest and are too heavy to run as a side effect of scaffolding
// a single lens (and the task that invokes this script may not want a
// full frontend typecheck fired automatically). Instead it prints the
// exact commands to run next.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(__dirname, "..");

// Category enum actually used across server/lib/lens-features.js and
// server/lib/lens-features-extended.js as of this writing — reproduce with:
//   grep -ohE 'category: "[A-Z_]+"' server/lib/lens-features{,-extended}.js | sort -u
const KNOWN_CATEGORIES = new Set([
  "AI_COGNITION", "AI_EXT", "BRIDGE", "CORE", "CREATIVE", "GOVERNANCE",
  "GOVERNANCE_EXT", "INDUSTRY", "KNOWLEDGE", "PLATFORM", "SCIENCE",
  "SCIENCE_EXT", "SPECIALIZED", "SPECIALIZED_EXT", "SYSTEM",
]);

const LENS_ID_RE = /^[a-z][a-z0-9-]*$/;

// ── CLI parsing ──────────────────────────────────────────────────────────

function parseArgs(argv) {
  const positional = [];
  const opts = { root: DEFAULT_ROOT, dryRun: false, force: false, skipRegistry: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") { opts.root = path.resolve(argv[++i] || ""); }
    else if (a === "--dry-run") { opts.dryRun = true; }
    else if (a === "--force") { opts.force = true; }
    else if (a === "--skip-registry") { opts.skipRegistry = true; }
    else if (a.startsWith("--")) { throw new Error(`unknown option: ${a}`); }
    else positional.push(a);
  }
  const [lensId, displayName, categoryRaw] = positional;
  return { lensId, displayName, categoryRaw, ...opts };
}

function usage() {
  return [
    'usage: node scripts/scaffold-lens.mjs <lens-id> "<Display Name>" <CATEGORY> [--root <path>] [--dry-run] [--force] [--skip-registry]',
    "",
    `  <CATEGORY> must be one of: ${Array.from(KNOWN_CATEGORIES).sort().join(", ")}`,
  ].join("\n");
}

// ── Validation ───────────────────────────────────────────────────────────

function validate({ lensId, displayName, categoryRaw }) {
  const errors = [];
  if (!lensId || !LENS_ID_RE.test(lensId)) {
    errors.push(`lens-id "${lensId}" must be kebab-case matching ${LENS_ID_RE}`);
  }
  if (!displayName || !displayName.trim()) {
    errors.push("display name is required (pass it quoted, e.g. \"Beekeeping\")");
  }
  const category = (categoryRaw || "").toUpperCase();
  if (!KNOWN_CATEGORIES.has(category)) {
    errors.push(`category "${categoryRaw}" is not one of the known enum values: ${Array.from(KNOWN_CATEGORIES).sort().join(", ")}`);
  }
  return { errors, category };
}

// ── lensNumber allocation ────────────────────────────────────────────────
// Scans the real feature registries (read-only) for the highest existing
// lensNumber and returns max+1, so the scaffolded entry doesn't collide.
// (CLAUDE.md's Production Audit found 10 duplicate lensNumber collisions
// from hand-assigned numbers before — this is the fix pattern, automated.)

function nextLensNumber(root) {
  let max = 0;
  for (const rel of ["server/lib/lens-features.js", "server/lib/lens-features-extended.js"]) {
    const p = path.join(root, rel);
    if (!fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, "utf8");
    for (const m of text.matchAll(/lensNumber:\s*(\d+)/g)) {
      const n = Number(m[1]);
      if (n > max) max = n;
    }
  }
  return max + 1;
}

// ── Templates ────────────────────────────────────────────────────────────

function domainRegisterFnName(lensId) {
  // e.g. "beekeeping" -> "registerBeekeepingMacros", "law-enforcement" ->
  // "registerLawEnforcementMacros" — matches the convention every existing
  // domains/*.js file uses (`export default function registerXMacros(register)`).
  const camel = lensId
    .split("-")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");
  return `register${camel}Macros`;
}

function domainFileTemplate(lensId, displayName) {
  const fnName = domainRegisterFnName(lensId);
  return `// server/domains/${lensId}.js
//
// SCAFFOLDED by scripts/scaffold-lens.mjs for the "${displayName}" lens.
//
// The two macros below are REAL and working, not TODO placeholders — they
// are meant to be a working starting point you replace with real domain
// logic, per CLAUDE.md's "honest by construction" invariant (a shipped
// macro must never fabricate a success it didn't do).
//
// - "${lensId}.echo" is pure and stateless: round-trips a message.
// - "${lensId}.counter" is honestly-scoped in-memory state (a Map, not a
//   DB table) — it really increments and really persists for the life of
//   the process, but does NOT survive a restart and is NOT per-DB-row.
//   Replace it with a real migration + table once this lens has a real
//   substrate; don't let it linger as if it were durable storage.

const _counters = new Map(); // scaffold-only in-memory state, see note above

function actorId(ctx) {
  return ctx?.actor?.userId || ctx?.user?.id || ctx?.user?.userId || "anon";
}

export default function ${fnName}(register) {
  /**
   * ${lensId}.echo — round-trips a message. Pure, side-effect-free.
   * input: { message? }
   */
  register("${lensId}", "echo", async (_ctx, input = {}) => {
    const message = typeof input.message === "string" && input.message.length > 0
      ? input.message.slice(0, 500)
      : "pong";
    return { ok: true, message, receivedAt: new Date().toISOString() };
  }, { note: "scaffold: pure echo round-trip" });

  /**
   * ${lensId}.counter — increments an in-memory per-user counter.
   * input: { key? } — optional sub-key to scope the counter within a user.
   */
  register("${lensId}", "counter", async (ctx, input = {}) => {
    const user = actorId(ctx);
    const key = typeof input.key === "string" && input.key.length > 0
      ? input.key.slice(0, 64)
      : "default";
    const mapKey = \`\${user}:\${key}\`;
    const next = (_counters.get(mapKey) || 0) + 1;
    _counters.set(mapKey, next);
    return { ok: true, key, count: next };
  }, { note: "scaffold: in-memory counter (not durable — see file header)" });
}
`;
}

function pageTemplate(lensId, displayName) {
  const compName = lensId
    .split("-")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("") + "LensPage";
  return `'use client';

/**
 * ─────────────────────────────────────────────────────────────────────────
 * CONCORD // ${displayName.toUpperCase()} — scaffolded by scripts/scaffold-lens.mjs
 * ─────────────────────────────────────────────────────────────────────────
 * This is a real, minimal, WORKING page, not a generic button-wall. Per
 * CLAUDE.md's "zero generic tendencies" hard invariant, a lens must not
 * read as an undifferentiated pile of auto-generated macro buttons — so
 * the primary surface below is a small bespoke component (an echo round
 * trip + a live counter) with its own state and its own direct
 * \`lensRun(...)\` calls, not just <ManifestActionBar/> alone.
 *
 * <ManifestActionBar/> is still mounted underneath as a secondary "quick
 * actions" strip (the manifest-driven convenience CLAUDE.md's Per-Lens
 * Polish sprint introduced) — but it is not the whole page.
 *
 * Replace everything below the header with the lens's real workflow.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { useCallback, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { lensRun } from '@/lib/api/client';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';

interface EchoResult { ok: boolean; message?: string; receivedAt?: string; reason?: string }
interface CounterResult { ok: boolean; key?: string; count?: number; reason?: string }

export default function ${compName}() {
  const [message, setMessage] = useState('');
  const [echoResult, setEchoResult] = useState<EchoResult | null>(null);
  const [echoLoading, setEchoLoading] = useState(false);
  const [echoError, setEchoError] = useState<string | null>(null);

  const [count, setCount] = useState<number | null>(null);
  const [counterLoading, setCounterLoading] = useState(false);
  const [counterError, setCounterError] = useState<string | null>(null);

  const runEcho = useCallback(async () => {
    setEchoLoading(true);
    setEchoError(null);
    const res = await lensRun<EchoResult>('${lensId}', 'echo', { message });
    if (res.data.ok && res.data.result?.ok) {
      setEchoResult(res.data.result);
    } else {
      setEchoError(res.data.result?.reason || res.data.error || 'Echo failed.');
    }
    setEchoLoading(false);
  }, [message]);

  const runCounter = useCallback(async () => {
    setCounterLoading(true);
    setCounterError(null);
    const res = await lensRun<CounterResult>('${lensId}', 'counter', {});
    if (res.data.ok && res.data.result?.ok) {
      setCount(res.data.result.count ?? null);
    } else {
      setCounterError(res.data.result?.reason || res.data.error || 'Counter failed.');
    }
    setCounterLoading(false);
  }, []);

  return (
    <LensShell lensId="${lensId}">
      <div className={ds.pageContainer}>
        <header className={ds.sectionHeader}>
          <div>
            <h1 className={ds.heading1}>${displayName}</h1>
            <p className={ds.textMuted}>
              Scaffolded lens — replace this page with the real ${displayName} workflow.
            </p>
          </div>
        </header>

        <section className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-3">
          <h2 className="text-sm font-semibold text-white">Echo (server round trip)</h2>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Type a message"
              className="min-w-[12rem] flex-1 rounded border border-white/20 bg-black/20 px-2 py-1.5 text-sm text-white placeholder:text-gray-500"
            />
            <button
              type="button"
              onClick={runEcho}
              disabled={echoLoading}
              className={cn(ds.btnPrimary, 'text-sm')}
            >
              {echoLoading ? 'Sending…' : 'Send'}
            </button>
          </div>
          {echoError && <p className="text-sm text-red-400">{echoError}</p>}
          {echoResult?.message && (
            <p className="text-sm text-gray-300">
              Server replied: <span className="font-mono text-white">{echoResult.message}</span>
              {echoResult.receivedAt && (
                <span className={cn(ds.textMuted, 'ml-2')}>at {echoResult.receivedAt}</span>
              )}
            </p>
          )}
        </section>

        <section className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-3">
          <h2 className="text-sm font-semibold text-white">Counter (per-session macro state)</h2>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={runCounter}
              disabled={counterLoading}
              className={cn(ds.btnPrimary, 'text-sm')}
            >
              {counterLoading ? 'Incrementing…' : 'Increment'}
            </button>
            <span className="text-lg font-mono text-white">{count ?? '—'}</span>
          </div>
          {counterError && <p className="text-sm text-red-400">{counterError}</p>}
        </section>

        <section className="space-y-2">
          <h2 className={cn(ds.textMuted, 'text-xs uppercase tracking-wide')}>Quick actions</h2>
          <ManifestActionBar lensId="${lensId}" />
        </section>
      </div>
    </LensShell>
  );
}
`;
}

function extendedFeaturesEntryTemplate(lensId, displayName, category, lensNumber) {
  return `  ${lensId}: {
    lensId: "${lensId}",
    lensNumber: ${lensNumber},
    category: "${category}",
    features: [
      f("${lensId}_scaffold_echo", "Echo Round Trip", "Scaffold-generated example macro (${lensId}.echo) — replace with real feature descriptors once this lens has real capabilities.", "infrastructure", []),
      f("${lensId}_scaffold_counter", "Session Counter", "Scaffold-generated example macro (${lensId}.counter) — replace once this lens has a real durable substrate.", "infrastructure", []),
    ],
    featureCount: 2, economicIntegrations: [], emergentAccess: false, botAccess: false, usbIntegration: false,
  },
`;
}

// ── Safe file writers ────────────────────────────────────────────────────

function writeFileChecked(filePath, content, { dryRun, force }) {
  if (fs.existsSync(filePath) && !force) {
    throw new Error(`refusing to overwrite existing file (pass --force to override): ${filePath}`);
  }
  if (dryRun) {
    console.log(`[dry-run] would write ${filePath}:\n${"-".repeat(72)}\n${content}\n${"-".repeat(72)}`);
    return;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
  console.log(`wrote ${filePath}`);
}

/**
 * Inserts a new `<lensId>: [tags...]` entry into DOMAIN_TAG_MAP in
 * server/lib/lens-manifest.js, right before the object's closing `});`.
 * Idempotent (skips if the key already exists). Writes to a sibling temp
 * file, runs `node --check` on it, and only then renames it over the
 * original — a failed check never touches the real file.
 */
function insertDomainTag(root, lensId, tags, { dryRun }) {
  const file = path.join(root, "server/lib/lens-manifest.js");
  if (!fs.existsSync(file)) {
    console.warn(`[skip] ${file} not found under --root; skipping DOMAIN_TAG_MAP edit`);
    return;
  }
  const content = fs.readFileSync(file, "utf8");
  const startMarker = "const DOMAIN_TAG_MAP = Object.freeze({";
  const startIdx = content.indexOf(startMarker);
  if (startIdx === -1) {
    console.warn(`[skip] could not find DOMAIN_TAG_MAP start marker in ${file}; skipping`);
    return;
  }
  const closeIdx = content.indexOf("\n});", startIdx);
  if (closeIdx === -1) {
    console.warn(`[skip] could not find DOMAIN_TAG_MAP close marker in ${file}; skipping`);
    return;
  }
  const block = content.slice(startIdx, closeIdx);
  if (block.includes("export const")) {
    // Sanity guard: found the wrong closer (shouldn't happen given the
    // file's current shape, but never insert into the wrong block).
    console.warn(`[skip] DOMAIN_TAG_MAP boundary detection looked unsafe in ${file}; skipping`);
    return;
  }
  // Idempotency is NOT gated by --force: --force only governs overwriting
  // the two brand-new generated files (domain.js / page.tsx). A duplicate
  // key inserted into this shared object literal would silently shadow
  // the first one (the same "silent shadowing" failure mode server.js's
  // own `register()` warns about for MACROS) — so re-running the
  // scaffolder must always dedupe here, --force or not.
  const keyRe = new RegExp(`^\\s*${lensId}:\\s*\\[`, "m");
  if (keyRe.test(block)) {
    console.log(`[ok] DOMAIN_TAG_MAP already has an entry for "${lensId}" — skipping (idempotent)`);
    return;
  }
  const tagsJs = tags.map((t) => JSON.stringify(t)).join(", ");
  const insertion = `\n  ${lensId}: [${tagsJs}],`;
  const next = content.slice(0, closeIdx) + insertion + content.slice(closeIdx);
  applyCheckedEdit(file, next, { dryRun });
}

/**
 * Inserts a new lens entry into EXTENDED_FEATURES in
 * server/lib/lens-features-extended.js, right before the final `};` that
 * closes the object (the object is the last statement in the file).
 * Idempotent + checked the same way as insertDomainTag.
 */
function insertExtendedFeature(root, lensId, displayName, category, lensNumber, { dryRun }) {
  const file = path.join(root, "server/lib/lens-features-extended.js");
  if (!fs.existsSync(file)) {
    console.warn(`[skip] ${file} not found under --root; skipping EXTENDED_FEATURES edit`);
    return;
  }
  const content = fs.readFileSync(file, "utf8");
  const trimmedEnd = content.replace(/\s+$/, "");
  if (!trimmedEnd.endsWith("};")) {
    console.warn(`[skip] ${file} does not end with the expected "};" — skipping to avoid corrupting it`);
    return;
  }
  const closeIdx = content.lastIndexOf("\n};");
  if (closeIdx === -1) {
    console.warn(`[skip] could not find EXTENDED_FEATURES close marker in ${file}; skipping`);
    return;
  }
  // Same non-negotiable idempotency rule as insertDomainTag above.
  const keyRe = new RegExp(`^\\s*${lensId}:\\s*\\{`, "m");
  if (keyRe.test(content)) {
    console.log(`[ok] EXTENDED_FEATURES already has an entry for "${lensId}" — skipping (idempotent)`);
    return;
  }
  const entry = extendedFeaturesEntryTemplate(lensId, displayName, category, lensNumber);
  const next = content.slice(0, closeIdx) + "\n" + entry + content.slice(closeIdx);
  applyCheckedEdit(file, next, { dryRun });
}

function applyCheckedEdit(file, nextContent, { dryRun }) {
  if (dryRun) {
    console.log(`[dry-run] would edit ${file} (new size ${nextContent.length} bytes)`);
    return;
  }
  // Preserve the original extension (".js") on the temp file — node's
  // `--check` picks its parser (ESM vs CJS) partly from the file
  // extension + nearest package.json, so a temp file named "*.scaffold-tmp"
  // with no recognized extension fails to even parse regardless of
  // whether the content is valid.
  const { dir, name, ext } = path.parse(file);
  const tmp = path.join(dir, `${name}.scaffold-tmp${ext}`);
  fs.writeFileSync(tmp, nextContent, "utf8");
  try {
    execFileSync(process.execPath, ["--check", tmp], { stdio: "pipe" });
  } catch (err) {
    fs.unlinkSync(tmp);
    throw new Error(`generated edit for ${file} failed "node --check" — original file left untouched.\n${err.stderr?.toString() || err.message}`);
  }
  fs.renameSync(tmp, file);
  console.log(`edited ${file} (checked with node --check)`);
}

function deriveTags(displayName) {
  const words = displayName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);
  return words.length > 0 ? words.slice(0, 6) : [displayName.toLowerCase()];
}

function printManualSteps(lensId, fnName) {
  console.log(`
── Manual steps this script intentionally does NOT automate ──────────────

1. Wire the domain's macros into server.js (NOT auto-edited — see the
   header comment in scripts/scaffold-lens.mjs for why: server.js is a
   79k+ line monolith with a documented boot-order TDZ hazard). Add near
   the other "import registerXMacros from \\"./domains/x.js\\";" lines:

     import ${fnName} from "./domains/${lensId}.js";
     ${fnName}(register);

   and add "${lensId}" to the ALL_LENS_DOMAINS array (~line 34153).

2. Add "${lensId}" to concord-frontend/lib/lens-registry.ts if it should
   appear in the sidebar / Ctrl+K palette (pick an icon, a category, and
   whether it's absorbed into a core lens or stands alone).

3. Add a real entry for "${lensId}" to
   concord-frontend/lib/lenses/manifest.ts (LENS_MANIFESTS) — this one is
   deliberately NOT auto-generated because its fields (dataTier: REAL_LIVE
   | REAL_FREE | SIM_GRADE_A | DEMO, artifacts, pipeline steps) are honest
   claims about what the lens's data actually is; a script can't know that
   truthfully, only a human authoring the real lens can.

4. Run the two self-check commands from concord-frontend/:
     npm run validate-routes
     npm run score-lenses
`);
}

// ── Main ─────────────────────────────────────────────────────────────────

function main() {
  const argv = process.argv.slice(2);
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(err.message);
    console.error(usage());
    process.exit(1);
  }

  const { errors, category } = validate(args);
  if (errors.length > 0 || !args.lensId) {
    console.error("scaffold-lens: invalid arguments:");
    for (const e of errors) console.error(`  - ${e}`);
    console.error("");
    console.error(usage());
    process.exit(1);
  }

  const { lensId, displayName, root, dryRun, force, skipRegistry } = args;
  const fnName = domainRegisterFnName(lensId);
  const lensNumber = nextLensNumber(root);

  const domainFile = path.join(root, "server/domains", `${lensId}.js`);
  const pageFile = path.join(root, "concord-frontend/app/lenses", lensId, "page.tsx");

  console.log(`scaffold-lens: root=${root} lensId=${lensId} category=${category} lensNumber=${lensNumber} dryRun=${dryRun}`);

  try {
    writeFileChecked(domainFile, domainFileTemplate(lensId, displayName), { dryRun, force });
    writeFileChecked(pageFile, pageTemplate(lensId, displayName), { dryRun, force });
  } catch (err) {
    console.error(`scaffold-lens: ${err.message}`);
    process.exit(1);
  }

  if (!dryRun && fs.existsSync(domainFile)) {
    try {
      execFileSync(process.execPath, ["--check", domainFile], { stdio: "pipe" });
      console.log(`self-check: node --check ${domainFile} — OK`);
    } catch (err) {
      console.error(`self-check FAILED for ${domainFile}:`);
      console.error(err.stderr?.toString() || err.message);
      process.exitCode = 1;
    }
  }

  if (!skipRegistry) {
    const tags = deriveTags(displayName);
    try {
      insertDomainTag(root, lensId, tags, { dryRun, force });
      insertExtendedFeature(root, lensId, displayName, category, lensNumber, { dryRun, force });
    } catch (err) {
      console.error(`registry edit failed: ${err.message}`);
      process.exitCode = 1;
    }
  } else {
    console.log("[skip-registry] leaving DOMAIN_TAG_MAP / EXTENDED_FEATURES untouched");
  }

  if (!dryRun) printManualSteps(lensId, fnName);
}

main();
