#!/usr/bin/env node
// server/scripts/run-dhtp-rs-analyze.mjs
// STEP 1 — Phase 1 analysis per DHTP-RS-MASTER-001 §24

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPhase1AnalysisReport, printSpecAnalysis } from "../lib/runtime/dhtp-rs-report.js";
import { PHASE1_BASELINE } from "../lib/runtime/dhtp-rs-spec.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const opts = { jsonPath: null, phase1Only: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--json" && argv[i + 1]) opts.jsonPath = argv[++i];
    else if (a === "--phase1") opts.phase1Only = true;
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv);

  console.log(buildPhase1AnalysisReport());

  if (opts.jsonPath) {
    const path = resolve(process.cwd(), opts.jsonPath);
    if (!existsSync(path)) {
      console.error(`File not found: ${path}`);
      process.exit(1);
    }
    const bench = JSON.parse(readFileSync(path, "utf8"));
    printSpecAnalysis(bench);
  } else if (!opts.phase1Only) {
    console.log(`\nPhase 1 baseline run: ${PHASE1_BASELINE.runId}`);
    console.log("Re-run with --json <path> to analyze a saved benchmark artifact.");
  }
}

main();
