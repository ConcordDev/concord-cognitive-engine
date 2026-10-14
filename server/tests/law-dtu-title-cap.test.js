// INC-SWEEP law F2 — CourtListener Save-as-DTU titles can exceed the
// INPUT_LIMITS.title = 200 cap. Prefill clamps client-side; the raw API
// must still reject oversize titles with INPUT_TOO_LONG. A clamped 200-char
// title must create and read back by id.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

process.env.NODE_ENV = "test";
process.env.AUTH_MODE = "public";
process.env.CONCORD_NO_LISTEN = "true";
process.env.CONCORD_LOAD_SHED_ENABLED = "0";

const UA = "Mozilla/5.0 (compatible; ConcordLawDtuTitleCap/1.0)";
const OWNER = "law-f2-owner-" + Date.now().toString(36);

describe("law DTU title cap (F2)", { timeout: 180000 }, () => {
  let server;
  let port;
  let runMacro;
  let makeInternalCtx;

  before(async () => {
    const { load } = await import("./depth/_harness.js");
    const t = await load();
    runMacro = t.runMacro;
    makeInternalCtx = t.makeInternalCtx;
    server = http.createServer(t.app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = server.address().port;
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  function ctxFor(userId) {
    const ctx = makeInternalCtx(userId);
    ctx.actor = { userId, role: "member", scope: "local", scopes: ["*"] };
    ctx.userId = userId;
    ctx.internal = false;
    return ctx;
  }

  async function postDtus(body) {
    const res = await fetch(`http://127.0.0.1:${port}/api/dtus`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": UA,
      },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, body: json };
  }

  it("clamped 200-char title creates+reads back; oversize title is INPUT_TOO_LONG", async () => {
    // Prefill path: a title already at the cap succeeds and reads back by id.
    const title = "A".repeat(200);
    const created = await runMacro(
      "dtu",
      "create",
      {
        title,
        content: "CourtListener opinion body for F2 clamp path",
        tags: ["real-data", "courtlistener", "law"],
        source: "courtlistener",
        isGlobal: false,
      },
      ctxFor(OWNER),
    );
    assert.equal(created.ok, true, JSON.stringify(created));
    const id = created.dtu?.id || created.id || created.result?.id || created.result?.dtu?.id;
    assert.ok(id, `missing id: ${JSON.stringify(created)}`);

    const got = await runMacro("dtu", "get", { id }, ctxFor(OWNER));
    const dtu = got.dtu || got.result?.dtu || got.result || got;
    const readTitle = dtu.title || dtu.human?.title;
    assert.equal(readTitle, title, JSON.stringify(got));
    assert.equal(String(readTitle).length, 200);

    // Raw API rejection: middleware still returns INPUT_TOO_LONG for >200.
    const longTitle = "B".repeat(202);
    const res = await postDtus({
      title: longTitle,
      content: "x",
      tags: ["law"],
      source: "courtlistener",
    });
    assert.equal(res.status, 400, JSON.stringify(res));
    assert.equal(res.body.code, "INPUT_TOO_LONG");
    assert.match(String(res.body.error || ""), /too long/i);
    assert.ok(
      Array.isArray(res.body.violations) &&
        res.body.violations.some((v) => /title:.*max 200/i.test(v)),
      JSON.stringify(res.body),
    );
  });
});
