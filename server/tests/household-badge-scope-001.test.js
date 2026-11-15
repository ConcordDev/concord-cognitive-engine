// FIX-household-001 — the depth badge on Household must not describe
// the member's own records as an "open-access dataset". The manifest
// tier (REAL_FREE) covers the lens's reference content; the member's
// household records are private per-account data. The household
// override in useDepthBadge names both halves.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const hook = readFileSync(join(root, "concord-frontend", "hooks", "useDepthBadge.ts"), "utf8");

test("the household badge override scopes the caption to reference content and private records", () => {
  const i = hook.indexOf("household: {");
  assert.ok(i >= 0, "household override present in LENS_DEPTH_OVERRIDE");
  const block = hook.slice(i, i + 600);
  assert.match(block, /Reference content/, "caption names what the open data actually is");
  assert.match(block, /yours alone, saved privately on your account/, "caption states the member's own records are private");
});
