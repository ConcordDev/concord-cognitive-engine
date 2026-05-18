// server/domains/messaging-snippets.js
//
// Message lens Sprint B #17 — saved replies / snippets as citable DTUs.
// Concord-native moat: every snippet is a kind='message_snippet' DTU.
// When another user reuses a public snippet via snippet_use, royalty
// cascade fires (kind-agnostic registerCitation) so the original
// author earns CC.

import { randomUUID } from "node:crypto";
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

export default function registerMessagingSnippetMacros(register) {
  register("messaging", "snippet_create", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const title = String(input.title || "").trim();
    const body = String(input.body || "").trim();
    if (!title || !body) return { ok: false, reason: "title_and_body_required" };
    if (body.length > 8000) return { ok: false, reason: "body_too_long" };
    const visibility = input.visibility === "public" ? "public" : "personal";
    const license = String(input.license || "CC-BY-SA");
    const priceCents = Math.max(0, Math.min(10_000, Number(input.priceCents) || 0));
    const tags = Array.isArray(input.tags) ? input.tags.slice(0, 8).map((t) => String(t).slice(0, 40)) : [];
    const id = `message_snippet:${randomUUID()}`;
    const meta = {
      type: "message_snippet",
      title, body, tags, visibility, license, price_cents: priceCents,
      consent: { allowCitations: visibility === "public" },
    };
    try {
      db.prepare(`
        INSERT INTO dtus (id, kind, title, creator_id, meta_json, skill_level, total_experience, created_at)
        VALUES (?, 'message_snippet', ?, ?, ?, 1, 0, unixepoch())
      `).run(id, title.slice(0, 200), userId, JSON.stringify(meta));
      return { ok: true, snippetDtuId: id, visibility, license };
    } catch (err) {
      return { ok: false, reason: "insert_failed", error: err?.message };
    }
  }, { destructive: true, note: "Mint a kind='message_snippet' DTU; public snippets earn via cascade on reuse" });

  register("messaging", "snippet_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db) return { ok: false, reason: "no_db" };
    const scope = String(input.scope || "mine");
    const limit = Math.min(200, Math.max(1, Number(input.limit) || 50));
    let rows;
    if (scope === "mine") {
      if (!userId) return { ok: false, reason: "auth_required" };
      rows = db.prepare(`SELECT id, title, creator_id, created_at, meta_json FROM dtus WHERE kind = 'message_snippet' AND creator_id = ? ORDER BY created_at DESC LIMIT ?`).all(userId, limit);
    } else if (scope === "public") {
      rows = db.prepare(`SELECT id, title, creator_id, created_at, meta_json FROM dtus WHERE kind = 'message_snippet' ORDER BY created_at DESC LIMIT ?`).all(limit);
    } else {
      return { ok: false, reason: "invalid_scope" };
    }
    const snippets = rows.map((r) => {
      let meta = {}; try { meta = JSON.parse(r.meta_json || "{}"); } catch { /* ok */ }
      return {
        id: r.id, title: r.title, creator_id: r.creator_id, created_at: r.created_at,
        body: meta.body, tags: meta.tags || [],
        visibility: meta.visibility, license: meta.license,
        price_cents: meta.price_cents || 0,
      };
    }).filter((s) => scope === "mine" || s.visibility === "public");
    return { ok: true, snippets, count: snippets.length };
  }, { note: "List the caller's snippets (scope: mine) or all public snippets (scope: public)" });

  register("messaging", "snippet_use", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const snippetDtuId = String(input.snippetDtuId || "");
    const conversationId = String(input.conversationId || "");
    if (!snippetDtuId || !conversationId) return { ok: false, reason: "snippetDtuId_and_conversationId_required" };
    if (!hasRole(db, conversationId, userId, "member")) return { ok: false, reason: "forbidden" };
    const snippet = db.prepare(`SELECT id, creator_id, meta_json FROM dtus WHERE id = ? AND kind = 'message_snippet'`).get(snippetDtuId);
    if (!snippet) return { ok: false, reason: "snippet_not_found" };
    let meta = {}; try { meta = JSON.parse(snippet.meta_json || "{}"); } catch { /* ok */ }
    const body = meta.body;
    if (!body) return { ok: false, reason: "snippet_missing_body" };
    // Post as a real message
    const sent = postMessage(db, {
      conversationId, authorId: userId, body, bodyKind: "text",
      parentMessageId: input.parentMessageId || null,
    });
    if (!sent.ok) return sent;
    // Fire the cascade citation when the snippet was authored by someone else AND is public.
    let cascadeRegistered = false;
    if (snippet.creator_id !== userId && meta.visibility === "public") {
      cascadeRegistered = await _registerCascadeCitation(db, sent.id, snippetDtuId, userId);
    }
    return { ok: true, messageId: sent.id, snippetDtuId, cascadeRegistered, sameAuthor: snippet.creator_id === userId };
  }, { destructive: true, note: "Post a snippet's body as a real message; cascades a citation back to the author when public + cross-user" });
}
