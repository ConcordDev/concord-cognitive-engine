// FIX-science-006 — the artifact title rides at the artifact level, next
// to `data`, but requiredFields rules name "title" as a field of the
// record — so creating a science Equipment record (title supplied, data
// holds model/serial/…) warned `Recommended field "title" is missing`
// on every save. artifactDataWithTitle fills the title into the
// validation view of the data; these tests pin the helper + the warning.
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateArtifact, artifactDataWithTitle } from "../lib/domain-logic.js";

test("a create that supplies a title no longer warns it is missing", () => {
  const data = artifactDataWithTitle({ model: "Thermal cycler", serialNumber: "TC-9" }, "Lab cycler");
  const v = validateArtifact("science", "Equipment", data, { status: "planned" });
  assert.equal(v.ok, true);
  assert.ok(!v.warnings.some((w) => w.includes('"title"')), `warnings: ${v.warnings.join(" | ")}`);
});

test("control: without the title fill the same create still warns", () => {
  const v = validateArtifact("science", "Equipment", { model: "Thermal cycler" }, { status: "planned" });
  assert.ok(v.warnings.some((w) => w.includes('"title"') && w.includes("science/Equipment")));
});

test("a title already inside the data is never overridden", () => {
  const data = artifactDataWithTitle({ title: "Data title" }, "Artifact title");
  assert.equal(data.title, "Data title");
});

test("a blank title fills nothing and the warning still fires", () => {
  const data = artifactDataWithTitle({ model: "Thermal cycler" }, "   ");
  assert.equal("title" in data, false);
  const v = validateArtifact("science", "Equipment", data, { status: "planned" });
  assert.ok(v.warnings.some((w) => w.includes('"title"')));
});

test("non-object data degrades to an empty record the title can fill", () => {
  assert.deepEqual(artifactDataWithTitle(null, "T"), { title: "T" });
  assert.deepEqual(artifactDataWithTitle(undefined, ""), {});
});
