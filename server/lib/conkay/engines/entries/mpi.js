/**
 * Engine entry — mpi (SXE-39, MPI lane: OpenMPI).
 *
 * Registered on import; server/lib/conkay/engines/entries/index.js
 * is the single import point. The "binary" the SXE-00 framework
 * resolves is this lane's driver-env Python: the env exists only
 * when the lane is provisioned on a host, so presence tracks
 * provisioning. The kernel launches mpirun itself and verifies
 * the rank count and the reduction before serving either.
 *
 * Licence re-read from the pinned release (OpenMPI 5.0.11,
 * BSD-3-Clause) at registration time, 2026-11-18.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineEngine } from "../manifest.js";

const KERNEL = join(dirname(fileURLToPath(import.meta.url)), "..", "kernels", "kernel-mpi.py");

defineEngine({
  id: "mpi",
  version: "5.0.11",
  licence: "BSD-3-Clause",
  linkMode: "process",
  envVar: "CONKAY_ENGINE_MPI_BIN",
  defaultPath: "/opt/concord-engines/mpi/bin/python",
  healthOp: "health",
  ops: ["health", "reduce-sum"],
  kernel: KERNEL,
  installHint:
    "MPI lane not provisioned on this host: provision the mpi driver env (Python + mpi4py + OpenMPI 5.0.11) at /opt/concord-engines/mpi (see docs/conkay/engines/mpi.md). Until then parallel tiers are NOT_COMPUTED engine_unavailable:mpi.",
  footprint: { diskMb: 256, memoryMb: 512, threads: 8 },
  timeoutMs: 180_000,
  opSchemas: {
    health: {
      request: {},
      result: { np: "number", total: "number", expectedTotal: "number" },
    },
    "reduce-sum": {
      request: { np: "number" },
      result: { np: "number", total: "number", expectedTotal: "number" },
    },
  },
});
