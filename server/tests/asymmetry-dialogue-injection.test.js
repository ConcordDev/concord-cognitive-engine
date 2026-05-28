/**
 * T1.2 — NPC asymmetry reaches the dialogue prompt (both prongs), never the secret.
 *
 * The grudge/preoccupation/desire are computed by composeAsymmetryContext and
 * attached to npcTraits by narrative-bridge, but were dropped at BOTH prompt
 * boundaries: the oracle template (oracleDialogueTreeComposer) only read
 * name/personality/role, and the live /dialogue endpoint never read asymmetry
 * into promptLines. NPCs therefore sounded generic.
 *
 * Invariant guard: narrative_context.secret must NEVER appear in any prompt.
 *
 * Run: node --test tests/asymmetry-dialogue-injection.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { TASK_PROMPTS } from "../lib/prompt-registry.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORLDS = path.resolve(HERE, "..", "routes", "worlds.js");

describe("T1.2 prong B — oracle dialogue template surfaces asymmetry", () => {
  it("renders grudge, preoccupation, and desire when present", () => {
    const out = TASK_PROMPTS.oracleDialogueTreeComposer({
      npcTraits: {
        name: "Iyatte",
        persistent_grudge: "Medici hunted clues to her secret for years.",
        current_preoccupation: "Her faction edges toward open war.",
        desire_for_this_player: "Carry a sealed letter to the Sahm chancellor.",
      },
    });
    assert.match(out, /Medici hunted clues/);
    assert.match(out, /edges toward open war/);
    assert.match(out, /sealed letter to the Sahm chancellor/);
  });

  it("omits the fields cleanly when absent (no 'undefined'/'null' bleed)", () => {
    const out = TASK_PROMPTS.oracleDialogueTreeComposer({ npcTraits: { name: "Citizen" } });
    assert.doesNotMatch(out, /Persistent grudge/);
    assert.doesNotMatch(out, /Current preoccupation/);
    assert.doesNotMatch(out, /What you quietly want/);
    // 'null' appears legitimately in the example JSON ("leadsTo": null); only
    // 'undefined' would indicate a template-interpolation bleed.
    assert.doesNotMatch(out, /undefined/);
  });

  it("NEVER prints a secret even if one leaks onto npcTraits", () => {
    const SECRET = "Her youngest son was born without flame.";
    const out = TASK_PROMPTS.oracleDialogueTreeComposer({
      npcTraits: { name: "Iyatte", secret: SECRET, narrative_context: { secret: SECRET } },
    });
    assert.ok(!out.includes(SECRET), "the oracle template must not render any secret field");
  });
});

describe("T1.2 prong A — live /dialogue endpoint wires asymmetry into the prompt", () => {
  const src = readFileSync(WORLDS, "utf-8");

  it("computes composeAsymmetryContext and pushes asymmetryLines into promptLines", () => {
    assert.match(src, /composeAsymmetryContext/, "endpoint must call composeAsymmetryContext");
    assert.match(src, /asymmetryLines/, "endpoint must build asymmetryLines");
    assert.match(src, /\.\.\.asymmetryLines/, "asymmetryLines must be spread into promptLines");
  });

  it("never inlines narrative_context.secret into the prompt", () => {
    // The persona/prompt path must not read a secret field. (The bridge's
    // canary scan stays authoritative; this is defense in depth at the route.)
    assert.doesNotMatch(src, /promptLines[\s\S]{0,400}narrative_context\.secret/);
    assert.doesNotMatch(src, /asymmetryLines[\s\S]{0,200}\.secret\b/);
  });
});
