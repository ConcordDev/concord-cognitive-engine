// Which 3D tool a chat turn should run when the model picked generate_image
// for a 3D/CAD ask. Engineered objects go to conkay_design (no GPU wait).
// Free-form objects go to generate_3d.

import { conceptKind } from "../conkay/concept-assembly.js";
import { ROBOT_RE } from "../conkay/robot-assembly.js";

const ENGINEERED_RE = /\b(?:cad|stl|beam|bracket|stand|truss|gear\s*box|gearbox|enclosure|robot|furniture|shelf|table|chair|cantilever|shaft|column|plate|frame|housing|mechanism|linkage|actuator|assembly|cars?|vehicles?|automobiles?|trucks?)\b/i;

// An object the user actually named. Bare "cad" / "stl" / "3d" do not count:
// "a 3d cad of a dragon" is still a creature.
const ENGINEERED_OBJECT_RE = /\b(?:beams?|brackets?|stands?|trusses?|gear\s*-?\s*box(?:es)?|gearboxes|enclosures?|furnitures?|shel(?:f|ves)|bookshel(?:f|ves)|bookcases?|tables?|desks?|chairs?|stools?|cantilevers?|shafts?|columns?|plates?|frames?|housings?|mechanisms?|linkages?|actuators?|assemblies|assembly|robots?|robotics?|droids?|androids?|humanoids?|cars?|vehicles?|automobiles?|trucks?|(?:phone|tablet|ipad|mobile)\s*(?:stand|holder|dock|cradle)s?)\b/i;

// Creatures, characters, statues, plants. A box layout is not one of these.
const ORGANIC_SUBJECT_RE = /\b(?:dragons?|creatures?|monsters?|beasts?|animals?|dinosaurs?|birds?|fish(?:es)?|insects?|plants?|trees?|flowers?|characters?|statues?|sculptures?|figurines?|busts?|phoenix(?:es)?|unicorns?|wol(?:f|ves)|lions?|tigers?|horses?|dogs?|cats?|owls?|snakes?|fairies|fairy|elves|elf)\b/i;

const GPU_FAIL_REASONS = new Set([
  "timeout", "gpu_busy", "gpu_wrong_model", "concept_failed", "mesh_failed",
  "local_gpu_unreachable", "generation_error", "weights_missing", "empty_mesh",
  "glb_parse_failed", "health_timeout", "loading", "not_image", "not_mesh",
]);

export const THREE_D_BUSY_REPLY = "3D generation is busy right now. Try again in a minute.";
export const THREE_D_UNAVAILABLE_REPLY = "3D generation is unavailable right now. Try again in a minute.";

/** Creature, character, statue, or plant, and not a part the user also named. */
export function isOrganic3dAsk(text) {
  const p = String(text || "");
  if (!ORGANIC_SUBJECT_RE.test(p)) return false;
  if (ENGINEERED_OBJECT_RE.test(p) || ROBOT_RE.test(p)) return false;
  return true;
}

/** Engineered / CAD-ish 3D ask (robot, car, part, mechanism, furniture the user named). */
export function isEngineered3dAsk(text) {
  const p = String(text || "").trim();
  if (!p || isOrganic3dAsk(p)) return false;
  return ENGINEERED_RE.test(p) || !!conceptKind(p) || ROBOT_RE.test(p);
}

/**
 * The user asked for a GPU mesh or an organic look, not only a CAD layout.
 * Organic subjects (dragon, statue, creature) are a separate path: they go
 * to generate_3d and never get a layout substituted.
 */
export function wantsExplicitMeshLook(text) {
  const p = String(text || "");
  if (/\borganic\s+look\b|\blooks?\s+organic\b|\bsculpted(?:\s+look)?\b|\btrellis\b/i.test(p)) return true;
  if (/\b(?:realistic|photoreal(?:istic)?|free[- ]form|organic)\s+(?:3[- ]?d\s+)?mesh\b/i.test(p)) return true;
  if (/\b(?:generate|make|render|create|want|give|show)\b[^.]{0,48}\bmesh\b/i.test(p)) return true;
  return false;
}

/** A 3D ask that must not be answered with a stand-in layout. */
export function isFreeform3dAsk(text) {
  const p = String(text || "").trim();
  if (!p) return false;
  if (isOrganic3dAsk(p)) return true;
  if (/\b(?:3[- ]?d|cad|stl|mesh|printable)\b/i.test(p) && !isEngineered3dAsk(p)) return true;
  return false;
}

const KIND_CHECKS = [
  ["phone-stand", /\b(?:phone|tablet|ipad|mobile)\s*(?:stand|holder|dock|cradle)s?\b|\bstand\s+for\s+(?:my\s+|a\s+)?(?:phone|tablet)\b/i],
  ["gearbox", /\bgear\s*-?\s*box|\bgear\s+(?:train|reducer|reduction)\b|\bspeed reducer\b/i],
  ["truss", /\btruss/i],
  ["shelf", /\b(?:shelf|shelves|bookshelf|bookcase)s?\b/i],
  ["table", /\b(?:table|desk|workbench)s?\b/i],
  ["chair", /\b(?:chair|stool|seat)s?\b/i],
  ["enclosure", /\b(?:enclosure|project box|electronics box|housing)s?\b/i],
  ["i-beam", /\bi[-\s]?beams?\b|\bbeams?\b|\bcantilevers?\b/i],
  ["bracket", /\bbrackets?\b/i],
  ["beam", /\bbeams?\b|\bcantilevers?\b/i],
  ["car", /\b(?:cars?|vehicles?|automobiles?|trucks?)\b/i],
  ["shaft", /\bshafts?\b/i],
  ["column", /\bcolumns?\b/i],
  ["plate", /\bplates?\b/i],
];

/**
 * True when this layout kind is the object the user named.
 * A bookshelf does not match a dragon, a robot, or a car.
 */
export function conceptMatchesAsk(kind, userText) {
  const blob = String(kind || "").toLowerCase();
  const text = String(userText || "");
  if (!blob.trim() || !text.trim()) return false;
  if (/robot/.test(blob)) return ROBOT_RE.test(text);
  for (const [name, re] of KIND_CHECKS) {
    if (blob.includes(name)) return re.test(text);
  }
  const token = blob.split(/[^a-z0-9]+/).find((w) => w.length > 2 && w !== "concept" && w !== "assembly" && w !== "model");
  if (!token) return false;
  return new RegExp(`\\b${token}s?\\b`, "i").test(text);
}

/**
 * True when handing the user this layout would substitute a different object
 * (a bookshelf for a dragon, a shelf for a robot). A plain sizing ask with no
 * 3D/CAD wording is left alone. No user text means no substitution to judge.
 */
export function layoutWouldSubstitute(userText, kind) {
  const user = String(userText || "").trim();
  if (!user) return false;
  if (isOrganic3dAsk(user) || isFreeform3dAsk(user)) return !conceptMatchesAsk(kind, user);
  if (!isEngineered3dAsk(user)) return false;
  if (!/\b(?:3[- ]?d|cad|stl|mesh|printable)\b/i.test(user)) return false;
  if (!(ENGINEERED_OBJECT_RE.test(user) || ROBOT_RE.test(user) || conceptKind(user))) return false;
  return !conceptMatchesAsk(kind, user);
}

/** Busy (pod loading, in use, or out of time) vs down. Both ask the user to retry. */
export function plain3dFailureReply(failure) {
  const blob = `${failure?.reason || ""} ${failure?.error || ""} ${failure?.stage || ""}`;
  if (/busy|loading|timeout|timed?\s*out|health_timeout|gpu_busy/i.test(blob)) return THREE_D_BUSY_REPLY;
  return THREE_D_UNAVAILABLE_REPLY;
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
 * layout instead of ending the turn with no model. The seed is the user's
 * own sentence. A tool prompt that names a stock object (a bookshelf) is
 * never used. Creatures, characters, statues, and plants stay a plain failure.
 * @returns {{ tool: "conkay_design", params: { text: string } } | null}
 */
export function fallbackDesignCall(userText, _toolPrompt, failure) {
  if (!failure || failure.ok) return null;
  const reason = String(failure.reason || "");
  const err = String(failure.error || "");
  const failed = GPU_FAIL_REASONS.has(reason) || /timed?\s*out|unavailable|busy|loading|\bgpu\b/i.test(`${reason} ${err}`);
  if (!failed) return null;
  const user = String(userText || "").trim();
  // The user decides. "generate a 3d model of a dragon" must not become a
  // bookshelf because the model's prompt copied one from a tool description.
  if (!user || isOrganic3dAsk(user) || isFreeform3dAsk(user) || !isEngineered3dAsk(user)) return null;
  return { tool: "conkay_design", params: { text: user.slice(0, 4000) } };
}
