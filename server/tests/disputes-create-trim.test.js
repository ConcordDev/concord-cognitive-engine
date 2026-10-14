// F3 — POST /api/disputes/create trims statement/transactionId and rejects
// whitespace-only filings (400, no row). Normal filing still 201.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import createDisputeRouter from "../routes/disputes.js";

function mockDb() {
  const disputes = [];
  const metadata = [];
  return {
    disputes,
    metadata,
    prepare(sql) {
      const s = String(sql);
      if (s.includes("FROM economy_ledger")) {
        return { get() { return null; } };
      }
      if (s.includes("INSERT INTO disputes") || s.includes("INSERT INTO disputes (")) {
        return {
          run(...args) {
            disputes.push({
              id: args[0],
              dispute_type: args[1],
              reporter_id: args[2],
              description: args[5],
            });
          },
        };
      }
      // openDispute uses a specific INSERT shape — also catch via legal-liability
      if (s.includes("INSERT INTO disputes")) {
        return {
          run(...args) {
            disputes.push({ id: args[0], dispute_type: args[1], reporter_id: args[2], description: args[5] });
          },
        };
      }
      if (s.includes("INSERT OR IGNORE INTO dispute_metadata")) {
        return {
          run(...args) {
            metadata.push({
              dispute_id: args[0],
              transaction_id: args[1],
              original_type: args[2],
            });
          },
        };
      }
      if (s.includes("FROM disputes")) {
        return {
          get(id) { return disputes.find((d) => d.id === id) || null; },
          all() { return disputes.slice(); },
        };
      }
      if (s.includes("FROM dispute_metadata")) {
        return {
          get(id) { return metadata.find((m) => m.dispute_id === id) || null; },
        };
      }
      // openDispute INSERT
      if (s.includes("INSERT INTO disputes")) {
        return { run() {} };
      }
      return {
        run() {},
        get() { return null; },
        all() { return []; },
      };
    },
  };
}

function makeApp(db) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: "user_buyer", role: "member" };
    next();
  });
  app.use("/api/disputes", createDisputeRouter({
    db,
    requireAuth: () => (_req, _res, next) => next(),
    adminOnly: (_req, res) => res.status(403).json({ ok: false, error: "forbidden" }),
  }));
  return app;
}

async function post(app, body) {
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/disputes/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    return { status: res.status, json };
  } finally {
    await new Promise((r) => server.close(r));
  }
}

describe("disputes F3 create trim", () => {
  let db;
  let app;
  beforeEach(() => {
    db = mockDb();
    // Patch prepare so openDispute's INSERT actually records rows.
    const realPrepare = db.prepare.bind(db);
    db.prepare = (sql) => {
      const s = String(sql);
      if (s.includes("INSERT INTO disputes")) {
        return {
          run(id, disputeType, reporterId, reportedContentId, reportedUserId, description, evidenceJson, openedAt) {
            db.disputes.push({
              id,
              dispute_type: disputeType,
              reporter_id: reporterId,
              reported_content_id: reportedContentId,
              reported_user_id: reportedUserId,
              description,
              evidence_json: evidenceJson,
              status: "open",
              opened_at: openedAt,
            });
          },
        };
      }
      return realPrepare(sql);
    };
    app = makeApp(db);
  });

  it("whitespace-only statement/transactionId -> 400 and nothing listed", async () => {
    const r = await post(app, {
      transactionId: "   ",
      type: "not_as_described",
      statement: "   ",
    });
    assert.equal(r.status, 400);
    assert.equal(r.json.ok, false);
    assert.equal(db.disputes.length, 0);
    assert.equal(db.metadata.length, 0);
  });

  it("normal filing still 201 with trimmed fields stored", async () => {
    const r = await post(app, {
      transactionId: "  tx_real_1  ",
      type: "non_delivery",
      statement: "  Package never arrived.  ",
    });
    assert.equal(r.status, 201);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.transactionId, "tx_real_1");
    assert.equal(r.json.type, "non_delivery");
    assert.equal(db.disputes.length, 1);
    assert.equal(db.disputes[0].description, "Package never arrived.");
    assert.equal(db.metadata.length, 1);
    assert.equal(db.metadata[0].transaction_id, "tx_real_1");
  });
});
