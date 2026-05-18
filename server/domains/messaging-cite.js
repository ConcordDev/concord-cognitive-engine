// server/domains/messaging-cite.js
//
// Message lens Sprint C #22 — cross-lens DTU citation in messages.
//
// Cite any concord DTU (chord_progression / code_spec /
// whiteboard_board / message_snippet / etc.) directly in a message
// body. Posts a body_kind='dtu_embed' message + registers the
// royalty cascade. Cross-lens reach: the original author of the
// cited DTU earns when the citing thread is later cited or
// purchased.

import { hasRole, postMessage } from "../lib/messaging/persistence.js";

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }
function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || null; }

async function _registerCascadeCitation(db, childId, parentId, childCreatorId) {
  try {
    const { registerCitation } = await import("../economy/royalty-cascade.js");
    const parent = db.prepare("SELECT creator_id FROM dtus WHERE id = ?").get(parentId);
    if (!parent?.creator_id) return false;
    const r = registerCitation(db, {
      childId, parentId,
      creatorId: childCreatorId, parentCreatorId: parent.creator_id,
      parentDtu: { visibility: "public" },
    });
    return !!r?.ok;
  } catch { return false; }
}

export default function registerMessagingCiteMacros(register) {
  register("messaging", "cite_dtu_in_message", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const conversationId = String(input.conversationId || "");
    const dtuId = String(input.dtuId || "");
    if (!conversationId || !dtuId) return { ok: false, reason: "conversationId_and_dtuId_required" };
    if (!hasRole(db, conversationId, userId, "member")) return { ok: false, reason: "forbidden" };
    const cited = db.prepare(`SELECT id, kind, title, creator_id FROM dtus WHERE id = ?`).get(dtuId);
    if (!cited) return { ok: false, reason: "dtu_not_found" };
    const annotation = String(input.body || "").trim().slice(0, 4000);
    // Real message — body_kind='dtu_embed', body is the optional
    // annotation, attachments_json carries the cited DTU summary.
    const sent = postMessage(db, {
      conversationId, authorId: userId,
      body: annotation, bodyKind: "dtu_embed",
      parentMessageId: input.parentMessageId || null,
      attachments: [{ kind: "dtu_embed", dtuId, dtuKind: cited.kind, dtuTitle: cited.title }],
    });
    if (!sent.ok) return sent;
    // Cascade citation (so the cited DTU's creator earns when this
    // thread is later cited or sold). Skip if same-author.
    let cascadeRegistered = false;
    if (cited.creator_id !== userId) {
      cascadeRegistered = await _registerCascadeCitation(db, sent.id, dtuId, userId);
    }
    try {
      globalThis._concordREALTIME?.io?.to(`conversation:${conversationId}`).emit("messaging:dtu-cited", {
        conversationId, messageId: sent.id, dtuId, dtuKind: cited.kind, userId,
      });
    } catch { /* best effort */ }
    return { ok: true, messageId: sent.id, dtuId, cascadeRegistered, sameAuthor: cited.creator_id === userId };
  }, { destructive: true, note: "Post a message that embeds a DTU; fires royalty cascade when cross-user" });
}
