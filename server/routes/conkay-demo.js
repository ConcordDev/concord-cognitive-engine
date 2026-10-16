// No-login ConKay demo (punch list item 2): a visitor without an account can
// size an I-beam and run the real beam-frame FEA on it. These routes only
// compute — nothing is saved, no sim job is recorded, no DTU is created.
// Saving a study, keeping it as a DTU and talking to ConKay stay behind
// sign-in on the full workspace (/lenses/conkay).
//
// GET-only on purpose: the production write-auth gate already exempts GET,
// so the only public entry is the authMiddleware bypass for
// /api/conkay/demo/* in server.js. Per-IP rate limit: read.conkay-demo.

import express from "express";
import { listBeamMaterials, solveBeamStudy, solveBeamSweep } from "../domains/engineering.js";
import { listSnapshots, loadSnapshot, loadSnapshotFile } from "../lib/conkay/showcase/index.js";
import { attestReceipt, ensureSigningKey } from "../lib/receipts/attest.js";
import { hydrateAssembly } from "../lib/conkay/assembly/build.js";
import { presentGlbFromStl } from "../lib/conkay/assembly/present-glb.js";
import { subscribeLive, eventsAfter, loadLiveRunFile } from "../lib/conkay/chat/live.js";

/** Hydrated showcase designs, keyed by the cached snapshot object. */
const hydratedDesigns = new WeakMap();
/** Presentation GLB per source STL sha256 (derived, deterministic). */
const presentGlbBySha = new Map();
/** Signed body per snapshot revision. The car is about 5 MB; canonicalizing it on every request costs ~0.4 s. */
const signedByRevision = new Map();

const DIM_KEYS = ["length", "height", "flangeWidth", "flangeThickness", "webThickness"];

function studyInput(q) {
  const dims = {};
  for (const k of DIM_KEYS) dims[k] = Number(q[k]);
  return {
    dims,
    loadN: Number(q.loadN),
    support: typeof q.support === "string" ? q.support : undefined,
    material: typeof q.material === "string" ? q.material : undefined,
  };
}

export default function createConkayDemoRouter({ rateLimit }) {
  const router = express.Router();
  const limit = rateLimit || ((_req, _res, next) => next());

  router.get("/materials", limit, (_req, res) => {
    const materials = listBeamMaterials().map((m) => ({
      id: m.id, label: m.label, category: m.category, E: m.E, yield: m.yield, density: m.density,
    }));
    res.json({ ok: true, materials });
  });

  router.get("/beam", limit, (req, res) => {
    try {
      const solved = solveBeamStudy(studyInput(req.query));
      if (!solved.ok) return res.status(400).json({ ok: false, error: solved.error });
      res.json({ ok: true, saved: false, result: solved.result });
    } catch (e) {
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  router.get("/sweep", limit, (req, res) => {
    try {
      const values = String(req.query.values || "").split(",").filter(Boolean);
      const sweep = solveBeamSweep({ ...studyInput(req.query), param: req.query.param, values });
      if (!sweep.ok) return res.status(400).json({ ok: false, error: sweep.error });
      const { param, elapsedMs, material, rows, lightestPassing } = sweep;
      res.json({ ok: true, saved: false, result: { param, elapsedMs, material, rows, lightestPassing } });
    } catch (e) {
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  // ConKay results page (lib/conkay/showcase): precomputed snapshots of the
  // showcase designs, read from disk. Nothing is solved here; a file is served
  // only if the snapshot lists it and its hash still matches.
  router.get("/designs", limit, async (_req, res) => {
    try {
      res.json({ ok: true, designs: await listSnapshots() });
    } catch (e) {
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  router.get("/designs/:id", limit, async (req, res) => {
    try {
      const snap = await loadSnapshot(String(req.params.id));
      if (!snap) return res.status(404).json({ ok: false, error: "no such showcase design" });
      // The car snapshot stores the loft spec, not the mesh; build the mesh
      // once per cached snapshot rather than on every request.
      let design = hydratedDesigns.get(snap);
      if (!design) {
        design = snap.assembly?.surface?.spec && !snap.assembly.surface.mesh?.positions
          ? { ...snap, assembly: hydrateAssembly(snap.assembly) }
          : snap;
        hydratedDesigns.set(snap, design);
      }
      // A file-backed signing key is read off the request path. Inline keys
      // resolve inside this await with no disk access.
      await ensureSigningKey();
      // Sign once per design revision. issuedAt belongs to that attestation,
      // not to the clock of each HTTP request. The on-disk snapshot is unchanged.
      const rev = typeof design.snapshotSha256 === "string" ? design.snapshotSha256 : null;
      let signed = rev ? signedByRevision.get(rev) : null;
      if (!signed) {
        signed = attestReceipt(design);
        if (rev) signedByRevision.set(rev, signed);
      }
      res.json({ ok: true, design: signed });
    } catch (e) {
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  // Presentation GLB of a design's analysed solid: the snapshot's own body
  // STL (hash-checked by loadSnapshotFile), welded, with normals and the
  // studio clearcoat material. Derived on first request, cached by STL hash.
  router.get("/designs/:id/present.glb", limit, async (req, res) => {
    try {
      const id = String(req.params.id);
      const snap = await loadSnapshot(id);
      if (!snap) return res.status(404).json({ ok: false, error: "no such showcase design" });
      const stlName = (snap.files || []).map((f) => f.name).find((n) => /^body-[0-9a-f]+\.stl$/.test(n));
      if (!stlName) return res.status(404).json({ ok: false, error: "this design has no analysed body solid" });
      const f = await loadSnapshotFile(id, stlName);
      if (!f) return res.status(404).json({ ok: false, error: "the body STL is missing or drifted from its snapshot" });
      let out = presentGlbBySha.get(f.sha256);
      if (!out) {
        out = presentGlbFromStl(f.data, { source: { design: id, stl: stlName, stlSha256: f.sha256 } });
        presentGlbBySha.set(f.sha256, out);
      }
      res.setHeader("Content-Type", "model/gltf-binary");
      res.setHeader("Content-Disposition", `attachment; filename="${id}-present.glb"`);
      res.setHeader("Cache-Control", "public, max-age=86400, immutable");
      res.setHeader("ETag", `"${out.sha256}"`);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.send(out.glb);
    } catch (e) {
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  router.get("/designs/:id/files/:name", limit, async (req, res) => {
    try {
      const f = await loadSnapshotFile(String(req.params.id), String(req.params.name));
      if (!f) return res.status(404).json({ ok: false, error: "no such file" });
      res.setHeader("Content-Type", f.contentType);
      res.setHeader("Cache-Control", "public, max-age=86400, immutable");
      res.setHeader("ETag", `"${f.sha256}"`);
      res.setHeader("X-Content-Type-Options", "nosniff");
      // SVGs are drawn by ConKay, but never let one run script in this origin.
      if (f.contentType === "image/svg+xml") res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
      res.send(f.data);
    } catch (e) {
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  // Live build stream (conversational-loop item 3): the orchestrator's events as Server-Sent Events. A recorded run
  // is replayed in order (event ids 1..n) and the stream ends after its last event; a run in this process streams
  // as it happens. Resumes from Last-Event-ID (or ?from=). Read-only, no user data.
  router.get("/designs/:id/live", limit, (req, res) => {
    const id = String(req.params.id);
    const after = Math.max(0, Number.parseInt(req.get("Last-Event-ID") ?? req.query.from ?? "0", 10) || 0);
    const write = (e) => res.write(`id: ${e.id}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    const head = () => {
      res.status(200);
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders?.();
      res.write("retry: 3000\n\n");
    };
    const unsubscribe = subscribeLive(id, after, (e) => {
      if (!res.headersSent) head();
      if (e) write(e); else res.end();
    });
    if (unsubscribe) {
      if (!res.headersSent) head();
      const beat = setInterval(() => res.write(": keep-alive\n\n"), 15000);
      beat.unref?.();
      req.on("close", () => { clearInterval(beat); unsubscribe(); });
      return;
    }
    const events = eventsAfter(id, after);
    if (!events) return res.status(404).json({ ok: false, error: "no such live run" });
    head();
    for (const e of events) write(e);
    res.end();
  });

  router.get("/designs/:id/live/files/:name", limit, (req, res) => {
    try {
      const buf = loadLiveRunFile(String(req.params.id), String(req.params.name));
      if (!buf) return res.status(404).json({ ok: false, error: "no such file" });
      res.setHeader("Content-Type", "model/stl");
      res.setHeader("Cache-Control", "public, max-age=86400, immutable");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.send(buf);
    } catch (e) {
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  return router;
}
