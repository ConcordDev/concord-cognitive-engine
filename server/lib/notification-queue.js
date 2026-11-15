/**
 * The platform notification queue (STATE.queues.notifications) is a
 * SHARED array: `enqueueNotification` feeds it genuine user-facing
 * notifications (fired alerts, reminders, action notifications — items
 * with a title and/or a message payload, optionally addressed via
 * targetUserId) AND the autogen pipeline's operator proposals
 * (type "dtu_proposal": a DTU candidate payload, no title, addressed to
 * no user, queued for operator review and read back through the state
 * snapshot, not through the notification routes).
 *
 * The user-facing /api/notifications routes (list, count, read, delete)
 * must only ever present the first kind. Presenting proposals as
 * notifications rendered them as blank system items in the bell panel
 * (no title, no message) and counted every accumulated proposal as
 * unread — the bell sat at 99+ over a pile of blanks (FIX-social-020).
 *
 * @param {unknown} item a raw queue entry
 * @returns {boolean} true when the entry is a user-facing notification
 */
export function isUserNotification(item) {
  if (!item || typeof item !== "object") return false;
  if (item.type === "dtu_proposal") return false;
  return true;
}
