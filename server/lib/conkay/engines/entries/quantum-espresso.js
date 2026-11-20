/**
 * Engine entry — quantum-espresso (SXE-26, Quantum ESPRESSO).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * Quantum ESPRESSO plane-wave DFT (the plan §4 leg folded into SXE-26). GPL-2: the kernel drives the stock pw.x binary as a separate process.
 *
 * Licence as catalogued for the pinned release (Quantum ESPRESSO
 * 7.4, GPL-2.0-only) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-quantum-espresso.py");

defineEngine({
  id: "quantum-espresso",
  version: "7.4",
  licence: "GPL-2.0-only",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_QUANTUM_ESPRESSO_BIN",
  defaultPath: "/opt/concord-engines/quantum-espresso/bin/python",
  healthOp: "health",
  ops: ["health", "scf"],
  kernel: KERNEL,
  installHint:
    "Quantum ESPRESSO not provisioned on this host: provision pw.x (QE 7.4) on PATH plus the driver env at /opt/concord-engines/quantum-espresso (see docs/conkay/engines/quantum-espresso.md). Until then plane-wave tiers are NOT_COMPUTED engine_unavailable:quantum-espresso.",
  footprint: { diskMb: 512, memoryMb: 1024, threads: 4 },
  timeoutMs: 1800000,
  opSchemas: {
    "health": {
      request: {},
      result: { energyRy: "number", converged: "boolean" },
    },
    "scf": {
      request: { ecutWfc: "number" },
      result: { energyRy: "number", converged: "boolean" },
    }
  },
});
