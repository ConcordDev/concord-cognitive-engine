/**
 * Engine entry — geant4 (SXE-30, Geant4 (reduced library)).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * Geant4 particle transport, reduced-library leg of SXE-30. The kernel drives the toolkit's own example B1 binary, built by the lane, as a separate process; nothing of Geant4 is imported.
 *
 * Licence as catalogued for the pinned release (Geant4 (reduced library)
 * 11.3.0, Geant4 Licence) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-geant4.py");

defineEngine({
  id: "geant4",
  version: "11.3.0",
  licence: "Geant4 Licence",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_GEANT4_BIN",
  defaultPath: "/opt/concord-engines/geant4/bin/python",
  healthOp: "health",
  ops: ["health", "b1"],
  kernel: KERNEL,
  installHint:
    "Geant4 not provisioned on this host: provision the example B1 binary built against Geant4 11.3.0 at CONKAY_GEANT4_B1 plus the driver env at /opt/concord-engines/geant4 (see docs/conkay/engines/geant4.md). Until then Geant4 tiers are NOT_COMPUTED engine_unavailable:geant4.",
  footprint: { diskMb: 4096, memoryMb: 2048, threads: 4 },
  timeoutMs: 1800000,
  opSchemas: {
    "health": {
      request: {},
      result: { doseMicroGy: "number", converged: "boolean" },
    },
    "b1": {
      request: { events: "number" },
      result: { doseMicroGy: "number", converged: "boolean" },
    }
  },
});
