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
  router.get("/designs", limit, (_req, res) => {
    res.json({ ok: true, designs: listSnapshots() });
  });

  router.get("/designs/:id", limit, (req, res) => {
    const snap = loadSnapshot(String(req.params.id));
    if (!snap) return res.status(404).json({ ok: false, error: "no such showcase design" });
    res.json({ ok: true, design: snap });
  });

  router.get("/designs/:id/files/:name", limit, (req, res) => {
    const f = loadSnapshotFile(String(req.params.id), String(req.params.name));
    if (!f) return res.status(404).json({ ok: false, error: "no such file" });
    res.setHeader("Content-Type", f.contentType);
    res.setHeader("Cache-Control", "public, max-age=86400, immutable");
    res.setHeader("ETag", `"${f.sha256}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    // SVGs are drawn by ConKay, but never let one run script in this origin.
    if (f.contentType === "image/svg+xml") res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
    res.send(f.data);
  });

  return router;
}
