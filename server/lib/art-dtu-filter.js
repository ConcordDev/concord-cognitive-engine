// Art DTU membership. The Art lens sidebar is labeled "Art DTUs" and must
// not list music, chat, or other domains that happen to share the context
// query. Domain "art", lens meta "art", or kind "artwork"/"art" qualify.

export function dtuDomain(d) {
  return String(d?.domain || d?.meta?.lens || "").toLowerCase();
}

export function dtuKind(d) {
  return String(d?.machine?.kind || d?.kind || d?.meta?.type || "").toLowerCase();
}

export function isArtDtu(d) {
  if (!d || typeof d !== "object") return false;
  const domain = dtuDomain(d);
  const kind = dtuKind(d);
  return domain === "art" || kind === "artwork" || kind === "art";
}

/** domain query on dtu.list. "art" also keeps artwork-kind rows. */
export function dtuMatchesDomain(d, want) {
  const needle = String(want || "").toLowerCase();
  if (!needle) return true;
  if (dtuDomain(d) === needle) return true;
  if (needle === "art" && isArtDtu(d)) return true;
  if (dtuKind(d) === needle) return true;
  return false;
}
