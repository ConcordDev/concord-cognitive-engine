/**
 * INC-141: who may publish / unpublish a DTU to the public lattice
 * (POST|DELETE /api/dtus/:id/publish).
 *
 * The routes used to add any caller-supplied id to PUBLIC_LATTICE, so any
 * signed-in member could publish another user's private DTU and then read
 * its title and content through GET /api/public/:id and GET /api/public.
 *
 * The rule is the existing DTU write rule (dtuMutationDenial, the gate
 * dtu.update / dtu.delete use): the concrete owner, or a platform admin
 * role (owner / admin / founder / sovereign). Ownerless/system DTUs are
 * admin-only. A caller who fails it is told the DTU does not exist, the same
 * answer a missing id gets, so the id is not confirmed.
 */
import { dtuMutationDenial } from "./dtu-ownership.js";

/**
 * The DTU the caller may publish/unpublish, or null (missing or not theirs).
 *
 * @param {{get: Function}} store  STATE.dtus
 * @param {string} id
 * @param {object} ctx             makeCtx(req)
 * @param {{authMode?: string}} [opts]
 */
export function publishableDtuForCaller(store, id, ctx, opts = {}) {
  const dtu = store?.get?.(String(id || "")) || null;
  if (!dtu || typeof dtu !== "object") return null;
  const denial = dtuMutationDenial(dtu, ctx, { authMode: opts.authMode, verb: "update" });
  if (denial) return null;
  return dtu;
}

export default { publishableDtuForCaller };
