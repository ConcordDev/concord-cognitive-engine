/**
 * Engine entry — warpx (SXE-31, WarpX (CPU)).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * WarpX electromagnetic PIC, CPU build (the heavy half of SXE-31; GPU builds are SXE-40, founder-gated). BSD-3-LBNL: the kernel drives the warpx executable as a separate process and imports nothing of it.
 *
 * Licence as catalogued for the pinned release (WarpX (CPU)
 * 25.10, BSD-3-Clause (BSD-3-LBNL)) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-warpx.py");

defineEngine({
  id: "warpx",
  version: "25.10",
  licence: "BSD-3-Clause (BSD-3-LBNL)",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_WARPX_BIN",
  defaultPath: "/opt/concord-engines/warpx/bin/python",
  healthOp: "health",
  ops: ["health", "langmuir"],
  kernel: KERNEL,
  installHint:
    "WarpX not provisioned on this host: provision the WarpX 25.10 CPU build (warpx.1d on PATH) and the driver env at /opt/concord-engines/warpx (see docs/conkay/engines/warpx.md). Until then PIC tiers are NOT_COMPUTED engine_unavailable:warpx.",
  footprint: { diskMb: 1024, memoryMb: 2048, threads: 4 },
  timeoutMs: 3600000,
  opSchemas: {
    "health": {
      request: {},
      result: { omegaP: "number", expectedOmegaP: "number", relError: "number" },
    },
    "langmuir": {
      request: { densityM3: "number", nSteps: "number" },
      result: { omegaP: "number", expectedOmegaP: "number", relError: "number" },
    }
  },
});
