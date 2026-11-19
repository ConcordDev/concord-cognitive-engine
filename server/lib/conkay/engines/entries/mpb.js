/**
 * Engine entry — mpb (SXE-18, MPB (Meep band structure)).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * MIT Photonic-Bands (the MPB half of SXE-18: band structure for the photonics tiers). GPL-2: imported only inside the child kernel process, never linked into Node.
 *
 * Licence as catalogued for the pinned release (MPB (Meep band structure)
 * 1.12.0, GPL-2.0-only) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-mpb.py");

defineEngine({
  id: "mpb",
  version: "1.12.0",
  licence: "GPL-2.0-only",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_MPB_BIN",
  defaultPath: "/opt/concord-engines/mpb/bin/python",
  healthOp: "health",
  ops: ["health", "bands"],
  kernel: KERNEL,
  installHint:
    "MPB not provisioned on this host: provision the mpb conda env (mpb 1.12.0, conda-forge) at /opt/concord-engines/mpb (see docs/conkay/engines/mpb.md). Until then band-structure tiers are NOT_COMPUTED engine_unavailable:mpb.",
  footprint: { diskMb: 512, memoryMb: 1024, threads: 2 },
  timeoutMs: 600000,
  opSchemas: {
    "health": {
      request: {},
      result: { bandEdge1: "number", expectedBandEdge1: "number", bandEdge2: "number", expectedBandEdge2: "number", maxRelError: "number" },
    },
    "bands": {
      request: { epsHigh: "number", resolution: "number" },
      result: { bandEdge1: "number", expectedBandEdge1: "number", bandEdge2: "number", expectedBandEdge2: "number", maxRelError: "number" },
    }
  },
});
