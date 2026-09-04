// server/lib/runtime/zuko-observe.js
//
// Concord Runtime — read-only observation of ~/.zuko. Zuko is the Kalshi
// pricing/risk engine. Dila Coinbase stays Dila — this adapter never
// opens a second Coinbase book and never places Kalshi orders.
//
// kalshi_config.json may contain live auth. stripSecrets drops it; we
// also never return the `auth` object even if the key name slipped.

import path from "node:path";
import { homePresence, readJsonIfPresent, resolveSisterHomes, stripSecrets } from "./sister-homes.js";
import { publish } from "./event-bus.js";

function publicKalshiConfig(cfg) {
  if (!cfg || typeof cfg !== "object") return null;
  const clean = stripSecrets(cfg);
  return {
    owner: typeof clean.owner === "string" ? clean.owner : null,
    dryRun: clean.dry_run === true,
    placeOrders: clean.place_orders === true,
    firstCycleScanOnly: clean.first_cycle_scan_only === true,
    startingBudgetUsd: Number.isFinite(clean.starting_budget_usd) ? clean.starting_budget_usd : null,
    cashAfterFlattenUsd: Number.isFinite(clean.cash_after_flatten_usd) ? clean.cash_after_flatten_usd : null,
    style: typeof clean.style === "string" ? clean.style : null,
    dilaCronsPaused: clean.dila_crons_paused === true,
  };
}

function publicRisk(risk) {
  if (!risk || typeof risk !== "object") return null;
  const clean = stripSecrets(risk);
  return {
    owner: typeof clean.owner === "string" ? clean.owner : null,
    venue: typeof clean.venue === "string" ? clean.venue : null,
    halted: clean.halted === true,
    haltReason: typeof clean.halt_reason === "string" ? clean.halt_reason : "",
    dailyPnlUsd: Number.isFinite(clean.daily_pnl_usd) ? clean.daily_pnl_usd : null,
    openNames: Array.isArray(clean.open_names) ? clean.open_names.slice(0, 16) : [],
    caps: clean.caps && typeof clean.caps === "object" ? {
      maxPositionUsd: clean.caps.max_position_usd ?? null,
      maxOpenNames: clean.caps.max_open_names ?? null,
      dailyLossHalt: clean.caps.daily_loss_halt ?? null,
      maxPortfolioUsd: clean.caps.max_portfolio_usd ?? null,
      minNetEv: clean.caps.min_net_ev ?? null,
    } : null,
    note: typeof clean.note === "string" ? clean.note : null,
  };
}

function publicState(state) {
  if (!state || typeof state !== "object") return null;
  const clean = stripSecrets(state);
  const kalshi = clean.kalshi && typeof clean.kalshi === "object" ? {
    owner: clean.kalshi.owner || null,
    cashUsd: Number.isFinite(clean.kalshi.cash_usd) ? clean.kalshi.cash_usd : null,
    positions: Number.isFinite(clean.kalshi.positions) ? clean.kalshi.positions : null,
    flattened: clean.kalshi.flattened === true,
    dryRun: clean.kalshi.dry_run === true,
  } : null;
  return {
    lane: typeof clean.lane === "string" ? clean.lane : null,
    concordiaHub: typeof clean.concordia_hub === "string" ? clean.concordia_hub : null,
    dilaBook: typeof clean.dila_book === "string" ? clean.dila_book : null,
    kalshi,
    updatedEt: typeof clean.updated_et === "string" ? clean.updated_et : null,
  };
}

/**
 * @param {object} [opts]
 * @param {ReturnType<typeof resolveSisterHomes>} [opts.homes]
 * @param {boolean} [opts.publishEvents]
 */
export function observeZuko(opts = {}) {
  const homes = opts.homes || resolveSisterHomes();
  const presence = homePresence(homes.zuko);
  if (!presence.present) {
    return { ok: true, present: false, reason: presence.reason, owner: "zuko" };
  }

  const state = readJsonIfPresent(path.join(homes.zuko, "state.json"));
  const risk = readJsonIfPresent(path.join(homes.zuko, "zuko_risk_state.json"));
  const cfg = readJsonIfPresent(path.join(homes.zuko, "kalshi_config.json"));
  const kill = readJsonIfPresent(path.join(homes.zuko, "kill_switch.json"));

  const snapshot = {
    ok: true,
    present: true,
    owner: "zuko",
    path: presence.path,
    state: state.ok ? publicState(state.value) : { reason: state.reason },
    risk: risk.ok ? publicRisk(risk.value) : { reason: risk.reason },
    config: cfg.ok ? publicKalshiConfig(cfg.value) : { reason: cfg.reason },
    killSwitch: kill.ok ? { present: true, halted: kill.value?.halted === true } : { present: false },
    execute: { locked: true, reason: "runtime_must_not_place_kalshi_orders" },
    note: "Dila Coinbase stays Dila. Zuko is Kalshi-only.",
  };

  if (opts.publishEvents) {
    publish("market.observed", {
      venue: "zuko_kalshi",
      present: true,
      cashUsd: snapshot.state?.kalshi?.cashUsd ?? null,
      positions: snapshot.state?.kalshi?.positions ?? null,
      halted: snapshot.risk?.halted === true,
    });
  }

  return snapshot;
}

export function zukoExecuteLocked(input = {}) {
  return {
    ok: false,
    reason: "locked",
    capability: "zuko.execute",
    requested: input && typeof input === "object" ? Object.keys(input).slice(0, 8) : [],
    note: "Zuko remains independently safety-bounded. Concord observes; it does not place orders.",
  };
}
