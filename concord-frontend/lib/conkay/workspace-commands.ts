/**
 * ConKay workspace commands — the deterministic half of the workspace
 * conversation.
 *
 * "Reduce web thickness to 8 mm and re-run the FEA" is an edit to a real
 * parametric study, not a question for a language model: it is parsed here,
 * applied to the study, and the study is re-solved by engineering.beamStudy.
 * Anything this parser does not recognise goes to the ConKay agent instead,
 * so nothing is guessed. Pure functions, no I/O.
 */

export type BeamSupport = 'simply-supported' | 'cantilever' | 'fixed';

export interface BeamDims {
  length: number;
  height: number;
  flangeWidth: number;
  flangeThickness: number;
  webThickness: number;
}

export interface MaterialOption {
  id: string;
  label: string;
}

export interface WorkspaceCommand {
  dims: Partial<BeamDims>;
  loadN?: number;
  support?: BeamSupport;
  materialId?: string;
  run: boolean;
  save: boolean;
  keep: boolean;
  /** One plain-language line per recognised edit, in the order given. */
  changes: string[];
}

export const DIM_LABELS: Record<keyof BeamDims, { symbol: string; name: string }> = {
  length: { symbol: 'L', name: 'length' },
  height: { symbol: 'D', name: 'depth' },
  flangeWidth: { symbol: 'W', name: 'flange width' },
  flangeThickness: { symbol: 't_f', name: 'flange thickness' },
  webThickness: { symbol: 't_w', name: 'web thickness' },
};

export const SUPPORT_LABELS: Record<BeamSupport, string> = {
  'simply-supported': 'Simply supported',
  cantilever: 'Cantilever',
  fixed: 'Fixed both ends',
};

// Longest phrases first so "flange thickness" wins over "flange".
const DIM_PATTERNS: Array<{ key: keyof BeamDims; re: string }> = [
  { key: 'webThickness', re: 'web\\s+thickness|web\\s+thk|t_?w' },
  { key: 'flangeThickness', re: 'flange\\s+thickness|flange\\s+thk|t_?f|flanges' },
  { key: 'flangeWidth', re: 'flange\\s+width|width|w|b_?f' },
  { key: 'height', re: 'height|depth|d' },
  { key: 'length', re: 'length|span|l' },
];

const NUM = '(-?\\d+(?:\\.\\d+)?)';
const LEN_UNIT = '(mm|cm|m|in|inch|inches|")?';

function toMm(value: number, unit: string | undefined): number {
  switch ((unit || 'mm').toLowerCase()) {
    case 'cm': return value * 10;
    case 'm': return value * 1000;
    case 'in': case 'inch': case 'inches': case '"': return value * 25.4;
    default: return value;
  }
}

function toN(value: number, unit: string): number {
  switch (unit.toLowerCase()) {
    case 'kn': return value * 1e3;
    case 'mn': return value * 1e6;
    case 'lbf': case 'lb': case 'lbs': return value * 4.4482216;
    case 'kip': case 'kips': return value * 4448.2216;
    default: return value;
  }
}

const round = (v: number) => Math.round(v * 1000) / 1000;

export function formatMm(v: number): string {
  return `${round(v)} mm`;
}

export function formatForce(n: number): string {
  return Math.abs(n) >= 1000 ? `${round(n / 1000)} kN` : `${round(n)} N`;
}

/**
 * Parse one message against the current dims. Returns null when the message
 * holds no workspace command at all — the caller then asks the agent.
 */
export function parseWorkspaceCommand(
  text: string,
  current: BeamDims,
  materials: MaterialOption[] = [],
): WorkspaceCommand | null {
  const src = ` ${String(text || '').replace(/\s+/g, ' ').trim()} `;
  if (!src.trim()) return null;
  const lower = src.toLowerCase();
  const cmd: WorkspaceCommand = { dims: {}, run: false, save: false, keep: false, changes: [] };

  for (const { key, re } of DIM_PATTERNS) {
    if (cmd.dims[key] !== undefined) continue;
    // "<dim> to 8 mm" / "<dim> = 8" / "<dim> at 15 mm" / "<dim> 8mm"
    const abs = new RegExp(`(?:^|[^a-z_])(?:${re})\\s*(?:to|=|:|at|of|is)?\\s*${NUM}\\s*${LEN_UNIT}(?![a-z])`, 'i');
    // "increase/reduce <dim> by 2 mm"
    const rel = new RegExp(`(increase|raise|grow|thicken|widen|lengthen|reduce|decrease|lower|shrink|thin|cut|shorten)\\s+(?:the\\s+)?(?:${re})\\s+by\\s+${NUM}\\s*${LEN_UNIT}(?![a-z])`, 'i');
    const r = rel.exec(src);
    if (r) {
      const sign = /increase|raise|grow|thicken|widen|lengthen/i.test(r[1]) ? 1 : -1;
      const next = current[key] + sign * toMm(Number(r[2]), r[3]);
      cmd.dims[key] = round(next);
      if (round(next) !== current[key]) cmd.changes.push(`${DIM_LABELS[key].symbol} = ${formatMm(next)}`);
      continue;
    }
    const a = abs.exec(src);
    if (a) {
      const v = toMm(Number(a[1]), a[2]);
      cmd.dims[key] = round(v);
      // "Keep flanges at 15 mm" restates a value: recorded, not reported as an edit.
      if (round(v) !== current[key]) cmd.changes.push(`${DIM_LABELS[key].symbol} = ${formatMm(v)}`);
    }
  }

  const load = /(?:load|force|p)\s*(?:to|=|:|of|at|is)?\s*(\d+(?:\.\d+)?)\s*(kn|mn|n|lbf|lbs|lb|kips|kip)(?![a-z])/i.exec(src)
    || /(?:^|\s)(\d+(?:\.\d+)?)\s*(kn|mn|lbf|kips|kip)(?![a-z])/i.exec(src);
  if (load) {
    cmd.loadN = round(toN(Number(load[1]), load[2]));
    cmd.changes.push(`load = ${formatForce(cmd.loadN)}`);
  }

  if (/cantilever/.test(lower)) cmd.support = 'cantilever';
  else if (/fixed[\s-]+(?:fixed|both|at both|each)|both ends fixed|clamped/.test(lower)) cmd.support = 'fixed';
  else if (/simply[\s-]*supported|pinned|pin[\s-]+roller/.test(lower)) cmd.support = 'simply-supported';
  if (cmd.support) cmd.changes.push(`support = ${SUPPORT_LABELS[cmd.support].toLowerCase()}`);

  const mat = matchMaterial(lower, materials);
  if (mat) {
    cmd.materialId = mat.id;
    cmd.changes.push(`material = ${mat.label}`);
  }

  cmd.run = /\b(?:re-?run|run|solve|re-?solve|analy[sz]e|re-?analy[sz]e|recompute)\b/i.test(src) || /^\s*fea\s*$/i.test(src);
  cmd.save = /\bsave\b[^.]*\b(?:model|part)\b/i.test(src);
  cmd.keep = /\b(?:keep|save|cite|record)\b[^.]*\bdtu\b/i.test(src);

  const anything = cmd.changes.length > 0 || Object.keys(cmd.dims).length > 0 || cmd.run || cmd.save || cmd.keep;
  return anything ? cmd : null;
}

function materialTokens(m: MaterialOption): string[] {
  return `${m.id} ${m.label}`.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 2);
}

/**
 * Name a material only when the message holds a token that identifies exactly
 * one library entry ("a36", "6061", "titanium", "concrete"). Words shared by
 * several entries ("steel", "aluminum") never pick one, and quantities with a
 * unit ("300 mm", "50 kN") are removed first so a dimension is never read as
 * a grade.
 */
function matchMaterial(lower: string, materials: MaterialOption[]): MaterialOption | null {
  const text = lower.replace(/\d+(?:\.\d+)?\s*(?:mm|cm|m|in|kn|mn|n|lbf|lbs|lb|kips|kip|mpa|gpa|ksi)(?![a-z])/g, ' ');
  const owners = new Map<string, Set<string>>();
  for (const m of materials) {
    for (const t of new Set(materialTokens(m))) {
      if (!owners.has(t)) owners.set(t, new Set());
      owners.get(t)!.add(m.id);
    }
  }
  let best: { m: MaterialOption; score: number } | null = null;
  for (const m of materials) {
    for (const t of new Set(materialTokens(m))) {
      if (owners.get(t)!.size !== 1) continue;
      if (t.length < 3) continue; // "3d", "ti", "4v" are too short to name a material
      if (!new RegExp(`(?:^|[^a-z0-9])${t}(?![a-z0-9])`).test(text)) continue;
      const score = (/\d/.test(t) ? 100 : 0) + t.length;
      if (!best || score > best.score) best = { m, score };
    }
  }
  return best ? best.m : null;
}

/** Apply a parsed command to the current inputs. Validation is the server's job. */
export function applyWorkspaceCommand(
  cmd: WorkspaceCommand,
  current: { dims: BeamDims; loadN: number; support: BeamSupport; materialId: string },
) {
  return {
    dims: { ...current.dims, ...cmd.dims },
    loadN: cmd.loadN ?? current.loadN,
    support: cmd.support ?? current.support,
    materialId: cmd.materialId ?? current.materialId,
  };
}

export interface BeamStudyResult {
  jobId: string | null;
  elapsedMs?: number;
  name: string;
  updatedAt: string;
  workspaceId?: string | null;
  dims: BeamDims;
  support: BeamSupport;
  loadN: number;
  loadNode?: string;
  material: { id: string; label: string; E: number; yield: number };
  section: { areaMm2: number; IxMm4: number; IyMm4: number };
  maxStressMPa: number;
  maxDeflectionMm: number;
  utilization: number;
  safetyFactor: number;
  pass: boolean;
  handCheck: {
    maxStressMPa: number;
    maxDeflectionMm: number;
    stressError: number;
    deflectionError: number;
    agrees: boolean;
    tolerance: number;
  };
  warnings: string[];
  utilizationByMember: Array<{ id: string; utilization: number; band?: string }>;
  dtuId?: string | null;
}

/**
 * Normalise a saved study (beamStudy-get) into the same shape a fresh run
 * returns. Null when the record is missing anything the workspace shows —
 * an incomplete record is not rendered as a result.
 */
export function studyFromSaved(saved: Record<string, unknown> | null | undefined): BeamStudyResult | null {
  if (!saved || typeof saved !== 'object') return null;
  const s = saved as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const sum = s.summary;
  const mat = s.materialInfo;
  if (!sum || !mat || !s.dims || !Array.isArray(s.utilizationByMember)) return null;
  if (![sum.maxStressMPa, sum.maxDeflectionMm, sum.utilization].every((v) => Number.isFinite(v))) return null;
  return {
    jobId: s.jobId ?? null,
    elapsedMs: s.elapsedMs,
    name: String(s.name || 'I-beam study'),
    updatedAt: String(s.updatedAt || ''),
    workspaceId: s.workspaceId ?? null,
    dims: s.dims,
    support: s.support,
    loadN: s.loadN,
    loadNode: s.loadNode,
    material: { id: mat.id, label: mat.label, E: mat.E, yield: mat.yield },
    section: s.section,
    ...sum,
    utilizationByMember: s.utilizationByMember,
    dtuId: s.dtuId ?? null,
  };
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

/**
 * ConKay's reply after a solve, composed only from the solver's numbers.
 * `previous` (the last result) adds a signed change in stress when the
 * comparison is meaningful.
 */
export function describeStudy(r: BeamStudyResult, previous?: BeamStudyResult | null): string {
  const lines: string[] = [];
  let stress = `Max bending stress ${r.maxStressMPa.toFixed(1)} MPa`;
  if (previous && previous.maxStressMPa > 0 && previous.jobId !== r.jobId) {
    const d = (r.maxStressMPa - previous.maxStressMPa) / previous.maxStressMPa;
    if (Math.abs(d) >= 0.0005) stress += ` (${d > 0 ? '+' : ''}${(d * 100).toFixed(1)}%)`;
  }
  lines.push(`FEA complete. ${stress}, deflection ${r.maxDeflectionMm.toFixed(3)} mm.`);
  lines.push(
    r.pass
      ? `Bending stress within yield for ${r.material.label}: utilization ${pct(r.utilization)}, safety factor ${r.safetyFactor.toFixed(2)}.`
      : `Exceeds yield for ${r.material.label}: utilization ${pct(r.utilization)}, safety factor ${r.safetyFactor.toFixed(2)}. This section does not carry the load.`,
  );
  lines.push(
    r.handCheck.agrees
      ? `The textbook formula gives ${r.handCheck.maxStressMPa.toFixed(1)} MPa, ${r.handCheck.maxDeflectionMm.toFixed(3)} mm — the solver agrees within ${pct(r.handCheck.tolerance)}.`
      : `The textbook formula gives ${r.handCheck.maxStressMPa.toFixed(1)} MPa, ${r.handCheck.maxDeflectionMm.toFixed(3)} mm, which differs from the solver by ${pct(Math.max(r.handCheck.stressError, r.handCheck.deflectionError))}. Treat this run with caution.`,
  );
  for (const w of r.warnings || []) lines.push(`Solver warning: ${w}`);
  return lines.join(' ');
}

/** Context block the agent receives with free-form questions. */
export function studyContext(inputs: {
  dims: BeamDims; loadN: number; support: BeamSupport; materialLabel: string;
}, result: BeamStudyResult | null): string {
  const d = inputs.dims;
  const parts = [
    'You are working inside the ConKay engineering workspace on a parametric I-beam study.',
    `Current inputs: L=${d.length} mm, D=${d.height} mm, W=${d.flangeWidth} mm, t_f=${d.flangeThickness} mm, t_w=${d.webThickness} mm, ${SUPPORT_LABELS[inputs.support].toLowerCase()}, point load ${formatForce(inputs.loadN)}, material ${inputs.materialLabel}.`,
  ];
  if (result) {
    parts.push(
      `Last solve (job ${result.jobId ?? 'unsaved'}): max bending stress ${result.maxStressMPa.toFixed(2)} MPa, deflection ${result.maxDeflectionMm.toFixed(4)} mm, utilization ${pct(result.utilization)}, safety factor ${result.safetyFactor.toFixed(2)}, ${result.pass ? 'passes' : 'fails'} yield; hand check ${result.handCheck.agrees ? 'agrees' : 'disagrees'}.`,
      'Stress is axial plus bending (P/A + Mc/I) at the extreme fibre, not von Mises. Do not invent results: to change the study, call run_lens_action with domain "engineering", action "beamStudy" and the full dims/material/support/loadN.',
    );
  } else {
    parts.push('No solve has run yet in this workspace.');
  }
  return parts.join('\n');
}
