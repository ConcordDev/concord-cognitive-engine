/**
 * New-design requests typed into the ConKay workspace box ("design me a
 * pedestrian bridge…", "show me the car", "show me the reactor"). Checked
 * before parseWorkspaceCommand, which only edits the open I-beam study.
 *
 * - showcase: a precomputed showcase design (/conkay/designs/<id>), drawn in
 *   the workspace with the designs page's own viewers (AssemblyViewer / StlViewer).
 * - workbench: a brief for POST /api/conkay/workbench. A car runs the car
 *   orchestrator and opens /conkay/workbench/<id>; a truss / bridge, bracket
 *   or Sentinel part is solved by the class-problem solvers and drawn here.
 */

export type NewDesignIntent =
  | { kind: 'showcase'; id: ShowcaseId; label: string }
  | { kind: 'workbench'; domain: 'car' | 'truss' | 'bracket' | 'sentinel-part'; label: string };

export type ShowcaseId = 'car' | 'sentinel-m1' | 'usb-blend-d' | 'methanol-water' | 'nuscale-us600';

export const SHOWCASE_LINKS: Array<{ id: ShowcaseId; label: string }> = [
  { id: 'car', label: 'Four-seat 180 mph car' },
  { id: 'sentinel-m1', label: 'Sentinel M1 ground prototype' },
  { id: 'nuscale-us600', label: 'NuScale US600 facility screening' },
  { id: 'usb-blend-d', label: 'USB Blend D formulation' },
  { id: 'methanol-water', label: 'Methanol-water mixture' },
];

const VERB = /\b(?:design|designing|build|make|create|draft|generate|show|open|view|see|load|start|new)\b/;
const SHOW = /\b(?:show|open|view|see|load)\b/;

const CAR = /\b(?:car|vehicle|sedan|coupe|hatchback|suv|roadster|supercar)s?\b/;
const TRUSS = /\b(?:truss(?:es)?|(?:foot)?bridges?|warren|pratt|howe)\b/;
const BRACKET = /\bbrackets?\b/;
const SENTINEL = /\bsentinel\b|\bm1\s+(?:robot|prototype)\b/;
const SENTINEL_PART = /\b(?:knee|hip|ankle|actuator|bracket|mount|link|housing)\b/;
const NUCLEAR = /\b(?:reactor|nuclear|nuscale|smr|us600)\b/;
const FORMULATION = /\b(?:formulation|blend\s*d|usb\s+blend|material\s+formulation|new\s+material)\b/;
const MIXTURE = /\b(?:mixture|methanol)\b/;
/** Beam words: these stay with the open I-beam study. */
const BEAM = /\b(?:i-?beam|beam|girder|joist|lintel)s?\b/;
/** "beam bridge": a beam, not a truss. */
const BEAM_BRIDGE = /\b(?:beam|girder)\s+bridge\b/;

/** True when the text names a design object other than the beam (parseWorkspaceCommand backs off). */
export function namesNonBeamObject(text: string): boolean {
  const t = String(text || '').toLowerCase();
  if (BEAM_BRIDGE.test(t)) return false;
  return CAR.test(t) || TRUSS.test(t) || BRACKET.test(t) || SENTINEL.test(t) || NUCLEAR.test(t) || FORMULATION.test(t) || MIXTURE.test(t);
}

export function detectNewDesign(text: string): NewDesignIntent | null {
  const t = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!t || !VERB.test(t)) return null;
  if (BEAM_BRIDGE.test(t)) return null;
  const show = SHOW.test(t);

  if (SENTINEL.test(t)) {
    // A named Sentinel part ("design a Sentinel knee actuator bracket") is a solver brief; otherwise the robot.
    if (!show && SENTINEL_PART.test(t)) return { kind: 'workbench', domain: 'sentinel-part', label: 'Sentinel part' };
    return { kind: 'showcase', id: 'sentinel-m1', label: 'Sentinel M1 ground prototype' };
  }
  // No prompt-driven pipeline for these yet: open the showcase result.
  if (NUCLEAR.test(t)) return { kind: 'showcase', id: 'nuscale-us600', label: 'NuScale US600 facility screening' };
  if (FORMULATION.test(t)) return { kind: 'showcase', id: 'usb-blend-d', label: 'USB Blend D formulation' };
  if (MIXTURE.test(t)) return { kind: 'showcase', id: 'methanol-water', label: 'Methanol-water mixture' };

  if (TRUSS.test(t)) return { kind: 'workbench', domain: 'truss', label: /bridge/.test(t) ? 'bridge (truss)' : 'truss' };
  if (CAR.test(t)) {
    // "show me the car" opens the showcase car; "design a car that…" runs the car pipeline on that brief.
    if (show && !/\b(?:design|build|make|create)\b/.test(t)) return { kind: 'showcase', id: 'car', label: 'Four-seat 180 mph car' };
    return { kind: 'workbench', domain: 'car', label: 'car' };
  }
  if (BRACKET.test(t) && !BEAM.test(t)) return { kind: 'workbench', domain: 'bracket', label: 'bracket' };
  return null;
}

export const START_EXAMPLES: string[] = [
  'Design me a pedestrian bridge, 30 m span, 3 m tall, 6 panels, 5 kN at each top joint, A36 steel',
  'Design a 3 m simply supported aluminum beam carrying 5 kN at midspan with a safety factor of 1.5',
  'Show me the car',
  'Show me the Sentinel M1',
  'Show me the reactor',
  'Show me the USB Blend D formulation',
];
