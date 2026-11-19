/**
 * Engine entry — code-aster (SXE-08, Code_Aster (container)).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * Code_Aster structural analysis, the catalogue's container engine: in production this driver env lives inside the Code_Aster container image and the RPC lane (SXE-51) reaches it. GPL-3: the kernel drives the runner as a separate process and imports nothing of it.
 *
 * Licence as catalogued for the pinned release (Code_Aster (container)
 * 17.4.0, GPL-3.0-only) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-code-aster.py");

defineEngine({
  id: "code-aster",
  version: "17.4.0",
  licence: "GPL-3.0-only",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_CODE_ASTER_BIN",
  defaultPath: "/opt/concord-engines/code-aster/bin/python",
  healthOp: "health",
  ops: ["health", "tension"],
  kernel: KERNEL,
  installHint:
    "Code_Aster not provisioned on this host: provision the Code_Aster 17.4.0 container env at /opt/concord-engines/code-aster (see docs/conkay/engines/code-aster.md). Until then Code_Aster tiers are NOT_COMPUTED engine_unavailable:code-aster.",
  footprint: { diskMb: 4096, memoryMb: 4096, threads: 4 },
  timeoutMs: 1800000,
  opSchemas: {
    "health": {
      request: {},
      result: { tipDisplacement: "number", expectedDisplacement: "number", relError: "number" },
    },
    "tension": {
      request: { lengthM: "number", areaM2: "number", ePa: "number", forceN: "number" },
      result: { tipDisplacement: "number", expectedDisplacement: "number", relError: "number" },
    }
  },
});
