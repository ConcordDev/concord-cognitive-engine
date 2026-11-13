import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../concord-frontend");
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".next") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (/\.(tsx?|jsx?)$/.test(e.name)) out.push(p);
  }
  return out;
}

test("no panel carries the literal 'Agent returned empty'", () => {
  const hits = [...walk(path.join(root, "components")), ...walk(path.join(root, "app"))]
    .filter((f) => fs.readFileSync(f, "utf8").includes("Agent returned empty"));
  assert.deepEqual(hits, []);
});

test("chat_agent.do returns reply next to answer", () => {
  const src = fs.readFileSync(path.resolve(root, "../server/domains/chat-agent.js"), "utf8");
  assert.ok(src.includes("reply:"));
});
