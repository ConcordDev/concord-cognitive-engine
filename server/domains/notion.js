// server/domains/notion.js
//
// Real Notion connector. Thin macros over the SSRF-guarded connector egress
// (lib/connector-client.js), reading the user's stored OAuth token (connector_id
// "notion") with Bearer auth + the required Notion-Version header. Inbound read
// (search, page get) + outbound write (append block). Honest reason codes when
// no token / not configured — never faked data.

import { searchNotion, readNotionPage, appendNotionBlock } from "../lib/connector-client.js";

const NOTION_ENABLED = process.env.CONCORD_NOTION_ENABLED !== "0";

export default function registerNotionActions(registerLensAction) {
  const uid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const fail = (res, fallback) => {
    const reason = res?.reason || fallback;
    return { ok: false, reason, error: reason, detail: res };
  };
  const guard = (ctx) => {
    if (!NOTION_ENABLED) return { ok: false, reason: "notion_disabled", error: "notion_disabled" };
    const userId = uid(ctx);
    if (!userId || userId === "anon") return { ok: false, reason: "no_user", error: "no_user" };
    if (!ctx?.db) return { ok: false, error: "db unavailable" };
    return null;
  };

  // Search pages/databases. params: { query?, pageSize?, filter? }
  registerLensAction("notion", "search", async (ctx, _a, params = {}) => {
    const bad = guard(ctx); if (bad) return bad;
    try {
      const res = await searchNotion(ctx.db, uid(ctx), { query: params.query, pageSize: params.pageSize, filter: params.filter });
      if (!res.ok) return fail(res, "search_failed");
      return { ok: true, result: { results: res.results, nextCursor: res.nextCursor, hasMore: res.hasMore } };
    } catch (e) {
      return { ok: false, error: "handler_error", message: String(e?.message || e) };
    }
  });

  // Read a page. params: { pageId }
  registerLensAction("notion", "get", async (ctx, _a, params = {}) => {
    const bad = guard(ctx); if (bad) return bad;
    const pageId = params.pageId || params.id;
    if (!pageId) return { ok: false, error: "pageId required" };
    try {
      const res = await readNotionPage(ctx.db, uid(ctx), pageId);
      if (!res.ok) return fail(res, "get_failed");
      return { ok: true, result: { page: res.page } };
    } catch (e) {
      return { ok: false, error: "handler_error", message: String(e?.message || e) };
    }
  });

  // Append a paragraph to a page/block. params: { blockId|pageId, text }
  registerLensAction("notion", "append", async (ctx, _a, params = {}) => {
    const bad = guard(ctx); if (bad) return bad;
    const blockId = params.blockId || params.pageId || params.id;
    if (!blockId) return { ok: false, error: "blockId required" };
    if (!params.text) return { ok: false, error: "text required" };
    try {
      const res = await appendNotionBlock(ctx.db, uid(ctx), blockId, params.text);
      if (!res.ok) return fail(res, "append_failed");
      return { ok: true, result: { appended: res.appended, blockId: res.blockId } };
    } catch (e) {
      return { ok: false, error: "handler_error", message: String(e?.message || e) };
    }
  });

  // Authorize URL. Tokens persist under connector_id "notion". Notion
  // capabilities (read/update/insert content) are configured on the integration
  // in Notion's console, not requested per-call — the scope tokens here are
  // nominal so the authorize route accepts the request.
  registerLensAction("notion", "connect", (_ctx, _a, params = {}) => {
    const scopes = ["read", "update", "insert"];
    const qs = new URLSearchParams({ token_key: "notion", scopes: scopes.join(" ") });
    if (params.redirect) qs.set("redirect", String(params.redirect));
    return { ok: true, result: { provider: "notion", authorizeUrl: `/api/oauth/notion/authorize?${qs.toString()}`, scopes } };
  });
}
