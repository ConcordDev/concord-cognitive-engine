// server/lib/runtime/trading-observe.js
//
// Concord Runtime — read-only observation of Dila's AutoTrader / PPO home.
// Does NOT place orders, does NOT import the Python traders, does NOT
// bypass PPO/Zuko/Dila safety. trading.execute stays LOCKED in the domain.
//
// Publishes market.observed (summary) and, when asked, only NEW
// auto_trader_log entries as trade.executed — never replays the whole
// history on every heartbeat.

import path from "node:path";
import { fileExists, homePresence, readJsonIfPresent, resolveSisterHomes, stripSecrets } from "./sister-homes.js";
import { publish } from "./event-bus.js";

let _lastPublishedLogAt = null;

function summarizePpoState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return { assets: 0, inPosition: 0 };
  }
  const assets = Object.keys(state);
  let inPosition = 0;
  for (const key of assets) {
    const row = state[key];
    if (row && typeof row === "object" && row.in_position === true) inPosition += 1;
  }
  return { assets: assets.length, inPosition };
}

function summarizeConfig(cfg) {
  if (!cfg || typeof cfg !== "object") return null;
  const clean = stripSecrets(cfg);
  return {
    autoTradeEnabled: !!clean.auto_trade_enabled,
    authorized: !!clean.authorized,
    authorizedBy: typeof clean.authorized_by === "string" ? clean.authorized_by : null,
    maxPositionUsd: Number.isFinite(clean.max_position_usd) ? clean.max_position_usd : null,
    maxTotalDeployed: Number.isFinite(clean.max_total_deployed) ? clean.max_total_deployed : null,
    maxDailyTrades: Number.isFinite(clean.max_daily_trades) ? clean.max_daily_trades : null,
    maxDailyLossUsd: Number.isFinite(clean.max_daily_loss_usd) ? clean.max_daily_loss_usd : null,
    noBankDeposits: clean.no_bank_deposits === true,
    strategiesEnabled: Array.isArray(clean.strategies_enabled) ? clean.strategies_enabled.slice(0, 16) : [],
    productCount: Array.isArray(clean.products) ? clean.products.length : 0,
  };
}

function summarizeLog(entries) {
  if (!Array.isArray(entries)) return { count: 0, lastLoggedAt: null, lastTypes: [] };
  const last = entries[entries.length - 1] || null;
  const lastLoggedAt = last?.logged_at || last?.trade?.timestamp || null;
  const lastTypes = entries.slice(-8).map((e) => e?.type || "unknown");
  return { count: entries.length, lastLoggedAt, lastTypes };
}

/**
 * @param {object} [opts]
 * @param {ReturnType<typeof resolveSisterHomes>} [opts.homes]
 * @param {boolean} [opts.publishEvents]
 */
export function observeDilaTrading(opts = {}) {
  const homes = opts.homes || resolveSisterHomes();
  const presence = homePresence(homes.trading);
  if (!presence.present) {
    return { ok: true, present: false, reason: presence.reason, venue: "dila_coinbase" };
  }

  const ppo = readJsonIfPresent(path.join(homes.trading, "ppo_momentum_state.json"));
  const cfg = readJsonIfPresent(path.join(homes.trading, "auto_trade_config.json"));
  const log = readJsonIfPresent(path.join(homes.trading, "auto_trader_log.json"));
  const lockPresent = fileExists(path.join(homes.trading, ".auto_trader_v10.lock"));

  const ppoSummary = ppo.ok ? summarizePpoState(ppo.value) : { assets: 0, inPosition: 0, reason: ppo.reason };
  const config = cfg.ok ? summarizeConfig(cfg.value) : null;
  const logSummary = log.ok ? summarizeLog(log.value) : { count: 0, lastLoggedAt: null, lastTypes: [], reason: log.reason };

  const snapshot = {
    ok: true,
    present: true,
    venue: "dila_coinbase",
    path: presence.path,
    liveLoopHint: lockPresent ? "lockfile_present" : "no_lockfile",
    ppo: ppoSummary,
    config,
    log: logSummary,
    execute: { locked: true, reason: "runtime_must_not_bypass_trader_safety" },
  };

  if (opts.publishEvents) {
    publish("market.observed", {
      venue: "dila_coinbase",
      present: true,
      inPosition: ppoSummary.inPosition,
      assets: ppoSummary.assets,
      lastLoggedAt: logSummary.lastLoggedAt,
    });
    if (log.ok && Array.isArray(log.value)) {
      const fresh = [];
      for (const entry of log.value) {
        const at = entry?.logged_at || entry?.trade?.timestamp;
        if (!at) continue;
        if (_lastPublishedLogAt && at <= _lastPublishedLogAt) continue;
        fresh.push(entry);
      }
      if (_lastPublishedLogAt != null) {
        for (const entry of fresh) {
          if (entry?.type === "trade_executed" && entry.trade) {
            publish("trade.executed", {
              venue: "dila_coinbase",
              product: entry.trade.product || null,
              side: entry.trade.side || null,
              amountUsd: entry.trade.amount_usd ?? null,
              strategy: entry.trade.strategy || null,
              loggedAt: entry.logged_at || null,
            });
          } else if (entry?.type === "trade_resolved" || entry?.trade?.realized_pnl) {
            publish("trade.resolved", {
              venue: "dila_coinbase",
              product: entry.trade?.product || null,
              realizedPnl: entry.trade?.realized_pnl ?? null,
              loggedAt: entry.logged_at || null,
            });
          }
        }
      }
      if (logSummary.lastLoggedAt) _lastPublishedLogAt = logSummary.lastLoggedAt;
    }
  }

  return snapshot;
}

/** @internal Test-only. */
export function _resetTradeObserveCursor() {
  _lastPublishedLogAt = null;
}

export function evaluateObservedEdge(input = {}) {
  const forecast = Number(input.forecastProbability);
  const market = Number(input.marketProbability);
  if (!Number.isFinite(forecast) || forecast < 0 || forecast > 1) {
    return { ok: false, reason: "invalid_forecast_probability" };
  }
  if (!Number.isFinite(market) || market < 0 || market > 1) {
    return { ok: false, reason: "invalid_market_probability" };
  }
  const fee = Number(input.fee) || 0;
  const edge = forecast - market;
  const ev = forecast * (1 - market) - (1 - forecast) * market - fee;
  return {
    ok: true,
    edge: Math.round(edge * 10000) / 10000,
    ev: Math.round(ev * 10000) / 10000,
    advisory: true,
    grantsAuthority: false,
    note: "Observational EV only — does not authorize trading.execute.",
  };
}

export function tradingExecuteLocked(input = {}) {
  return {
    ok: false,
    reason: "locked",
    capability: "trading.execute",
    requested: input && typeof input === "object" ? Object.keys(input).slice(0, 8) : [],
    note: "Runtime monitors trading. It must not bypass Dila PPO / Zuko safety. There is no execution channel.",
  };
}
