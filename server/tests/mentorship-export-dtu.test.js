// F3 — POST /api/lens/mentorship/export-dtu must return a binary .dtu body
// for a real tools/program payload (not 500 on Buffer.from(Object)).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import createUniversalExportRouter from "../routes/universal-export.js";
import { lensDataToDTU } from "../lib/universal-dtu-bridge.js";

const TOOLS_PAYLOAD = {
  matchScore: 83,
  skillOverlap: 2,
  compatibility: "excellent",
  progressTrack: { completionRate: 67, totalHours: 3, momentum: "building" },
  feedbackSummary: { avgRating: 4, clarity: 2, pace: 1 },
  developmentPlan: { timelineWeeks: 26 },
};

describe("mentorship F3 export-dtu", () => {
  it("lensDataToDTU returns a real Buffer for a tools payload", () => {
    const r = lensDataToDTU("mentorship", TOOLS_PAYLOAD, {
      title: "mentorship export",
      tags: ["mentorship", "export"],
    });
    assert.equal(r.ok, true);
    assert.ok(Buffer.isBuffer(r.buffer));
    assert.ok(r.buffer.length > 48);
  });

  it("POST /api/lens/mentorship/export-dtu returns 200 file body", async () => {
    const app = express();
    app.use(express.json({ limit: "2mb" }));
    app.use(createUniversalExportRouter({}, async () => ({}), () => ({})));

    const server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const { port } = server.address();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/lens/mentorship/export-dtu`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          data: TOOLS_PAYLOAD,
          title: "mentorship export",
          tags: ["mentorship", "export"],
        }),
      });
      const buf = Buffer.from(await res.arrayBuffer());
      assert.equal(res.status, 200, `status ${res.status}: ${buf.toString("utf8").slice(0, 200)}`);
      assert.match(res.headers.get("content-type") || "", /octet-stream/);
      assert.ok(buf.length > 48);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});
