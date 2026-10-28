// server/lib/conkay/chat/what-if.js
//
// Natural follow-ups on a design (conversational-loop item 4): "what if it seats 2?", "make the tail shorter",
// "use aluminium 6061 for the body", "what about 150 mph". Each one is read deterministically into one of two edits:
//
//   PARAMETER (a design variable): applied to the live design graph. DesignEngine reruns only the runs whose
//     recorded reads touch the changed value and everything downstream of them (the dependency closure); pending
//     kernels (the CAD body) settle; if new checks fail, the orchestrator resumes on what its rules cover.
//   REQUIREMENT (what the design must meet): only from the user's own words, never inferred or automatic. A
//     requirement also feeds the compiler's derivations (the speed limiter, the drive unit, the package), so the
//     car is rebuilt from the new brief and the orchestrator resumes from the current design variables.
//
// Every reply carries a diff against the previous revision: the changed values with their provenance (the user's
// words), the checks that flipped, the runs that reran. undo() returns to the previous revision exactly: its
// receipt hash is the same as before the edit.

import { sha256 } from "../iterate/receipt.js";
import { scanQuantities } from "./quantities.js";
import { orchestrate } from "./orchestrator.js";
import { resolveMaterialName } from "../materials/index.js";
import { parseEdit } from "../compiler/edit-parser.js";
import { listComponents } from "../components/index.js";
import { packageScene } from "../packaging/checks.js";

export const WHAT_IF_VERSION = "1.0.0";
export const TAIL_STEP_M = 0.1; // the repair table's tail step (chat/repair-rules.js)
export const TAIL_BOUNDS_M = [0, 1.0];
/** Declared bounds for the assembly knobs (HANDOFF-3 A1): packaging ranges a designer may move a
 *  family car within; the fit checks, not the bounds, judge whether a given car still works. */
export const WHEELBASE_BOUNDS_M = [2.4, 3.6];
export const TRACK_BOUNDS_M = [1.3, 1.85];
export const FLOOR_Z_BOUNDS_M = [0.09, 0.3];
export const HPOINT_X_BOUNDS_M = [2.0, 3.2];
export const HPOINT_Z_BOUNDS_M = [0.28, 0.6];
/** SAE J1100 Class A H30 range, cited in the h30 design choice's own basis (compiler/car-layout.js). */
export const H30_RANGE_M = [0.127, 0.405];
/** The one package the car compiler derives (compiler/car-layout.js): two rows, four occupants. */
export const PACKAGE_SEATS = 4;

/** The state of a design that a receipt names: every run's status and input hash. */
export function designReceipt(envelopes) {
  const runs = [...envelopes.values()].filter(Boolean).map((e) => ({ runId: e.runId, status: e.status, inputHash: e.provenance?.inputHash ?? null })).sort((a, b) => a.runId.localeCompare(b.runId));
  return sha256(runs);
}

const envMap = (session) => new Map(session.results().filter(Boolean).map((e) => [e.runId, e]));

function flips(before, after) {
  const out = [];
  for (const [id, e] of after) {
    const b = before.get(id);
    if (!b || b.status !== e.status) out.push({ runId: id, from: b?.status ?? null, to: e.status });
  }
  for (const id of before.keys()) if (!after.has(id)) out.push({ runId: id, from: before.get(id).status, to: null });
  return out.sort((a, b) => a.runId.localeCompare(b.runId));
}

/** Rebuild the compiler's brief from the requirements (the same form chat/brief-parser.js carIr writes). */
function briefFrom(req) {
  const parts = [];
  if (req.massMaxKg != null) parts.push(`weighs ${+(req.massMaxKg / 0.45359237).toFixed(1)} lb`);
  if (req.topSpeedMs != null) parts.push(`can go ${+(req.topSpeedMs / 0.44704).toFixed(2)} mph`);
  if (req.seats != null) parts.push(`seats ${req.seats} people`);
  return `Design a car that ${parts.join(", ")}.`;
}

/** Read a follow-up. Returns { kind: "requirement" | "parameter", ... } or { kind: "question" | "error", ... }. */
export function readWhatIf(text, { graph, requirements }) {
  const t = String(text || "").trim();
  const lower = t.toLowerCase();
  const scan = scanQuantities(t);
  if (scan.errors.length) return { kind: "error", error: scan.errors[0].error };

  // requirements: only what the words say
  const seats = scan.counts.find((c) => /^(people|persons?|passengers?|adults?|occupants?|seats?|seater)$/.test(c.noun)) || (lower.match(/\bseats?\s+(\d+)\b/) && { value: Number(lower.match(/\bseats?\s+(\d+)\b/)[1]), raw: lower.match(/\bseats?\s+\d+\b/)[0] });
  if (seats) {
    // the car compiler derives one package: four seats (two rows). Fewer seats is met by it as is; a smaller package
    // (no rear row, a shorter tub) is not derived yet, and more than four does not fit it. Said, not rebuilt into a
    // car the package does not describe.
    const cap = PACKAGE_SEATS;
    if (seats.value === requirements.seats) return { kind: "unchanged", note: `it already seats ${seats.value}` };
    if (seats.value > cap) return { kind: "limit", field: "seats", value: seats.value, words: `"${seats.raw}"`, note: `the car compiler's package seats ${cap} at most (two rows); ${seats.value} seats needs a package it does not derive yet` };
    if (seats.value < cap) return { kind: "limit", field: "seats", value: seats.value, words: `"${seats.raw}"`, note: `the current car seats ${cap}, which meets "seats ${seats.value}"; a ${seats.value}-seat package (no rear row, a shorter tub and wheelbase) is not derived by the compiler yet, so the design is not rebuilt around ${seats.value} seats` };
    return { kind: "requirement", field: "seats", value: seats.value, words: `"${seats.raw}"`, requirements: { ...requirements, seats: seats.value } };
  }
  const speed = scan.quantities.find((q) => q.dim === "velocity");
  if (speed) return { kind: "requirement", field: "topSpeed", value: speed.si, words: `"${speed.raw}"`, requirements: { ...requirements, topSpeedMs: speed.si } };
  const mass = scan.quantities.find((q) => q.dim === "mass");
  if (mass && /\bweigh|\bmass|\bunder\b|\blighter\b|\bheavier\b/.test(lower)) return { kind: "requirement", field: "mass", value: mass.si, words: `"${mass.raw}"`, requirements: { ...requirements, massMaxKg: mass.si } };

  // the tail: an explicit length, or one repair-table step shorter / longer
  if (/\btail\b/.test(lower)) {
    const body = graph.node("BODY_SHELL");
    const cur = body?.geometry?.tailExtension;
    if (!Number.isFinite(cur)) return { kind: "error", error: "this design has no CAD body tail to change (the body is a screening shell)" };
    const len = scan.quantities.find((q) => q.dim === "length");
    let next = len ? len.si : /\bshort|\bcut|\btrim|\bless\b/.test(lower) ? cur - TAIL_STEP_M : /\blong|\bmore\b|\bextend/.test(lower) ? cur + TAIL_STEP_M : null;
    if (next == null) return { kind: "question", question: `Shorter, longer, or a length? (now ${+cur.toFixed(3)} m; steps of ${TAIL_STEP_M} m)` };
    next = Math.round(next * 1000) / 1000;
    if (next < TAIL_BOUNDS_M[0] || next > TAIL_BOUNDS_M[1]) return { kind: "error", error: `a tail of ${next} m is outside its ${TAIL_BOUNDS_M[0]}..${TAIL_BOUNDS_M[1]} m bounds` };
    return { kind: "parameter", ops: [{ node: "BODY_SHELL", path: "geometry.tailExtension", value: next }], changes: [{ field: "BODY_SHELL tail", before: cur, after: next, unit: "m", source: len ? `"${len.raw}"` : `"${t}" (one ${TAIL_STEP_M} m step, the repair table's)` }], stateUpdate: { tailExtensionM: next } };
  }

  // a material: on a named part; the car has more than one, so an unnamed part is a question
  const matWord = lower.match(/\b(6061(?:-t6)?|7075|a36|a992|4140|8620|stainless|steel|alumin(?:i)?um|titanium|cfrp|carbon\s+fib(?:re|er)|fib(?:re|er)glass)\b/);
  if (matWord && /\b(use|make|switch|change|in|from|of)\b/.test(lower)) {
    const r = resolveMaterialName(matWord[1].replace(/-t6$/, ""));
    if (!r) return { kind: "error", error: `no library entry for "${matWord[1]}"` };
    const part = lower.match(/\b(body|shell|skin|tub|frame|chassis)\b/);
    if (!part) return { kind: "question", question: `Which part should be ${r.id}: the body (now ${graph.node("BODY_SHELL")?.material ?? "?"}) or the tub (now ${[...graph.nodes.values()].find((n) => n.props?.role === "tub")?.material ?? "?"})?` };
    const nodes = /body|shell|skin/.test(part[1]) ? [graph.node("BODY_SHELL")].filter(Boolean) : [...graph.nodes.values()].filter((n) => n.props?.role === "tub");
    if (!nodes.length) return { kind: "error", error: `this design has no ${part[1]}` };
    return {
      kind: "parameter", ops: nodes.map((n) => ({ node: n.id, path: "material", value: r.id })),
      changes: [{ field: `${part[1]} material`, before: nodes[0].material, after: r.id, source: `"${matWord[0]}"${r.note ? ` (${r.note})` : ""}`, parts: nodes.length }], stateUpdate: {},
    };
  }

  // anything the general edit parser reads ("set plate P1 thickness to 12 mm")
  const p = parseEdit(t, graph);
  if (p.ok) return { kind: "parameter", ops: p.ops, changes: p.ops.map((o) => ({ field: `${o.node} ${o.path}`, before: getPath(graph.node(o.node), o.path), after: o.value, source: `"${t}"` })), stateUpdate: {}, notes: p.notes };
  return { kind: "error", error: 'I can read follow-ups like "what if it seats 2?", "make the tail shorter", "use aluminium 6061 for the body", "what about 150 mph".' };
}

const getPath = (o, p) => p.split(".").reduce((x, k) => (x == null ? undefined : x[k]), o);

/**
 * A design held across a conversation. start() from an orchestrated result ({ state, final, receipt }), then
 * ask(text) for each follow-up, undo() to step back.
 */
export class DesignConversation {
  constructor({ evaluate, rules, requirements, state, final, budget }) {
    this.evaluate = evaluate;
    this.rules = rules;
    this.budget = budget;
    this.locked = new Set(); // design variables the user locked (the Workbench): no edit and no orchestrator touches them
    this.revisions = [{ kind: "start", state, final, requirements, receipt: designReceipt(final.envelopes) }];
  }

  get current() { return this.revisions.at(-1); }

  async ask(text) {
    const cur = this.current;
    const graph = cur.final.session.engine.graph;
    const w = readWhatIf(text, { graph, requirements: cur.requirements });
    if (w.kind === "error" || w.kind === "question" || w.kind === "limit" || w.kind === "unchanged") return w;
    const lockedHit = Object.keys(w.stateUpdate || {}).find((v) => this.locked.has(v));
    if (lockedHit) return { kind: "locked", variable: lockedHit, note: `${lockedHit} is locked: unlock it to change it` };
    return this._apply(w, text);
  }

  /** The Workbench's knobs: the same edit path as a chat follow-up. */
  async setKnob(variable, value) {
    if (this.locked.has(variable)) return { kind: "locked", variable, note: `${variable} is locked: unlock it to change it` };
    const knob = knobsOf(this).find((k) => k.variable === variable);
    if (!knob) return { kind: "error", error: "invalid_input", field: variable, reason: "unknown_variable", message: `no knob "${variable}"` };
    if (knob.options && !knob.options.includes(value)) return { kind: "error", error: "invalid_input", field: variable, reason: "not_an_option", message: `${variable} must be one of ${knob.options.join(", ")}` };
    if (knob.bounds && !(typeof value === "number" && Number.isFinite(value) && value >= knob.bounds[0] && value <= knob.bounds[1])) return { kind: "error", error: "invalid_input", field: variable, reason: "out_of_range", message: `${variable} must be within ${knob.bounds[0]}..${knob.bounds[1]} ${knob.unit || ""}`.trim() };
    const edit = knobEdit(this, variable, value);
    if (edit?.error) return { kind: "error", ...edit.error };
    if (edit) return this._apply({ kind: "parameter", ops: edit.ops, changes: edit.changes, stateUpdate: edit.stateUpdate || {} }, `knob ${variable} = ${value}`);
    // a component choice (the drive unit): the compiler rebuilds the car with it, and the orchestrator resumes on
    // whatever else fails (never moving a locked variable)
    return this._rebuild({ ...this.current.state, [variable]: value }, { field: variable, before: this.current.state[variable] ?? knob.value, after: value, source: "Workbench knob" }, `knob ${variable} = ${value}`);
  }

  lock(variable) { if (!knobsOf(this).some((k) => k.variable === variable)) return { ok: false, error: `no knob "${variable}"` }; this.locked.add(variable); return { ok: true, locked: [...this.locked].sort() }; }
  unlock(variable) { this.locked.delete(variable); return { ok: true, locked: [...this.locked].sort() }; }

  async _rebuild(state, change, text) {
    const cur = this.current;
    const before = new Map(cur.final.envelopes);
    const run = await orchestrate({ evaluate: this.evaluate, rules: this.rules, initialState: state, budget: this.budget, locked: [...this.locked] });
    if (!run.final) return { kind: "variable", ok: true, outcome: run.outcome, note: "this choice cannot be built from the library" };
    const rev = { kind: "variable", text, state: run.state, final: run.final, requirements: cur.requirements, receipt: designReceipt(run.final.envelopes), orchestrator: { outcome: run.outcome, log: run.log } };
    this.revisions.push(rev);
    return { kind: "variable", ok: true, revision: this.revisions.length - 1, diff: { changed: [change], flipped: flips(before, run.final.envelopes), rerun: "rebuilt: a component choice feeds the compiler" }, outcome: run.outcome, receipt: rev.receipt };
  }

  async _apply(w, text) {
    const cur = this.current;
    const before = new Map(cur.final.envelopes);
    if (w.kind === "requirement") {
      // the user's words change a requirement: rebuild from the new brief and resume the orchestrator from the
      // current design variables
      const state = { ...cur.state, brief: briefFrom(w.requirements) };
      const run = await orchestrate({ evaluate: this.evaluate, rules: this.rules, initialState: state, budget: this.budget, locked: [...this.locked] });
      if (!run.final) return { kind: "requirement", ok: true, outcome: run.outcome, note: "the new requirement cannot be built from the library" };
      const rev = { kind: "requirement", text, words: w.words, field: w.field, state: run.state, final: run.final, requirements: w.requirements, receipt: designReceipt(run.final.envelopes), orchestrator: { outcome: run.outcome, log: run.log } };
      this.revisions.push(rev);
      return { kind: "requirement", ok: true, revision: this.revisions.length - 1, diff: { changed: [{ field: w.field, before: cur.requirements[w.field === "topSpeed" ? "topSpeedMs" : w.field === "mass" ? "massMaxKg" : "seats"], after: w.value, source: `the user's words ${w.words} (a requirement change, made only because they were said)` }], flipped: flips(before, run.final.envelopes), rerun: "rebuilt: a requirement feeds the compiler's derivations" }, outcome: run.outcome, receipt: rev.receipt };
    }
    // a design-variable edit, applied to the live graph
    const session = cur.final.session;
    const reads = new Map([...session.engine.runs].map(([id, run]) => [id, new Set(run.reads)]));
    const r = session.edit(w.ops);
    if (!r.ok) return { kind: "error", error: r.error };
    const settled = await session.settle();
    const after = envMap(session);
    const rerun = [...new Set([...r.rerun, ...settled.rerun])].sort();
    const final = { ...cur.final, envelopes: after };
    const state = { ...cur.state, ...w.stateUpdate };
    // the inverse: the engine's own record of each op's previous value
    const inverse = session.engine.graph.history.at(-1).ops.map((o) => ({ node: o.node, path: o.path, value: o.before }));
    const rev = { kind: "parameter", text, ops: w.ops, inverse, editedSession: session, state, final, requirements: cur.requirements, receipt: designReceipt(after), readsBefore: reads, changedKeys: r.changedKeys };
    this.revisions.push(rev);
    const newFails = flips(before, after).filter((f) => f.to === "FAIL").map((f) => f.runId);
    let resumed = null;
    if (newFails.length && Object.keys(w.stateUpdate).length) {
      // a design variable the orchestrator also owns (the tail): resume it from the edited state
      const run = await orchestrate({ evaluate: this.evaluate, rules: this.rules, initialState: state, budget: this.budget, locked: [...this.locked] });
      resumed = { outcome: run.outcome, log: run.log };
      if (run.final) { rev.final = run.final; rev.state = run.state; rev.receipt = designReceipt(run.final.envelopes); }
    }
    return {
      kind: "parameter", ok: true, revision: this.revisions.length - 1,
      diff: { changed: w.changes, flipped: flips(before, rev.final.envelopes), rerun, reused: r.reused.length },
      newFailures: newFails, resumed, receipt: rev.receipt, ...(w.notes?.length ? { notes: w.notes } : {}),
    };
  }

  /** Step back one revision. Graph edits are reversed on the live graph; a rebuild returns to the kept design. */
  async undo() {
    if (this.revisions.length < 2) return { ok: false, error: "nothing to undo" };
    const rev = this.revisions.pop();
    const prev = this.current;
    if (rev.kind === "parameter") {
      // reverse the edit on the session it was applied to (even if the orchestrator then moved on to a rebuild)
      const r = rev.editedSession.edit(rev.inverse);
      if (!r.ok) return { ok: false, error: r.error };
      await rev.editedSession.settle();
      prev.final = { ...prev.final, envelopes: envMap(rev.editedSession) };
    }
    const receipt = designReceipt(prev.final.envelopes);
    return { ok: true, revision: this.revisions.length - 1, receipt, matches: receipt === prev.receipt };
  }
}

const r4 = (v) => Math.round(v * 1e4) / 1e4;

/** The packaging scene (SgRPs, floor) for the conversation's live graph, or null when it has no package. */
function sceneOf(graph) {
  const pkg = graph?.node("VEH")?.props?.vehicle?.packaging;
  if (!pkg) return null;
  const centers = {};
  for (const n of graph.nodes.values()) if (n.position && Number.isFinite(+n.position.x)) centers[n.id] = { x: +n.position.x, y: +n.position.y, z: +n.position.z };
  try { return packageScene({ pkg, centers }); } catch { return null; }
}

/**
 * The graph edit behind a knob, or null when the knob is not a graph edit (the drive unit rebuilds instead).
 * Every op writes a value the solvers already read — the same paths the compiler wrote at build time:
 *   wheelbase   VEH props.vehicle.rearAxleX (the front axle stays; the rear tyres follow their axle)
 *   track       the two tyre centres' y, moved symmetrically about the centreline
 *   ride height the package design choice floorZ (the cabin floor the whole J1100 scene stands on)
 *   H-point x   the design choice ahpX: packageScene's UMTRI relation moves the front SgRP 1:1 with the
 *               heel point (its seat-track clamp shifts with it), so the knob sets the SgRP and the edit
 *               shifts ahpX by the same delta
 *   H-point z   the design choice h30: SgRP z is floorZ + H30, so the edit sets H30 = target − floorZ and
 *               refuses when that leaves the J1100 Class A H30 range the choice's own basis cites
 * Returns { ops, changes, stateUpdate } or { error } (a validation refusal in the invalid_input shape).
 */
function knobEdit(conv, variable, value) {
  const graph = conv.current.final.session.engine.graph;
  const veh = graph.node("VEH");
  const dc = veh?.props?.vehicle?.packaging?.designChoices;
  const pos = (id) => graph.node(id)?.position;
  const DC = "props.vehicle.packaging.designChoices";
  switch (variable) {
    case "tailExtensionM": {
      const before = graph.node("BODY_SHELL")?.geometry?.tailExtension;
      return { ops: [{ node: "BODY_SHELL", path: "geometry.tailExtension", value }], changes: [{ field: "BODY_SHELL tail", before, after: value, unit: "m", source: "Workbench knob" }], stateUpdate: { tailExtensionM: value } };
    }
    case "wheelbaseM": {
      const fa = veh.props.vehicle.frontAxleX, ra = veh.props.vehicle.rearAxleX;
      const rearX = r4(fa + value);
      return {
        ops: [
          { node: "VEH", path: "props.vehicle.rearAxleX", value: rearX },
          { node: "TIRE_RL", path: "position.x", value: rearX },
          { node: "TIRE_RR", path: "position.x", value: rearX },
        ],
        changes: [{ field: "wheelbase", before: r4(ra - fa), after: value, unit: "m", source: "Workbench knob" }],
        stateUpdate: {},
      };
    }
    case "frontTrackM":
    case "rearTrackM": {
      const [l, r] = variable === "frontTrackM" ? ["TIRE_FL", "TIRE_FR"] : ["TIRE_RL", "TIRE_RR"];
      return {
        ops: [
          { node: l, path: "position.y", value: -value / 2 },
          { node: r, path: "position.y", value: value / 2 },
        ],
        changes: [{ field: variable === "frontTrackM" ? "front track" : "rear track", before: r4(Math.abs(pos(r).y - pos(l).y)), after: value, unit: "m", source: "Workbench knob" }],
        stateUpdate: {},
      };
    }
    case "rideHeightM": {
      return {
        ops: [{ node: "VEH", path: `${DC}.floorZ.value`, value }],
        changes: [{ field: "ride height (cabin floor)", before: dc.floorZ.value, after: value, unit: "m", source: "Workbench knob" }],
        stateUpdate: {},
      };
    }
    case "seatHPointXM": {
      const scene = sceneOf(graph);
      if (!scene) return null;
      return {
        ops: [{ node: "VEH", path: `${DC}.ahpX.value`, value: r4(dc.ahpX.value + (value - scene.sgRPFront.x)) }],
        changes: [{ field: "seat H-point x (via the heel point)", before: r4(scene.sgRPFront.x), after: value, unit: "m", source: "Workbench knob" }],
        stateUpdate: {},
      };
    }
    case "seatHPointZM": {
      const scene = sceneOf(graph);
      if (!scene) return null;
      const h30 = value - scene.floorZ;
      if (!(h30 >= H30_RANGE_M[0] && h30 <= H30_RANGE_M[1])) {
        return { error: { error: "invalid_input", field: variable, reason: "out_of_range", message: `a seat H-point z of ${value} m at this floor height (${scene.floorZ} m) implies H30 ${r4(h30)} m, outside the J1100 Class A range ${H30_RANGE_M[0]}..${H30_RANGE_M[1]} m` } };
      }
      return {
        ops: [{ node: "VEH", path: `${DC}.h30.value`, value: r4(h30) }],
        changes: [{ field: "seat H-point z (via H30)", before: r4(scene.sgRPFront.z), after: value, unit: "m", source: "Workbench knob" }],
        stateUpdate: {},
      };
    }
    default:
      return null;
  }
}

/** The design variables a person may move, with their declared bounds or options (the repair table's). */
export function knobsOf(conv) {
  const cur = conv.current;
  const out = [];
  const tail = cur.final.session?.engine?.graph?.node("BODY_SHELL")?.geometry?.tailExtension;
  if (Number.isFinite(tail)) out.push({ variable: "tailExtensionM", label: "Tail length", value: tail, unit: "m", bounds: TAIL_BOUNDS_M, step: TAIL_STEP_M, locked: conv.locked.has("tailExtensionM"), source: "the repair table's tail rule (chat/repair-rules.js)" });
  const sel = cur.final.report?.selection?.engine_or_motor;
  if (sel) {
    // every library drive unit for this powertrain (a pinned choice narrows the compiler's own candidate list to
    // itself); the compiler checks the one picked, and an unbuildable pick comes back infeasible, not guessed
    const electric = cur.state.fuelType === "electric";
    const options = listComponents("engine_or_motor").filter((c) => (electric ? /^motor\./ : /^engine\./).test(c.id)).map((c) => c.id).sort();
    if (options.length) out.push({ variable: "motorId", label: "Drive unit", value: sel.chosen, options, locked: conv.locked.has("motorId"), source: "components/library.json (the compiler checks the one picked)" });
  }
  // the assembly's driving parameters (HANDOFF-3 A1): shown when the design carries the values they read
  const graph = cur.final.session?.engine?.graph;
  const veh = graph?.node?.("VEH");
  const pkg = veh?.props?.vehicle?.packaging;
  const dc = pkg?.designChoices;
  const fa = veh?.props?.vehicle?.frontAxleX, ra = veh?.props?.vehicle?.rearAxleX;
  const locked = (v) => conv.locked.has(v);
  if (Number.isFinite(fa) && Number.isFinite(ra)) out.push({ variable: "wheelbaseM", label: "Wheelbase", value: r4(ra - fa), unit: "m", bounds: WHEELBASE_BOUNDS_M, step: 0.01, locked: locked("wheelbaseM"), source: "VEH props.vehicle frontAxleX/rearAxleX (packaging/checks.js); the rear axle moves and its tyres follow, the front axle stays — the compiler's own convention (compiler/car-from-library.js)" });
  const trackOf = (l, r) => { const a = graph?.node?.(l)?.position, b = graph?.node?.(r)?.position; return a && b && Number.isFinite(a.y) && Number.isFinite(b.y) ? r4(Math.abs(b.y - a.y)) : null; };
  const ft = trackOf("TIRE_FL", "TIRE_FR");
  if (ft != null) out.push({ variable: "frontTrackM", label: "Front track", value: ft, unit: "m", bounds: TRACK_BOUNDS_M, step: 0.005, locked: locked("frontTrackM"), source: "the front tyre centres' y positions (packaging/checks.js); both tyres move symmetrically about the centreline" });
  const rt = trackOf("TIRE_RL", "TIRE_RR");
  if (rt != null) out.push({ variable: "rearTrackM", label: "Rear track", value: rt, unit: "m", bounds: TRACK_BOUNDS_M, step: 0.005, locked: locked("rearTrackM"), source: "the rear tyre centres' y positions (packaging/checks.js); both tyres move symmetrically about the centreline" });
  if (dc && Number.isFinite(dc.floorZ?.value)) out.push({ variable: "rideHeightM", label: "Ride height (cabin floor)", value: dc.floorZ.value, unit: "m", bounds: FLOOR_Z_BOUNDS_M, step: 0.005, locked: locked("rideHeightM"), source: "the package design choice floorZ (compiler/car-layout.js): the cabin floor height above ground the J1100 scene stands on; ground clearance is floorZ minus the skin offset (assembly/build.js)" });
  const scene = pkg ? sceneOf(graph) : null;
  if (scene && dc && Number.isFinite(dc.ahpX?.value)) out.push({ variable: "seatHPointXM", label: "Seat H-point x", value: r4(scene.sgRPFront.x), unit: "m", bounds: HPOINT_X_BOUNDS_M, step: 0.01, locked: locked("seatHPointXM"), source: "the front SgRP from packageScene (packaging/checks.js): the UMTRI H-point follows the heel point (design choice ahpX) 1:1, so the edit shifts ahpX by the same delta" });
  if (scene && dc && Number.isFinite(dc.h30?.value)) out.push({ variable: "seatHPointZM", label: "Seat H-point z", value: r4(scene.sgRPFront.z), unit: "m", bounds: HPOINT_Z_BOUNDS_M, step: 0.005, locked: locked("seatHPointZM"), source: "the front SgRP from packageScene (packaging/checks.js): SgRP z is floorZ + H30 (design choice h30, SAE J1100), so the edit sets H30 and refuses outside its Class A range" });
  return out;
}

/** The runs a set of changed keys must rerun: the runs whose reads touch a key, then every reader of their results. */
export function dependencyClosure(readsByRun, changedKeys) {
  const touches = (a, b) => a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`);
  const out = new Set();
  for (const [id, reads] of readsByRun) if ([...reads].some((r) => changedKeys.some((c) => touches(r, c)))) out.add(id);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [id, reads] of readsByRun) {
      if (out.has(id)) continue;
      if ([...reads].some((r) => r.startsWith("result:") && out.has(r.slice(7)))) { out.add(id); grew = true; }
    }
  }
  return [...out].sort();
}
