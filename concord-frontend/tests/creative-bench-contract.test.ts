/**
 * Source-pin suite for the creative bench input contract (F3/F4 fix
 * return, the (b) leg). The bench macros read a keyed object, but the
 * panel's bare textareas invited a bare JSON array — which travelled
 * as { artifact: { data: [...] } }, was refused by the route's
 * plain-object peel, and the macros silently returned their default
 * templates as if computed (R4's S3 finding: entered values never
 * appeared; the defaults presented instead). The panel now binds:
 * a pasted array is normalized into the macro's shape with the
 * entered values honoured, and a content-bearing paste it cannot
 * bind is refused IN WORDS — the macro is never called with it.
 *
 * Each pin is verified against the shipped source below.
 */
import { describe, it } from 'vitest';
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const panel = readFileSync(join(here, "..", "components", "creative", "CreativeActionPanel.tsx"), "utf8");

describe("creative bench input contract — the panel binds before it calls", () => {
  it("all four binders exist, one per bench field", () => {
    for (const fn of ["function bindScenes(", "function bindAssets(", "function bindBudget(", "function bindDist("]) {
      assert.ok(panel.includes(fn), fn);
    }
  });

  it("every bench action binds its paste and calls the macro with the BOUND data", () => {
    for (const pair of [
      "const bound = bindScenes(parsed)",
      "const bound = bindAssets(parsed)",
      "const bound = bindBudget(parsed)",
      "const bound = bindDist(parsed)",
    ]) {
      assert.ok(panel.includes(pair), pair);
    }
    assert.equal((panel.match(/\{ artifact: \{ data: bound\.data \} \}/g) || []).length, 4, "all four verbs send bound.data");
    assert.ok(!panel.includes("{ artifact: { data: parsed } }"), "no bench call sends the raw parse anymore");
  });

  it("a refusal returns before the macro is called (err, then return)", () => {
    assert.equal((panel.match(/if \(!bound\.ok\) \{ err\(bound\.error\); return; \}/g) || []).length, 4);
  });

  it("a scene carrying its own shots[] flattens into the macro's shape", () => {
    assert.ok(panel.includes("Array.isArray(scene.shots)"));
    assert.ok(panel.includes("description: shot.description ?? shot.name"));
    assert.ok(panel.includes("durationSec: shot.durationSec ?? shot.duration"));
  });

  it("budget lines take their category from the entered name or label when no category is authored", () => {
    assert.ok(panel.includes("category: line.category ?? line.name ?? line.label"));
  });

  it("a delivery array lifts its channel and date to the macro's platform/deliveryDate", () => {
    assert.ok(panel.includes("data.platform = first.channel"));
    assert.ok(panel.includes("data.deliveryDate = dated.date ?? dated.deliveryDate"));
  });

  it("unbindable pastes are refused IN WORDS, per bench, and empty lists refuse too", () => {
    for (const s of [
      "That JSON does not describe scenes.",
      "That JSON does not describe assets.",
      "That JSON does not describe a budget.",
      "That JSON does not describe a delivery.",
      "The scenes list is empty — add at least one scene.",
      "The budget list is empty — add at least one line.",
    ]) {
      assert.ok(panel.includes(s), s);
    }
  });

  it("each textarea now documents its shape with a placeholder", () => {
    for (const s of [
      'placeholder=\'[{ "name": "Scene", "shots": [{ "name": "Shot" }] }]\'',
      'placeholder=\'[{ "name": "Asset" }]\'',
      'placeholder=\'[{ "name": "Line", "amount": 0 }]\'',
      'placeholder=\'[{ "name": "Entry", "channel": "…" }]\'',
    ]) {
      assert.ok(panel.includes(s), s);
    }
  });
});
