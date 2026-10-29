/**
 * Pure interaction reducers for the forum POST-ARTIFACT family
 * (server.js registerLensAction("forum", …) handlers).
 *
 * BoardPanel used to persist votes, comments, saves and awards by
 * rewriting the WHOLE post artifact through the generic lens.update
 * — which is exactly the write path SEC Fix 7 closes to non-owners.
 * These reducers apply ONE caller's ONE change to a post (or one of
 * its comments) so the new server actions never need the client to
 * send, or be able to forge, any other part of the post:
 *
 * - applyBallot: one ballot per user, kept in a `voters` map on the
 *   item; the score moves by the ballot delta. Clicking the same
 *   direction again retracts the ballot.
 * - appendCommentTree / findCommentInTree / countCommentTree: the
 *   recursive comment tree inside a post's data.
 * - applyAward: appends one award and applies the product's +10
 *   score bump (the same bump the client applied optimistically).
 * - toggleSavedBy: the caller's own save flag, kept as a `savedBy`
 *   user-id list on the post — never a shared boolean one user can
 *   flip for everyone.
 *
 * All functions mutate the item passed in (the live artifact data)
 * and return small result facts for the handler to reply with.
 */

export function applyBallot(item, userId, direction) {
  if (!item || typeof item !== "object") return null;
  if (!item.voters || typeof item.voters !== "object" || Array.isArray(item.voters)) {
    item.voters = {};
  }
  const dir = Math.sign(Number(direction) || 0);
  const prev = Number(item.voters[userId]) || 0;
  const next = dir === 0 || prev === dir ? 0 : dir;
  if (next === 0) delete item.voters[userId];
  else item.voters[userId] = next;
  const score = (Number(item.score) || 0) + (next - prev);
  item.score = score;
  return { score, userVote: next };
}

export function findCommentInTree(comments, commentId) {
  if (!Array.isArray(comments) || !commentId) return null;
  for (const c of comments) {
    if (c?.id === commentId) return c;
    const hit = findCommentInTree(c?.replies, commentId);
    if (hit) return hit;
  }
  return null;
}

export function countCommentTree(comments) {
  if (!Array.isArray(comments)) return 0;
  let n = 0;
  for (const c of comments) {
    n += 1 + countCommentTree(c?.replies);
  }
  return n;
}

/**
 * Appends `comment` at the top level (parentId null) or into the
 * replies of the comment with id `parentId`. Returns false when a
 * parentId was given but no such comment exists (the handler then
 * refuses instead of silently re-rooting the reply).
 */
export function appendCommentTree(comments, parentId, comment) {
  if (!Array.isArray(comments)) return false;
  if (!parentId) {
    comments.push(comment);
    return true;
  }
  const parent = findCommentInTree(comments, parentId);
  if (!parent) return false;
  if (!Array.isArray(parent.replies)) parent.replies = [];
  parent.replies.push(comment);
  return true;
}

export function applyAward(item, award) {
  if (!item || typeof item !== "object") return null;
  if (!Array.isArray(item.awards)) item.awards = [];
  item.awards.push(award);
  item.score = (Number(item.score) || 0) + 10;
  return { awards: item.awards, score: item.score };
}

export function toggleSavedBy(item, userId) {
  if (!item || typeof item !== "object") return null;
  if (!Array.isArray(item.savedBy)) item.savedBy = [];
  const idx = item.savedBy.indexOf(userId);
  let saved;
  if (idx >= 0) {
    item.savedBy.splice(idx, 1);
    saved = false;
  } else {
    item.savedBy.push(userId);
    saved = true;
  }
  return { saved };
}
