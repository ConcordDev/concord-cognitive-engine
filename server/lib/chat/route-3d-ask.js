// Which 3D tool a chat turn should run when the model picked generate_image
// for a 3D/CAD ask. Engineered objects go to conkay_design (no GPU wait).
// Free-form objects go to generate_3d.

import { conceptKind } from "../conkay/concept-assembly.js";
import { ROBOT_RE } from "../conkay/robot-assembly.js";

const ENGINEERED_RE = /\b(?:cad|stl|beam|bracket|stand|truss|gear\s*box|gearbox|enclosure|robot|furniture|shelf|table|chair|cantilever|shaft|column|plate|frame|housing|mechanism|linkage|actuator|assembly)\b/i;

const GPU_FAIL_REASONS = new Set([
  "timeout", "gpu_busy", "gpu_wrong_model", "concept_failed", "mesh_failed",
  "local_gpu_unreachable", "generation_error", "weights_missing", "empty_mesh",
  "glb_parse_failed", "health_timeout",
]);

/** Engineered / CAD-ish 3D ask (robot, part, mechanism, CAD, STL, stand, …). */
export function isEngineered3dAsk(text) {
  const p = String(text || "").trim();
  if (!p) return false;
  return ENGINEERED_RE.test(p) || !!conceptKind(p) || ROBOT_RE.test(p);
}

/**
 * @returns {{ tool: "conkay_design", params: { text: string } } | { tool: "generate_3d", params: { prompt: string } } | null}
 */
export function toolFor3dAsk(text) {
  const p = String(text || "").trim();
  if (!p) return null;
  if (isEngineered3dAsk(p)) {
    return { tool: "conkay_design", params: { text: p.slice(0, 4000) } };
  }
  return { tool: "generate_3d", params: { prompt: p.slice(0, 600) } };
}

/**
 * When free-form 3D generation fails on an engineered ask, build the local
 * layout instead of ending the turn with no model. Free-form asks (a dragon,
 * a figurine) stay a plain failure.
 * @returns {{ tool: "conkay_design", params: { text: string } } | null}
 */
export function fallbackDesignCall(userText, toolPrompt, failure) {
  if (!failure || failure.ok) return null;
  const reason = String(failure.reason || "");
  const err = String(failure.error || "");
  const failed = GPU_FAIL_REASONS.has(reason) || /timed?\s*out|unavailable|busy|\bgpu\b/i.test(`${reason} ${err}`);
  if (!failed) return null;
  const user = String(userText || "").trim();
  const tool = String(toolPrompt || "").trim();
  const source = isEngineered3dAsk(user) ? user : (isEngineered3dAsk(tool) ? tool : "");
  if (!source) return null;
  return { tool: "conkay_design", params: { text: source.slice(0, 4000) } };
}
