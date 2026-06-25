// server/domains/styletx.js
//
// Style Transfer (#45) — macro over lib/style-transfer.js. Moves a source DTU
// toward a style (mean(A)−mean(B) in embedding space) and returns the nearest
// real DTUs to the restyled vector. Operates on real stored embeddings; reports
// semantic:false honestly when the needed DTUs aren't embedded.
//
// Registered from server.js: registerStyletxMacros(register).

import { transferStyle } from "../lib/style-transfer.js";

export default function registerStyletxMacros(register) {
  register("styletx", "transfer", async (ctx, input = {}) => {
    const db = ctx?.db;
    return transferStyle(db, {
      sourceDtuId: input.sourceDtuId,
      styleAIds: input.styleAIds || [],
      styleBIds: input.styleBIds || [],
      candidateIds: input.candidateIds || [],
      alpha: Number(input.alpha) || 1,
      topK: input.topK,
    });
  }, { note: "transfer a style direction onto a source DTU; nearest real DTUs to the result (honest semantic flag) (#45)" });
}
