// Real-app check for the render route: server.js mounts routes/studio.js at /api/studio BEFORE it
// registers durable.js, so the router's POST /:projectId/render is the handler that actually answers
// in production. It used to answer {ok:true,status:"complete"} with no output (live, 2026-11-01).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "studio-render-"));
process.env.DB_PATH = process.env.DB_PATH || path.join(tmp, "t.db");

import http from "node:http";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { load } from "./_harness.js";

let srv, base, token;
before(async () => {
  const t = await load();
  srv = await new Promise((r) => { const s = http.createServer(t.app); s.listen(0, "127.0.0.1", () => r(s)); });
  base = `http://127.0.0.1:${srv.address().port}`;
  const n = `rend_${crypto.randomBytes(3).toString("hex")}`;
  const reg = await fetch(`${base}/api/auth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: n, email: `${n}@test.invalid`, password: "TestPass123!", dateOfBirth: "1990-01-01" }) });
  token = (await reg.json()).token;
  assert.ok(token, "registered");
});
after(() => { srv?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const api = (p, body) => fetch(`${base}${p}`, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, ...(body ? { body: JSON.stringify(body) } : {}) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

describe("POST /api/studio/:projectId/render through the real app", () => {
  it("is honest: failed with audio_worker_unavailable, never complete, and the stored row agrees", async () => {
    const created = await api("/api/studio/projects", { name: "Real app song", type: "audio" });
    const projectId = created.body.project?.projectId || created.body.projectId || created.body.project?.project_id;
    assert.ok(projectId, JSON.stringify(created.body));
    const r = await api(`/api/studio/${projectId}/render`, { format: "wav" });
    assert.equal(r.body.ok, false, JSON.stringify(r.body));
    assert.equal(r.body.status, "failed");
    assert.match(r.body.error, /^audio_worker_unavailable/);
    const got = await api(`/api/studio/renders/${r.body.renderId}`);
    assert.equal(got.body.render.status, "failed");
    assert.equal(got.body.render.output_path, null);
  });
});
