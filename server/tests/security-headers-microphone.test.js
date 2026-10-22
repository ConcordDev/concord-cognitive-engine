// server/tests/security-headers-microphone.test.js
//
// Studio recording needs getUserMedia({audio}). A Permissions-Policy of
// `microphone=()` disables it outright (NotAllowedError, no prompt), so the
// server must allow same-origin microphone use.

import test from "node:test";
import assert from "node:assert/strict";
import securityHeaders from "../middleware/security-headers.js";

test("security headers allow same-origin microphone for Studio recording", () => {
  const headers = {};
  const res = { setHeader: (k, v) => { headers[k.toLowerCase()] = v; }, removeHeader: () => {} };
  let nextCalled = false;
  securityHeaders({ headers: {}, path: "/" }, res, () => { nextCalled = true; });
  assert.ok(nextCalled);
  const pp = headers["permissions-policy"];
  assert.match(pp, /microphone=\(self\)/);
  assert.doesNotMatch(pp, /microphone=\(\)/);
  assert.match(pp, /xr-spatial-tracking=\(self\)/);
});
