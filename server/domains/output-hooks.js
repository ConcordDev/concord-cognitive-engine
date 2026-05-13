// server/domains/output-hooks.js — Phase J4
//
// Exposes lib/output-hooks.js as a macro surface so callers can opt
// into the constitution-check + ghost-thread + fingerprint pre-render
// pipeline without bypassing the existing chat.respond path.
//
//   output_hooks.process(text)  → { text, flags, blocked, ghostInsights }
//   output_hooks.quick_check(text) → { ok, blockedReason? }
//
// chat.respond can re-route through this wrapper or callers can hit
// it directly before showing model output to the player.

import outputHooks from "../lib/output-hooks.js";

export default function registerOutputHooksMacros(register) {
  register("output_hooks", "process", async (ctx, input = {}) => {
    const userId = ctx?.actor?.userId || "system";
    const { text, context = {} } = input || {};
    if (!text) return { ok: false, reason: "missing_text" };
    try {
      const result = await outputHooks.processOutput(userId, text, context);
      return { ok: true, ...result };
    } catch (err) {
      return { ok: false, reason: "process_failed", error: err?.message };
    }
  }, { note: "Run an output through the constitution + fingerprint + ghost-thread pipeline." });

  register("output_hooks", "quick_check", async (ctx, input = {}) => {
    const userId = ctx?.actor?.userId || "system";
    const { text, context = {} } = input || {};
    if (!text) return { ok: false, reason: "missing_text" };
    try {
      const result = await outputHooks.quickConstitutionCheck(userId, text, context);
      return { ok: true, ...result };
    } catch (err) {
      return { ok: false, reason: "check_failed", error: err?.message };
    }
  }, { note: "Cheap constitution check (no fingerprint write)." });
}
