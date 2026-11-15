// Behavior test for FIX-database-004: CSV import silently rewrote
// identifiers (spaces/hyphens to _) and silently typed a mixed
// numeric column as text. Pins: the import still succeeds, but every
// rename and the mixed-type coercion are named in result.warnings;
// a clean import carries no warnings.
import { test } from "node:test";
import assert from "node:assert/strict";

process.chdir(new URL("../", import.meta.url).pathname);
globalThis._concordSTATE = {};
const registerDatabaseActions = (await import("../domains/database.js")).default;
const actions = new Map();
registerDatabaseActions((domain, action, handler) => actions.set(`${domain}:${action}`, handler));
const ctx = { actor: { userId: "user-a" } };

const connRes = await actions.get("database:connection-create")(ctx, null, { name: "warehouse", engine: "in-memory", readOnly: false });
assert.equal(connRes.ok, true);
const connectionId = connRes.result.connection?.id || connRes.result.id;
assert.ok(connectionId, "connection created");
const importCsv = actions.get("database:dataset-import-csv");

test("renames and mixed-type coercion are warned, not silent", async () => {
  const out = await importCsv(ctx, null, {
    connectionId,
    name: "my table",
    csv: "unit price,qty\n10,5\n12,-3\n9,abc",
  });
  assert.equal(out.ok, true);
  assert.equal(out.result.imported, 3);
  const warnings = out.result.warnings || [];
  assert.ok(warnings.some((w) => w.includes('"unit price"') && w.includes('"unit_price"')), `header rename warned: ${warnings}`);
  assert.ok(warnings.some((w) => w.includes('"my table"') && w.includes('"my_table"')), `dataset rename warned: ${warnings}`);
  assert.ok(warnings.some((w) => w.includes('"qty"') && w.includes("text") && w.includes('"abc"')), `coercion warned: ${warnings}`);
});

test("a clean import carries no warnings", async () => {
  const out = await importCsv(ctx, null, {
    connectionId,
    name: "clean_table",
    csv: "sku,qty\nA1,5\nA2,7",
  });
  assert.equal(out.ok, true);
  assert.deepEqual(out.result.warnings, []);
});
