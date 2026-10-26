// CAD layouts become a millimetre GLB (1 unit = 1 mm) with one named node
// per part, and that GLB is the chat message's media artifact. A TRELLIS
// mesh is scaled only when the prompt states a size.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import Database from "better-sqlite3";
import { Document, NodeIO } from "@gltf-transform/core";
import { up } from "../migrations/193_chat_sessions.js";
import { persistChatTurn, hydrateSession } from "../lib/chat-session-store.js";
import { externalizeChatArtifact, GLB_MIME } from "../lib/chat/artifact-media.js";
import createMediaRouter from "../routes/media.js";
import { compileDesignIR } from "../lib/conkay/compiler/design-ir.js";
import { getMaterial } from "../lib/conkay/materials/index.js";
import { designIrParts, designIrToGlb, glbExtents, positionsBBox } from "../lib/conkay/cad-glb.js";
import { parseRequestedSize, applyRequestedScale } from "../lib/chat/mesh-scale.js";
import { generate3dFromPrompt } from "../lib/chat/generate-3d.js";
import { executeToolCall } from "../lib/chat-agent.js";
import { userFacingMeshReply } from "../lib/chat/tool-turn-reply.js";

const OWNER = "user-cad";
const PNG = "iVBORw0KGgo=";

function db() {
  const d = new Database(":memory:");
  up(d);
  return d;
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

function near(actual, expected, label) {
  const tol = Math.max(Math.abs(expected) * 0.01, 0.05);
  assert.ok(Math.abs(actual - expected) <= tol, `${label}: ${actual} vs ${expected} (tol ${tol})`);
}

function spans(positions) {
  const b = positionsBBox(positions);
  return [b.sx, b.sy, b.sz];
}

async function tinyGlb() {
  const doc = new Document();
  const buf = doc.createBuffer();
  const pos = doc.createAccessor().setType("VEC3").setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1])).setBuffer(buf);
  const idx = doc.createAccessor().setType("SCALAR").setArray(new Uint32Array([0, 1, 2, 0, 1, 3, 0, 2, 3, 1, 2, 3])).setBuffer(buf);
  const prim = doc.createPrimitive().setAttribute("POSITION", pos).setIndices(idx);
  const mesh = doc.createMesh().addPrimitive(prim);
  const node = doc.createNode().setMesh(mesh).setTranslation([0, 2, 0]);
  doc.createScene().addChild(node);
  return Buffer.from(await new NodeIO().writeBinary(doc));
}

describe("design IR tessellation", () => {
  test("a plate and a cylinder match their dimensions, and shell / cad-body are skipped", async () => {
    const compiled = compileDesignIR({
      nodes: [
        {
          id: "plate", kind: "Part", name: "plate", material: "aluminum-6061-t6",
          geometry: { shape: "plate", length: "200 mm", width: "100 mm", thickness: "10 mm" },
          position: { x: "1 m", y: 0, z: 0 },
        },
        {
          id: "pin", kind: "Part", name: "pin", material: "aluminum-6061-t6",
          geometry: { shape: "cylinder", diameter: "20 mm", length: "50 mm" },
          props: { axis: "y" },
          position: { x: 0, y: "100 mm", z: 0 },
        },
        { id: "skin", kind: "Part", name: "skin", geometry: { shape: "shell", area: "1 m2", thickness: "2 mm" } },
        { id: "body", kind: "Part", name: "body", geometry: { shape: "cad-body", thickness: "2 mm", skinOffset: "1 mm" } },
      ],
    });
    assert.equal(compiled.ok, true, JSON.stringify(compiled.errors));
    const { parts, skipped } = designIrParts(compiled);
    assert.deepEqual(skipped.map((s) => s.reason).sort(), ["kernel solid, not a primitive", "no unique solid"]);
    const plate = parts.find((p) => p.name === "plate");
    const pin = parts.find((p) => p.name === "pin");
    const [px, py, pz] = spans(plate.positions);
    near(px, 200, "plate x"); near(py, 100, "plate y"); near(pz, 10, "plate z");
    const [cx, cy, cz] = spans(pin.positions);
    near(cx, 20, "pin x"); near(cy, 50, "pin y"); near(cz, 20, "pin z");
    const density = getMaterial("aluminum-6061-t6").densityKgM3;
    near(plate.massKg, 0.2 * 0.1 * 0.01 * density, "plate mass");
    near(plate.massKg, 0.54, "plate mass kg");
    const built = await designIrToGlb(compiled);
    const doc = await new NodeIO().readBinary(new Uint8Array(built.glb));
    const nodes = doc.getRoot().listNodes();
    const plateNode = nodes.find((n) => n.getName() === "plate");
    assert.ok(plateNode, "plate node");
    assert.equal(plateNode.getExtras().materialId, "aluminum-6061-t6");
    near(plateNode.getExtras().massKg, 0.54, "glb mass");
    const scene = doc.getRoot().getDefaultScene();
    assert.equal(scene.getExtras().metersPerUnit, 0.001);
    assert.equal(scene.getExtras().units, "mm");
  });
});

describe("iron man and torso layouts", () => {
  test("iron man is 405×880×330 mm with 16 named parts, and the chat message stores the GLB", async () => {
    const r = await executeToolCall(
      { actor: { userId: OWNER }, userPrompt: "an iron man like robot" },
      async () => ({}),
      new Map(),
      { tool: "conkay_design", params: { text: "an iron man like robot" } },
    );
    assert.equal(r.ok, true);
    assert.equal(r.artifact.partRanges.length, 16);
    assert.deepEqual(r.artifact.bbox_mm, { length: 405, height: 880, width: 330 });
    assert.equal(r.artifact.units, "mm");
    assert.equal(r.artifact.geometryUnits, "m");
    assert.equal(r.artifact.engineering.massKg, null);
    const covered = new Array(r.artifact.indices.length).fill(false);
    for (const range of r.artifact.partRanges) {
      assert.ok(range.i1 > range.i0, range.name);
      for (let i = range.i0; i < range.i1; i++) {
        assert.equal(covered[i], false, `${range.name} overlaps at ${i}`);
        covered[i] = true;
      }
    }
    assert.ok(covered.every(Boolean), "every index belongs to one part");
    const state = { dtus: new Map(), sessions: new Map() };
    const d = db();
    try {
      const record = await externalizeChatArtifact(r.artifact, { ownerId: OWNER, state });
      assert.match(record.url, /^\/api\/media\/media-[^/]+\/stream$/);
      assert.equal(record.mimeType, GLB_MIME);
      assert.equal(record.positions, undefined);
      assert.equal(record.units, "mm");
      assert.deepEqual(record.bbox_mm, { length: 405, height: 880, width: 330 });
      assert.equal(record.partRanges.length, 16);
      persistChatTurn(d, "cad-session", {
        ownerId: OWNER,
        userMsg: { role: "user", content: "an iron man like robot", ts: 1 },
        assistantMsg: { role: "assistant", content: "Here is the model.", ts: 2, meta: { artifacts: [record] } },
      });
      assert.equal(hydrateSession(d, state, "cad-session", { ownerId: OWNER }), true);
      const app = express();
      app.use((req, _res, next) => { req.user = { id: OWNER }; next(); });
      app.use("/api/media", createMediaRouter({ STATE: state }));
      const server = await listen(app);
      try {
        const port = server.address().port;
        const res = await fetch(`http://127.0.0.1:${port}${record.url}`);
        const body = Buffer.from(await res.arrayBuffer());
        assert.equal(res.headers.get("content-type"), GLB_MIME);
        assert.equal(body.subarray(0, 4).toString("ascii"), "glTF");
        const ext = await glbExtents(body);
        assert.equal(ext.names.length, 16);
        assert.ok(ext.names.some((n) => /torso/.test(n)), ext.names.join(","));
        assert.ok(ext.names.some((n) => /leg/.test(n)), ext.names.join(","));
        near(ext.size[0], 405, "glb length");
        near(ext.size[1], 880, "glb height");
        near(ext.size[2], 330, "glb width");
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    } finally {
      cleanup(state);
      d.close();
    }
  });

  test("a torso ask is 236×440×340 mm and only the three torso parts", async () => {
    const r = await executeToolCall(
      { actor: { userId: OWNER }, userPrompt: "Make a 3D CAD model of a simple Mark-9 Iron Man style robot torso" },
      async () => ({}),
      new Map(),
      { tool: "conkay_design", params: { text: "Make a 3D CAD model of a simple Mark-9 Iron Man style robot torso", scope: "torso" } },
    );
    assert.deepEqual(r.result.parts.map((p) => p.name), ["torso waist", "torso chest", "chest plate"]);
    assert.deepEqual(r.artifact.bbox_mm, { length: 236, height: 440, width: 340 });
    assert.equal(r.artifact.partRanges.length, 3);
    assert.equal(r.artifact.units, "mm");
  });
});

describe("requested TRELLIS size", () => {
  test("parses a size and ignores words that are not a unit", () => {
    assert.deepEqual(parseRequestedSize("a 30 cm dragon statue"), [{ mm: 300, axis: null, raw: "30 cm" }]);
    const tall = parseRequestedSize("a 2 m tall robot");
    assert.equal(tall[0].mm, 2000);
    assert.equal(tall[0].axis, "y");
    assert.deepEqual(parseRequestedSize("2 model"), []);
    assert.deepEqual(parseRequestedSize("a small owl"), []);
    assert.deepEqual(parseRequestedSize("3D"), []);
  });

  test("scales the longest side, a named axis, or leaves a unitless mesh alone", () => {
    const mesh = { positions: [0, 0, 0, 2, 0, 0, 0, 1, 0], indices: [0, 1, 2], triangleCount: 1 };
    const longest = applyRequestedScale(mesh, "30 cm");
    assert.equal(longest.units, "mm");
    assert.equal(longest.bbox_mm.length, 300);
    assert.match(longest.scaleNote, /longest side is 300 mm/);
    const tall = applyRequestedScale(mesh, "2 m tall");
    assert.equal(tall.bbox_mm.height, 2000);
    assert.equal(tall.geometryUnits, "mm");
    const both = applyRequestedScale(mesh, "30 cm tall and 10 cm wide");
    assert.equal(both.bbox_mm.height, 300);
    assert.match(both.scaleNote, /was not set independently/);
    const plain = applyRequestedScale(mesh, "a small owl");
    assert.equal(plain.units, "unitless");
    assert.equal(plain.bbox_mm, null);
    assert.equal(plain.scaleNote, "unitless (not to scale)");
    assert.deepEqual(plain.mesh.positions, mesh.positions);
    const flat = { positions: [0, 0, 0, 0, 1, 0, 0, 0, 1], indices: [0, 1, 2] };
    const missed = applyRequestedScale(flat, "2 m long");
    assert.equal(missed.units, "unitless");
    assert.equal(missed.bbox_mm, null);
    assert.match(missed.scaleNote, /no span/);
    assert.deepEqual(missed.mesh.positions, flat.positions);
  });

  test("generate_3d keeps an unsized owl and scales a 30 cm statue", async () => {
    const glb = await tinyGlb();
    const fetchImpl = async (url) => {
      const body = String(url).endsWith("/concept")
        ? { ok: true, png_b64: PNG }
        : { ok: true, glb_b64: glb.toString("base64"), provider: "local-gpu:TRELLIS", faces: 4 };
      return { json: async () => body };
    };
    const owl = await generate3dFromPrompt("a small owl", { fetchImpl });
    assert.equal(owl.ok, true);
    assert.equal(owl.units, "unitless");
    assert.equal(owl.bbox_mm, null);
    assert.equal(Math.max(...owl.mesh.positions.filter((_, i) => i % 3 === 1)), 3);
    const dragon = await generate3dFromPrompt("a 30 cm dragon statue", { fetchImpl });
    assert.equal(dragon.geometryUnits, "mm");
    assert.equal(dragon.units, "mm");
    const spans3 = [dragon.bbox_mm.length, dragon.bbox_mm.height, dragon.bbox_mm.width];
    assert.equal(Math.max(...spans3), 300);
    assert.ok(spans3.every((n) => n <= 300.001));
  });

  test("an i-beam reply without a layout bbox stays the exact shown-below sentence", () => {
    const hit = { artifact: { meshKind: "i-beam", units: "mm", geometryUnits: "m", extents_mm: { x: 10, y: 20, z: 2000 } }, result: { part: "i-beam" } };
    assert.equal(userFacingMeshReply(hit), "The 3D model is shown below.");
  });
});
