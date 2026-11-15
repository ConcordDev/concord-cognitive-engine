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
import { attestReceipt, ensureSigningKey, verifyAttestation } from "../lib/receipts/attest.js";
import { renderCalcSheetHtml } from "../lib/receipts/calc-sheet.js";
import { buildCalcReceipt, roundTo } from "../lib/receipts/calc-receipt.js";
import { issueStoredReceipt } from "../lib/receipts/store.js";
import { CHEM_FUELS, solveChemEquilibrium, chemReceiptParts } from "../lib/receipts/chem-equilibrium.js";
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
    // GB-1534: optional caller-supplied job references, signed into the
    // calc receipt (each capped at 200 chars by the receipt builder).
    ...(typeof q.projectRef === "string" ? { projectRef: q.projectRef } : {}),
    ...(typeof q.jobRef === "string" ? { jobRef: q.jobRef } : {}),
    ...(typeof q.preparedFor === "string" ? { preparedFor: q.preparedFor } : {}),
  };
}

/** Fields every stored-receipt response carries (saved:true + id + URL, or saved:false + why). */
function savedFields(issued) {
  return issued.saved
    ? { saved: true, receiptId: issued.receiptId, receiptUrl: issued.receiptUrl }
    : { saved: false, saveError: issued.saveError };
}

export default function createConkayDemoRouter({ rateLimit, db, store } = {}) {
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
      // Sign the receipt over a fresh receiptId and store it. A store failure
      // never fails the solve: the signed receipt still comes back, saved:false.
      const issued = issueStoredReceipt(solved.result.calcReceipt, { db, store });
      res.json({ ok: true, ...savedFields(issued), result: { ...solved.result, calcReceipt: issued.receipt } });
    } catch (e) {
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  // GB-1534: the one-page human calc sheet for the same solve, rendered
  // from the signed v2 calc receipt (verified first, verdict on the page).
  router.get("/beam/sheet", limit, (req, res) => {
    try {
      const solved = solveBeamStudy(studyInput(req.query));
      if (!solved.ok) return res.status(400).json({ ok: false, error: solved.error });
      const receipt = solved.result.calcReceipt;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.send(renderCalcSheetHtml(receipt, { verify: verifyAttestation(receipt) }));
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

  // GB-1534: no-login chemistry equilibrium demo. Same discipline as the
  // beam demo — compute only, nothing saved. The Cantera kernel is a child
  // process, so the design is settled off the request path (the
  // conkay_design pattern) and kernel runs are serialized (cap 1 per
  // process) and cached by the kernel key. When Cantera is unavailable the
  // answer is an honest NOT_COMPUTED with the reason — never a fake number.
  router.get("/chem/equilibrium", limit, async (req, res) => {
    try {
      const spec = chemInput(req.query);
      if (!spec.ok) return res.status(400).json({ ok: false, error: spec.error });
      const outcome = await solveChemEquilibrium(spec);
      const issued = issueStoredReceipt(chemCalcReceipt(spec, outcome), { db, store });
      const receipt = issued.receipt;
      res.json({
        ok: true, ...savedFields(issued),
        result: {
          fuel: spec.fuel, phi: spec.phi, T0: spec.T0, P0: spec.P0atm, mechanism: CHEM_FUELS[spec.fuel].mechanism,
          status: outcome.status,
          ...(outcome.reason ? { reason: outcome.reason } : {}),
          ...(outcome.status !== "NOT_COMPUTED"
            ? { adiabaticFlameTemperatureK: roundTo(outcome.tAd, 1), majorProducts: outcome.products }
            : {}),
          reference: CHEM_FUELS[spec.fuel].reference,
          calcReceipt: receipt,
          receipt,
        },
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  router.get("/chem/equilibrium/sheet", limit, async (req, res) => {
    try {
      const spec = chemInput(req.query);
      if (!spec.ok) return res.status(400).json({ ok: false, error: spec.error });
      const outcome = await solveChemEquilibrium(spec);
      const receipt = chemCalcReceipt(spec, outcome);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.send(renderCalcSheetHtml(receipt, { verify: verifyAttestation(receipt) }));
    } catch (e) {
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  return router;
}

/** Bounded chem demo inputs: fuel CH4|H2, phi 0.5–2.0, T0 250–1000 K, P0 0.5–10 atm. */
function chemInput(q) {
  const fuel = typeof q.fuel === "string" ? q.fuel.toUpperCase() : "CH4";
  if (!CHEM_FUELS[fuel]) return { ok: false, error: "fuel must be CH4 or H2" };
  const phi = q.phi === undefined || q.phi === "" ? 1 : Number(q.phi);
  if (!Number.isFinite(phi) || phi < 0.5 || phi > 2.0) return { ok: false, error: "phi must be between 0.5 and 2.0" };
  const T0 = q.T0 === undefined || q.T0 === "" ? 300 : Number(q.T0);
  if (!Number.isFinite(T0) || T0 < 250 || T0 > 1000) return { ok: false, error: "T0 must be between 250 and 1000 K" };
  const P0atm = q.P0 === undefined || q.P0 === "" ? 1 : Number(q.P0);
  if (!Number.isFinite(P0atm) || P0atm < 0.5 || P0atm > 10) return { ok: false, error: "P0 must be between 0.5 and 10 atm" };
  return { ok: true, fuel, phi, T0, P0atm };
}

/** The signed v2 calc receipt for one chem demo outcome (parts shared with the chem lens action). */
function chemCalcReceipt(spec, outcome) {
  return buildCalcReceipt(chemReceiptParts(spec, outcome));
}
