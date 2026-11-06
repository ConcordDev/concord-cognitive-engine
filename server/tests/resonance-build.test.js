// Resonance build — the Workbench hygiene legs (S-RES-3/4/6).
// Harness form follows docs-domain-parity: register the domain's actions
// into a Map against a stubbed STATE, then drive the action fns directly.
import { test } from "node:test";
import assert from "node:assert/strict";
import registerResonanceActions from "../domains/resonance.js";
import { collectLensExport, _clearLensExportProvidersForTests } from "../lib/lens-export.js";

const actions = new Map();
registerResonanceActions((domain, name, fn) => actions.set(`${domain}.${name}`, fn));
const run = (name, params = {}, userId = "u-res") =>
  actions.get(`resonance.${name}`)({ actor: { userId }, userId }, null, params);

globalThis._concordSTATE = {};
globalThis._concordSaveStateDebounced = () => {};

const STRONG_A = {
  domain: "immunology",
  title: "Immune memory",
  description: "adaptive recall of prior exposure",
  invariants: [
    "memory of prior exposure",
    "response strengthens on re-exposure",
    "specificity to a target",
  ],
};
const STRONG_B = {
  domain: "music",
  title: "Motif return",
  description: "thematic material returning transformed",
  invariants: [
    "memory of prior exposure",
    "response strengthens on re-exposure",
    "specificity to a target",
  ],
};

test("S-RES-3: an exact duplicate pair is refused, in either orientation", () => {
  const first = run("proposePair", { a: STRONG_A, b: STRONG_B, note: "the fixture pair" });
  assert.equal(first.ok, true);
  assert.equal(first.result.pair.classification, "strong_resonance");

  const same = run("proposePair", { a: STRONG_A, b: STRONG_B });
  assert.equal(same.ok, false);
  assert.match(same.error, /already exists/);

  const reversed = run("proposePair", { a: STRONG_B, b: STRONG_A });
  assert.equal(reversed.ok, false);
  assert.match(reversed.error, /already exists/);

  const listed = run("listPairs", {});
  assert.equal(listed.result.count, 1);
});

test("S-RES-4: updatePair recomputes in place and refuses a collision", () => {
  const other = run("proposePair", {
    a: { domain: "cooking", title: "Maillard crust", description: "browning chemistry", invariants: ["heat drives browning"] },
    b: { domain: "astronomy", title: "Stellar forge", description: "fusion in cores", invariants: ["heat drives fusion"] },
  });
  assert.equal(other.ok, true);
  const otherId = other.result.pair.id;

  const mine = run("listPairs", {}).result.pairs.find((x) => x.a.domain === "immunology");
  const edited = run("updatePair", {
    pairId: mine.id,
    a: STRONG_A,
    b: { ...STRONG_B, invariants: ["wholly unrelated constraint", "nothing shared at all"] },
    note: "edited",
  });
  assert.equal(edited.ok, true);
  assert.equal(edited.result.pair.id, mine.id, "the pair keeps its id");
  assert.equal(edited.result.pair.resonance, 0, "disjoint invariants recompute to zero");
  assert.equal(edited.result.pair.classification, "noise_floor");
  assert.equal(edited.result.pair.note, "edited");

  const collide = run("updatePair", { pairId: otherId, a: STRONG_A, b: STRONG_B });
  assert.equal(collide.ok, false);
  assert.match(collide.error, /already holds those sides/);

  const ghost = run("updatePair", { pairId: "pair_nope", a: STRONG_A, b: STRONG_B });
  assert.equal(ghost.ok, false);
});

test("S-RES-4: deletePair removes the pair and the alerts it raised", () => {
  const before = run("resonanceAlerts", {});
  const mine = run("listPairs", {}).result.pairs.find((x) => x.a.domain === "immunology");
  assert.ok(
    before.result.alerts.some((al) => al.pairId === mine.id),
    "the strong pair raised an alert",
  );
  const del = run("deletePair", { pairId: mine.id });
  assert.equal(del.ok, true);
  const after = run("resonanceAlerts", {});
  assert.ok(!after.result.alerts.some((al) => al.pairId === mine.id), "its alerts go with it");
  assert.ok(!run("listPairs", {}).result.pairs.some((x) => x.id === mine.id));
  const ghost = run("deletePair", { pairId: mine.id });
  assert.equal(ghost.ok, false);
});

test("S-RES-6: the export provider surfaces the lens's pairs and insights", async () => {
  const strong = run("proposePair", { a: STRONG_A, b: STRONG_B });
  assert.equal(strong.ok, true);
  const insight = run("resonanceToInsight", { pairId: strong.result.pair.id });
  assert.equal(insight.ok, true);

  const out = await collectLensExport({
    runMacro: async () => ({ ok: true, artifacts: [] }),
    domain: "resonance",
    ctx: { actor: { userId: "u-res" }, userId: "u-res" },
  });
  assert.equal(out.ok, true);
  assert.equal(out.stateBacked, true);
  const types = out.artifacts.map((a) => a.type);
  assert.ok(types.includes("resonance_pair"), "pairs export");
  assert.ok(types.includes("resonance_insight"), "insights export");
  const pairRow = out.artifacts.find((a) => a.type === "resonance_pair");
  assert.match(pairRow.title, /Immune memory/);
  _clearLensExportProvidersForTests();
});
