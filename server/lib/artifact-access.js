/**
 * INC-139: read gate + wire shape for DTU-keyed artifact routes.
 *
 * GET /api/artifact/:dtuId/{download,stream,info,thumbnail} used to look the
 * DTU up and serve its bytes to anyone. They must apply the same rule as
 * GET /api/dtus/:id (dtu.get): shadow DTUs are internal, and a private DTU
 * is readable only by its owner (lib/dtu-read-access.js ctxMayReadDtu).
 * A hidden DTU is reported exactly like a missing one so the id does not
 * confirm it exists.
 */
import { ctxMayReadDtu } from "./dtu-read-access.js";

/**
 * The DTU behind an artifact route, or null when it is missing, internal
 * (shadow), or private to someone other than the caller.
 *
 * @param {{get: Function}} store  STATE.dtus
 * @param {string} id              DTU id from the route
 * @param {object} ctx             makeCtx(req) (or any ctx ctxMayReadDtu accepts)
 * @param {{isShadow?: Function}} [opts]
 */
export function artifactDtuForViewer(store, id, ctx, opts = {}) {
  const dtu = store?.get?.(String(id || "")) || null;
  if (!dtu || typeof dtu !== "object") return null;
  if (typeof opts.isShadow === "function" && opts.isShadow(dtu)) return null;
  if (!ctxMayReadDtu(ctx, dtu)) return null;
  return dtu;
}

const PATH_KEYS = ["diskPath", "compressedPath", "transcodedPath"];

/**
 * Wire copy of an artifact ref without server filesystem paths. Storage is
 * unchanged. thumbnail / preview hold absolute paths in storage; on the wire
 * they become booleans (truthiness preserved). derivatives map name → path
 * (or nested objects of paths) and become name → boolean. Multipart parts lose their diskPath.
 */
export function publicArtifactRef(artifact) {
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) return artifact;
  const out = { ...artifact };
  for (const k of PATH_KEYS) delete out[k];
  for (const k of ["thumbnail", "preview"]) {
    if (typeof out[k] === "string") out[k] = out[k].length > 0;
  }
  if (out.derivatives && typeof out.derivatives === "object" && !Array.isArray(out.derivatives)) {
    const d = {};
    // Values are paths or nested objects of paths (video renditions).
    for (const [name, v] of Object.entries(out.derivatives)) d[name] = !!v;
    out.derivatives = d;
  }
  if (Array.isArray(out.parts)) {
    out.parts = out.parts.map((p) => {
      if (!p || typeof p !== "object") return p;
      const q = { ...p };
      for (const k of PATH_KEYS) delete q[k];
      return q;
    });
  }
  return out;
}

/**
 * Wire copy of a DTU whose artifact has no server paths. Returns the same
 * object when there is no artifact, so list rows without one are untouched.
 * Never mutates the stored DTU.
 */
export function withPublicArtifact(dtu) {
  if (!dtu || typeof dtu !== "object" || !dtu.artifact || typeof dtu.artifact !== "object") return dtu;
  return { ...dtu, artifact: publicArtifactRef(dtu.artifact) };
}

export default { artifactDtuForViewer, publicArtifactRef, withPublicArtifact };
