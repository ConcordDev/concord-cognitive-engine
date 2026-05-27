// server/domains/news-compose.js
//
// Phase II Wave 21 — news auto-compose domain macros.

import {
  runNewsComposePass,
  composeStoryFromEvent,
  listRecentStories,
} from "../lib/news-story-composer.js";

export default function registerNewsComposeMacros(register) {
  register("news", "auto_compose", async (ctx) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return runNewsComposePass(db);
  });

  register("news", "compose_one", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return composeStoryFromEvent(db, {
      kind: input?.kind,
      sourceId: input?.sourceId,
      signature: input?.signature,
      vars: input?.vars || {},
      timestamp: input?.timestamp,
    });
  });

  register("news", "list_recent", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return { ok: true, stories: listRecentStories(db, { limit: input?.limit, kind: input?.kind }) };
  });
}
