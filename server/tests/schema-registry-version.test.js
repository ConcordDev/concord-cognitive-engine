// FIX-schema-001 — pinning drive for the schema registry version chain.
//
// The audit recorded the editor toast announcing 'Saved new version
// v0.1.0 (patch bump)' while the Registry showed v1.0.1 for the same
// save. At branch state the chain is consistent by construction:
// registryCreate seeds 1.0.0, registrySaveVersion bumps from the last
// stored version, pushes that version, and returns it, and
// registryList's latestVersion reads versions[last] — the toast
// prints the returned version verbatim, so toast and Registry cannot
// diverge through this code. This drive pins that invariant end to
// end (the reported toast cannot be produced by any input here: a
// patch bump increments the third component, and 0.1.0 would require
// a minor bump off a 0.0.0 base that registryCreate never seeds).

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import registerSchemaActions from "../domains/schema.js";

const actions = new Map();
registerSchemaActions((domain, name, fn) => actions.set(`${domain}.${name}`, fn));

const ctx = { actor: { userId: "qa-user" } };
const artifact = { id: null, domain: "schema", type: "domain_action", data: {}, meta: {} };
const call = (name, input) => actions.get(`schema.${name}`)(ctx, artifact, input);

beforeEach(() => {
  globalThis._concordSTATE = {};
});

test("create → patch save → returned version equals the registry's latest at every step", () => {
  const created = call("registryCreate", {
    name: "qa5",
    schema: { fields: { title: { type: "string" } } },
    note: "initial version",
  });
  assert.equal(created.ok, true);
  assert.equal(created.result.version, "1.0.0");
  const id = created.result.id;

  // Field-identical save (note only) → patch bump.
  const patch = call("registrySaveVersion", {
    id,
    schema: { fields: { title: { type: "string" } } },
    note: "editor save",
  });
  assert.equal(patch.ok, true);
  assert.equal(patch.result.bump, "patch");
  assert.equal(patch.result.version, "1.0.1");

  const listAfterPatch = call("registryList", {});
  const rowAfterPatch = listAfterPatch.result.schemas.find((s) => s.id === id);
  assert.equal(rowAfterPatch.latestVersion, "1.0.1");
  assert.equal(rowAfterPatch.versionCount, 2);
  assert.deepEqual(rowAfterPatch.versionLabels, ["1.0.0", "1.0.1"]);

  // Additive save (new optional field) → minor bump, same invariant.
  const minor = call("registrySaveVersion", {
    id,
    schema: { fields: { title: { type: "string" }, tag: { type: "string" } } },
    note: "add tag",
  });
  assert.equal(minor.result.bump, "minor");
  assert.equal(minor.result.version, "1.1.0");
  const listAfterMinor = call("registryList", {});
  assert.equal(listAfterMinor.result.schemas.find((s) => s.id === id).latestVersion, "1.1.0");
});
