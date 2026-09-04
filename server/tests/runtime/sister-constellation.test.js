// Behavioral tests for Concord Runtime sister-system connection.
// Injected temp homes only — never talks to live Kalshi/Coinbase, never
// runs offensive tools. Expected EV values are hand-computed.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveSisterHomes, homePresence, stripSecrets, readJsonIfPresent } from "../../lib/runtime/sister-homes.js";
import {
  evaluateObservedEdge, observeDilaTrading, tradingExecuteLocked, _resetTradeObserveCursor,
} from "../../lib/runtime/trading-observe.js";
import { observeZuko, zukoExecuteLocked } from "../../lib/runtime/zuko-observe.js";
import {
  checkScope, authorizeEngagement, pentesterExecuteLocked, labHealth, _resetEngagements,
} from "../../lib/runtime/pentester-control.js";
import { concordiaPresence } from "../../lib/runtime/concordia-presence.js";
import { collectConstellationHealth } from "../../lib/runtime/constellation.js";
import { subscribe, recentEvents, _reset as resetBus } from "../../lib/runtime/event-bus.js";
import { getCapabilityDescriptor, checkCapabilityHealth, _resetRegistry } from "../../lib/runtime/capability-registry.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

function makeHomes() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "concord-constellation-"));
  const trading = path.join(root, "trading");
  const zuko = path.join(root, "zuko");
  const cyberRange = path.join(root, "cyber-range");
  fs.mkdirSync(trading);
  fs.mkdirSync(zuko);
  fs.mkdirSync(cyberRange);
  writeJson(path.join(trading, "ppo_momentum_state.json"), {
    BTC: { in_position: true },
    ETH: { in_position: false },
    SOL: { in_position: true },
  });
  writeJson(path.join(trading, "auto_trade_config.json"), {
    auto_trade_enabled: true,
    authorized: true,
    authorized_by: "operator",
    max_position_usd: 5,
    auth: { api_key: "SHOULD_NEVER_LEAK" },
    token: "nope",
    strategies_enabled: ["rsi_extremes"],
    products: ["BTC-USD", "ETH-USD"],
  });
  writeJson(path.join(trading, "auto_trader_log.json"), [
    { type: "trade_executed", logged_at: "2026-08-18T10:00:00.000Z", trade: { product: "BTC-USD", side: "BUY", amount_usd: 3.5 } },
  ]);
  writeJson(path.join(zuko, "state.json"), {
    lane: "zuko_kalshi",
    dila_book: "coinbase_live_spender_untouched",
    kalshi: { owner: "zuko", cash_usd: 8.34, positions: 0, flattened: true, dry_run: true },
    updated_et: "2026-08-27 01:17:25 ET",
  });
  writeJson(path.join(zuko, "zuko_risk_state.json"), {
    owner: "zuko",
    venue: "kalshi",
    halted: false,
    halt_reason: "",
    daily_pnl_usd: 0,
    open_names: [],
    caps: { max_position_usd: 1, daily_loss_halt: 0.5 },
    note: "Zuko-only.",
  });
  writeJson(path.join(zuko, "kalshi_config.json"), {
    owner: "zuko",
    dry_run: false,
    place_orders: true,
    starting_budget_usd: 8.34,
    auth: { key_id: "LEAK", private_key: "LEAK" },
  });
  fs.writeFileSync(path.join(cyberRange, "docker-compose.yml"), "services: {}\n");
  return resolveSisterHomes({ trading, zuko, cyberRange, repoRoot: REPO_ROOT });
}

describe("sister-homes", () => {
  it("reports not_present for a missing directory", () => {
    const r = homePresence(path.join(os.tmpdir(), "concord-no-such-home-xyz"));
    assert.equal(r.present, false);
    assert.equal(r.reason, "not_present");
  });

  it("stripSecrets drops auth/token/key fields", () => {
    const clean = stripSecrets({ dry_run: false, auth: { key: "x" }, token: "y", place_orders: true });
    assert.equal(clean.dry_run, false);
    assert.equal(clean.place_orders, true);
    assert.equal("auth" in clean, false);
    assert.equal("token" in clean, false);
  });

  it("readJsonIfPresent is honest on missing files", () => {
    const r = readJsonIfPresent(path.join(os.tmpdir(), "nope.json"));
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_present");
  });
});

describe("trading observe + lock", () => {
  it("summarizes injected PPO state and never echoes secrets", () => {
    const homes = makeHomes();
    const snap = observeDilaTrading({ homes });
    assert.equal(snap.ok, true);
    assert.equal(snap.present, true);
    assert.equal(snap.ppo.assets, 3);
    assert.equal(snap.ppo.inPosition, 2);
    assert.equal(snap.config.productCount, 2);
    assert.equal(snap.execute.locked, true);
    const blob = JSON.stringify(snap);
    assert.equal(blob.includes("SHOULD_NEVER_LEAK"), false);
    assert.equal(blob.includes("nope"), false);
  });

  it("missing trading home is present:false, not a fabricated book", () => {
    const homes = resolveSisterHomes({
      trading: path.join(os.tmpdir(), "concord-no-trading"),
      zuko: path.join(os.tmpdir(), "concord-no-zuko"),
      cyberRange: path.join(os.tmpdir(), "concord-no-range"),
      repoRoot: REPO_ROOT,
    });
    const snap = observeDilaTrading({ homes });
    assert.equal(snap.ok, true);
    assert.equal(snap.present, false);
    assert.equal(snap.reason, "not_present");
  });

  it("evaluate EV is hand-computed and does not grant authority", () => {
    // forecast 0.6 vs market 0.5, fee 0 → edge 0.1, ev = 0.6*0.5 - 0.4*0.5 = 0.1
    const r = evaluateObservedEdge({ forecastProbability: 0.6, marketProbability: 0.5, fee: 0 });
    assert.equal(r.ok, true);
    assert.equal(r.edge, 0.1);
    assert.equal(r.ev, 0.1);
    assert.equal(r.grantsAuthority, false);
    assert.equal(r.advisory, true);
  });

  it("trading.execute is locked", () => {
    const r = tradingExecuteLocked({ product: "BTC-USD", side: "BUY" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "locked");
  });

  it("first observe publishes market.observed, not a replay of historic fills", () => {
    resetBus();
    _resetTradeObserveCursor();
    const seen = [];
    const unsub = subscribe("*", (e) => seen.push(e.name));
    observeDilaTrading({ homes: makeHomes(), publishEvents: true });
    unsub();
    assert.ok(seen.includes("market.observed"));
    assert.equal(seen.includes("trade.executed"), false);
  });
});

describe("zuko observe + lock", () => {
  it("reads injected Zuko state and strips kalshi auth", () => {
    const snap = observeZuko({ homes: makeHomes() });
    assert.equal(snap.ok, true);
    assert.equal(snap.present, true);
    assert.equal(snap.state.kalshi.cashUsd, 8.34);
    assert.equal(snap.config.placeOrders, true);
    assert.equal(snap.config.dryRun, false);
    const blob = JSON.stringify(snap);
    assert.equal(blob.includes("LEAK"), false);
    assert.equal(blob.includes("key_id"), false);
    assert.equal(snap.execute.locked, true);
  });

  it("zuko.execute is locked", () => {
    const r = zukoExecuteLocked({ ticker: "KXRAIN" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "locked");
  });
});

describe("pentester control plane", () => {
  beforeEach(() => _resetEngagements());

  it("allows only localhost lab hosts", () => {
    const lab = checkScope({ host: "127.0.0.1", port: 18080 });
    assert.equal(lab.ok, true);
    assert.equal(lab.allowed, true);
    assert.equal(lab.knownLabPort, true);

    const remote = checkScope({ host: "example.com", port: 443 });
    assert.equal(remote.ok, true);
    assert.equal(remote.allowed, false);
    assert.equal(remote.reason, "out_of_lab_scope");
  });

  it("authorize requires actor + confirm and records lab intent only", () => {
    const denied = authorizeEngagement({ host: "8.8.8.8", port: 80, confirm: true }, { userId: "op" });
    assert.equal(denied.ok, false);
    assert.equal(denied.reason, "out_of_lab_scope");

    const noConfirm = authorizeEngagement({ host: "127.0.0.1", port: 18080 }, { userId: "op" });
    assert.equal(noConfirm.ok, false);
    assert.equal(noConfirm.reason, "confirm_required");

    const ok = authorizeEngagement({ host: "127.0.0.1", port: 18080, confirm: true, intent: "lab status" }, { userId: "op" });
    assert.equal(ok.ok, true);
    assert.equal(ok.engagement.execute, "locked");
    assert.equal(ok.engagement.status, "authorized_lab_only");
  });

  it("pentester.execute is locked even after authorize", () => {
    authorizeEngagement({ host: "127.0.0.1", port: 18080, confirm: true }, { userId: "op" });
    const r = pentesterExecuteLocked({ engagementId: "any" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "locked");
  });

  it("labHealth is honest when the range dir is missing", async () => {
    const r = await labHealth({
      homes: resolveSisterHomes({ cyberRange: path.join(os.tmpdir(), "concord-no-range") }),
      probe: false,
    });
    assert.equal(r.ok, true);
    assert.equal(r.present, false);
    assert.equal(r.execute.locked, true);
  });
});

describe("concordia presence", () => {
  it("reports in-repo clients and seeded worlds from this tree", () => {
    const snap = concordiaPresence({ homes: resolveSisterHomes({ repoRoot: REPO_ROOT }) });
    assert.equal(snap.ok, true);
    assert.equal(snap.present, true);
    assert.equal(snap.clients.threeJs.present, true);
    assert.equal(snap.clients.godot.present, true);
    assert.ok(snap.worldCount >= 1);
    assert.ok(snap.worlds.some((w) => w.id === "concordia-hub"));
  });
});

describe("domain capability registration + handlers", () => {
  before(async () => {
    _resetRegistry();
    const LENS = new Map();
    globalThis.__concordLensActions = LENS;
    const register = (domain, action, handler) => LENS.set(`${domain}.${action}`, handler);
    const { default: registerDila } = await import("../../domains/dila.js");
    const { default: registerTrading } = await import("../../domains/trading.js");
    const { default: registerZuko } = await import("../../domains/zuko.js");
    const { default: registerPentester } = await import("../../domains/pentester.js");
    const { default: registerConcordia } = await import("../../domains/concordia.js");
    const { default: registerConstellation } = await import("../../domains/constellation.js");
    registerDila(register);
    registerTrading(register);
    registerZuko(register);
    registerPentester(register);
    registerConcordia(register);
    registerConstellation(register);
  });

  it("registers the spec capability names with real handlers", () => {
    for (const name of [
      "dila.status", "agent.dila",
      "zuko.status", "agent.zuko", "zuko.execute",
      "trading.observe", "trading.evaluate", "trading.execute",
      "pentester.scope", "pentester.authorize", "pentester.execute",
      "concordia.world", "concordia.simulation",
      "constellation.status",
    ]) {
      const desc = getCapabilityDescriptor(name);
      assert.ok(desc, name);
      const health = checkCapabilityHealth(name);
      assert.equal(health.reachable, true, name);
    }
  });

  it("trading.execute and pentester.execute handlers return locked", async () => {
    const lens = globalThis.__concordLensActions;
    const trade = await lens.get("trading.execute")({}, { data: {} }, { product: "BTC-USD" });
    assert.equal(trade.ok, false);
    assert.equal(trade.reason, "locked");
    const pent = await lens.get("pentester.execute")({}, { data: {} }, { host: "127.0.0.1" });
    assert.equal(pent.ok, false);
    assert.equal(pent.reason, "locked");
  });

  it("constellation.status sees injected homes without probing the lab", async () => {
    const lens = globalThis.__concordLensActions;
    const homes = makeHomes();
    const r = await lens.get("constellation.status")({}, { data: { homes, probeLab: false } }, { homes, probeLab: false });
    assert.equal(r.ok, true);
    assert.equal(r.domains.trading.present, true);
    assert.equal(r.domains.zuko.present, true);
    assert.equal(r.domains.pentester.executeLocked, true);
    assert.equal(r.domains.trading.executeLocked, true);
    assert.equal(r.domains.concordia.present, true);
    assert.ok(Array.isArray(r.chain));
    assert.ok(r.chain.includes("dila"));
  });
});

describe("collectConstellationHealth", () => {
  it("ABSENT homes do not fabricate HEALTHY traders", async () => {
    const health = await collectConstellationHealth({
      homes: resolveSisterHomes({
        trading: path.join(os.tmpdir(), "concord-no-trading-2"),
        zuko: path.join(os.tmpdir(), "concord-no-zuko-2"),
        cyberRange: path.join(os.tmpdir(), "concord-no-range-2"),
        repoRoot: REPO_ROOT,
      }),
      probeLab: false,
    });
    assert.equal(health.ok, true);
    assert.equal(health.domains.trading.status, "ABSENT");
    assert.equal(health.domains.zuko.status, "ABSENT");
    assert.notEqual(health.overall, "FAILED");
    assert.ok(recentEvents(1));
  });
});
