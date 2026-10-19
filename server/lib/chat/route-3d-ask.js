// Which 3D tool a chat turn should run when the model picked generate_image
// for a 3D/CAD ask. Engineered objects go to conkay_design (no GPU wait).
// Free-form objects go to generate_3d.

import { conceptKind } from "../conkay/concept-assembly.js";
import { ROBOT_RE } from "../conkay/robot-assembly.js";

const ENGINEERED_RE = /\b(?:cad|beam|bracket|stand|truss|gear\s*box|gearbox|enclosure|robot|furniture|shelf|table|chair|cantilever|shaft|column|plate|frame|housing)\b/i;

/**
 * @returns {{ tool: "conkay_design", params: { text: string } } | { tool: "generate_3d", params: { prompt: string } } | null}
 */
export function toolFor3dAsk(text) {
  const p = String(text || "").trim();
  if (!p) return null;
  if (ENGINEERED_RE.test(p) || conceptKind(p) || ROBOT_RE.test(p)) {
    return { tool: "conkay_design", params: { text: p.slice(0, 4000) } };
  }
  return { tool: "generate_3d", params: { prompt: p.slice(0, 600) } };
}
