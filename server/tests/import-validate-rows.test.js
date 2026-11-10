import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import registerImport from "../domains/importdomain.js";

const actions = new Map();
function register(domain, name, fn) { actions.set(`${domain}.${name}`, fn); }
function call(name, params) {
  return actions.get(`import.${name}`)({ actor: { userId: "ada" }, userId: "ada" }, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerImport(register); });

describe("import validateImport reads the posted rows", () => {
  it("validates a CSV-shaped row passed as params, not only artifact.data", () => {
    const rows = [{ title: "Slope notes", content: "A 2 inch drain." }];
    const schema = call("inferSchema", { rows });
    assert.equal(schema.ok, true);
    const fields = {};
    for (const field of schema.result.fields) fields[field.source] = { type: field.inferredType, required: field.required };
    const checked = call("validateImport", { rows, schema: fields });
    assert.equal(checked.ok, true);
    assert.equal(checked.result.totalRows, 1);
    assert.equal(checked.result.status, "pass");
    assert.equal(checked.result.validRows, 1);
  });

  it("still validates a JSON array of two records as two rows", () => {
    const rows = [{ title: "A", content: "one" }, { title: "B", content: "two" }];
    const checked = call("validateImport", { rows, schema: { title: { type: "string" }, content: { type: "string" } } });
    assert.equal(checked.result.totalRows, 2);
    assert.equal(checked.result.status, "pass");
  });
});
