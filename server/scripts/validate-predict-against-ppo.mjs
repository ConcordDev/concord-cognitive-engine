// One-off validation script (NOT a permanent macro/route) — proves Concord
// Predict computes correctly against ground truth this session already knows
// exhaustively: the PPO(19,39,9) crypto momentum strategy's real, audited
// out-of-sample backtest trades (Dila's /Users/dutch/.hermes/dila-tools).
//
// Reads a real per-trade JSON extracted (read-only) from
// spec_engine/scripts/research_stranding_boundary.py's own
// extract_trades_with_mae() function — the exact validated config (PPO
// 19/39/9, 15-day min hold, 1.2% round-trip cost, 730 daily bars, 65/35
// chronological split) — via a small Python shim
// (scratchpad/extract_ppo_trades.py) that imports that function directly
// rather than re-deriving the backtest logic. No file under
// /Users/dutch/.hermes was modified; this only reads its cached candle data
// through the strategy's own extraction function.
//
// Deliberately bypasses booting the full server.js (heartbeats, backups,
// evo-asset network bootstrap, learning-probation sweeps, ...) — predict.js
// has no runtime dependency on any of that for create/resolve/calibration,
// only on a real migrated SQLite handle, so this opens one directly against
// the actual migration files and calls the domain's registerLensAction
// handlers exactly as /api/lens/run would.
//
// Forecast mapping (documented, not fabricated): this is a systematic
// momentum signal, not a probabilistic classifier, so there is no genuine
// per-trade confidence to carry forward. The honest choice is to use the
// strategy's own PUBLISHED aggregate hit rate at the moment it was frozen
// (ppo_momentum_signal.py's docstring: TEST hit=37.7%) as a CONSTANT
// forecast probability for every ticket — "will this trade be a winner,
// per what the strategy currently believes about itself" — then resolve
// each ticket with the REAL recorded win/loss outcome from a fresh
// extraction against the same cached price data. This is a genuine
// calibration question: is the strategy's own published win rate still
// well-calibrated against actual outcomes on this exact validated
// universe/window today?
//
// Run: node server/scripts/validate-predict-against-ppo.mjs

import path from "node:path";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import Database from "better-sqlite3";

import registerPredictActions from "../domains/predict.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TRADES_JSON = process.env.PPO_TRADES_JSON
  || "/private/tmp/claude-501/-Users-dutch-concord-vs-code-concord-cognitive-engine/7ecc985e-b634-4922-b905-dc077c866ac2/scratchpad/ppo_test_trades.json";

// The strategy's own published aggregate, frozen at the moment
// ppo_momentum_signal.py was written this session — the constant forecast
// probability every ticket below is scored against.
const PUBLISHED_HIT_RATE = 0.377;

function makeMinimalDb() {
  const dir = mkdtempSync(path.join(tmpdir(), "predict-ppo-validate-"));
  const dbPath = path.join(dir, "validate.db");
  execFileSync(process.execPath, [path.join(__dirname, "../migrate.js")], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, DB_PATH: dbPath },
    stdio: "pipe",
  });
  return new Database(dbPath);
}

function makeLensActions() {
  const LENS = new Map();
  registerPredictActions((domain, action, handler) => LENS.set(`${domain}.${action}`, handler));
  return LENS;
}

async function callPredict(LENS, ctx, action, params) {
  const handler = LENS.get(`predict.${action}`);
  const artifact = { id: null, domain: "predict", type: "domain_action", data: params, meta: {} };
  const out = await handler(ctx, artifact, params);
  // Mirror the real lens.run single-envelope unwrap so this script exercises
  // the exact same contract the HTTP path and the depth tests rely on.
  return (out && typeof out === "object" && "result" in out) ? { ok: out.ok, result: out.result } : out;
}

async function main() {
  const db = makeMinimalDb();
  const LENS = makeLensActions();
  const ctx = { db, actor: { userId: "ppo-validation" } };

  const raw = JSON.parse(readFileSync(TRADES_JSON, "utf8"));
  const trades = raw.test_trades;
  console.log(`Loaded ${trades.length} real out-of-sample PPO(19,39,9) trades `
    + `(${raw.loaded_assets}/${raw.universe_size} assets, config=${JSON.stringify(raw.config)})`);

  let created = 0;
  let resolved = 0;
  for (const t of trades) {
    const c = await callPredict(LENS, ctx, "create", {
      subject: t.asset,
      eventDefinition: "PPO(19,39,9) momentum entry will close as a net winner after 1.2% round-trip cost",
      horizonSeconds: t.hold_days * 86400,
      modelId: "ppo-momentum-19-39-9",
      modelVersion: "2026-08-30",
      regime: "crypto-daily-momentum",
      forecastDistribution: { prob: PUBLISHED_HIT_RATE },
      pointProbability: PUBLISHED_HIT_RATE,
      featureSnapshot: { entryIdx: t.entry_idx, holdDays: t.hold_days, grossReturn: t.gross },
      decision: "TRADE",
    });
    if (!c.ok || !c.result?.ticket) {
      console.error("create failed", JSON.stringify(c));
      continue;
    }
    created += 1;
    const win = t.net > 0;
    const r = await callPredict(LENS, ctx, "resolve", {
      id: c.result.ticket.id,
      actualOutcome: win,
      actualValue: { net: t.net, gross: t.gross },
      resolutionSource: "spec_engine/research_stranding_boundary.py extract_trades_with_mae (real cached Coinbase daily candles)",
    });
    if (r.ok && r.result?.ticket) resolved += 1;
    else console.error("resolve failed", JSON.stringify(r));
  }
  console.log(`Created ${created} PredictionTicket rows, resolved ${resolved}.`);

  const cal = await callPredict(LENS, ctx, "calibration", { modelId: "ppo-momentum-19-39-9", bins: 5 });
  if (!cal.ok || cal.result?.ok === false) {
    console.error("calibration failed", JSON.stringify(cal));
    process.exit(1);
  }
  const result = cal.result;

  const wins = trades.filter((t) => t.net > 0);
  const losses = trades.filter((t) => t.net <= 0);
  const measuredHitRate = wins.length / trades.length;
  const avgWin = wins.reduce((s, t) => s + t.net, 0) / wins.length;
  const avgLoss = losses.reduce((s, t) => s + t.net, 0) / losses.length;

  console.log("\n=== Concord Predict calibration report over real PPO trades ===");
  console.log(JSON.stringify(result, null, 2));

  console.log("\n=== Comparison: engine output vs. already-known ground truth ===");
  console.log(`Published strategy hit rate (forecast used for every ticket): ${(PUBLISHED_HIT_RATE * 100).toFixed(1)}%`);
  console.log(`Measured hit rate on this fresh extraction (n=${trades.length}):   ${(measuredHitRate * 100).toFixed(1)}%`);
  console.log("Session's previously-documented TEST hit rate (n=204, different fetch date): 37.7%");
  console.log(`Avg winner (net of 1.2% cost): ${(avgWin * 100).toFixed(1)}%  (previously documented: +23.7%)`);
  console.log(`Avg loser  (net of 1.2% cost): ${(avgLoss * 100).toFixed(1)}%  (previously documented: -12.7%)`);
  console.log(`Concord Predict's baseRate over the same n=${result.n} resolved tickets: ${(result.baseRate * 100).toFixed(1)}%`);
  console.log(`Brier score (${PUBLISHED_HIT_RATE} forecast vs realized outcome): ${result.brierScore}`);
  console.log(`Calibration gap (avg forecast ${PUBLISHED_HIT_RATE} vs realized ${result.baseRate}): `
    + `${(PUBLISHED_HIT_RATE - result.baseRate).toFixed(4)} -> quality "${result.quality}"`);

  // result.baseRate is rounded to 4 decimals for display (lib/calibration-math.js
  // callers round; the raw computation is exact) — compare at that same precision.
  const agree = Math.abs(result.baseRate - measuredHitRate) < 5e-5;
  console.log(`\nEngine baseRate matches independently-computed measured hit rate (to 4 decimals): ${agree}`);

  db.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
