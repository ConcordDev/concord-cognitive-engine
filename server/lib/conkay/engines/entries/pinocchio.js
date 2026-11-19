/**
 * Engine entry — pinocchio (SXE-14, Pinocchio rigid-body dynamics).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * Pinocchio rigid-body dynamics (the robotics companion to the Chrono lane). BSD-2: imported only inside the child kernel process — linkMode "process" regardless.
 *
 * Licence as catalogued for the pinned release (Pinocchio rigid-body dynamics
 * 3.3.0, BSD-2-Clause) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-pinocchio.py");

defineEngine({
  id: "pinocchio",
  version: "3.3.0",
  licence: "BSD-2-Clause",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_PINOCCHIO_BIN",
  defaultPath: "/opt/concord-engines/pinocchio/bin/python",
  healthOp: "health",
  ops: ["health", "rnea"],
  kernel: KERNEL,
  installHint:
    "Pinocchio not provisioned on this host: provision the pinocchio conda env (pinocchio 3.3.0, conda-forge) at /opt/concord-engines/pinocchio (see docs/conkay/engines/pinocchio.md). Until then robotics-dynamics tiers are NOT_COMPUTED engine_unavailable:pinocchio.",
  footprint: { diskMb: 1024, memoryMb: 1024, threads: 2 },
  timeoutMs: 120000,
  opSchemas: {
    "health": {
      request: {},
      result: { torque: "number", expectedTorqueAbs: "number", relError: "number" },
    },
    "rnea": {
      request: { massKg: "number", lengthM: "number", angleRad: "number" },
      result: { torque: "number", expectedTorqueAbs: "number", relError: "number" },
    }
  },
});
