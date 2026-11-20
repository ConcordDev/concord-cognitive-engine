/**
 * Engine entry — orekit (SXE-36, Orekit).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * Orekit space-dynamics library via its Python wrapper (JVM bridge inside the child kernel process). Apache-2.0.
 *
 * Licence as catalogued for the pinned release (Orekit
 * 13.1.0, Apache-2.0) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-orekit.py");

defineEngine({
  id: "orekit",
  version: "13.1.0",
  licence: "Apache-2.0",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_OREKIT_BIN",
  defaultPath: "/opt/concord-engines/orekit/bin/python",
  healthOp: "health",
  ops: ["health", "orbit"],
  kernel: KERNEL,
  installHint:
    "Orekit not provisioned on this host: provision the Orekit driver env (13.1.0) and the orekit-data set at /opt/concord-engines/orekit (see docs/conkay/engines/orekit.md). Until then space-dynamics tiers are NOT_COMPUTED engine_unavailable:orekit.",
  footprint: { diskMb: 1024, memoryMb: 2048, threads: 2 },
  timeoutMs: 900000,
  opSchemas: {
    "health": {
      request: {},
      result: { periodS: "number", expectedPeriodS: "number", relError: "number", closureErrorM: "number", converged: "boolean" },
    },
    "orbit": {
      request: { semiMajorKm: "number" },
      result: { periodS: "number", expectedPeriodS: "number", relError: "number", closureErrorM: "number", converged: "boolean" },
    }
  },
});
