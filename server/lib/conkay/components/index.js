// server/lib/conkay/components/index.js
//
// The component library: real parts with published specs (library.json).
// Every entry names its manufacturer, exact variant, mass with a mass state
// and source, key dimensions and ratings, and the constraints it is
// applicable under. validateLibrary() refuses an entry without a source for
// its mass; checkApplicability() compares an entry with a vehicle
// configuration and reports mismatches (and what it could not check, because
// the configuration doesn't say yet). selectComponent() picks the lightest
// applicable entry in a category. Nothing here estimates a spec: a missing
// figure stays missing.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { validateMassState } from "../verification/mass-state.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const LIBRARY_PATH = path.join(HERE, "library.json");

let cached = null;

export function loadLibrary({ fresh = false } = {}) {
  if (cached && !fresh) return cached;
  const lib = JSON.parse(readFileSync(LIBRARY_PATH, "utf8"));
  const v = validateLibrary(lib);
  if (!v.ok) throw new Error(`component library is invalid: ${v.errors.join("; ")}`);
  cached = lib;
  return lib;
}

export const CATEGORIES = ["engine_or_motor", "transmission", "differential", "wheels", "tyres", "brakes", "suspension", "steering", "cooling", "fuel_or_battery", "exhaust", "wiring", "interior_seats"];

const str = (v) => typeof v === "string" && v.trim().length > 0;
const isUrl = (v) => str(v) && /^https?:\/\//.test(v);
const isDate = (v) => str(v) && /^\d{4}-\d{2}-\d{2}$/.test(v);

function validateSource(s, where, errors) {
  if (!s || typeof s !== "object") { errors.push(`${where}: source required`); return; }
  if (!isUrl(s.url) && !str(s.document)) errors.push(`${where}: source.url (http/https) or source.document required`);
  if (!str(s.title)) errors.push(`${where}: source.title required`);
  if (!isDate(s.retrieved)) errors.push(`${where}: source.retrieved (YYYY-MM-DD) required`);
}

/** Validate one library entry. Returns a list of errors. */
export function validateEntry(c) {
  const errors = [];
  const where = c?.id || "entry";
  for (const k of ["id", "category", "manufacturer", "model", "variant"]) if (!str(c?.[k])) errors.push(`${where}: ${k} required`);
  if (c?.category && !CATEGORIES.includes(c.category)) errors.push(`${where}: unknown category "${c.category}"`);
  const m = c?.mass;
  if (!m || typeof m !== "object") errors.push(`${where}: mass required (use massState to say how it is known)`);
  else {
    if (!(Number.isFinite(m.kg) && m.kg > 0)) errors.push(`${where}: mass.kg must be a positive number`);
    if (!str(m.published)) errors.push(`${where}: mass.published (the figure as published) required`);
    const ms = m.massState;
    for (const e of validateMassState(ms, { massKg: m.kg })) errors.push(`${where}: ${e}`);
    if (ms?.state === "placeholder") errors.push(`${where}: a library entry cannot be a placeholder`);
    if (ms?.state === "sourced" || ms?.state === "estimated") validateSource(ms.source, `${where}.mass`, errors);
    for (const [i, s] of (ms?.componentSources || []).entries()) validateSource(s, `${where}.mass.componentSources[${i}]`, errors);
    for (const [i, x] of (m.crossChecks || []).entries()) validateSource(x.source, `${where}.mass.crossChecks[${i}]`, errors);
  }
  const d = c?.dimensions;
  if (!d || !["sourced", "estimated", "missing"].includes(d.state)) errors.push(`${where}: dimensions.state must be sourced, estimated or missing`);
  else if (d.state === "sourced") validateSource(d.source, `${where}.dimensions`, errors);
  else if (d.state === "estimated" && !str(d.method)) errors.push(`${where}: estimated dimensions need a method`);
  else if (d.state === "missing" && !str(d.note)) errors.push(`${where}: missing dimensions need a note`);
  if (!c?.ratings || typeof c.ratings !== "object") errors.push(`${where}: ratings required`);
  if (!c?.applicability || typeof c.applicability !== "object") errors.push(`${where}: applicability required`);
  return errors;
}

export function validateLibrary(lib) {
  const errors = [];
  if (!lib || !Array.isArray(lib.components)) return { ok: false, errors: ["components[] required"] };
  const ids = new Set();
  for (const c of lib.components) {
    if (ids.has(c?.id)) errors.push(`${c.id}: duplicate id`);
    ids.add(c?.id);
    errors.push(...validateEntry(c));
  }
  for (const key of ["speedSymbols", "loadIndex"]) {
    const r = lib.references?.[key];
    if (!r?.table || !Array.isArray(r.sources) || !r.sources.length) errors.push(`references.${key}: table and sources required`);
    else r.sources.forEach((s, i) => validateSource(s, `references.${key}.sources[${i}]`, errors));
  }
  return { ok: errors.length === 0, errors };
}

export function getComponent(id) {
  return loadLibrary().components.find((c) => c.id === id) || null;
}

export function listComponents(category) {
  const all = loadLibrary().components;
  return category ? all.filter((c) => c.category === category) : all;
}

// ── Tyre reference tables ────────────────────────────────────────────────

export function speedSymbolTable() {
  return loadLibrary().references.speedSymbols;
}

export function loadIndexKg(li) {
  const v = loadLibrary().references.loadIndex.table[String(li)];
  return Number.isFinite(v) ? v : null;
}

/**
 * The speed a tyre is established for, from its speed symbol. "(Y)" is over
 * 300 km/h only with the manufacturer's explicit rating; "ZR" with no symbol
 * is over 240 km/h, likewise. Without that rating, only the floor is
 * established. Returns { kmh, symbol, basis } or { error }.
 */
export function tyreSpeedCapability(symbol, { explicitMaxKmh = null, explicitSource = null } = {}) {
  const ref = speedSymbolTable();
  const sym = String(symbol ?? "").trim().toUpperCase().replace(/\s+/g, "");
  const explicit = Number.isFinite(explicitMaxKmh) && explicitMaxKmh > 0 && str(explicitSource);
  if (sym === "(Y)") {
    return explicit
      ? { kmh: explicitMaxKmh, symbol: sym, basis: `(Y) with the manufacturer's explicit rating: ${explicitSource}` }
      : { kmh: 300, symbol: sym, basis: "(Y) without the manufacturer's explicit maximum: only 300 km/h (Y) is established" };
  }
  if (sym === "ZR") {
    return explicit
      ? { kmh: explicitMaxKmh, symbol: sym, basis: `ZR with the manufacturer's explicit rating: ${explicitSource}` }
      : { kmh: 240, symbol: sym, basis: "ZR with no service description and no manufacturer rating: only 240 km/h is established" };
  }
  const kmh = ref.table[sym];
  if (!Number.isFinite(kmh)) return { error: `unknown speed symbol "${symbol}"` };
  return { kmh, symbol: sym, basis: `speed symbol ${sym} = ${kmh} km/h (ISO 4000-1 / ETRTO table)` };
}

// ── Applicability ────────────────────────────────────────────────────────

/**
 * Compare an entry's applicability constraints with a configuration:
 *   { fuelType, drivetrain, enginePattern, engineId, engineTorqueNm, engineMaxRpm,
 *     transmissionType, boltPattern, wheelDiameterIn, wheelWidthIn, loadPerTyreKg,
 *     requiredTopSpeedKmh, spindle, frontSuspension, rearSuspension,
 *     vehicleMassKg, provides: [] }
 * Returns { ok, mismatches: [{ field, required, actual }], unchecked: [{ field, reason }], needs: [] }.
 * ok means no mismatch; what could not be checked is listed, never assumed.
 */
export function checkApplicability(entry, config = {}) {
  const a = entry.applicability || {};
  const mismatches = [];
  const unchecked = [];
  const need = (field, actual, test, required) => {
    if (actual == null) { unchecked.push({ field, reason: `the configuration does not state ${field} yet` }); return; }
    if (!test(actual)) mismatches.push({ field, required, actual });
  };
  if (a.fuelType) need("fuelType", config.fuelType, (v) => a.fuelType.includes(v), a.fuelType);
  if (a.drivetrain) need("drivetrain", config.drivetrain, (v) => a.drivetrain.includes(v), a.drivetrain);
  if (a.enginePattern) need("enginePattern", config.enginePattern, (v) => a.enginePattern.includes(v), a.enginePattern);
  if (a.maxInputTorqueNm != null) need("engineTorqueNm", config.engineTorqueNm, (v) => v <= a.maxInputTorqueNm, `≤ ${a.maxInputTorqueNm} N·m`);
  if (a.maxInputRpm != null) need("engineMaxRpm", config.engineMaxRpm, (v) => v <= a.maxInputRpm, `≤ ${a.maxInputRpm} rpm`);
  if (a.boltPattern) need("boltPattern", config.boltPattern, (v) => v === a.boltPattern, a.boltPattern);
  if (a.boltPatterns) need("boltPattern", config.boltPattern, (v) => a.boltPatterns.includes(v), a.boltPatterns);
  if (a.diameterIn != null) need("wheelDiameterIn", config.wheelDiameterIn, (v) => v === a.diameterIn, a.diameterIn);
  if (a.rimDiameterIn != null) need("wheelDiameterIn", config.wheelDiameterIn, (v) => v === a.rimDiameterIn, a.rimDiameterIn);
  if (a.minWheelDiameterIn != null) need("wheelDiameterIn", config.wheelDiameterIn, (v) => v >= a.minWheelDiameterIn, `≥ ${a.minWheelDiameterIn} in`);
  if (a.rimWidthIn) need("wheelWidthIn", config.wheelWidthIn, (v) => v >= a.rimWidthIn.min && v <= a.rimWidthIn.max, `${a.rimWidthIn.min}–${a.rimWidthIn.max} in`);
  if (a.maxLoadKg != null) need("loadPerTyreKg", config.loadPerTyreKg, (v) => v <= a.maxLoadKg, `≤ ${a.maxLoadKg} kg`);
  if (a.establishedMaxSpeedKmh != null) need("requiredTopSpeedKmh", config.requiredTopSpeedKmh, (v) => v <= a.establishedMaxSpeedKmh, `≤ ${a.establishedMaxSpeedKmh} km/h`);
  if (a.spindle) need("spindle", config.spindle, (v) => v === a.spindle, a.spindle);
  if (a.frontSuspension) need("frontSuspension", config.frontSuspension, (v) => a.frontSuspension.includes(v), a.frontSuspension);
  if (a.rearSuspension) need("rearSuspension", config.rearSuspension, (v) => a.rearSuspension.includes(v), a.rearSuspension);
  if (a.engineIds) need("engineId", config.engineId, (v) => a.engineIds.includes(v), a.engineIds);
  if (a.transmissionType) need("transmissionType", config.transmissionType, (v) => v === a.transmissionType, a.transmissionType);
  // What the maker publishes no rating for is listed, never assumed to fit.
  for (const u of a.unrated || []) unchecked.push({ field: u.field, reason: `not rated: ${u.reason}` });
  if (a.vehicleMassKg) need("vehicleMassKg", config.vehicleMassKg, (v) => (a.vehicleMassKg.min == null || v >= a.vehicleMassKg.min) && (a.vehicleMassKg.max == null || v <= a.vehicleMassKg.max), a.vehicleMassKg);
  const provides = new Set(config.provides || []);
  const needs = (a.requires || []).filter((r) => !provides.has(r));
  return { ok: mismatches.length === 0, mismatches, unchecked, needs };
}

/**
 * The lightest entry in a category with no applicability mismatch (and any
 * extra test). `where` narrows the category first (e.g. the front axle's
 * brakes). Returns { chosen, candidates: [{ id, massKg, ok, mismatches, unchecked, needs, rejected? }] }.
 */
export function selectComponent(category, config, { extra, where } = {}) {
  const candidates = listComponents(category).filter((c) => !where || where(c)).map((c) => {
    const app = checkApplicability(c, config);
    const extraReason = app.ok && extra ? extra(c) : null;
    return { id: c.id, massKg: c.mass.kg, ...app, ...(extraReason ? { ok: false, rejected: extraReason } : {}) };
  });
  const ok = candidates.filter((c) => c.ok).sort((x, y) => x.massKg - y.massKg);
  return { chosen: ok.length ? getComponent(ok[0].id) : null, candidates };
}

/** A massState for a design node from a library entry (with the entry's id). */
export function massStateOf(entry) {
  return { ...entry.mass.massState, componentId: entry.id };
}
