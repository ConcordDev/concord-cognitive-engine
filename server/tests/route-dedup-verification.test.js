// Verification-audit fix — structural regression test for 7 duplicate
// Express route registrations in server.js (verification-audit campaign,
// duplicate-handler-race detector findings). Express appends a second
// handler for the same (method, path) rather than replacing the first —
// only the first-registered handler ever dispatches, so the second was
// always dead code (or, in 2 cases, the LIVE bug: the dead handler was
// actually the more-correct one). Each pair was resolved by either
// deleting the dead/incorrect duplicate or merging the two into one
// survivor. This test is a structural registration-count invariant: each
// route+method pair must appear exactly once, so a future accidental
// re-duplication fails loudly instead of silently reintroducing dead code.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_JS = path.resolve(__dirname, "..", "server.js");
const src = readFileSync(SERVER_JS, "utf8");

function countRegistrations(method, routePath) {
  // Match both single- and double-quoted route-string literals.
  const re = new RegExp(
    `app\\.${method}\\(\\s*["']${routePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`,
    "g"
  );
  return (src.match(re) || []).length;
}

const PAIRS = [
  ["get", "/api/artifact/:dtuId/thumbnail"],
  ["get", "/api/roguelite/catalog"],
  ["get", "/api/federation/status"],
  ["get", "/api/economic/wallet/:odId"],
  ["get", "/api/economic/marketplace"],
  ["get", "/api/economic/config"],
  ["get", "/api/artistry/marketplace/art"],
];

describe("server.js duplicate route registrations — resolved, each now registered exactly once", () => {
  for (const [method, routePath] of PAIRS) {
    it(`${method.toUpperCase()} ${routePath} is registered exactly once`, () => {
      assert.equal(countRegistrations(method, routePath), 1, `expected exactly 1 registration of ${method.toUpperCase()} ${routePath}`);
    });
  }
});
