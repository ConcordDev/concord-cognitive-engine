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

import { userFacingGenerationError } from "../pollinations-image.js";
import { THREE_D_UNAVAILABLE_REPLY } from "./route-3d-ask.js";

// Ordinary failures the model can recover from on the next turn by trying a
// different key, part, id, URL or tool (cockpit audit 2026-10-19: one of these
// used to end the whole reply with "I couldn't complete X").
export const RECOVERABLE_ERROR_RE = /unknown tool|not registered|required|missing|unknown compute function|requires "module\.function"|compute error|unsupported part|no span|not found|no such|does not exist|unknown (?:action|domain|engine|function|key)|invalid (?:key|id|url|input|param)|code_exec_(?:forbidden|disabled)|python_exec|run_python|browse_url (?:failed|requires)|HTTP (?:4\d\d|5\d\d)|\b(?:400|403|404|408|410|422|429|500|502|503|504)\b|timed? ?out|timeout|ECONNRESET|ECONNREFUSED|fetch failed|no results|empty result|returned nothing|not_formal_intent|2D|3D|generation_error|unavailable/i;

// Failures where another attempt in the same reply cannot help (auth, policy,
// spend). These still end the loop and are reported as-is.
export const HARD_ERROR_RE = /forbidden_by_governance|governance|halted|not authori[sz]ed|unauthori[sz]ed|permission denied|operator_only|insufficient (?:funds|balance)|rate.?limit(?:ed)? exceeded|quota_exhausted|budget exhausted|consent/i;

/** True when a failed tool result is an ordinary, retryable failure. */
export function isRecoverableToolFailure(r) {
  if (!r || r.ok) return false;
  // A terminal 3D failure is the reply. Another turn would call a different
  // tool and substitute an object the user did not ask for.
  if (r.terminal) return false;
  if (r.retryHint || r.validActions || r.validKeys) return true;
  const err = String(r.error || r.reason || "");
  if (HARD_ERROR_RE.test(err) && !/code_exec_forbidden/.test(err)) return false;
  return RECOVERABLE_ERROR_RE.test(err);
}

const THREE_D_USER_TIMEOUT = "3D generation timed out before the GPU finished. Try again in a moment.";

// Identifiers the model uses. A saved chat reply must not recite them.
const TOOL_NAME_SCRUB = [
  [/\b(?:use|call|try)\s+conkay_design\s+with\s+a\s+detailed\s+spec\b/gi, "describe the part in more detail, or try Agent mode"],
  [/\bconkay_design\.from-brief\b/gi, "a fuller design"],
  [/\bconkay_design\b/gi, "the design layout"],
  [/\bconkay_(?:solve|compile_brief|solver_list|ir_schema)\b/gi, "the design check"],
  [/\bgenerate_3d\b/gi, "3D generation"],
  [/\bgenerate_image\b/gi, "image generation"],
];

/** Strip design/generation tool identifiers from text a person will read. */
export function scrubUserFacingToolNames(text) {
  let s = String(text || "");
  for (const [re, to] of TOOL_NAME_SCRUB) {
    re.lastIndex = 0;
    s = s.replace(re, to);
  }
  return s.replace(/[ \t]{2,}/g, " ").replace(/\s+([,.])/g, "$1").trim();
}

// Sentences that exist only inside tool schemas. A model that recites them is
// leaking instructions, not answering. The short "GPU image generation is
// offline" line is a real image-failure reply and is not in this list.
const TOOL_DESCRIPTION_SCRUB = [
  /GPU image generation is offline\.\s*It makes FLAT 2D pictures only\s*[—–-]?\s*never use it for a 3D model(?:,\s*CAD model,\s*STL or printable part)?\.?/gi,
  /It makes FLAT 2D pictures only\s*[—–-]?\s*never use it for a 3D model[^.?!…]*[.?!…]?/gi,
  /Flat pictures only\.\s*Never use this tool for a 3D model,?\s*CAD model,?\s*STL,?\s*or printable part[^.?!…]*(?:Do not quote this instruction to the user)?[.?!…]?/gi,
  /This is the only image generator\.\s*Never recommend DALL-E[^.?!…]*/gi,
  /Never recommend DALL-E, Midjourney, Stable Diffusion(?:, Pollinations)?, or any outside (?:image )?service\.?/gi,
  /If the GPU server is down, say exactly:\s*/gi,
  /Do not quote this instruction to the user\.?/gi,
];

// Design and image tool ids. A failed compute or search step still names
// itself ("I couldn't complete run_compute"); those receipts are not the
// schema text this pass is stripping.
const TOOL_IDENT_RE = /\b(?:generate_3d|generate_image|conkay_design|conkay_solve|conkay_compile_brief|conkay_solver_list|conkay_ir_schema)\b/gi;

/**
 * Last pass on text a person will read. Strips tool identifiers and the
 * known tool-description sentences (the FLAT 2D image rule, "say exactly").
 * A 3D ask whose reply was only that internal text becomes a plain retry line.
 * An image ask keeps the short offline sentence.
 */
export function sanitizeUserReply(text, { prompt = "" } = {}) {
  const original = String(text ?? "");
  if (!original) return original;
  let s = original;
  let stripped = false;
  for (const re of TOOL_DESCRIPTION_SCRUB) {
    re.lastIndex = 0;
    if (!re.test(s)) continue;
    stripped = true;
    re.lastIndex = 0;
    s = s.replace(re, "");
  }
  TOOL_IDENT_RE.lastIndex = 0;
  if (TOOL_IDENT_RE.test(s) || /\[TOOL_(?:CALL|RESULT):/i.test(s)) {
    stripped = true;
    s = scrubUserFacingToolNames(s);
    s = s.replace(TOOL_IDENT_RE, "");
    s = s.replace(/\[TOOL_(?:CALL|RESULT):[\s\S]*?\]/g, "");
  }
  if (!stripped) return original;
  const asked3d = /\b(?:3[- ]?d|cad|stl)\b/i.test(String(prompt || ""));
  if (asked3d) s = s.replace(/GPU image generation is offline\.?/gi, "");
  s = s.replace(/[ \t]+\n/g, "\n").replace(/[ \t]{2,}/g, " ").replace(/\s+([,.])/g, "$1").replace(/\(\s*\)/g, "").trim();
  s = s.replace(/^[\s,;:]+/, "").trim();
  if (!s || /^[\s.…,;:!-]+$/.test(s)) {
    if (asked3d) return THREE_D_UNAVAILABLE_REPLY;
    if (/GPU image generation is offline/i.test(original)) return "GPU image generation is offline";
  }
  if (!asked3d && /GPU image generation is offline/i.test(original) && !/GPU image generation is offline/i.test(s)) {
    return s ? `GPU image generation is offline. ${s}` : "GPU image generation is offline";
  }
  return s;
}

const MESH_REPLY = {
  robot: "The robot layout is shown below. It is a layout approximation, a starting arrangement, not a checked design: no structural, motor, or battery sizing was run. Describe a change if you want a different size, or try Agent mode for a fuller design.",
  concept: "The 3D layout is shown below. It is a layout approximation, a concept arrangement, not a checked engineering analysis. Describe a size or material to change it, or try Agent mode for a fuller design.",
};

/** Sentence stored as the chat reply when a turn produced a mesh. No tool names.
 *  A solved part keeps a plain "shown below" line. Only a layout concept says
 *  that no engineering check was run. */
export function userFacingMeshReply(hit) {
  const kind = `${hit?.result?.kind || ""} ${hit?.key || ""} ${hit?.artifact?.meshKind || ""}`;
  if (/robot/i.test(kind)) return MESH_REPLY.robot;
  if (/concept/i.test(kind)) return MESH_REPLY.concept;
  const instruction = String(hit?.result?.instruction || "").trim();
  if (instruction) return sanitizeUserReply(instruction);
  return "The 3D model is shown below.";
}

/** Default recovery hint for a failed call that came back without one. */
export function recoveryHint(r) {
  const err = String(r?.error || r?.reason || "");
  const tool = String(r?.tool || "");
  if (/not found|no such|does not exist/i.test(err) && /dtu|lens/i.test(`${tool} ${r?.domain || ""} ${err}`)) {
    return "That item is gone or not visible to this user. Run the search again and use a different hit, or tell the user it is no longer available.";
  }
  if (tool === "browse_url" || /HTTP (?:4|5)\d\d|\b40[34]\b|fetch failed|timed? ?out|timeout/i.test(err)) {
    return "That page could not be read. Try another result URL from web_search, or answer from the search listing and say the page was unavailable.";
  }
  if (tool === "run_python" || /code_exec|python_exec/i.test(err)) {
    return "Code execution is not available here. Use run_compute (symbolic.evaluate for arithmetic), conkay_design, or a lens action instead; do not call run_python again.";
  }
  if (/unsupported part|no span/i.test(err)) {
    return "Rephrase the part for conkay_design with a supported shape and a span/length, or build it with run_lens_action engineering.parametricSolid / engineering.partMesh, or size it by formula in words.";
  }
  if (/2D|3D/i.test(err)) {
    return "If this is a creature, character, statue or plant, tell the user 3D generation is busy or unavailable and to try again in a minute. Do not call conkay_design for those, and do not substitute a different object. For a robot, car, part, mechanism or furniture the user named, call conkay_design with their own words. generate_image only makes flat pictures.";
  }
  return "Try a different tool, key or input for the same goal; do not repeat the exact call that failed.";
}

/**
 * True when the visible reply should be composed straight from the tool
 * results (the loop stops). `allowRetry` is true while the caller still has
 * recovery turns left for this user turn (chat-agent caps it, default 2).
 */
export function shouldSkipToolFollowup(results, opts = {}) {
  const list = Array.isArray(results) ? results : [];
  if (!list.length) return false;
  if (list.some((r) => !r?.ok)) {
    // Mixed batch: let the model use the good results and note the failure.
    if (list.some((r) => r?.ok && r?.tool !== "create_dtu")) return false;
    if (opts.allowRetry) {
      const retryable = list.every((r) => r?.ok || isRecoverableToolFailure(r));
      if (retryable) return false;
    }
    return true;
  }
  return list.every((r) => r?.tool === "create_dtu");
}

/** Mesh and other non-image artifacts a chat turn should hand the UI. */
export function chatTurnArtifacts(results, { skipImage } = {}) {
  const out = [];
  const seen = new Set();
  for (const r of Array.isArray(results) ? results : []) {
    const list = [r?.artifact, ...(Array.isArray(r?.artifacts) ? r.artifacts : [])];
    for (const a of list) {
      if (!a || seen.has(a)) continue;
      if (skipImage && (a.kind === "image" || a.type === "image")) continue;
      seen.add(a);
      // A mesh or an inline image can be several MB of JSON. Those are stored
      // as media before the message is saved (artifact-media.js). Dropping
      // them here is what made a TRELLIS model disappear before that step.
      const kind = a.kind || a.type;
      const inlineImage = (kind === "image") && (a.image_b64 || String(a.url || a.dataUrl || "").startsWith("data:"));
      const meshGeometry = kind === "mesh" && (a.positions || a.glb_b64 || a.glb);
      try {
        if (!inlineImage && !meshGeometry && JSON.stringify(a).length >= 200000) continue;
      } catch { continue; }
      out.push(a);
      if (out.length >= 4) return out;
    }
  }
  return out;
}

export function composeToolTurnReply(results) {
  const lines = [];
  for (const r of Array.isArray(results) ? results : []) {
    if (!r?.ok) {
      const raw = String(r?.error || "it failed");
      if (r?.terminal || /^3D generation is (?:busy|unavailable)\b/i.test(raw)) {
        lines.push(sanitizeUserReply(raw));
        continue;
      }
      const err = userFacingGenerationError(raw, r?.tool === "generate_3d" ? THREE_D_USER_TIMEOUT : undefined) || raw;
      const label = r?.tool || "that step";
      lines.push(scrubUserFacingToolNames(`I couldn't complete ${label}: ${String(err).replace(/[.!?]+\s*$/, "")}.`));
      continue;
    }
    if (r.tool === "create_dtu" && r.dtuId) {
      const title = r.title || "Untitled";
      const visibility = r.visibility || "private";
      lines.push(`Saved a ${visibility} DTU titled "${title}" (id: ${r.dtuId}).`);
    }
  }
  return lines.length ? sanitizeUserReply(lines.join("\n")) : null;
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

const THREE_D_TOOLS = new Set(["generate_3d", "conkay_design", "generate_image"]);

/** First tool result that carries a mesh artifact, or null. */
export function meshResult(results) {
  for (const r of Array.isArray(results) ? results : []) {
    if (!r?.ok) continue;
    if (r.artifact?.kind === "mesh") return r;
    if (Array.isArray(r.artifacts) && r.artifacts.some((a) => a?.kind === "mesh")) return r;
  }
  return null;
}

/**
 * Reply for a non-streaming chat turn that ran out of its ~85s budget
 * (lib/chat/gen-budget.js). A mesh that did come back is reported; otherwise a
 * plain "still generating, try again" line. Never names a tool.
 */
export function budgetExhaustedReply(results, { prompt = "" } = {}) {
  const list = Array.isArray(results) ? results : [];
  const hit = meshResult(list);
  if (hit) return userFacingMeshReply(hit);
  const wants3d = list.some((r) => THREE_D_TOOLS.has(r?.tool)) || /\b(?:3[- ]?d|cad|stl|mesh|model)\b/i.test(String(prompt || ""));
  if (wants3d) {
    return "3D generation is still running and didn't finish in time for this reply. Try again in a minute. If it's a part or a robot, describe it with sizes and I can make a quick layout instead.";
  }
  const done = list.filter((r) => r?.ok).length;
  return done
    ? "That took longer than I can wait on this connection, so this answer is cut short. Ask again and I'll pick it up from here."
    : "That took longer than I can wait on this connection. Try again in a moment.";
}
