// server/tests/learning-rebuild.test.js
//
// Sprint 5 — Education lens rebuild. 20 endpoints + migration 232.
// We test the route layer directly via Express stubs.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import express from "express";
import createLearningRebuildRoutes from "../routes/learning-rebuild.js";

let db, app, STATE;

before(async () => {
  db = new Database(":memory:");
  const m = await import("../migrations/232_learning_rebuild.js");
  m.up(db);
  // Minimal dtus table for the search endpoint
  db.exec(`CREATE TABLE IF NOT EXISTS dtus (id TEXT PRIMARY KEY, kind TEXT, title TEXT, creator_id TEXT, created_at INTEGER DEFAULT (unixepoch()))`);
  STATE = { db };
  const requireAuth = () => (req, _res, next) => {
    req.user = { id: req.headers["x-test-user"] || "u_test" };
    next();
  };
  app = express();
  app.use(express.json());
  app.use("/api/learning", createLearningRebuildRoutes({ STATE, requireAuth }));
});
after(() => { try { db.close(); } catch { /* ok */ } });

async function jsonReq(method, path, body, userId = "u_test") {
  const { default: request } = await import("node:http").then(() => null).catch(() => ({ default: null }));
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      const http = require("node:http");
      const opts = {
        port, host: "127.0.0.1", path, method,
        headers: { "content-type": "application/json", "x-test-user": userId },
      };
      const req = http.request(opts, (res) => {
        let data = "";
        res.on("data", (c) => data += c);
        res.on("end", () => {
          server.close();
          try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode, body: data }); }
        });
      });
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  });
}

// Simpler approach: directly call route handlers via supertest-style mock
function mockReq(method, body = {}, query = {}, userId = "u_test") {
  return {
    method, body, query,
    user: { id: userId },
    headers: { "x-test-user": userId },
  };
}
function mockRes() {
  const res = { _status: 200, _json: null };
  res.status = (s) => { res._status = s; return res; };
  res.json = (j) => { res._json = j; return res; };
  return res;
}

// Helper: walk the router stack and invoke the right handler
async function call(method, path, body = {}, query = {}, userId = "u_test") {
  const router = createLearningRebuildRoutes({ STATE, requireAuth: () => (req, _res, next) => { req.user = { id: userId }; next(); } });
  return new Promise((resolve) => {
    const req = mockReq(method, body, query, userId);
    req.path = path;
    req.url = path;
    const res = mockRes();
    res.end = () => resolve({ status: res._status, body: res._json });
    router.handle({ ...req, originalUrl: path, baseUrl: "" }, res, () => resolve({ status: 404, body: null }));
    // Fallback: if handler set _json synchronously, resolve
    setImmediate(() => resolve({ status: res._status, body: res._json }));
  });
}

// ─── Assessments ─────────────────────────────────────────────────

describe("Education rebuild — assessments", () => {
  it("POST /assessment/generate creates an assessment", async () => {
    const r = await call("POST", "/assessment/generate", {
      title: "Algebra 101", topic: "math",
      questions: [{ q: "1+1?", correct: 2, points: 10 }],
    });
    assert.equal(r.body?.ok, true);
    assert.ok(r.body.id);
    assert.equal(r.body.totalPoints, 10);
  });

  it("POST /submit auto-grades when answers match", async () => {
    const gen = await call("POST", "/assessment/generate", {
      title: "Quiz A", topic: "math",
      questions: [
        { q: "1+1?", correct: "2", points: 10 },
        { q: "2+2?", correct: "4", points: 10 },
      ],
    });
    const sub = await call("POST", "/submit", { assessmentId: gen.body.id, answers: { 0: "2", 1: "4" } });
    assert.equal(sub.body.ok, true);
    assert.equal(sub.body.autoGraded, true);
    assert.equal(sub.body.autoScore, 100);
  });

  it("POST /submit on free-form questions doesn't auto-grade", async () => {
    const gen = await call("POST", "/assessment/generate", {
      title: "Essay", topic: "english",
      questions: [{ q: "Discuss freedom.", points: 100 }],  // no correct
    });
    const sub = await call("POST", "/submit", { assessmentId: gen.body.id, answers: { 0: "freedom is..." } });
    assert.equal(sub.body.autoGraded, false);
  });

  it("POST /assessment/grade clamps score 0-100 + sets letter", async () => {
    const gen = await call("POST", "/assessment/generate", {
      title: "Manual", topic: "x",
      questions: [{ q: "?", points: 100 }],
    });
    const sub = await call("POST", "/submit", { assessmentId: gen.body.id, answers: { 0: "a" } });
    const grade = await call("POST", "/assessment/grade", { submissionId: sub.body.id, score: 150 });
    assert.equal(grade.body.score, 100);
    assert.equal(grade.body.letter, "A");
  });

  it("GET /submissions/mine lists my submissions", async () => {
    const r = await call("GET", "/submissions/mine");
    assert.equal(r.body.ok, true);
    assert.ok(Array.isArray(r.body.submissions));
  });
});

// ─── Cohorts ────────────────────────────────────────────────────

describe("Education rebuild — cohorts", () => {
  it("POST /cohort/form creates peer cohort + adds creator as member", async () => {
    const r = await call("POST", "/cohort/form", { name: "Study Squad", topic: "physics" });
    assert.equal(r.body.ok, true);
    assert.ok(r.body.id);
    // Verify member row
    const member = db.prepare(`SELECT role FROM learning_cohort_members WHERE cohort_id = ? AND user_id = ?`).get(r.body.id, "u_test");
    assert.equal(member.role, "student");
  });

  it("POST /cohort/teach creates teacher-led cohort + earns 1.0", async () => {
    const r = await call("POST", "/cohort/teach", { name: "Algebra Masterclass", topic: "math", maxSize: 30 });
    assert.equal(r.body.ok, true);
    const member = db.prepare(`SELECT role FROM learning_cohort_members WHERE cohort_id = ? AND user_id = ?`).get(r.body.id, "u_test");
    assert.equal(member.role, "teacher");
    const earn = db.prepare(`SELECT amount FROM learning_earnings WHERE ref_id = ? AND source = 'cohort_teach'`).get(r.body.id);
    assert.equal(earn.amount, 1.0);
  });

  it("GET /cohort/match returns public open cohorts filtered by topic", async () => {
    const r = await call("GET", "/cohort/match", null, { topic: "physics" });
    assert.equal(r.body.ok, true);
    assert.ok(r.body.cohorts.find((c) => c.topic === "physics"));
  });

  it("GET /cohort/mine returns my memberships", async () => {
    const r = await call("GET", "/cohort/mine");
    assert.equal(r.body.ok, true);
    assert.ok(r.body.cohorts.length >= 2);
  });
});

// ─── Rates + leaderboard + earnings ─────────────────────────────

describe("Education rebuild — economy", () => {
  it("GET /rates returns hardcoded rate card", async () => {
    const r = await call("GET", "/rates");
    assert.equal(r.body.ok, true);
    assert.equal(r.body.rates.tutor_session.amount, 0.25);
    assert.equal(r.body.rates.cohort_teach.amount, 1.0);
  });

  it("GET /earnings/me returns my earnings + total + byKind", async () => {
    const r = await call("GET", "/earnings/me");
    assert.equal(r.body.ok, true);
    assert.ok(typeof r.body.total === "number");
    assert.ok(r.body.byKind);
  });

  it("GET /leaderboard returns top earners", async () => {
    const r = await call("GET", "/leaderboard");
    assert.equal(r.body.ok, true);
    assert.ok(r.body.leaderboard.find((l) => l.user_id === "u_test"));
  });

  it("GET /credential/me returns my credentials list", async () => {
    db.prepare(`INSERT INTO learning_credentials (id, user_id, kind, title, topic, issued_by) VALUES (?, ?, ?, ?, ?, ?)`)
      .run("cred:1", "u_test", "badge", "First Submission", "math", "system");
    const r = await call("GET", "/credential/me");
    assert.equal(r.body.ok, true);
    assert.ok(r.body.credentials.find((c) => c.title === "First Submission"));
  });
});

// ─── Knowledge + tutor ──────────────────────────────────────────

describe("Education rebuild — tutor + frontier + genome", () => {
  it("POST /tutor/ask creates session + deterministic reply", async () => {
    const r = await call("POST", "/tutor/ask", { topic: "calculus", message: "What is a derivative?" });
    assert.equal(r.body.ok, true);
    assert.ok(r.body.sessionId);
    assert.equal(r.body.messages.length, 2);
    assert.equal(r.body.messages[0].role, "user");
    assert.equal(r.body.messages[1].role, "assistant");
  });

  it("POST /tutor/socratic returns a question back", async () => {
    const r = await call("POST", "/tutor/socratic", { topic: "ethics", message: "Stealing is wrong." });
    assert.equal(r.body.ok, true);
    assert.ok(r.body.reply.includes("?"));
  });

  it("POST /interaction logs valid kind", async () => {
    const r = await call("POST", "/interaction", { kind: "dtu_view", subjectId: "dtu:abc" });
    assert.equal(r.body.ok, true);
    const row = db.prepare(`SELECT kind FROM learning_interactions WHERE subject_id = ?`).get("dtu:abc");
    assert.equal(row.kind, "dtu_view");
  });

  it("POST /interaction rejects invalid kind", async () => {
    const r = await call("POST", "/interaction", { kind: "INVALID", subjectId: "x" });
    assert.equal(r.body.ok, false);
  });

  it("GET /genome returns aggregate stats", async () => {
    const r = await call("GET", "/genome");
    assert.equal(r.body.ok, true);
    assert.ok(typeof r.body.genome.submissions === "number");
  });

  it("GET /frontier returns unmastered topics", async () => {
    const r = await call("GET", "/frontier");
    assert.equal(r.body.ok, true);
    assert.ok(Array.isArray(r.body.frontier));
  });

  it("GET /genome/graph returns nodes + edges", async () => {
    const r = await call("GET", "/genome/graph");
    assert.equal(r.body.ok, true);
    assert.ok(Array.isArray(r.body.nodes));
    assert.ok(Array.isArray(r.body.edges));
  });

  it("GET /dtus/search returns matching DTUs", async () => {
    db.prepare(`INSERT INTO dtus (id, kind, title, creator_id) VALUES (?, ?, ?, ?)`).run("dtu:calc1", "doc", "Calculus Intro", "u_author");
    const r = await call("GET", "/dtus/search", null, { q: "calculus" });
    assert.equal(r.body.ok, true);
    assert.ok(r.body.results.find((d) => d.id === "dtu:calc1"));
  });

  it("GET /dtus/search rejects too-short query", async () => {
    const r = await call("GET", "/dtus/search", null, { q: "a" });
    assert.equal(r.body.reason, "query_too_short");
  });

  it("GET /path lists paths filtered by topic", async () => {
    db.prepare(`INSERT INTO learning_paths (id, title, topic, level, author_user_id, visibility) VALUES (?, ?, ?, ?, ?, ?)`)
      .run("path:1", "Calc 1", "calculus", "beginner", "u_author", "public");
    const r = await call("GET", "/path", null, { topic: "calculus" });
    assert.equal(r.body.ok, true);
    assert.ok(r.body.paths.find((p) => p.id === "path:1"));
  });
});
