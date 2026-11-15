// Slice B7 drive — FIX-expert-mode-002 update verbs (server/domains/expert-mode.js).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerExpertModeMacros from "../domains/expert-mode.js";

const actions = new Map();
registerExpertModeMacros((domain, name, fn) => actions.set(`${domain}:${name}`, fn));
async function call(name, input = {}, userId = "u1") {
  const fn = actions.get(`expert_mode:${name}`);
  assert.ok(fn, `missing action ${name}`);
  return fn({ actor: { userId } }, input);
}
beforeEach(() => { globalThis._concordSTATE = {}; });

test("space_update renames/re-describes the owner's space only; empty name refused", async () => {
  const created = await call("space_create", { name: "Old name", description: "d1" });
  assert.equal(created.ok, true);
  const id = created.space.id;

  const updated = await call("space_update", { spaceId: id, name: "New name", description: "d2" });
  assert.equal(updated.ok, true);
  assert.equal(updated.space.name, "New name");
  assert.equal(updated.space.description, "d2");

  const list = await call("space_list", {});
  assert.equal(list.spaces.find((s) => s.id === id).name, "New name");

  assert.equal((await call("space_update", { spaceId: id, name: " " })).reason, "missing_name");
  assert.equal((await call("space_update", { spaceId: id, name: "x" }, "u2")).ok, false);
});

test("upload_update renames the owner's document only; empty name refused", async () => {
  const up = await call("upload_source", { name: "report.pdf", text: "body text", kind: "text" });
  assert.equal(up.ok, true);
  const id = up.upload.id;

  const renamed = await call("upload_update", { uploadId: id, name: "report-v2.pdf" });
  assert.equal(renamed.ok, true);
  assert.equal(renamed.upload.name, "report-v2.pdf");

  const list = await call("upload_list", {});
  assert.equal(list.uploads.find((u) => u.id === id).name, "report-v2.pdf");

  assert.equal((await call("upload_update", { uploadId: id, name: "" })).reason, "missing_name");
  assert.equal((await call("upload_update", { uploadId: id, name: "x" }, "u2")).ok, false);
});
