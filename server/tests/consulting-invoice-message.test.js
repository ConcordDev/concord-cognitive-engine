/**
 * FIX-consulting-013 (message leg): invoice-create's empty refusal was
 * the raw code 'no unbilled time entries', which the panel toasted
 * verbatim. Pins: the refusal keeps its code and gains the helpful
 * message; with unbilled time logged the generate succeeds.
 */
import { describe, it, expect } from "vitest";
import registerConsultingActions from "../domains/consulting.js";

const actions = new Map();
registerConsultingActions((d, a, h) => actions.set(`${d}:${a}`, h));
globalThis._concordSTATE = {};
const ctx = { actor: { userId: "u1" }, userId: "u1" };
const run = (a, p = {}) => actions.get(`consulting:${a}`)(ctx, null, p);

describe("invoice-create refusal message", () => {
  it("empty engagement refuses with code + helpful message; logged time generates", () => {
    const eng = run("engagement-create", { name: "Advisory", client: "Acme", rate: 200 });
    expect(eng.ok).toBe(true);
    const id = eng.result.engagement.id;
    const refused = run("invoice-create", { engagementId: id });
    expect(refused.ok).toBe(false);
    expect(refused.error).toBe("no unbilled time entries");
    expect(refused.message).toMatch(/Log time on this engagement first/);
    expect(run("time-log", { engagementId: id, hours: 2 }).ok).toBe(true);
    const made = run("invoice-create", { engagementId: id });
    expect(made.ok).toBe(true);
    expect(made.result.invoice.total).toBe(400);
  });
});
