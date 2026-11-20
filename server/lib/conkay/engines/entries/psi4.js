/**
 * Engine entry — psi4 (SXE-26, Psi4).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * Psi4 quantum chemistry (the process leg of SXE-26). GPL-2: imported only inside the child kernel process, never linked into Node.
 *
 * Licence as catalogued for the pinned release (Psi4
 * 1.10.0, GPL-2.0-only) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-psi4.py");

defineEngine({
  id: "psi4",
  version: "1.10.0",
  licence: "GPL-2.0-only",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_PSI4_BIN",
  defaultPath: "/opt/concord-engines/psi4/bin/python",
  healthOp: "health",
  ops: ["health", "rhf-energy"],
  kernel: KERNEL,
  installHint:
    "Psi4 not provisioned on this host: provision the psi4 driver env (Psi4 1.10.0, conda-forge) at /opt/concord-engines/psi4 (see docs/conkay/engines/psi4.md). Until then the Psi4 tiers are NOT_COMPUTED engine_unavailable:psi4.",
  footprint: { diskMb: 1024, memoryMb: 1024, threads: 2 },
  timeoutMs: 600000,
  opSchemas: {
    "health": {
      request: {},
      result: { energyHartree: "number", expectedHartree: "number", absError: "number", converged: "boolean" },
    },
    "rhf-energy": {
      request: { molecule: "string" },
      result: { energyHartree: "number", expectedHartree: "number", absError: "number", converged: "boolean" },
    }
  },
});
