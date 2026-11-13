process.env.EMBEDDINGS_ENABLED = "false";
import test from "node:test";
import assert from "node:assert/strict";
import { pickTools } from "../../lib/inference/tool-picker.js";

test("pickTools returns tools again (dead imports repaired)", async () => {
  const tools = await pickTools("search the web", ["agent"], 5);
  assert.ok(Array.isArray(tools));
  assert.ok(tools.length > 0);
  assert.ok(tools.length <= 5);
});
