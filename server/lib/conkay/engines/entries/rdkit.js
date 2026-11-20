/**
 * Engine entry — rdkit (SXE-26, RDKit).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this engine's driver-env Python: the env exists only
 * when the engine is provisioned on a host, so presence tracks
 * provisioning.
 *
 * RDKit cheminformatics (descriptors, fingerprints, substructure). BSD-3: imported only inside the child kernel process.
 *
 * Licence as catalogued for the pinned release (RDKit
 * 2025.09.1, BSD-3-Clause) at registration time, 2026-11-19.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-rdkit.py");

defineEngine({
  id: "rdkit",
  version: "2025.09.1",
  licence: "BSD-3-Clause",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_RDKIT_BIN",
  defaultPath: "/opt/concord-engines/rdkit/bin/python",
  healthOp: "health",
  ops: ["health", "descriptors"],
  kernel: KERNEL,
  installHint:
    "RDKit not provisioned on this host: provision the rdkit driver env (RDKit 2025.09.1) at /opt/concord-engines/rdkit (see docs/conkay/engines/rdkit.md). Until then cheminformatics tiers are NOT_COMPUTED engine_unavailable:rdkit.",
  footprint: { diskMb: 512, memoryMb: 512, threads: 1 },
  timeoutMs: 300000,
  opSchemas: {
    "health": {
      request: {},
      result: { molWt: "number", expectedMolWt: "number", absError: "number", converged: "boolean" },
    },
    "descriptors": {
      request: { smiles: "string" },
      result: { molWt: "number", formula: "string" },
    }
  },
});
