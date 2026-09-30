// server/routes/conkay-verticals.js
// ConKay industry verticals — Molecular / Hospital / Prosthetics / Studio / Aero.
// Mounted at /api/conkay. Auth required. Dual-use BIO: geometry + synthetic only.

import { Router } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildMolecularCad } from '../lib/conkay/verticals/molecular-cad.js';
import {
  generateSyntheticIntakeBatch,
  compressHospitalPackets,
  predictiveTriage,
  runHospitalOpsCert,
} from '../lib/conkay/verticals/hospital-ops.js';
import {
  buildParametricSocket,
  digitalFitCheck,
  emitBioprintToolpath,
  runProstheticsCert,
} from '../lib/conkay/verticals/prosthetics.js';
import { aeroPanelProxy, aeroAlphaCurve, buildDefaultAirfoilMesh } from '../lib/conkay/verticals/aerodynamics.js';
import { compileStudioShot } from '../lib/conkay/verticals/studio.js';

export default function createConkayVerticalsRouter({ requireAuth }) {
  const router = Router();
  const auth = requireAuth;

  /** POST /api/conkay/molecular/build  { text|formula } */
  router.post('/molecular/build', auth, (req, res) => {
    try {
      const out = buildMolecularCad(req.body || {});
      if (!out.ok) return res.status(400).json(out);
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  /** POST /api/conkay/hospital/intake  { n?, seed? } — SYNTHETIC ONLY */
  router.post('/hospital/intake', auth, (req, res) => {
    try {
      const out = generateSyntheticIntakeBatch(req.body || {});
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  /** POST /api/conkay/hospital/compress  { patients? | n? } */
  router.post('/hospital/compress', auth, (req, res) => {
    try {
      const batch = Array.isArray(req.body?.patients)
        ? { patients: req.body.patients }
        : generateSyntheticIntakeBatch({ n: req.body?.n || 200, seed: req.body?.seed });
      const out = compressHospitalPackets(batch);
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  /** POST /api/conkay/hospital/triage  { packets? | patients? | n?, beds? } */
  router.post('/hospital/triage', auth, (req, res) => {
    try {
      let packets = req.body?.packets;
      if (!packets) {
        const batch = Array.isArray(req.body?.patients)
          ? { patients: req.body.patients }
          : generateSyntheticIntakeBatch({ n: req.body?.n || 200 });
        packets = compressHospitalPackets(batch).packets;
      }
      const out = predictiveTriage(packets, { beds: req.body?.beds });
      return res.json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  /** POST /api/conkay/hospital/run — full cert slice */
  router.post('/hospital/run', auth, (req, res) => {
    try {
      return res.json(runHospitalOpsCert(req.body || {}));
    } catch (e) {
      return res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  /** POST /api/conkay/prosthetics/socket */
  router.post('/prosthetics/socket', auth, (req, res) => {
    try {
      return res.json(buildParametricSocket(req.body || {}));
    } catch (e) {
      return res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  /** POST /api/conkay/prosthetics/fit-check  { mesh?, params? } */
  router.post('/prosthetics/fit-check', auth, (req, res) => {
    try {
      const mesh = req.body?.mesh || buildParametricSocket(req.body || {}).mesh;
      return res.json(digitalFitCheck(mesh, req.body || {}));
    } catch (e) {
      return res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  /** POST /api/conkay/prosthetics/toolpath — writes gcode+telemetry under ~/.zuko or body.outDir */
  router.post('/prosthetics/toolpath', auth, (req, res) => {
    try {
      const socket = buildParametricSocket(req.body?.socket || req.body || {});
      const outDir =
        req.body?.outDir ||
        path.join(os.homedir(), '.zuko', 'remaining-work', 'conkay-prosthetics-out');
      const fit = digitalFitCheck(socket.mesh, req.body || {});
      const tool = emitBioprintToolpath(socket.mesh, { ...req.body, outDir });
      return res.json({ ok: tool.ok && fit.ok, socket, fit, toolpath: tool });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  /** POST /api/conkay/prosthetics/run */
  router.post('/prosthetics/run', auth, (req, res) => {
    try {
      const outDir =
        req.body?.outDir ||
        path.join(os.homedir(), '.zuko', 'remaining-work', 'conkay-prosthetics-out');
      const cert = runProstheticsCert({ ...req.body, outDir });
      return res.json({ ...cert, mesh: cert.socket?.mesh || null });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  /** POST /api/conkay/studio/shot  { text?, archetype?, durationSec? } */
  router.post('/studio/shot', auth, (req, res) => {
    try {
      return res.json(compileStudioShot(req.body || {}));
    } catch (e) {
      return res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  /** POST /api/conkay/aero/panel  { mesh?, alphaDeg?, U?, sweep?, alphasDeg? } */
  router.post('/aero/panel', auth, (req, res) => {
    try {
      const mesh = req.body?.mesh?.positions
        ? req.body.mesh
        : buildDefaultAirfoilMesh(req.body?.airfoil || req.body || {});
      const single = aeroPanelProxy(mesh, req.body || {});
      const wantSweep = req.body?.sweep !== false; // default on for richer vertical
      if (!wantSweep) return res.json(single);
      const sweep = aeroAlphaCurve(mesh, {
        alphasDeg: req.body?.alphasDeg,
        U: req.body?.U,
        rho: req.body?.rho,
      });
      return res.json({
        ...single,
        alphaCurve: sweep.curve,
        clMax: sweep.clMax,
        alphaStallProxy: sweep.alphaStallProxy,
        sweepMs: sweep.ms,
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  /** GET /api/conkay/verticals/status */
  router.get('/verticals/status', auth, (_req, res) => {
    res.json({
      ok: true,
      verticals: ['molecular', 'hospital', 'prosthetics', 'studio', 'aerodynamics'],
      honesty: {
        bio: 'structural geometry + synthetic hospital only — no pathogens/enhancement/wet-lab',
        clinical: false,
        fda: false,
        isoCmm: false,
      },
    });
  });

  return router;
}
