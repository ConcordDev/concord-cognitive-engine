// INC-SWEEP legacy F1 — prove shared export-dtu route (post lab/mentorship
// Buffer fix) works for the Legacy walk payload: 200 octet-stream, not 500
// Buffer.from(Object). Walk posted {"data":{},"title":"legacy export",...}.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import createUniversalExportRouter from "../routes/universal-export.js";
import { lensDataToDTU } from "../lib/universal-dtu-bridge.js";

const LEGACY_PAYLOAD = {};

describe("legacy F1 export-dtu (ALREADY-CLOSED shared route)", () => {
  it("lensDataToDTU returns a Buffer for a legacy object payload", () => {
    const r = lensDataToDTU("legacy", LEGACY_PAYLOAD, {
      title: "legacy export",
      tags: ["legacy", "export"],
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(Buffer.isBuffer(r.buffer));
    assert.ok(r.buffer.length > 48);
  });

  it("POST /api/lens/legacy/export-dtu returns 200 file body", async () => {
    const app = express();
    app.use(express.json({ limit: "2mb" }));
    app.use(createUniversalExportRouter({}, async () => ({}), () => ({})));

    const server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const { port } = server.address();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/lens/legacy/export-dtu`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          data: LEGACY_PAYLOAD,
          title: "legacy export",
          tags: ["legacy", "export"],
        }),
      });
      const buf = Buffer.from(await res.arrayBuffer());
      assert.equal(res.status, 200, `status ${res.status}: ${buf.toString("utf8").slice(0, 200)}`);
      assert.match(res.headers.get("content-type") || "", /octet-stream/);
      assert.ok(buf.length > 48);
      assert.ok(!buf.toString("utf8").includes("first argument must be of type string"));
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});
