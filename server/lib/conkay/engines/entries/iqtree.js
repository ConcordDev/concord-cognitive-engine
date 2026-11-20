/**
 * Engine entry — iqtree (SXE-28, IQ-TREE).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * IQ-TREE maximum-likelihood phylogenetics. GPL-2: the kernel drives the stock iqtree2 CLI as a separate process.
 *
 * Licence as catalogued for the pinned release (IQ-TREE
 * 2.3.6, GPL-2.0-only) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-iqtree.py");

defineEngine({
  id: "iqtree",
  version: "2.3.6",
  licence: "GPL-2.0-only",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_IQTREE_BIN",
  defaultPath: "/opt/concord-engines/iqtree/bin/python",
  healthOp: "health",
  ops: ["health", "tree"],
  kernel: KERNEL,
  installHint:
    "IQ-TREE not provisioned on this host: provision iqtree2 2.3.6 on PATH plus the driver env at /opt/concord-engines/iqtree (see docs/conkay/engines/iqtree.md). Until then phylogenetics tiers are NOT_COMPUTED engine_unavailable:iqtree.",
  footprint: { diskMb: 256, memoryMb: 512, threads: 2 },
  timeoutMs: 1200000,
  opSchemas: {
    "health": {
      request: {},
      result: { logLikelihood: "number", tips: "number", converged: "boolean" },
    },
    "tree": {
      request: { alignment: "string" },
      result: { logLikelihood: "number", tips: "number" },
    }
  },
});
