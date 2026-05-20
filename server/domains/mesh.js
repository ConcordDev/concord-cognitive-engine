// server/domains/mesh.js
// Records substrate for the mesh lens — gives the lens a real,
// persistent, per-user tracked-records workspace (add / list / update /
// delete / dashboard). Wired into domains/index.js.

import { registerLensSubstrate } from "../lib/lens-substrate.js";

export default function registerMeshSubstrate(registerLensAction) {
  registerLensSubstrate(registerLensAction, "mesh", {
    noun: "peer", idPrefix: "msh",
  });
}
