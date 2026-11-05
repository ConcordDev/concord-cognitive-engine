// Science full build (GB-1021) — the record layer's gate, the statistics
// mode, and the custody count.
//
// S1: the ArtifactsPanel's creates (and Quick Capture's) died in
// validateArtifact against a science rule authored in a vocabulary the
// lens never sends. These tests run the REAL registry under server.js's
// own merge semantics (an extended rule applies only where no base rule
// exists; reconcileArtifactTypes runs after the merge) and pin the exact
// payloads the panel sends.
// S4: stats-descriptive reports a mode when one exists and omits the
// field when no value repeats.
// S3 (server half): chainOfCustody's transfers count is the chain's row
// count — the panel's count-matches-rows contract rests on it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { DOMAIN_RULES, validateArtifact, getValidTransitions } from "../lib/domain-logic.js";
import { EXTENDED_DOMAIN_RULES } from "../lib/domain-logic-extended.js";
import { FRONTEND_ARTIFACT_TYPES, reconcileArtifactTypes } from "../lib/lens-artifact-types.js";
import registerScienceActions from "../domains/science.js";

// server.js's merge, replicated: extended entries fill only absent domains.
for (const [k, v] of EXTENDED_DOMAIN_RULES) {
  if (!DOMAIN_RULES.has(k)) DOMAIN_RULES.set(k, v);
}
reconcileArtifactTypes(DOMAIN_RULES);

test("S1: every ArtifactsPanel create validates — type + the status its form sends", () => {
  const panelPayloads = [
    ["Experiment", "planned"], ["Experiment", "active"], ["Experiment", "peer_review"],
    ["Sample", "excellent"], ["Sample", "disposed"],
    ["Equipment", "operational"], ["Equipment", "needs_calibration"],
    ["Analysis", "planned"], ["Analysis", "analyzing"],
    ["Protocol", "draft"], ["Protocol", "under_review"], ["Protocol", "approved"],
    ["Publication", "draft"], ["Publication", "submitted"], ["Publication", "published"],
  ];
  for (const [type, status] of panelPayloads) {
    const v = validateArtifact("science", type, { hypothesis: "h" }, { status });
    assert.equal(v.ok, true, `${type}/${status} must validate, got: ${v.errors.join("; ")}`);
  }
});

test("S1: Quick Capture's type validates at the same gate (F3)", () => {
  const v = validateArtifact("science", "capture", { content: "note" }, {});
  assert.equal(v.ok, true, v.errors.join("; "));
});

test("S1: Protocol stands in the frontend-types registry for science", () => {
  assert.ok(FRONTEND_ARTIFACT_TYPES.science.includes("Protocol"));
  assert.ok(DOMAIN_RULES.get("science").types.includes("Protocol"));
});

test("S1: the gate still refuses — unknown types and statuses fail by name", () => {
  const badType = validateArtifact("science", "NotARealType", {}, { status: "planned" });
  assert.equal(badType.ok, false);
  assert.match(badType.errors.join(" "), /Invalid type "NotARealType" for domain "science"/);
  const badStatus = validateArtifact("science", "Experiment", {}, { status: "not_a_status" });
  assert.equal(badStatus.ok, false);
  assert.match(badStatus.errors.join(" "), /Invalid status "not_a_status" for domain "science"/);
});

test("S1: status edits validate — frontend statuses transition; the legacy map is intact", () => {
  const fe = getValidTransitions("science", "planned");
  assert.ok(fe.includes("active") && fe.includes("archived"), "planned must reach the panel's other statuses");
  assert.deepEqual(getValidTransitions("science", "hypothesis"), ["experimenting", "draft", "archived"]);
});

test("S1: the legacy science vocabulary still validates (no record stranded)", () => {
  const v = validateArtifact("science", "experiment", { title: "t", hypothesis: "h" }, { status: "hypothesis" });
  assert.equal(v.ok, true, v.errors.join("; "));
});

// ── domain macros ──────────────────────────────────────────────────────

const ACTIONS = new Map();
registerScienceActions((d, n, fn) => ACTIONS.set(n, fn));
const call = (name, artifact, params) => ACTIONS.get(name)({ actor: { userId: "u1" }, userId: "u1" }, artifact, params);

test("S4: stats-descriptive reports the mode of the walk's dataset", () => {
  const r = call("stats-descriptive", { id: null, data: {} }, { data: [2, 4, 4, 4, 5, 5, 7, 9] });
  assert.equal(r.ok, true);
  assert.equal(r.result.mean, 5);
  assert.equal(r.result.median, 4.5);
  assert.equal(r.result.sd, 2.1381); // the sample SD, as ever — now labelled as such in the panel
  assert.equal(r.result.mode, 4);
});

test("S4: multimodal data reports every mode; no repeats, no mode field", () => {
  const multi = call("stats-descriptive", { id: null, data: {} }, { data: [1, 1, 2, 2, 3] });
  assert.deepEqual(multi.result.mode, [1, 2]);
  const none = call("stats-descriptive", { id: null, data: {} }, { data: [1, 2, 3, 4] });
  assert.equal(none.ok, true);
  assert.ok(!("mode" in none.result), "a modeless dataset must not gain an invented mode");
});

test("S3 (server half): chainOfCustody counts the chain's rows", () => {
  const chain = [
    { transferredTo: "tech A", receivedBy: "lab", date: "2026-10-31" },
    { transferredTo: "tech B", receivedBy: "tech A", date: "2026-10-31" },
  ];
  const r = call("chainOfCustody", { id: "s1", title: "Buffer", data: { chainOfCustody: chain } }, {});
  assert.equal(r.ok, true);
  assert.equal(r.result.transfers, 2);
  assert.equal(r.result.intact, true);
});
