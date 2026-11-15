// FIX-affect-001 pin — a private mood check-in must not move the shared
// affect state. Source-level pins (the routes live in the server.js
// monolith, which this suite does not boot): the session for a write is
// resolved by the route handlers themselves, so their resolution IS
// the behaviour — a body-supplied session id is only ever a REQUEST,
// granted when it names the caller's own middleware session (or the
// caller is an operator) and refused with 403 otherwise.
//
// Mechanism pinned: the ATS middleware keys sessions per authenticated
// user (`user_<id>`, "prevents shared mood across users"); before the
// fix the /api/affect/event and /api/affect/reset routes read the
// session from the body first, and the affect lens's session context
// defaulted to the literal 'default', so every member's check-in
// emitted into the one shared session. (The branch's landed shape —
// the atsWriteSession gate — is stricter than this seat's first local
// fix, which only re-ordered the resolution; the pin follows the
// landed contract.)
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const serverJs = readFileSync(join(here, "..", "server.js"), "utf8");
const ctxTsx = readFileSync(join(here, "..", "..", "concord-frontend", "components", "affect", "AffectSessionContext.tsx"), "utf8");
const stripTsx = readFileSync(join(here, "..", "..", "concord-frontend", "components", "affect", "AffectStateStrip.tsx"), "utf8");

function routeBody(marker) {
  const start = serverJs.indexOf(marker);
  assert.ok(start >= 0, `route not found: ${marker}`);
  return serverJs.slice(start, start + 1400);
}

describe("FIX-affect-001: write routes gate the session through atsWriteSession", () => {
  it("the gate grants a requested session only when it is the caller's own or the caller is an operator", () => {
    const start = serverJs.indexOf("function atsWriteSession(");
    assert.ok(start >= 0, "atsWriteSession gate present");
    const helper = serverJs.slice(start, start + 600);
    assert.match(helper, /req\._atsSessionId/, "the gate resolves the caller's own middleware session");
    assert.match(helper, /target === own \|\| isOperator \? target : null/, "a foreign target resolves to null (refused), never to the shared session");
  });

  it("POST /api/affect/event passes the body session id as a request to the gate and 403s a refusal", () => {
    const body = routeBody('app.post("/api/affect/event"');
    assert.match(body, /atsWriteSession\(req, req\.body\?\.source\?\.sessionId \|\| req\.body\?\.sessionId\)/);
    assert.match(body, /if \(!sessionId\) return res\.status\(403\)/);
  });

  it("POST /api/affect/reset passes the body session id as a request to the gate and 403s a refusal", () => {
    const body = routeBody('app.post("/api/affect/reset"');
    assert.match(body, /atsWriteSession\(req, req\.body\?\.sessionId\)/);
    assert.match(body, /if \(!sessionId\) return res\.status\(403\)/);
  });

  it("the middleware still keys sessions per authenticated user", () => {
    assert.match(serverJs, /sessionId = `user_\$\{req\.user\.id\}`/);
  });

  it("the affect session context no longer defaults to the shared 'default' bucket", () => {
    assert.doesNotMatch(ctxTsx, /useState\('default'\)/);
    assert.match(ctxTsx, /useState\(''\)/);
  });

  it("clearing the session field in the strip returns to the caller's own session, not 'default'", () => {
    assert.doesNotMatch(stripTsx, /draft\.trim\(\) \|\| 'default'/);
    assert.match(stripTsx, /setSessionId\(draft\.trim\(\)\)/);
  });
});
