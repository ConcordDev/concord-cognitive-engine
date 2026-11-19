/**
 * Engine entry — ngspice (SXE-16, ngspice circuit simulation).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * ngspice circuit simulation (the SXE-16 row also names Xyce for large parallel decks; Xyce is a separate future engine — this entry is ngspice only, and the doc says so). Modified BSD: the kernel drives the ngspice binary as a separate process.
 *
 * Licence as catalogued for the pinned release (ngspice circuit simulation
 * 44, BSD-3-Clause (modified BSD)) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-ngspice.py");

defineEngine({
  id: "ngspice",
  version: "44",
  licence: "BSD-3-Clause (modified BSD)",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_NGSPICE_BIN",
  defaultPath: "/opt/concord-engines/ngspice/bin/python",
  healthOp: "health",
  ops: ["health", "rc-step"],
  kernel: KERNEL,
  installHint:
    "ngspice not provisioned on this host: install ngspice 44 and provision the driver env at /opt/concord-engines/ngspice (see docs/conkay/engines/ngspice.md). Until then circuit tiers are NOT_COMPUTED engine_unavailable:ngspice.",
  footprint: { diskMb: 256, memoryMb: 512, threads: 2 },
  timeoutMs: 120000,
  opSchemas: {
    "health": {
      request: {},
      result: { tauS: "number", vAtTau: "number", expectedVAtTau: "number", relError: "number" },
    },
    "rc-step": {
      request: { rOhm: "number", cF: "number", vStep: "number" },
      result: { tauS: "number", vAtTau: "number", expectedVAtTau: "number", relError: "number" },
    }
  },
});
