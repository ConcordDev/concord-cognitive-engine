// server/tests/name-collision-gate.test.js
//
// Bidirectional pinning test for the standalone name-collision gate
// (scripts/check-name-collisions.mjs, E3 of docs/CONTENT_INTEGRITY_SWEEP.md).
//
// Pins that the detector:
//   (a) FLAGS a new real-nation / trademarked-IP name reused for fiction,
//   (b) does NOT flag a clean / coined value,
//   (c) does NOT flag a baseline-accepted term (public-domain myth) or a
//       known-pending term inside its recorded scope,
//   (d) is SUBSTRING-SAFE: "medicine" / "decree" / "screen" never match
//       "Medici" / "Cree".
//
// A regression in EITHER direction (gate goes blind, or gate goes noisy) turns
// this red — the anti-goalpost-move contract from CLAUDE.md §4.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findCollisions,
  buildDictionary,
  isBaselined,
} from "../../scripts/check-name-collisions.mjs";

const DICT = buildDictionary();

// --- (a) flags a NEW real-name-for-fiction collision --------------------------

test("flags a real living-people ethnonym reused for a fictional entity", () => {
  // "Zulu" is a real living people; here used as a fictional faction name.
  const hits = findCollisions("The Zulu Ascendancy holds the eastern arcology", { dictionary: DICT });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].term, "Zulu");
  assert.equal(hits[0].category, "REAL_NATIONS");
});

test("flags a trademarked franchise proper noun reused for fiction", () => {
  // "Rivendell" is Tolkien IP; forward-protected — must fire if it ever enters.
  const hits = findCollisions("guild_hall_of_rivendell", { dictionary: DICT });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].term, "Rivendell");
  assert.equal(hits[0].category, "TRADEMARKED_IP");
});

test("catches snake_case identifiers (token boundary, not \\b)", () => {
  // The exact class of residual the \\bcree\\b regex missed: `cree_*` ids.
  const hits = findCollisions("navajo_stone_carver_elder", { dictionary: DICT });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].term, "Navajo");
});

// --- (b) does NOT flag clean / coined content --------------------------------

test("does not flag a fully coined / clean value", () => {
  assert.deepEqual(findCollisions("The Vessine of Corre cross the Maeris expanse", { dictionary: DICT }), []);
  assert.deepEqual(findCollisions("nevex_district_gate", { dictionary: DICT }), []);
});

test("the three already-FIXED renames leave zero residual in the dictionary path", () => {
  // Cree→Corre, Nymeria→Maeris, ArasaCorp→Nevex: the coined replacements are clean.
  for (const clean of ["Corre", "Maeris", "Nevex", "corre_eldest_walker"]) {
    assert.deepEqual(findCollisions(clean, { dictionary: DICT }), [], `"${clean}" must be clean`);
  }
});

// --- (c) baseline-accepted + known-pending are not treated as violations -----

test("a public-domain / accepted term is covered by the baseline (acceptedTerms)", () => {
  const baseline = { acceptedTerms: ["Mercury"], knownPending: [] };
  // Even if Mercury were in the dictionary, acceptedTerms clears it anywhere.
  assert.equal(isBaselined("Mercury", "content/world/tunya/deities.json", baseline), true);
});

test("a known-pending term is covered INSIDE its recorded scope but flags OUTSIDE it", () => {
  const baseline = {
    acceptedTerms: [],
    knownPending: [
      { term: "Kree", category: "TRADEMARKED_IP", scopes: ["content/world/tunya/"], reason: "pending" },
    ],
  };
  // Kree is genuinely still a dictionary term...
  const hits = findCollisions("the Kree ark-fleet", { dictionary: DICT });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].term, "Kree");
  // ...but inside its scope it is a known (non-blocking) match:
  assert.equal(isBaselined("Kree", "content/world/tunya/lore.json", baseline), true);
  // ...and a NEW occurrence outside the recorded scope re-opens the class:
  assert.equal(isBaselined("Kree", "content/world/superhero/npcs.json", baseline), false);
});

// --- (d) substring safety (the real bugs this class was born from) -----------

test("substring-safe: real words containing a term as a substring never match", () => {
  const cases = [
    "medicine",         // contains "medici"
    "the royal decree", // contains "cree"
    "on the screen",    // contains "cree"
    "screened footage", // contains "cree"
    "apacherror",       // contains "apache" (fabricated stress word)
    "brahmini fish",    // "brahmin" as a substring of a longer token
  ];
  for (const c of cases) {
    assert.deepEqual(findCollisions(c, { dictionary: DICT }), [], `"${c}" must NOT flag`);
  }
});

test("word-boundary: a term only matches as a whole token", () => {
  assert.deepEqual(findCollisions("Kreeton was a coined name", { dictionary: DICT }), [], "Kreeton != Kree");
  assert.equal(findCollisions("a Kree ship", { dictionary: DICT }).length, 1, "standalone Kree matches");
  // But 'Medici' is deliberately NOT in the dictionary (real dynasty, tracked
  // manually) — so 'medicine' is doubly safe.
  assert.deepEqual(findCollisions("modern medicine", { dictionary: DICT }), []);
});

test("dictionary is a non-trivial curated set", () => {
  assert.ok(DICT.size >= 60, `expected a curated dictionary, got ${DICT.size}`);
});
