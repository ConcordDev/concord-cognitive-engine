// server/lib/chat/generate-3d.js
//
// generate_3d chat tool: a free-form 3D model from a text prompt on Concord's
// own GPU pod (engines/concord-gen-pod: FLUX concept → TRELLIS mesh, reached
// over the CONCORD_GEN_URL tunnel). Cockpit audit 2026-10-19: "generate a 3d
// model" was answered with a flat FLUX picture because chat had no 3D tool.
//
// The GLB the pod returns is decimated and flattened into the same
// positions/indices "mesh" artifact conkay_design produces, so the chat
// renders it in 3D with no frontend change. The concept image rides along.
// Honest failures only: pod down, mesh engine broken, timeout. Never a
// placeholder mesh.

import { NodeIO } from "@gltf-transform/core";
import { MeshoptSimplifier } from "meshoptimizer";

const GEN_URL = () => (process.env.CONCORD_GEN_URL || "http://127.0.0.1:7870").replace(/\/$/, "");
const CONCEPT_FRAMING = "a single object, product shot, plain white background, centered, full object visible, no text,";
export const MESH_TIMEOUT_MS = Number(process.env.CONCORD_GEN3D_TIMEOUT_MS || 150_000);
const MAX_TRIS = 5_000;

async function postJson(route, body, timeoutMs, fetchImpl) {
  try {
    const r = await fetchImpl(`${GEN_URL()}${route}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
    });
    return await r.json();
  } catch (err) {
    return { ok: false, reason: err?.name === "TimeoutError" ? "timeout" : "local_gpu_unreachable", error: String(err?.message || err) };
  }
}

/** Every triangle in the GLB, world transforms applied, as flat arrays. */
export async function glbToTriangles(glbBuffer) {
  const io = new NodeIO();
  const doc = await io.readBinary(new Uint8Array(glbBuffer));
  const positions = [];
  const indices = [];
  const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];
  const visit = (node) => {
    const mesh = node.getMesh();
    if (mesh) {
      const M = node.getWorldMatrix();
      for (const prim of mesh.listPrimitives()) {
        if (prim.getMode() !== 4) continue; // TRIANGLES only
        const pos = prim.getAttribute("POSITION");
        if (!pos) continue;
        const base = positions.length / 3;
        const v = [0, 0, 0];
        for (let i = 0; i < pos.getCount(); i++) {
          pos.getElement(i, v);
          positions.push(
            M[0] * v[0] + M[4] * v[1] + M[8] * v[2] + M[12],
            M[1] * v[0] + M[5] * v[1] + M[9] * v[2] + M[13],
            M[2] * v[0] + M[6] * v[1] + M[10] * v[2] + M[14],
          );
        }
        const idx = prim.getIndices();
        if (idx) for (let i = 0; i < idx.getCount(); i++) indices.push(base + idx.getScalar(i));
        else for (let i = 0; i < pos.getCount(); i++) indices.push(base + i);
      }
    }
    for (const child of node.listChildren()) visit(child);
  };
  if (scene) for (const n of scene.listChildren()) visit(n);
  return { positions, indices };
}

/** Decimate to ≤ maxTris and drop unused vertices; unit-agnostic. */
export async function decimateMesh({ positions, indices }, maxTris = MAX_TRIS) {
  let idx = Uint32Array.from(indices);
  const pos = Float32Array.from(positions);
  if (idx.length / 3 > maxTris) {
    await MeshoptSimplifier.ready;
    const target = Math.floor(maxTris) * 3;
    const [out] = MeshoptSimplifier.simplify(idx, pos, 3, target, 0.05, ["LockBorder"]);
    idx = out.length >= 3 ? out : idx;
    if (idx.length / 3 > maxTris) {
      const [sloppy] = MeshoptSimplifier.simplifySloppy(idx, pos, 3, null, target, 0.2);
      if (sloppy.length >= 3) idx = sloppy;
    }
  }
  const remap = new Map();
  const outPos = [];
  const outIdx = [];
  for (const i of idx) {
    let j = remap.get(i);
    if (j === undefined) {
      j = outPos.length / 3;
      remap.set(i, j);
      outPos.push(Math.round(pos[i * 3] * 1e4) / 1e4, Math.round(pos[i * 3 + 1] * 1e4) / 1e4, Math.round(pos[i * 3 + 2] * 1e4) / 1e4);
    }
    outIdx.push(j);
  }
  return { positions: outPos, indices: outIdx, vertexCount: outPos.length / 3, triangleCount: outIdx.length / 3 };
}

/**
 * @returns {Promise<{ok:true, mesh, conceptB64, seconds, provider} | {ok:false, error, reason, stage}>}
 */
export async function generate3dFromPrompt(prompt, { fetchImpl = fetch, seed = 0, maxTris = MAX_TRIS } = {}) {
  const clean = String(prompt || "").trim().slice(0, 600);
  if (!clean) return { ok: false, stage: "input", reason: "empty_prompt", error: "generate_3d requires a prompt" };
  const t0 = Date.now();
  const concept = await postJson("/concept", { prompt: `${CONCEPT_FRAMING} ${clean}`, seed, width: 512, height: 512 }, 120_000, fetchImpl);
  if (!concept?.ok || !concept.png_b64) {
    return { ok: false, stage: "concept", reason: concept?.reason || "concept_failed", error: `3D generation is unavailable: the GPU pod could not make the concept image (${concept?.reason || concept?.error || "no image"})` };
  }
  const mesh = await postJson("/mesh", { image_b64: concept.png_b64, seed }, MESH_TIMEOUT_MS, fetchImpl);
  if (!mesh?.ok || !mesh.glb_b64) {
    const why = String(mesh?.error || mesh?.reason || "no mesh").slice(0, 200);
    return { ok: false, stage: "mesh", reason: mesh?.reason || "mesh_failed", conceptB64: concept.png_b64,
      error: `3D mesh generation is unavailable on the GPU pod right now (${why})` };
  }
  let tri;
  try {
    tri = await decimateMesh(await glbToTriangles(Buffer.from(mesh.glb_b64, "base64")), maxTris);
  } catch (err) {
    return { ok: false, stage: "convert", reason: "glb_parse_failed", error: `the pod returned a 3D file Concord could not read (${String(err?.message || err).slice(0, 160)})` };
  }
  if (tri.triangleCount < 4) return { ok: false, stage: "convert", reason: "empty_mesh", error: "the pod returned an empty 3D mesh" };
  return { ok: true, mesh: tri, conceptB64: concept.png_b64, provider: mesh.provider || "local-gpu:TRELLIS", faces: mesh.faces, seconds: Math.round((Date.now() - t0) / 1000) };
}
