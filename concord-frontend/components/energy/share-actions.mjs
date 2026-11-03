/**
 * Share view of the energy lens.
 *
 * The loaded EIA rate and the bill computed from it are energy data.
 * Saving a snapshot is a private platform DTU, which is why Mint stays.
 * DM, public publish, and optimize are not registered energy actions
 * (energy review, cross-check #67(c)). They are listed on the panel as
 * unavailable. This module does not register stand-in verbs for them.
 */

export const ABSENT_ENERGY_SHARE_ACTIONS = [
  {
    id: "dm",
    label: "DM household",
    reason: "Not an energy action. This lens does not send a message.",
  },
  {
    id: "publish",
    label: "Publish tips",
    reason: "Not an energy action. This lens does not publish.",
  },
  {
    id: "optimize",
    label: "Optimize",
    reason: "Not an energy action. This lens does not run an agent.",
  },
];

/** Blank is not zero. A digit string, including "0", is recorded monthly kWh. */
export function recordedMonthlyKwh(raw) {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Bill from a recorded EIA cents/kWh and recorded kWh. Either missing → null. */
export function estimatedBillUsd(priceCentsPerKwh, kwh) {
  if (typeof priceCentsPerKwh !== "number" || !Number.isFinite(priceCentsPerKwh) || priceCentsPerKwh < 0) return null;
  if (typeof kwh !== "number" || !Number.isFinite(kwh) || kwh < 0) return null;
  return Math.round((priceCentsPerKwh / 100) * kwh * 100) / 100;
}
