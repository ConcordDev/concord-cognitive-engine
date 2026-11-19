/**
 * Engine entry — qutip (SXE-32, QuTiP).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * QuTiP quantum dynamics (open systems, Lindblad, Floquet). BSD-3: imported only inside the child kernel process.
 *
 * Licence as catalogued for the pinned release (QuTiP
 * 5.2.0, BSD-3-Clause) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-qutip.py");

defineEngine({
  id: "qutip",
  version: "5.2.0",
  licence: "BSD-3-Clause",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_QUTIP_BIN",
  defaultPath: "/opt/concord-engines/qutip/bin/python",
  healthOp: "health",
  ops: ["health", "rabi"],
  kernel: KERNEL,
  installHint:
    "QuTiP not provisioned on this host: provision the qutip driver env (QuTiP 5.2.0) at /opt/concord-engines/qutip (see docs/conkay/engines/qutip.md). Until then quantum-dynamics tiers are NOT_COMPUTED engine_unavailable:qutip.",
  footprint: { diskMb: 512, memoryMb: 1024, threads: 2 },
  timeoutMs: 300000,
  opSchemas: {
    "health": {
      request: {},
      result: { periodS: "number", pExcitedHalfPeriod: "number", pExcitedFullPeriod: "number" },
    },
    "rabi": {
      request: { omega: "number" },
      result: { periodS: "number", pExcitedHalfPeriod: "number", pExcitedFullPeriod: "number" },
    }
  },
});
