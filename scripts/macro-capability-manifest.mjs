#!/usr/bin/env node
// scripts/macro-capability-manifest.mjs
//
// Machine-generated capability report (spec §15): registered, discoverable,
// invocable, verified, observable — without conflating reflection catalogs with
// runtime truth.
//
// Usage:
//   node scripts/macro-capability-manifest.mjs
//   node scripts/macro-capability-manifest.mjs --live   # boot + oracles + log stats
//   node scripts/macro-capability-manifest.mjs --json-out audit/macro-capability-manifest.json

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { classifyMacro } from "../server/lib/runtime/macro-capability-classifier.js";
import { evaluateDomainAcceptance } from "../server/lib/runtime/domain-acceptance.js";
import { COMPLETION_STATUS } from "../server/lib/runtime/macro-failure-taxonomy.js";
import { SUBSTRATE_ORACLE_CASES } from "../server/lib/runtime/substrate-oracles.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
const wantLive = args.includes("--live");
const jsonOut = args.includes("--json-out")
  ? args[args.indexOf("--json-out") + 1] || "audit/macro-capability-manifest.json"
  : "audit/macro-capability-manifest.json";

async function main() {
  const generatedAt = new Date().toISOString();

  const domainReachability = await loadDomainReachability();
  const lensWiring = loadLensWiring();
  const registration = wantLive ? await loadLiveRegistration() : loadStaticRegistrationEstimate();

  const oracleDomains = new Set(SUBSTRATE_ORACLE_CASES.map((c) => c.domain));
  const invocationByKey = wantLive ? await loadInvocationMap(registration) : new Map();

  const domainReports = [];
  const allDomains = new Set([...registration.domains]);

  for (const domain of [...allDomains].sort()) {
    const reps = SUBSTRATE_ORACLE_CASES.filter((c) => c.domain === domain).map((c) => c.action);
    domainReports.push(
      evaluateDomainAcceptance(domain, {
        registeredKeys: registration.keys,
        invocationByKey,
        representativeActions: reps.length ? reps : undefined,
      })
    );
  }

  const classCounts = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  for (const key of registration.keys) {
    const [domain, ...rest] = key.split(".");
    const name = rest.join(".");
    const { class: cls } = classifyMacro(domain, name);
    classCounts[cls]++;
  }

  const manifest = {
    generatedAt,
    mode: wantLive ? "live" : "static",
    summary: {
      registeredPairs: registration.keys.size,
      registeredDomains: registration.domains.size,
      lensDirectories: lensWiring.total,
      lensesWired: lensWiring.wired,
      lensesNoBackend: lensWiring.noBackend,
      darkDomainRegistrars: domainReachability.unreachableRegistrars,
      oracleCases: SUBSTRATE_ORACLE_CASES.length,
      macroCallLogUniquePairs: invocationByKey.size ? countLoggedPairs(invocationByKey) : null,
      classification: classCounts,
      domainsCompleteAF: domainReports.filter((d) => d.complete).length,
      phase3: domainReachability.unreachableRegistrars === 0
        ? "CLOSED — 0 dark domain registrars (all wired via index.js or server.js)"
        : `OPEN — ${domainReachability.unreachableRegistrars} unreachable registrar(s)`,
    },
    surfaces: {
      note: "MACROS, LENS_ACTIONS, reflection catalog, and macro_call_log are distinct — do not sum counts",
      macrosPath: "runMacro / MACROS map",
      lensActionsPath: "dispatchLensRun / LENS_ACTIONS map",
      discoveryCatalog: "reflection / cartographer (not executable surface)",
      observability: "macro_call_log (post Phase-1 LENS_ACTION billing)",
    },
    domainReachability,
    lensWiring,
    oracleDomains: [...oracleDomains],
    domainAcceptanceSample: domainReports.filter((d) => oracleDomains.has(d.domain) || d.actionCount > 0).slice(0, 30),
    completionStatuses: COMPLETION_STATUS,
  };

  if (wantLive && registration.oracleReport) {
    manifest.oracleReport = registration.oracleReport;
  }

  const phase5Path = path.join(ROOT, "audit/runtime-capability-coverage.json");
  if (fs.existsSync(phase5Path)) {
    try {
      const p5 = JSON.parse(fs.readFileSync(phase5Path, "utf8"));
      manifest.phase5Coverage = {
        generatedAt: p5.generatedAt,
        summary: p5.summary?.coverageDenominator || p5.summary,
        unresolvedFailureCount: p5.unresolvedFailures?.length ?? null,
      };
    } catch {
      // ignore stale parse errors
    }
  }

  const outPath = path.isAbsolute(jsonOut) ? jsonOut : path.join(ROOT, jsonOut);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2) + "\n");

  console.log(`Wrote ${outPath}`);
  console.log(
    `Registered: ${manifest.summary.registeredPairs} pairs / ${manifest.summary.registeredDomains} domains`
  );
  console.log(`Lenses: ${manifest.summary.lensesWired} wired / ${manifest.summary.lensDirectories} total`);
  console.log(`Phase 3: ${manifest.summary.phase3}`);
  if (wantLive && registration.oracleReport) {
    console.log(`Oracles: ${registration.oracleReport.passed}/${registration.oracleReport.total}`);
  }

  if (domainReachability.unreachableRegistrars > 0) process.exitCode = 1;
  if (wantLive && registration.oracleReport && !registration.oracleReport.ok) process.exitCode = 1;

  if (wantLive) setImmediate(() => process.exit(process.exitCode ?? 0));
}

async function loadDomainReachability() {
  const mod = await import(
    pathToFileURL(path.join(ROOT, "server/lib/detectors/domain-reachability-detector.js")).href
  );
  const report = await mod.runDomainReachabilityDetector({ root: ROOT });
  const summary = report.findings?.find((f) => f.id === "domain_reachability_summary")?.evidence || {};
  const unreachable = report.findings?.filter((f) => f.id === "domain_registrar_unreachable") || [];
  return {
    unreachableRegistrars: summary.unreachableRegistrars ?? unreachable.length,
    unreachableFiles: unreachable.map((f) => f.location),
    totalDomainFiles: summary.totalFiles ?? null,
    registrarCount: summary.registrarCount ?? null,
    helperCount: summary.helperCount ?? null,
    unreachableHelpers: summary.unreachableHelpers ?? null,
    evidence: summary,
  };
}

function loadLensWiring() {
  const result = spawnSync("node", ["scripts/verify-lens-backends.mjs"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 120_000,
  });
  const text = (result.stdout || "") + (result.stderr || "");
  const wired = text.match(/"WIRED":\s*(\d+)/)?.[1];
  const noBackend = text.match(/"NO-BACKEND-CALL":\s*(\d+)/)?.[1];
  const total = text.match(/total\s+(\d+)/)?.[1];
  return {
    wired: wired ? Number(wired) : null,
    noBackend: noBackend ? Number(noBackend) : null,
    total: total ? Number(total) : null,
    rawTail: text.trim().split("\n").slice(-5).join("\n"),
  };
}

function loadStaticRegistrationEstimate() {
  const keys = new Set();
  const domains = new Set();
  const serverDir = path.join(ROOT, "server");
  const files = walkJs(serverDir);

  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    const aliases = new Set(["register", "registerLensAction"]);
    for (const m of src.matchAll(/\bconst\s+(\w+)\s*=\s*(?:registerLensAction|register)\b/g)) {
      aliases.add(m[1]);
    }
    const aliasRe = new RegExp(
      String.raw`\b(?:` + [...aliases].join("|") + String.raw`)\(\s*["'\`]([a-zA-Z0-9_.\-]+)["'\`]\s*,\s*["'\`]([a-zA-Z0-9_.\-]+)["'\`]`,
      "g"
    );
    let m;
    while ((m = aliasRe.exec(src))) {
      const key = `${m[1]}.${m[2]}`;
      keys.add(key);
      domains.add(m[1]);
    }
  }
  return { keys, domains, oracleReport: null };
}

async function loadLiveRegistration() {
  const { bootEngine, enumerateMacros } = await import("./contracts/harness.mjs");
  const { runSubstrateOracles } = await import("../server/lib/runtime/substrate-oracles.js");
  const boot = await bootEngine();
  const { dispatchLensRun, makeInternalCtx, MACROS, lensActions, brainBacked } = boot;
  const ctx = makeInternalCtx("capability-manifest");
  const keys = new Set();
  const domains = new Set();

  for (const m of enumerateMacros(MACROS, lensActions, brainBacked)) {
    const key = `${m.domain}.${m.name}`;
    keys.add(key);
    domains.add(m.domain);
  }

  const oracleReport = await runSubstrateOracles({
    dispatch: dispatchLensRun,
    ctx,
    db: globalThis._concordDB,
    logCalls: !!globalThis._concordDB,
    userId: "capability-manifest",
  });

  for (const r of oracleReport.results.filter((x) => x.verified)) {
    // seeded below via loadInvocationMap merge
  }

  return { keys, domains, oracleReport };
}

async function loadInvocationMap(registration) {
  const map = new Map();
  const db = globalThis._concordDB;
  if (db) {
    try {
      const rows = db.prepare(`
        SELECT domain, macro_name, status, COUNT(*) AS n, MAX(created_at) AS last_at
        FROM macro_call_log
        GROUP BY domain, macro_name, status
      `).all();
      for (const row of rows) {
        const key = `${row.domain}.${row.macro_name}`;
        const prev = map.get(key) || { ok: false, logged: true, count: 0 };
        prev.logged = true;
        prev.count += row.n;
        if (row.status === "ok") prev.ok = true;
        prev.lastAt = row.last_at;
        map.set(key, prev);
      }
    } catch {
      // table may not exist in minimal boot
    }
  }

  if (registration.oracleReport) {
    for (const r of registration.oracleReport.results) {
      const key = `${r.domain}.${r.action}`;
      map.set(key, {
        ok: r.ok,
        verified: r.verified,
        logged: true,
        oracle: true,
      });
    }
  }

  return map;
}

function countLoggedPairs(map) {
  return [...map.values()].filter((v) => v.logged).length;
}

function walkJs(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", "tests", "test"].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkJs(p, acc);
    else if (e.name.endsWith(".js")) acc.push(p);
  }
  return acc;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
