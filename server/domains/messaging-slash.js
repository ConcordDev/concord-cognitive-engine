// server/domains/messaging-slash.js
//
// Sprint B #16 — slash command dispatcher. Frontend chat input passes
// the raw `/cmd args` line + the current conversationId; we parse +
// resolve + execute the matching real macro.

import { parseSlash, listBuiltins } from "../lib/messaging/slash-commands.js";

function _runMacro(ctx, domain, name, input) {
  if (typeof ctx?.runMacro === "function") return ctx.runMacro(domain, name, input);
  if (typeof globalThis._concordRunMacro === "function") {
    return globalThis._concordRunMacro(domain, name, input, ctx);
  }
  throw new Error("no_macro_dispatcher");
}

export default function registerMessagingSlashMacros(register) {
  register("messaging", "slash_builtins", async () => {
    return { ok: true, builtins: listBuiltins() };
  }, { note: "List built-in slash commands (for the / menu)" });

  register("messaging", "slash_dispatch", async (ctx, input = {}) => {
    const line = String(input.line || "").trim();
    const dispatchCtx = input.dispatchCtx || {};
    if (!line) return { ok: false, reason: "empty" };
    const parsed = parseSlash(line, dispatchCtx);
    if (parsed.error) return { ok: false, reason: parsed.error, name: parsed.name };
    if (parsed.domain === "_meta") return { ok: true, meta: true, ...parsed.input };
    try {
      const result = await _runMacro(ctx, parsed.domain, parsed.macro, parsed.input);
      return { ok: true, parsed, result };
    } catch (err) {
      return { ok: false, reason: "dispatch_failed", error: err?.message };
    }
  }, { destructive: true, note: "Parse a /-prefixed line + dispatch the resolved macro" });
}
