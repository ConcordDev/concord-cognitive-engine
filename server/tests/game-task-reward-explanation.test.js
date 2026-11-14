/**
 * FIX-game-006: the same task appeared to pay +10 XP once and +20
 * later. The resolver's award is base XP (by difficulty) times a
 * streak bonus (x1.05 per streak day, capped x2) — by design, but
 * nothing explained it: the task row printed only the base and the
 * activity log kept only the total. Pins: taskComplete returns the
 * reward breakdown and the XP log entry carries it.
 */
import { describe, it, expect, beforeEach } from "vitest";
import registerGameActions from "../domains/game.js";

const actions = new Map();
registerGameActions((domain, action, handler) => actions.set(`${domain}:${action}`, handler));
const ctx = { actor: { userId: "u1" }, userId: "u1" };
const run = (action, params) => actions.get(`game:${action}`)(ctx, null, params);

function seedTask(streak) {
  globalThis._concordSTATE = {};
  const S = globalThis._concordSTATE;
  S.game = { tasks: new Map([["u1", new Map([["t1", {
    id: "t1", title: "Morning pages", kind: "habit", difficulty: "easy",
    streak, longestStreak: streak, completions: streak, lastCompletedDay: null,
  }]])]]) };
}

describe("taskComplete reward explanation", () => {
  beforeEach(() => { globalThis._concordSTATE = {}; });

  it("a capped streak pays double the base — and the result explains why", () => {
    seedTask(19);
    const r = run("taskComplete", { id: "t1" });
    expect(r.ok).toBe(true);
    expect(r.result.xpDelta).toBe(20);
    expect(r.result.reward).toMatchObject({ baseXp: 10, difficulty: "easy", streak: 20, streakBonus: 2, xpDelta: 20 });
    const log = run("xpLogList", {});
    const entry = log.result.entries.find((e) => e.refId === "t1");
    expect(entry.baseXp).toBe(10);
    expect(entry.streakBonus).toBe(2);
  });

  it("a first completion pays the base (rounded) with its small bonus named", () => {
    seedTask(0);
    const r = run("taskComplete", { id: "t1" });
    expect(r.result.reward).toMatchObject({ baseXp: 10, streak: 1, streakBonus: 1.05 });
    expect(r.result.xpDelta).toBe(Math.round(10 * 1.05));
  });
});
