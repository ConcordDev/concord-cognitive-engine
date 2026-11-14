// FIX-fashion-006 (FE pins) — the closet cost ceiling on the client
// side: the edit helper refuses above the bound before anything is
// sent, the Add form refuses before the call, and the over-max note
// stands beside the haiku lane's negative note (whose pinned shape in
// tests/numeric-notes-h13.test.ts is untouched).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

describe("fashion cost ceiling — FE (FIX-fashion-006)", () => {
  it("the edit helper carries the ceiling and refuses above it in words", () => {
    const src = read("components/fashion/closet-item-edit.ts");
    assert.ok(src.includes("CLOSET_COST_MAX = 10_000_000"), "ceiling constant present");
    assert.ok(src.includes("cost > CLOSET_COST_MAX"), "ceiling enforced in the helper");
    assert.ok(src.includes("Cost must be $10,000,000 or less."), "refusal names the bound");
    assert.ok(src.includes("Cost cannot be negative."), "the negative refusal stands");
  });

  it("the Add form guards before the call and shows the over-max note; the negative note is byte-identical", () => {
    const src = read("components/fashion/FashionClosetPanel.tsx");
    assert.ok(src.includes("c > CLOSET_COST_MAX"), "add() refuses above the ceiling");
    assert.ok(src.includes("Cost must be between $0 and $10,000,000."), "add() refusal names the range");
    assert.ok(src.includes("Cost must be $10,000,000 or less.</span>"), "over-max inline note present");
    assert.ok(
      src.includes("Number(form.cost) < 0 && <span role=\"note\" className=\"col-span-full text-xs text-rose-300\">Cost can&apos;t be negative.</span>"),
      "haiku's negative note stands byte-identical (numeric-notes-h13 pin)",
    );
  });

  it("the server names the same ceiling at all three entry paths", () => {
    const src = read("../server/domains/fashion.js");
    assert.ok(src.includes("MAX_ITEM_COST = 10_000_000"), "server ceiling present");
    assert.ok(src.includes("fsCostError(params.cost)"), "item-add / item-update guard");
    assert.ok(src.includes("fsCostError(params.cost != null ? params.cost : entry.price)"), "convert guard on the effective cost");
  });
});
