#!/usr/bin/env node
// E6 / C-L5 — synthetic-journey probe runner.
//
// Self-contained by default (CI-safe, no live server). Set PROBE_BASE_URL to
// run the SSE check LIVE against a deployed instance post-deploy (the L5 use).
//
//   node scripts/synthetic-journey-probe.mjs
//   PROBE_BASE_URL=https://concord-os.org node scripts/synthetic-journey-probe.mjs
//
// Exit 0 = all checks green; exit 1 = a journey break or SSE-buffering drift.
// Prints a single JSON line (Grafana/alert-friendly).

import { runSyntheticJourneyProbe } from "../lib/synthetic-journey-probe.js";

const baseUrl = process.env.PROBE_BASE_URL || undefined;
const result = await runSyntheticJourneyProbe({ baseUrl });
process.stdout.write(JSON.stringify(result) + "\n");
process.exit(result.ok ? 0 : 1);
