/**
 * Engine entry — xtb (SXE-26, xtb (GFN-xTB)).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * xtb semiempirical tight-binding (GFN2-xTB). LGPL-3: the kernel drives the stock xtb binary as a separate process and imports nothing of it.
 *
 * Licence as catalogued for the pinned release (xtb (GFN-xTB)
 * 6.7.1, LGPL-3.0-only) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-xtb.py");

defineEngine({
  id: "xtb",
  version: "6.7.1",
  licence: "LGPL-3.0-only",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_XTB_BIN",
  defaultPath: "/opt/concord-engines/xtb/bin/python",
  healthOp: "health",
  ops: ["health", "gfn2-energy"],
  kernel: KERNEL,
  installHint:
    "xtb not provisioned on this host: provision the xtb 6.7.1 binary on PATH plus the driver env at /opt/concord-engines/xtb (see docs/conkay/engines/xtb.md). Until then tight-binding tiers are NOT_COMPUTED engine_unavailable:xtb.",
  footprint: { diskMb: 256, memoryMb: 512, threads: 2 },
  timeoutMs: 600000,
  opSchemas: {
    "health": {
      request: {},
      result: { energyHartree: "number", converged: "boolean" },
    },
    "gfn2-energy": {
      request: { molecule: "string" },
      result: { energyHartree: "number", converged: "boolean" },
    }
  },
});
