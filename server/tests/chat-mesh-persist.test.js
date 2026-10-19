// A TRELLIS mesh is far larger than the 60 KB chat_messages artifact cap.
// The GLB is stored as private media; the message keeps a stream URL.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import Database from "better-sqlite3";
import { up } from "../migrations/193_chat_sessions.js";
import { persistChatTurn, hydrateSession } from "../lib/chat-session-store.js";
import { externalizeChatArtifacts, externalizeChatArtifact, GLB_MIME } from "../lib/chat/artifact-media.js";
import createMediaRouter from "../routes/media.js";

const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const OWNER = "user-mesh";

function db() {
  const d = new Database(":memory:");
  up(d);
  return d;
}

function bigMesh(tris = 4000) {
  const positions = [];
  const indices = [];
  for (let i = 0; i < tris; i++) {
    const b = positions.length / 3;
    positions.push(i, 0, 0, i + 0.5, 1, 0, i, 0.2, 1);
    indices.push(b, b + 1, b + 2);
  }
  return {
    kind: "mesh",
    source: "generate_3d",
    title: "dragon statue (3D)",
    meshKind: "generated",
    color: "#a3a3a3",
    positions,
    indices,
    vertexCount: positions.length / 3,
    triangleCount: tris,
  };
}

function cleanup(state) {
  const medias = state?._media?.mediaDTUs;
  if (!medias) return;
  const roots = new Set();
  for (const dtu of medias.values()) {
    const ref = dtu.storageRef?.artifactRef;
    if (!ref?.diskPath) continue;
    roots.add(path.dirname(ref.diskPath));
    fs.rmSync(ref.diskPath, { force: true });
    if (ref.compressedPath) fs.rmSync(ref.compressedPath, { force: true });
  }
  for (const root of roots) {
    let names = [];
    try { names = fs.readdirSync(root); } catch { continue; }
    for (const name of names) {
      if (name.startsWith(`chat-model-${OWNER}-`) || name.startsWith(`chat-image-${OWNER}-`)) {
        fs.rmSync(path.join(root, name), { recursive: true, force: true });
      }
    }
  }
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

test("a large GLB artifact round-trips as a media URL and the stream serves model/gltf-binary", async () => {
  const mesh = bigMesh();
  assert.ok(JSON.stringify(mesh).length > 60_000, "fixture must exceed the session cap");
  const state = { dtus: new Map(), sessions: new Map() };
  const d = db();
  let saved;
  try {
    const [record] = await externalizeChatArtifacts([mesh], { ownerId: OWNER, state });
    assert.ok(record, "externalize returns a record");
    assert.match(record.url, /^\/api\/media\/media-[^/]+\/stream$/);
    assert.equal(record.mimeType, GLB_MIME);
    assert.equal(record.kind, "mesh");
    assert.equal(record.triangleCount, 4000);
    assert.equal(record.vertexCount, 12000);
    assert.equal(record.title, mesh.title);
    assert.equal(record.positions, undefined);
    assert.equal(record.indices, undefined);
    assert.equal(record.glb_b64, undefined);
    assert.ok(JSON.stringify(record).length < 60_000);

    persistChatTurn(d, "mesh-session", {
      ownerId: OWNER,
      userMsg: { role: "user", content: "generate a 3d model of a dragon statue", ts: 1 },
      assistantMsg: { role: "assistant", content: "Here is the model.", ts: 2, meta: { artifacts: [record] } },
    });
    const row = d.prepare("SELECT meta_json FROM chat_messages WHERE role='assistant'").get();
    saved = JSON.parse(row.meta_json).artifacts[0];
    assert.equal(saved.url, record.url);
    assert.equal(saved.mimeType, GLB_MIME);
    assert.equal(saved.triangleCount, 4000);
    assert.equal(saved.positions, undefined);

    assert.equal(hydrateSession(d, state, "mesh-session", { ownerId: OWNER }), true);
    const mem = state.sessions.get("mesh-session").messages.find((m) => m.role === "assistant");
    assert.equal(mem.meta.artifacts[0].url, record.url);
    assert.equal(mem.meta.artifacts[0].positions, undefined);

    const app = express();
    app.use((req, _res, next) => { req.user = { id: OWNER }; next(); });
    app.use("/api/media", createMediaRouter({ STATE: state }));
    const server = await listen(app);
    try {
      const port = server.address().port;
      const res = await fetch(`http://127.0.0.1:${port}${record.url}`);
      const body = Buffer.from(await res.arrayBuffer());
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-type"), GLB_MIME);
      assert.equal(body.subarray(0, 4).toString("ascii"), "glTF");
      assert.ok(body.length > 12);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  } finally {
    cleanup(state);
    d.close();
  }
});

test("a large real image becomes a media URL; a fake data URL is not stored", async () => {
  const state = { dtus: new Map() };
  try {
    const png = { kind: "image", title: "sunset", prompt: "x".repeat(70_000), image_b64: PNG_B64 };
    assert.ok(JSON.stringify(png).length >= 60_000);
    const stored = await externalizeChatArtifact(png, { ownerId: OWNER, state });
    assert.match(stored.url, /^\/api\/media\/media-[^/]+\/stream$/);
    assert.equal(stored.mimeType, "image/png");
    assert.equal(stored.image_b64, undefined);
    assert.ok(JSON.stringify(stored).length < 60_000);

    const before = state._media.mediaDTUs.size;
    const fake = { kind: "image", url: "data:image/png;base64," + "A".repeat(70_000) };
    assert.equal(await externalizeChatArtifact(fake, { ownerId: OWNER, state }), null);
    assert.equal(state._media.mediaDTUs.size, before);

    const song = { kind: "song", projectId: "p1", title: "T", song: { notes: [1, 2, 3] } };
    assert.deepEqual(await externalizeChatArtifact(song, { ownerId: OWNER, state }), song);
  } finally {
    cleanup(state);
  }
});

test("the agent message keeps the slim artifacts, not an empty meta", () => {
  const src = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
  const agent = src.slice(src.indexOf("const _agentMeta = {"), src.indexOf("const _agentMeta = {") + 700);
  assert.match(agent, /artifacts: _agentArtifacts/);
  assert.match(src, /sess\.messages\.push\(\{ role: "assistant", content: _agentReply, ts: nowISO\(\), meta: _agentMeta \}\)/);
  assert.match(src, /externalizeChatArtifacts\(_agentOut\.artifacts/);
  assert.match(src, /externalizeChatArtifacts\(_turnArtifacts/);
});
