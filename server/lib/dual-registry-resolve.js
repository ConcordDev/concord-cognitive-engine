// server/lib/dual-registry-resolve.js
//
// Concord macros can land in either of two disjoint registries:
//   - LENS_ACTIONS (populated by registerLensAction(domain, action, handler))
//     — e.g. math.symbolicCompute, the code.dsl authoring surface.
//   - MACROS (populated by register(domain, name, handler), resolved via
//     runMacro(domain, name, input, ctx)) — the majority of domain macros,
//     INCLUDING anything a loaded plugin registers
//     (server/plugins/loader.js -> register()).
//
// server.js's runMcpTool (the dispatcher used by the MCP server and by
// /api/lens/run) is the only place in the codebase that checks BOTH
// registries — "prefer LENS_ACTIONS, then MACROS" — before this module
// existed. server/lib/chat-agent.js's `run_lens_action` tool checked ONLY
// LENS_ACTIONS, which meant any macro registered solely via plain
// register() (including every loaded plugin's macros) was unreachable
// through ConKay's own tool-calling loop, even though the exact same
// (domain, action) pair worked fine through the MCP server or a direct
// /api/lens/run call. See docs/CONKAY_TOOL_AUTHORING_SPEC.md's "Corrections
// to the task's framing" section for the full trace of how this gap was
// found.
//
// This module is the single shared "which registry answers this
// (domain, action) pair" resolution helper both dispatchers now call, so
// the "prefer LENS_ACTIONS, then MACROS" order can't silently drift
// between server.js's runMcpTool and chat-agent.js's run_lens_action tool.
//
// Deliberately narrow: this ONLY answers "which registry, if either,
// resolves this pair" — it does not build a virtualArtifact, does not peel
// any input-wrapper convention (that's an /api/lens/run-specific concern
// living in lens-input-normalize.js), and does not itself invoke anything.
// Callers decide what second/third arguments their own handler call needs.

/**
 * @param {string} domain
 * @param {string} name
 * @param {{ lensActions?: Map<string, Function>, runMacro?: Function, macros?: Map }} registries
 *        `macros` is the canonical MACROS registry (Map<domain, Map<name, entry>>).
 *        When omitted, `globalThis._concordMACROS` (set by server.js) is used.
 * @returns {{ via: 'lens_action', handler: Function, key: string }
 *         | { via: 'macro', key: string }
 *         | { via: 'none', key: string, reason?: string }}
 *
 * `via: 'macro'` now means the (domain, name) pair is ACTUALLY registered in
 * MACROS — not just "runMacro is callable". Previously this returned 'macro'
 * for any pair as long as runMacro was a function, so a misnamed / never-
 * registered (domain, action) — the exact thing ConKay guesses wrong — got
 * `via: 'macro'`, and the caller's `runMacro()` then threw
 * "macro not found: d.n", surfacing to the model as an opaque
 * "lens action error" instead of a clean "unknown action, list_lens_actions
 * for the real names". A caller can pass `strict: false` to opt back into the
 * old permissive behavior if it genuinely wants to attempt the call.
 */
export function resolveDualRegistry(domain, name, { lensActions, runMacro, macros, strict = true } = {}) {
  const key = `${domain}.${name}`;
  const hasLensActions = !!(lensActions && typeof lensActions.get === "function");
  const lensHandler = hasLensActions ? lensActions.get(key) : null;
  if (lensHandler) return { via: "lens_action", handler: lensHandler, key };

  if (typeof runMacro !== "function") return { via: "none", key, reason: "no_dispatcher" };

  // Strict mode downgrades to via:"none" ONLY when we can POSITIVELY determine
  // the pair is not registered — i.e. a real MACROS map is available and the
  // lookup misses. With no map to consult (isolated unit contexts), or with
  // strict:false, fall back to the permissive "attempt it via runMacro".
  const macroMap = strict
    ? (macros || (typeof globalThis !== "undefined" ? globalThis._concordMACROS : null))
    : null;
  if (macroMap && typeof macroMap.get === "function") {
    const registered = !!macroMap.get(domain)?.get?.(name);
    if (!registered) return { via: "none", key, reason: "not_registered" };
  }
  return { via: "macro", key };
}

export default resolveDualRegistry;
