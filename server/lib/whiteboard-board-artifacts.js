// Shadows of a whiteboard board (wb_*) stored as lens artifacts.
//
// The canvas lives on the whiteboard DTU (machine.kind === "whiteboard").
// The studio used to also POST /api/lens/whiteboard with type "board" and
// no link back to that DTU, then rename and delete only the DTU. These
// helpers decide which of those artifacts still belong to a live board
// and which are orphans. An artifact that stores its own elements is a
// canvas in the lens store, not a shadow, and is never treated as an orphan.

export function isBoardArtifact(artifact) {
  return Boolean(artifact && artifact.domain === "whiteboard" && artifact.type === "board");
}

export function shadowHasElements(artifact) {
  const elements = artifact?.data?.elements;
  return Array.isArray(elements) && elements.length > 0;
}

/** A studio shadow: type board, and no canvas of its own. */
export function isEmptyBoardShadow(artifact) {
  return isBoardArtifact(artifact) && !shadowHasElements(artifact);
}

/** Raw board name. The DTU title is stored as "Whiteboard: <name>". */
export function rawBoardTitle(record) {
  const fromData = record?.machine?.data?.title ?? record?.data?.title;
  if (typeof fromData === "string" && fromData.trim()) return fromData.trim();
  return String(record?.title || "").replace(/^Whiteboard:\s*/, "").trim();
}

/**
 * The one unlinked shadow with this owner and title.
 * Zero or more than one match returns null — a title collision is not
 * a safe delete.
 */
export function pickLegacyShadow(artifacts, { ownerId, title } = {}) {
  const want = String(title || "").trim();
  if (!want || !ownerId) return null;
  const matches = [];
  for (const artifact of artifacts || []) {
    if (!isEmptyBoardShadow(artifact)) continue;
    if (artifact.data?.whiteboardId) continue;
    if (artifact.ownerId !== ownerId) continue;
    if (String(artifact.title || "").trim() !== want) continue;
    matches.push(artifact);
  }
  return matches.length === 1 ? matches[0] : null;
}

/**
 * @param {object[]} artifacts lens artifacts (any domain)
 * @param {object[]} boards whiteboard DTUs (machine.kind === "whiteboard")
 * @returns {{ orphans: {artifact: object, reason: string}[], kept: {artifact: object, reason: string}[] }}
 */
export function classifyOrphanBoardArtifacts(artifacts, boards) {
  const liveIds = new Set();
  const liveTitles = new Set();
  for (const board of boards || []) {
    const kind = board?.machine?.kind || board?.kind;
    if (kind !== "whiteboard") continue;
    if (board.id) liveIds.add(String(board.id));
    const title = rawBoardTitle(board);
    const owner = board.ownerId || "";
    if (title) liveTitles.add(`${owner}\0${title}`);
  }

  const orphans = [];
  const kept = [];
  for (const artifact of artifacts || []) {
    if (!isBoardArtifact(artifact)) {
      kept.push({ artifact, reason: "not_a_board_artifact" });
      continue;
    }
    const link = artifact.data?.whiteboardId;
    if (typeof link === "string" && link) {
      if (liveIds.has(link)) kept.push({ artifact, reason: "linked_board_live" });
      else orphans.push({ artifact, reason: "linked_board_missing" });
      continue;
    }
    if (shadowHasElements(artifact)) {
      kept.push({ artifact, reason: "has_elements" });
      continue;
    }
    const key = `${artifact.ownerId || ""}\0${String(artifact.title || "").trim()}`;
    if (liveTitles.has(key)) kept.push({ artifact, reason: "title_matches_live_board" });
    else orphans.push({ artifact, reason: "unlinked_no_live_board" });
  }
  return { orphans, kept };
}
