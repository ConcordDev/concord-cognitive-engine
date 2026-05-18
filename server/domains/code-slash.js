// server/domains/code-slash.js
//
// Code Sprint B Item #9 — slash command parser + skill resolver
// macros. The frontend chat input parses `/cmd args` locally for
// fast feedback, then sends to code.slash_dispatch which actually
// runs the resolved macro on the server.

import { parseSlash, listBuiltins } from "../lib/code/slash-commands.js";

function _runMacro(ctx, domain, name, input) {
  if (typeof ctx?.runMacro === "function") return ctx.runMacro(domain, name, input);
  if (typeof globalThis._concordRunMacro === "function") {
    return globalThis._concordRunMacro(domain, name, input, ctx);
  }
  throw new Error("no_macro_dispatcher");
}

export default function registerCodeSlashMacros(register) {
  register("code", "slash_builtins", async () => {
    return { ok: true, builtins: listBuiltins() };
  }, { note: "Lists built-in slash commands for the / autocomplete menu" });

  register("code", "slash_skills_list", async (ctx) => {
    const db = ctx?.db || ctx?.STATE?.db;
    const userId = ctx?.actor?.userId || ctx?.userId;
    if (!db || !userId) return { ok: true, skills: [] };
    try {
      const rows = db.prepare(`
        SELECT id, title, meta_json FROM dtus
        WHERE kind = 'code_skill' AND creator_id = ?
        ORDER BY created_at DESC LIMIT 100
      `).all(userId);
      const skills = rows.map((r) => {
        let meta = {};
        try { meta = JSON.parse(r.meta_json || "{}"); } catch { /* tolerate malformed */ }
        return { id: r.id, name: meta.name || r.title || r.id, description: meta.description || "" };
      });
      return { ok: true, skills };
    } catch {
      return { ok: true, skills: [] };
    }
  }, { note: "List user-authored slash skills (kind=code_skill DTUs)" });

  register("code", "slash_skill_save", async (ctx, input = {}) => {
    const db = ctx?.db || ctx?.STATE?.db;
    const userId = ctx?.actor?.userId || ctx?.userId;
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const name = String(input.name || "").trim();
    if (!name || !/^[a-z0-9_-]{2,40}$/i.test(name)) return { ok: false, reason: "invalid_name" };
    const prompt = String(input.prompt || input.template || "").trim();
    if (!prompt) return { ok: false, reason: "prompt_required" };
    const description = String(input.description || "").slice(0, 500);
    const id = `code_skill:${name}:${Date.now()}`;
    const meta = {
      name, description, prompt,
      domain: input.dispatch_domain || "code",
      macro: input.dispatch_macro || "multi-file-plan",
    };
    try {
      db.prepare(`
        INSERT INTO dtus (id, kind, title, creator_id, meta_json, skill_level, total_experience, created_at)
        VALUES (?, 'code_skill', ?, ?, ?, 1, 0, unixepoch())
      `).run(id, name, userId, JSON.stringify(meta));
      return { ok: true, skillDtuId: id, name };
    } catch (err) {
      return { ok: false, reason: "insert_failed", error: err?.message };
    }
  }, { destructive: true, note: "Save a custom slash skill as kind='code_skill' DTU" });

  register("code", "slash_dispatch", async (ctx, input = {}) => {
    const db = ctx?.db || ctx?.STATE?.db;
    const userId = ctx?.actor?.userId || ctx?.userId;
    const line = String(input.line || "").trim();
    if (!line) return { ok: false, reason: "empty" };
    const dispatchCtx = input.dispatchCtx || {};
    const skillResolver = (db && userId) ? async (name) => {
      const row = db.prepare(`
        SELECT id, title, meta_json FROM dtus
        WHERE kind = 'code_skill' AND creator_id = ?
        AND (title = ? OR id LIKE ?)
        ORDER BY created_at DESC LIMIT 1
      `).get(userId, name, `code_skill:${name}:%`);
      if (!row) return null;
      let meta = {};
      try { meta = JSON.parse(row.meta_json || "{}"); } catch { /* ok */ }
      return { id: row.id, ...meta };
    } : null;
    const parsed = await parseSlash(line, dispatchCtx, skillResolver);
    if (parsed.error) return { ok: false, reason: parsed.error, name: parsed.name };
    if (parsed.domain === "_meta") {
      return { ok: true, meta: true, ...parsed.input };
    }
    // Real dispatch — call the resolved macro for real.
    let result;
    try {
      result = await _runMacro(ctx, parsed.domain, parsed.macro, parsed.input);
    } catch (err) {
      return { ok: false, reason: "dispatch_failed", error: err?.message, parsed };
    }
    return { ok: true, parsed, result };
  }, { destructive: true, note: "Parse a /-prefixed line and dispatch to the resolved macro" });
}
