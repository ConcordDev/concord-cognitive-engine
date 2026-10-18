/**
 * What the user sees after chat_tools runs.
 *
 * The follow-up brain call used to be fed the pre-tool assistant reply.
 * That reply was already grounded in retrieved DTUs, so a failed tool
 * (create_dtu → not_formal_intent) came back as unrelated notes. Failures
 * and a plain DTU save are answered from the tool results only.
 *
 * A mixed batch (some ok, some failed) is NOT skipped: the model gets the
 * good results and is told about the failure. create_dtu-only batches still
 * skip the follow-up because the visible reply is synthesized directly.
 */

export function shouldSkipToolFollowup(results, opts = {}) {
  const list = Array.isArray(results) ? results : [];
  if (!list.length) return false;
  if (list.some((r) => !r?.ok)) {
    // Mixed batch: let the model use the good results and note the failure.
    if (list.some((r) => r?.ok && r?.tool !== "create_dtu")) return false;
    if (opts.allowRetry) {
      const retryable = list.every((r) => {
        if (r?.ok) return true;
        if (r?.retryHint || r?.validActions) return true;
        return /unknown tool|not registered|required|missing/i.test(String(r?.error || ""));
      });
      if (retryable) return false;
    }
    return true;
  }
  return list.every((r) => r?.tool === "create_dtu");
}

export function composeToolTurnReply(results) {
  const lines = [];
  for (const r of Array.isArray(results) ? results : []) {
    if (!r?.ok) {
      const err = r?.error || "it failed";
      lines.push(`I couldn't complete ${r?.tool || "that tool"}: ${String(err).replace(/[.!?]+\s*$/, "")}.`);
      continue;
    }
    if (r.tool === "create_dtu" && r.dtuId) {
      const title = r.title || "Untitled";
      const visibility = r.visibility || "private";
      lines.push(`Saved a ${visibility} DTU titled "${title}" (id: ${r.dtuId}).`);
    }
  }
  return lines.length ? lines.join("\n") : null;
}

/**
 * Follow-up turns see the user prompt and the tool results. They do not
 * see the pre-tool assistant draft — that draft is where retrieved,
 * off-topic notes were leaking into the visible reply.
 */
export function toolFollowUpUserMessage(prompt, toolResultsText) {
  return [
    "User prompt:",
    String(prompt || ""),
    "",
    "Tool results:",
    String(toolResultsText || ""),
    "",
    "GROUNDING RULES (mandatory):",
    "- Answer only from these tool results. If a tool failed, say plainly that you couldn't complete it. Do not substitute unrelated retrieved notes, documents, or earlier context.",
    "- If web_search results include numbered snippets with title/url/excerpt, cite at least one real title and full https URL from those snippets.",
    "- Quote or paraphrase only from the provided excerpts. Do not invent sources that are not listed.",
    "- Do NOT output any [TOOL_CALL:] markers.",
  ].join("\n");
}

export function followUpFailureReply(results, toolResultsText) {
  return composeToolTurnReply(results)
    || `I couldn't get a follow-up answer from the brain. Tool results:\n${String(toolResultsText || "").slice(0, 4000)}`;
}

/** Append any created DTU id the follow-up brain dropped. */
export function ensureCreatedDtuIds(reply, results) {
  const text = String(reply || "");
  const missing = (Array.isArray(results) ? results : []).filter(
    (r) => r?.ok && r.tool === "create_dtu" && r.dtuId && !text.includes(String(r.dtuId)),
  );
  if (!missing.length) return text;
  const extra = missing
    .map((r) => {
      const title = r.title || "Untitled";
      const visibility = r.visibility || "private";
      return `Saved a ${visibility} DTU titled "${title}" (id: ${r.dtuId}).`;
    })
    .join("\n");
  return text.trim() ? `${text.trim()}\n\n${extra}` : extra;
}
