/**
 * Who may subscribe to `whiteboard:<boardId>`.
 * A shared board is owner or invited participant only.
 * A private board is its owner only. Knowing the id is not membership.
 */
export function whiteboardRoomAllowed(state, userId, boardId) {
  if (!userId || !boardId) return false;
  const wb = state?.whiteboardLens;
  if (!wb) return false;
  const shared = wb.sharedBoards?.get?.(boardId);
  if (shared && (shared.ownerId === userId || shared.participants?.has?.(userId))) return true;
  const own = wb.boards?.get?.(userId);
  return !!own?.has?.(boardId);
}
