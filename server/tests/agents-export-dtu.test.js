// INC-SWEEP agents F9 — prove shared export-dtu route (post lab/mentorship/legacy
// Buffer fix) works for the Agents walk payload: 200 octet-stream, not 500
// Buffer.from(Object). Walk posted an object `data` from DTUExportButton.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import createUniversalExportRouter from "../routes/universal-export.js";
import { lensDataToDTU } from "../lib/universal-dtu-bridge.js";

const AGENTS_PAYLOAD = {
  id: "lart_agents_export_probe",
  title: "Agent export probe",
  type: "agent",
  data: { tools: ["classify"], enabled: false },
};

describe("agents F9 export-dtu (ALREADY-CLOSED shared route)", () => {
  it("lensDataToDTU returns a Buffer for an agents object payload", () => {
    const r = lensDataToDTU("agents", AGENTS_PAYLOAD, {
      title: "agents export",
      tags: ["agents", "export"],
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(Buffer.isBuffer(r.buffer));
    assert.ok(r.buffer.length > 48);
  });

  it("POST /api/lens/agents/export-dtu returns 200 file body", async () => {
    const app = express();
    app.use(express.json({ limit: "2mb" }));
    app.use(createUniversalExportRouter({}, async () => ({}), () => ({})));

    const server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const { port } = server.address();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/lens/agents/export-dtu`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          data: AGENTS_PAYLOAD,
          title: "agents export",
          tags: ["agents", "export"],
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
