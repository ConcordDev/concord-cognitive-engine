/**
 * Engine entry — openradioss (SXE-13, OpenRadioss explicit dynamics).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * OpenRadioss explicit dynamics. AGPL-3: runs UNMODIFIED as separate processes (founder F7 rule; the manifest validator enforces unmodified: true) — the kernel drives the distribution's own starter/engine binaries on the distribution's own shipped QA deck.
 *
 * Licence as catalogued for the pinned release (OpenRadioss explicit dynamics
 * 2025.09, AGPL-3.0-only) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-openradioss.py");

defineEngine({
  id: "openradioss",
  version: "2025.09",
  licence: "AGPL-3.0-only",
  linkMode: "process",
  unmodified: true,
  envVar: "CONKAY_ENGINE_OPENRADIOSS_BIN",
  defaultPath: "/opt/concord-engines/openradioss/bin/python",
  healthOp: "health",
  ops: ["health", "bar-impact"],
  kernel: KERNEL,
  installHint:
    "OpenRadioss not provisioned on this host: provision the unmodified OpenRadioss 2025.09 distribution (with its QA set) and the driver env at /opt/concord-engines/openradioss (see docs/conkay/engines/openradioss.md). Until then explicit-dynamics tiers are NOT_COMPUTED engine_unavailable:openradioss.",
  footprint: { diskMb: 2048, memoryMb: 4096, threads: 8 },
  timeoutMs: 3600000,
  opSchemas: {
    "health": {
      request: {},
      result: { deck: "string", initialEnergy: "number", finalEnergy: "number", relDrift: "number" },
    },
    "bar-impact": {
      request: { deckName: "string" },
      result: { deck: "string", initialEnergy: "number", finalEnergy: "number", relDrift: "number" },
    }
  },
});
