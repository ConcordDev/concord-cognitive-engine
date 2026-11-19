/**
 * Engine entry — chrono (SXE-14, Project Chrono (PyChrono)).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * Project Chrono multibody dynamics via PyChrono (vehicle dynamics rides Chrono::Vehicle on this lane). BSD-3: the library is imported only inside the child kernel process — linkMode "process" regardless.
 *
 * Licence as catalogued for the pinned release (Project Chrono (PyChrono)
 * 9.0.0, BSD-3-Clause) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-chrono.py");

defineEngine({
  id: "chrono",
  version: "9.0.0",
  licence: "BSD-3-Clause",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_CHRONO_BIN",
  defaultPath: "/opt/concord-engines/chrono/bin/python",
  healthOp: "health",
  ops: ["health", "pendulum"],
  kernel: KERNEL,
  installHint:
    "Project Chrono not provisioned on this host: provision the chrono conda env (pychrono 9.0.0, conda-forge) at /opt/concord-engines/chrono (see docs/conkay/engines/chrono.md). Until then vehicle-dynamics tiers are NOT_COMPUTED engine_unavailable:chrono.",
  footprint: { diskMb: 4096, memoryMb: 2048, threads: 4 },
  timeoutMs: 300000,
  opSchemas: {
    "health": {
      request: {},
      result: { periodS: "number", expectedPeriodS: "number", relError: "number" },
    },
    "pendulum": {
      request: { lengthM: "number", gravity: "number", angleRad: "number" },
      result: { periodS: "number", expectedPeriodS: "number", relError: "number" },
    }
  },
});
