/**
 * Engine entry — openfast (SXE-37, OpenFAST).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * OpenFAST wind-turbine simulation. Apache-2.0: the kernel drives the stock openfast binary as a separate process and imports nothing of it.
 *
 * Licence as catalogued for the pinned release (OpenFAST
 * 4.1.2, Apache-2.0) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-openfast.py");

defineEngine({
  id: "openfast",
  version: "4.1.2",
  licence: "Apache-2.0",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_OPENFAST_BIN",
  defaultPath: "/opt/concord-engines/openfast/bin/python",
  healthOp: "health",
  ops: ["health", "run"],
  kernel: KERNEL,
  installHint:
    "OpenFAST not provisioned on this host: provision the OpenFAST 4.1.2 binary on PATH plus the case dir and driver env at /opt/concord-engines/openfast (see docs/conkay/engines/openfast.md). Until then wind-energy tiers are NOT_COMPUTED engine_unavailable:openfast.",
  footprint: { diskMb: 1024, memoryMb: 2048, threads: 4 },
  timeoutMs: 1800000,
  opSchemas: {
    "health": {
      request: {},
      result: { finalTimeS: "number", deckTMaxS: "number", converged: "boolean" },
    },
    "run": {
      request: { tMaxS: "number" },
      result: { finalTimeS: "number", deckTMaxS: "number", converged: "boolean" },
    }
  },
});
