// FIX-cognition-010 — the /dtu/<id> page dressed everyone, including
// the DTU's signed-in owner, in signed-out chrome: a Sign in / Join
// header, no Private label on a private DTU, and Fork as the only
// action — no owner controls, no delete. Access control itself was
// sound (the server refuses anonymous reads of private DTUs); the
// presentation never asked who was looking. The view now reads the
// session: signed-in viewers get a signed-in header, a private DTU
// carries a Private badge, and the owner gets an owner strip with a
// two-step delete against the standing DELETE /api/dtus/:id route
// (the server still enforces delete ownership).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const view = readFileSync(join(root, "concord-frontend", "app", "dtu", "[id]", "PublicDTUView.tsx"), "utf8");

test("the view learns who is looking", () => {
  assert.match(view, /import \{ useAuth \} from '@\/hooks\/useAuth'/);
  assert.match(view, /const isOwner = Boolean\(user\)/);
});

test("a private DTU is labelled Private", () => {
  assert.match(view, /dtu\.visibility === 'private' \|\| dtu\.meta\?\.scope === 'local'/);
  assert.match(view, /\{isPrivate && \(/);
});

test("the header stops offering Sign in to a signed-in viewer", () => {
  assert.match(view, /Signed in as \{user\.username\}/);
});

test("the owner gets a two-step delete against the standing route", () => {
  assert.match(view, /api\.delete\(`\/api\/dtus\/\$\{encodeURIComponent\(id\)\}`\)/);
  assert.match(view, /Delete this DTU permanently\?/);
});
