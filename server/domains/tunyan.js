// server/domains/tunyan.js
//
// Concordia Phase 9 — Tunyan calendar + civic clock macros.

import { monthFor, monthsList, yearDayFor, YEAR_DAYS } from "../lib/tunyan-calendar.js";
import { blockToCivic, civicBlocksList, activityForRole } from "../lib/civic-clock.js";

export default function registerTunyanMacros(register) {
  register("tunyan", "current_month", async (ctx, input = {}) => {
    const yearDay = Number(input?.yearDay);
    if (!Number.isFinite(yearDay)) return { ok: false, reason: "missing_inputs" };
    return { ok: true, ...monthFor(yearDay) };
  });

  register("tunyan", "months", async () => {
    return { ok: true, months: monthsList(), yearDays: YEAR_DAYS };
  });

  register("tunyan", "year_day_for", async (ctx, input = {}) => {
    const monthIndex = Number(input?.monthIndex);
    const dayInMonth = Number(input?.dayInMonth) || 1;
    if (!Number.isFinite(monthIndex)) return { ok: false, reason: "missing_inputs" };
    return { ok: true, yearDay: yearDayFor(monthIndex, dayInMonth) };
  });

  register("tunyan", "civic_block", async (ctx, input = {}) => {
    const blockIndex = Number(input?.blockIndex);
    if (!Number.isFinite(blockIndex)) return { ok: false, reason: "missing_inputs" };
    return { ok: true, block: blockToCivic(blockIndex) };
  });

  register("tunyan", "civic_blocks", async () => {
    return { ok: true, blocks: civicBlocksList() };
  });

  register("tunyan", "activity_for_role", async (ctx, input = {}) => {
    const role = String(input?.role || "").trim();
    const blockIndex = Number(input?.blockIndex);
    if (!role || !Number.isFinite(blockIndex)) return { ok: false, reason: "missing_inputs" };
    const activity = activityForRole(role, blockIndex);
    if (!activity) return { ok: false, reason: "unknown_role" };
    return { ok: true, role, blockIndex, activity };
  });
}
