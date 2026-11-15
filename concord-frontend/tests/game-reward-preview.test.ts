/**
 * FIX-game-006 (FE half): nextRewardPreview mirrors the server's
 * taskComplete formula so the task row can show the effective award
 * ("+10 XP x2 streak = +20 XP") instead of only the base.
 */
import { describe, it, expect } from "vitest";
import { nextRewardPreview } from "@/components/game/HabitHub";

const today = new Date().toISOString().slice(0, 10);

describe("nextRewardPreview", () => {
  it("first completion: base with the x1.05 starting bonus", () => {
    const p = nextRewardPreview({ difficulty: "easy", kind: "habit", streak: 0, lastCompletedDay: null });
    expect(p).toEqual({ base: 10, streakBonus: 1.05, effective: 11 });
  });
  it("capped streak: double", () => {
    const p = nextRewardPreview({ difficulty: "easy", kind: "habit", streak: 19, lastCompletedDay: today });
    expect(p.streakBonus).toBe(2);
    expect(p.effective).toBe(20);
  });
  it("a broken streak on a daily restarts the bonus", () => {
    const p = nextRewardPreview({ difficulty: "medium", kind: "daily", streak: 9, lastCompletedDay: "2020-01-01" });
    expect(p).toEqual({ base: 20, streakBonus: 1.05, effective: 21 });
  });
});
