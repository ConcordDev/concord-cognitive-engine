// Persona legacy gate — security regression tests (HANDOFF-SEC-2 Fix 9).
//
// Pins the fix for: the canonical persona.* macros (STATE.customPersonas,
// aliased to personas.*) had no ownership at all — create stored no
// owner, list returned every user's personas INCLUDING systemPrompt to
// any caller, update/delete let any member rewrite or delete any user's
// persona — and PUT /api/personas/:id mutated the global agent persona
// roster with no auth check in the handler.
//
// Two layers:
//   1. Unit tests for the helpers in lib/persona-legacy-gate.js.
//   2. Source assertions on server.js: each guard sits inside its
//      handler (so the personas.* alias inherits it), create stamps
//      ownerId, list filters, get strips systemPrompt for non-owners,
//      and the roster PUT checks the role before the roster lookup
//      and before the first persona assignment.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  personaActor,
  personaCreateDenial,
  personaModifyDenial,
  personaListVisible,
  personaPromptVisible,
  personaRosterPutDenial,
} from "../lib/persona-legacy-gate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_JS = readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

const ALICE = { actor: { userId: "alice", role: "member" } };
const BOB = { actor: { userId: "bob", role: "member" } };
const ADMIN = { actor: { userId: "root", role: "admin" } };
const FOUNDER_VIA_ROLES = { actor: { userId: "f", role: "member", roles: ["founder"] } };
const ANON = { actor: { userId: "anon" } };
const NO_ACTOR = {};
const INTERNAL = { internal: true, actor: { userId: "anon" } };

const ALICES = { id: "p1", ownerId: "alice" };
const LEGACY = { id: "p0" }; // no ownerId — pre-fix record

const AUTH_REQUIRED = { ok: false, status: 401, code: "AUTH_REQUIRED", error: "sign in required" };

describe("persona-legacy-gate — create", () => {
  it("allows a signed-in user and internal callers; refuses anon 401", () => {
    assert.equal(personaCreateDenial(ALICE), null);
    assert.equal(personaCreateDenial(INTERNAL), null);
    assert.deepEqual(personaCreateDenial(ANON), AUTH_REQUIRED);
    assert.deepEqual(personaCreateDenial(NO_ACTOR), AUTH_REQUIRED);
  });
});

describe("persona-legacy-gate — modify (update/delete)", () => {
  it("allows the owner, admins (role or roles[]), and internal callers", () => {
    assert.equal(personaModifyDenial(ALICE, ALICES), null);
    assert.equal(personaModifyDenial(ADMIN, ALICES), null);
    assert.equal(personaModifyDenial(FOUNDER_VIA_ROLES, ALICES), null);
    assert.equal(personaModifyDenial(INTERNAL, ALICES), null);
  });

  it("refuses another member 403 with the ownership message", () => {
    assert.deepEqual(personaModifyDenial(BOB, ALICES), {
      ok: false, status: 403, code: "FORBIDDEN",
      error: "forbidden: persona belongs to another user",
    });
  });

  it("legacy ownerless personas are admin-only", () => {
    assert.deepEqual(personaModifyDenial(ALICE, LEGACY), {
      ok: false, status: 403, code: "FORBIDDEN",
      error: "forbidden: admin role required",
    });
    assert.equal(personaModifyDenial(ADMIN, LEGACY), null);
  });

  it("anon gets 401 after the allow checks", () => {
    assert.deepEqual(personaModifyDenial(ANON, ALICES), AUTH_REQUIRED);
  });

  it("denials are fresh objects", () => {
    const first = personaModifyDenial(BOB, ALICES);
    first.error = "tampered";
    assert.equal(personaModifyDenial(BOB, ALICES).error, "forbidden: persona belongs to another user");
  });
});

describe("persona-legacy-gate — list/get visibility", () => {
  it("members see only their own custom personas in list", () => {
    assert.equal(personaListVisible(ALICE, ALICES), true);
    assert.equal(personaListVisible(BOB, ALICES), false);
    assert.equal(personaListVisible(ANON, ALICES), false);
    assert.equal(personaListVisible(ALICE, LEGACY), false); // legacy: admin-only
  });

  it("admins and internal callers see all in list", () => {
    assert.equal(personaListVisible(ADMIN, ALICES), true);
    assert.equal(personaListVisible(INTERNAL, LEGACY), true);
  });

  it("systemPrompt is visible only to the owner, admins, internal", () => {
    assert.equal(personaPromptVisible(ALICE, ALICES), true);
    assert.equal(personaPromptVisible(BOB, ALICES), false);
    assert.equal(personaPromptVisible(ADMIN, ALICES), true);
    assert.equal(personaPromptVisible(INTERNAL, ALICES), true);
    assert.equal(personaPromptVisible(ALICE, LEGACY), false);
  });
});

describe("persona-legacy-gate — roster PUT", () => {
  it("admin-class only; member 403; anon 401", () => {
    assert.equal(personaRosterPutDenial(ADMIN), null);
    assert.equal(personaRosterPutDenial(FOUNDER_VIA_ROLES), null);
    assert.equal(personaRosterPutDenial(INTERNAL), null);
    assert.deepEqual(personaRosterPutDenial(ALICE), {
      ok: false, status: 403, code: "FORBIDDEN",
      error: "forbidden: admin role required",
    });
    assert.deepEqual(personaRosterPutDenial(ANON), AUTH_REQUIRED);
  });

  it("personaActor resolves userId/admin/internal", () => {
    assert.deepEqual(personaActor(ALICE), { userId: "alice", isAdmin: false, internal: false });
    assert.deepEqual(personaActor(INTERNAL), { userId: null, isAdmin: false, internal: true });
  });
});

describe("persona-legacy-gate — server.js wiring (source assertions)", () => {
  function handlerBody(registerLine, nextRegisterAfter) {
    const start = SERVER_JS.indexOf(registerLine);
    assert.ok(start > 0, `found: ${registerLine}`);
    const end = SERVER_JS.indexOf(nextRegisterAfter, start + 1);
    assert.ok(end > start, `found end after: ${registerLine}`);
    return SERVER_JS.slice(start, end);
  }

  it("server.js imports the gate helpers", () => {
    assert.ok(SERVER_JS.includes('from "./lib/persona-legacy-gate.js"'), "import present");
  });

  it("create: denial precedes construction and ownerId is stamped from ctx", () => {
    const body = handlerBody('register("persona", "create"', 'register("persona", "list"');
    assert.ok(body.indexOf("personaCreateDenial(ctx)") < body.indexOf("STATE.customPersonas.set"), "gate before the store write");
    assert.ok(body.includes("ownerId: ctx?.actor?.userId || ctx?.actor?.id || null"), "ownerId stamped");
  });

  it("list: results are filtered through personaListVisible", () => {
    const body = handlerBody('register("persona", "list"', 'register("persona", "update"');
    assert.ok(body.includes(".filter((p) => personaListVisible(ctx, p))"), "list filter wired");
  });

  it("update: denial sits after the existence check and before the first field assignment", () => {
    const body = handlerBody('register("persona", "update"', 'register("persona", "delete"');
    const notFoundAt = body.indexOf('"Persona not found"');
    const gateAt = body.indexOf("personaModifyDenial(ctx, persona)");
    const assignAt = body.indexOf("persona.name =");
    assert.ok(notFoundAt > 0 && gateAt > notFoundAt, "404 first, then the gate");
    assert.ok(assignAt > gateAt, "gate before any mutation");
  });

  it("delete: denial sits after the existence check and before the delete", () => {
    const start = SERVER_JS.indexOf('register("persona", "delete"');
    const body = SERVER_JS.slice(start, start + 1200);
    const notFoundAt = body.indexOf('"Persona not found"');
    const gateAt = body.indexOf("personaModifyDenial(ctx, persona)");
    const deleteAt = body.indexOf("STATE.customPersonas.delete");
    assert.ok(notFoundAt > 0 && gateAt > notFoundAt, "404 first, then the gate");
    assert.ok(deleteAt > gateAt, "gate before the delete");
  });

  it("get: systemPrompt is stripped when the caller may not see it", () => {
    const body = handlerBody('register("personas", "get"', 'register("personas", "stats"');
    assert.ok(body.includes("personaPromptVisible(ctx, p)"), "prompt visibility checked");
    assert.ok(body.includes("systemPrompt: _omitted"), "prompt omitted from the returned copy");
  });

  it("PUT /api/personas/:id: role check precedes the roster lookup and the first assignment", () => {
    const start = SERVER_JS.indexOf('app.put("/api/personas/:id"');
    assert.ok(start > 0, "route found");
    const body = SERVER_JS.slice(start, start + 1600);
    const gateAt = body.indexOf("personaRosterPutDenial(makeCtx(req))");
    const lookupAt = body.indexOf("STATE.personas.find");
    const assignAt = body.indexOf("persona.customInstructions =");
    assert.ok(gateAt > 0, "gate called with a request ctx");
    assert.ok(lookupAt > gateAt, "gate before the roster lookup");
    assert.ok(assignAt > gateAt, "gate before the first persona assignment");
  });
});
