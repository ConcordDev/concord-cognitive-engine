// server/tests/security-diff-check.test.js
//
// The §1.1 SECURITY-diff tripwire (scripts/check-security-diff.mjs):
// a PR whose server.js diff removes SECURITY lines must not reach
// review unread. Pins the literal semantics: removals from the target
// file block and are named; additions, context lines, other files'
// removals, and empty diffs pass; the CLI exits 1/0 accordingly.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { findSecurityRemovals, runCli } from "../../scripts/check-security-diff.mjs";

const REMOVAL_DIFF = `diff --git a/server/server.js b/server/server.js
index 111..222 100644
--- a/server/server.js
+++ b/server/server.js
@@ -100,7 +100,5 @@ function boot() {
 const keep = 1;
-// SECURITY: mandatory HMAC on federation receive
-  if (!ok) return refuse("SECURITY_HMAC_REQUIRED");
 const alsoKeep = 2;
+// SECURITY: added control
+  verifyEverything(req);
`;

const ADDITION_ONLY_DIFF = `diff --git a/server/server.js b/server/server.js
--- a/server/server.js
+++ b/server/server.js
@@ -1,3 +1,5 @@
 const a = 1;
+// SECURITY: new gate
+  requireAuth();
 const b = 2;
`;

const OTHER_FILE_DIFF = `diff --git a/server/lib/other.js b/server/lib/other.js
--- a/server/lib/other.js
+++ b/server/lib/other.js
@@ -1,3 +1,2 @@
-// SECURITY: not the guarded file
 const x = 1;
diff --git a/server/server.js b/server/server.js
--- a/server/server.js
+++ b/server/server.js
@@ -5,3 +5,3 @@
-const plain = "no keyword here";
+const plain = "changed";
 const y = 2;
`;

describe("security-diff tripwire (§1.1)", () => {
  it("names every SECURITY line the target file's diff removes", () => {
    const removals = findSecurityRemovals(REMOVAL_DIFF);
    assert.equal(removals.length, 2);
    assert.ok(removals[0].includes("mandatory HMAC"));
    assert.ok(removals[1].includes("SECURITY_HMAC_REQUIRED"));
  });

  it("additions and context mentions never block", () => {
    assert.deepEqual(findSecurityRemovals(ADDITION_ONLY_DIFF), []);
  });

  it("removals from other files are ignored", () => {
    assert.deepEqual(findSecurityRemovals(OTHER_FILE_DIFF), []);
  });

  it("an empty diff passes", () => {
    assert.deepEqual(findSecurityRemovals(""), []);
  });

  it("the CLI exits 1 on a blocking diff and 0 on a clean one (stdin)", () => {
    const script = new URL("../../scripts/check-security-diff.mjs", import.meta.url).pathname;
    let code = 0;
    try {
      execFileSync(process.execPath, [script], { input: REMOVAL_DIFF, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) { code = e.status; }
    assert.equal(code, 1);
    const out = execFileSync(process.execPath, [script], { input: ADDITION_ONLY_DIFF, encoding: "utf8" });
    assert.match(String(out), /no SECURITY lines removed/);
  });

  it("runCli returns the same verdicts in-process", () => {
    assert.equal(runCli([], { readStdin: () => REMOVAL_DIFF }), 1);
    assert.equal(runCli([], { readStdin: () => "" }), 0);
  });
});
