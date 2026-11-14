// Behavior test for FIX-transfer-006: registering a connector from a
// malformed CSV was accepted silently (the lenient reader padded the
// garbage into "1 row and 2 fields"). Pins: ragged rows and an
// unterminated quote are rejected with a named reason and create NO
// connector; a well-formed CSV registers as before.
import { test } from "node:test";
import assert from "node:assert/strict";

process.chdir(new URL("../", import.meta.url).pathname);
globalThis._concordSTATE = {};
const registerTransferActions = (await import("../domains/transfer.js")).default;
const actions = new Map();
registerTransferActions((domain, action, handler) => actions.set(`${domain}:${action}`, handler));
const upsert = actions.get("transfer:connector-upsert");
const list = actions.get("transfer:connector-list");
const ctx = { actor: { userId: "user-a" } };

test("malformed CSV payloads are rejected and register nothing", async () => {
  const ragged = await upsert(ctx, null, { name: "bad-ragged", kind: "csv", payload: "id,name\n1,alpha,extra\n2,beta" });
  assert.equal(ragged.ok, false);
  assert.match(ragged.error, /row 2 has 3 field\(s\) but the header has 2/);
  const unclosed = await upsert(ctx, null, { name: "bad-quote", kind: "csv", payload: "id,name\n1,\"alpha\n2,beta" });
  assert.equal(unclosed.ok, false);
  assert.match(unclosed.error, /unterminated quoted field/);
  const after = await list(ctx, null, {});
  assert.equal(after.result.connectors.length, 0, "no connector created from bad input");
});

test("a well-formed CSV registers with its rows probed", async () => {
  const good = await upsert(ctx, null, { name: "good", kind: "csv", payload: "id,name\n1,alpha\n2,beta" });
  assert.equal(good.ok, true);
  assert.equal(good.result.connector.rowCount, 2);
  const after = await list(ctx, null, {});
  assert.equal(after.result.connectors.length, 1);
});
