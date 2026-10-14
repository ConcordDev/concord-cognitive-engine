// INC-SWEEP research F8 — anonymous GET /api/dtus/:id of a private DTU is
// 401 AUTH_REQUIRED (same as lens macros). Other-user still 404; no content.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import registerDtuRoutes from "../routes/dtus.js";

describe("anon private DTU GET status (F8)", () => {
  let app;
  let STATE;
  const OWNER = "owner-f8-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const OTHER = "other-f8-aaaaaaaa-bbbb-4ccc-8ddd-ffffffffffff";
  const PRIVATE_ID = "dtu_f8_private_marker";
  const MISSING_ID = "dtu_f8_does_not_exist";

  before(() => {
    STATE = {
      dtus: new Map([
        [
          PRIVATE_ID,
          {
            id: PRIVATE_ID,
            title: "Secret research note",
            content: "body must not leak",
            tags: ["rsch-f8-secret"],
            ownerId: OWNER,
            visibility: "private",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      ]),
    };

    app = express();
    app.use(express.json());
    // Stash actor from test header so makeCtx can build anon vs authed.
    app.use((req, _res, next) => {
      const uid = req.get("x-test-user");
      req.user = uid ? { id: uid, role: "member" } : null;
      next();
    });

    registerDtuRoutes(app, {
      STATE,
      makeCtx(req) {
        const uid = req.user?.id || null;
        return {
          actor: uid
            ? { userId: uid, id: uid, role: "member" }
            : { userId: "anon", role: "anon" },
          db: null,
          internal: false,
        };
      },
      async runMacro(_domain, name, input, ctx) {
        if (name !== "get") return { ok: false, error: "unexpected" };
        const dtu = STATE.dtus.get(input.id);
        if (!dtu) return { ok: false, error: "DTU not found" };
        const viewer = ctx.actor?.id || (ctx.actor?.userId !== "anon" ? ctx.actor?.userId : null);
        if (dtu.visibility === "private" && dtu.ownerId !== viewer) {
          return { ok: false, error: "DTU not found" };
        }
        return { ok: true, dtu };
      },
      dtuForClient: (d) => d,
      dtusArray: () => [...STATE.dtus.values()],
      userVisibleDTUs: () => [...STATE.dtus.values()],
      _withAck: (fn) => fn,
      _saveStateDebounced: () => {},
      validate: () => (_req, _res, next) => next(),
      requireRole: () => (_req, _res, next) => next(),
    });
  });

  async function get(id, userId = null) {
    const server = app.listen(0);
    const { port } = server.address();
    try {
      const headers = {};
      if (userId) headers["x-test-user"] = userId;
      const res = await fetch(`http://127.0.0.1:${port}/api/dtus/${id}`, { headers });
      const body = await res.json();
      return { status: res.status, body };
    } finally {
      await new Promise((r) => server.close(r));
    }
  }

  it("anonymous GET of private DTU is 401 AUTH_REQUIRED without content", async () => {
    const { status, body } = await get(PRIVATE_ID, null);
    assert.equal(status, 401);
    assert.equal(body.ok, false);
    assert.equal(body.code, "AUTH_REQUIRED");
    assert.match(String(body.error), /login required/i);
    assert.ok(!JSON.stringify(body).includes("rsch-f8-secret"));
    assert.ok(!JSON.stringify(body).includes("body must not leak"));
  });

  it("other authenticated user still gets 404 (isolation)", async () => {
    const { status, body } = await get(PRIVATE_ID, OTHER);
    assert.equal(status, 404);
    assert.equal(body.error, "DTU not found");
    assert.ok(!JSON.stringify(body).includes("body must not leak"));
  });

  it("owner can read; missing id is 404 for anon too", async () => {
    const own = await get(PRIVATE_ID, OWNER);
    assert.equal(own.status, 200);
    assert.equal(own.body.ok, true);
    assert.equal(own.body.dtu.id, PRIVATE_ID);

    const missing = await get(MISSING_ID, null);
    assert.equal(missing.status, 404);
  });
});
