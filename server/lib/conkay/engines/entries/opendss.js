/**
 * Engine entry — opendss (SXE-19, OpenDSS (OpenDSSDirect)).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * OpenDSS distribution-system simulation via the OpenDSSDirect bindings. BSD-3-style (EPRI): the DSS engine library loads only inside the child kernel process.
 *
 * Licence as catalogued for the pinned release (OpenDSS (OpenDSSDirect)
 * 0.9.0, BSD-3-Clause) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-opendss.py");

defineEngine({
  id: "opendss",
  version: "0.9.0",
  licence: "BSD-3-Clause",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_OPENDSS_BIN",
  defaultPath: "/opt/concord-engines/opendss/bin/python",
  healthOp: "health",
  ops: ["health", "power-flow"],
  kernel: KERNEL,
  installHint:
    "OpenDSS not provisioned on this host: provision the OpenDSSDirect driver env (0.9.0) at /opt/concord-engines/opendss (see docs/conkay/engines/opendss.md). Until then distribution-flow tiers are NOT_COMPUTED engine_unavailable:opendss.",
  footprint: { diskMb: 256, memoryMb: 512, threads: 1 },
  timeoutMs: 300000,
  opSchemas: {
    "health": {
      request: {},
      result: { voltageKv: "number", expectedVoltageKv: "number", relError: "number", converged: "boolean" },
    },
    "power-flow": {
      request: { loadKw: "number" },
      result: { voltageKv: "number", expectedVoltageKv: "number", relError: "number", converged: "boolean" },
    }
  },
});
