/**
 * Engine entry — pyscf (SXE-26, PySCF).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * PySCF quantum chemistry (the primary SXE-26 leg). Apache-2: imported only inside the child kernel process.
 *
 * Licence as catalogued for the pinned release (PySCF
 * 2.9.0, Apache-2.0) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-pyscf.py");

defineEngine({
  id: "pyscf",
  version: "2.9.0",
  licence: "Apache-2.0",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_PYSCF_BIN",
  defaultPath: "/opt/concord-engines/pyscf/bin/python",
  healthOp: "health",
  ops: ["health", "rhf-energy"],
  kernel: KERNEL,
  installHint:
    "PySCF not provisioned on this host: provision the pyscf driver env (PySCF 2.9.0) at /opt/concord-engines/pyscf (see docs/conkay/engines/pyscf.md). Until then quantum-chemistry tiers are NOT_COMPUTED engine_unavailable:pyscf.",
  footprint: { diskMb: 512, memoryMb: 1024, threads: 2 },
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
