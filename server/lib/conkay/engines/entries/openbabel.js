/**
 * Engine entry — openbabel (SXE-26, Open Babel).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * Open Babel format conversion and descriptors (the process leg of SXE-26). GPL-2: the kernel drives the stock obabel CLI as a separate process.
 *
 * Licence as catalogued for the pinned release (Open Babel
 * 3.1.1, GPL-2.0-only) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-openbabel.py");

defineEngine({
  id: "openbabel",
  version: "3.1.1",
  licence: "GPL-2.0-only",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_OPENBABEL_BIN",
  defaultPath: "/opt/concord-engines/openbabel/bin/python",
  healthOp: "health",
  ops: ["health", "convert"],
  kernel: KERNEL,
  installHint:
    "Open Babel not provisioned on this host: provision the obabel CLI (Open Babel 3.1.1) on PATH plus the driver env at /opt/concord-engines/openbabel (see docs/conkay/engines/openbabel.md). Until then conversion tiers are NOT_COMPUTED engine_unavailable:openbabel.",
  footprint: { diskMb: 256, memoryMb: 256, threads: 1 },
  timeoutMs: 300000,
  opSchemas: {
    "health": {
      request: {},
      result: { formula: "string", mass: "number", expectedMass: "number", absError: "number", converged: "boolean" },
    },
    "convert": {
      request: { smiles: "string" },
      result: { formula: "string", mass: "number" },
    }
  },
});
