/**
 * Resolve the DTU a mesh send is about.
 *
 * The picker lists both the shared store and the caller's local universe.
 * mesh.send used to read only STATE.dtus, so a selected local DTU came
 * back as "No DTU specified" even though the id was on the request.
 * An inline object is the caller's own payload and is not looked up.
 */

export function resolveMeshSendDtu({ stateDtus, localDtus, dtuId, inlineDtu, userId }) {
  if (inlineDtu) return { ok: true, dtu: inlineDtu };
  const id = typeof dtuId === "string" ? dtuId.trim() : "";
  if (!id) return { ok: false, error: "No DTU specified. Provide dtu or dtuId." };
  const stored = stateDtus?.get?.(id) || localDtus?.get?.(id) || null;
  if (!stored) return { ok: false, error: "No DTU specified. Provide dtu or dtuId." };
  const isOwner = !stored.ownerId || stored.ownerId === userId ||
    stored.ownerId === "system" || stored.ownerId === "founder";
  const vis = stored.meta?.visibility || stored.visibility;
  const isPublic = vis === "published" || vis === "public" || stored.scope === "global";
  if (!isOwner && !isPublic) return { ok: false, error: "not_your_dtu" };
  return { ok: true, dtu: stored };
}
