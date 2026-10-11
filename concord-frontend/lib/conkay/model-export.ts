/**
 * ConKay model names and the header-export document.
 *
 * Saved models live in engineering.savePart, not in lens artifacts. The
 * export file is built only from those records plus the study the workspace
 * actually has open. A missing solve stays null — it is not filled in.
 */

export interface ConkayExportResults {
  maxStressMPa: number;
  maxDeflectionMm: number;
  utilization: number;
  safetyFactor: number;
  pass: boolean;
  jobId: string | null;
  elapsedMs: number | null;
  handCheck: unknown;
}

export interface ConkayExportModel {
  id?: string;
  name: string;
  kind: string;
  designType: string;
  params: Record<string, number>;
  results: ConkayExportResults | null;
  solverVersion: string | null;
  material: string | null;
  geometry?: unknown;
  study?: { loadN: number; support: string; dims: Record<string, number> } | null;
}

export interface ConkayExportDocument {
  kind: 'conkay-model-export';
  savedModels: ConkayExportModel[];
  currentModel: ConkayExportModel | null;
  /** Set when the lens-artifact list failed. Absent means that list was read. */
  lensItemsError?: string;
  lensItems?: unknown[];
}

/** Display name for a part kind. A box in this workspace is a bracket. */
export function designTypeName(kind: string): string {
  const k = String(kind || '')
    .trim()
    .toLowerCase();
  switch (k) {
    case 'i-beam':
    case 'ibeam':
    case 'w-beam':
    case 'wide-flange':
      return 'I-beam';
    case 'beam':
      return 'Beam';
    case 'box':
    case 'bracket':
    case 'angle':
    case 'gusset':
      return 'Bracket';
    case 'cylinder':
    case 'rod':
      return 'Cylinder';
    case 'tube':
    case 'rect-tube':
    case 'pipe':
      return 'Tube';
    case 'sphere':
      return 'Sphere';
    default:
      if (!k) return 'Part';
      return k.charAt(0).toUpperCase() + k.slice(1);
  }
}

const GENERIC_NAMES = new Set(['', 'i-beam study', 'part']);

/** The name to offer when the study still has the placeholder title. */
export function preferredModelName(current: string, kind: string): string {
  const raw = String(current || '').trim();
  if (GENERIC_NAMES.has(raw.toLowerCase())) return designTypeName(kind);
  return raw;
}

/** First free "Name", "Name 2", "Name 3", … against names already saved. */
export function nextModelName(base: string, existing: string[]): string {
  const name = base.trim() || 'Part';
  const taken = new Set(existing.map((n) => n.trim()).filter(Boolean));
  if (!taken.has(name)) return name;
  const stem = name.replace(/ \d+$/, '');
  let n = 2;
  while (taken.has(`${stem} ${n}`)) n += 1;
  return `${stem} ${n}`;
}

export function partToExportModel(part: {
  id?: string;
  name?: string;
  kind?: string;
  designType?: string;
  params?: Record<string, number>;
  results?: ConkayExportResults | null;
  solverVersion?: string | null;
  material?: string | null;
  geometry?: unknown;
  study?: ConkayExportModel['study'];
}): ConkayExportModel {
  const kind = String(part.kind || 'part');
  return {
    ...(part.id ? { id: part.id } : {}),
    name: String(part.name || designTypeName(part.designType || kind)),
    kind,
    designType: String(part.designType || kind),
    params: part.params && typeof part.params === 'object' ? part.params : {},
    results: part.results ?? null,
    solverVersion: part.solverVersion ?? null,
    material: part.material ?? null,
    ...(part.geometry !== undefined ? { geometry: part.geometry } : {}),
    ...(part.study !== undefined ? { study: part.study } : {}),
  };
}

export function buildConkayExport(input: {
  parts: Array<Parameters<typeof partToExportModel>[0]>;
  current: ConkayExportModel | null;
  lensItems?: unknown[];
  lensItemsError?: string | null;
}): ConkayExportDocument {
  const doc: ConkayExportDocument = {
    kind: 'conkay-model-export',
    savedModels: input.parts.map(partToExportModel),
    currentModel: input.current,
  };
  if (input.lensItems && input.lensItems.length > 0) doc.lensItems = input.lensItems;
  if (input.lensItemsError) doc.lensItemsError = input.lensItemsError;
  return doc;
}

export function conkayExportCsv(doc: ConkayExportDocument): string {
  const headers = [
    'id',
    'name',
    'kind',
    'designType',
    'solverVersion',
    'material',
    'params',
    'results',
  ];
  const line = (m: ConkayExportModel) =>
    headers
      .map((h) => {
        const value = h === 'id' ? (m.id ?? '') : (m as unknown as Record<string, unknown>)[h];
        const cell =
          value !== null && typeof value === 'object' ? JSON.stringify(value) : (value ?? '');
        return JSON.stringify(cell);
      })
      .join(',');
  const models = doc.currentModel ? [...doc.savedModels, doc.currentModel] : doc.savedModels;
  return [headers.join(','), ...models.map(line)].join('\n');
}

/** The open study, published for the lens-header export. Null when the workspace is closed. */
let currentModel: ConkayExportModel | null = null;

export function setConkayCurrentModel(model: ConkayExportModel | null): void {
  currentModel = model;
}

export function getConkayCurrentModel(): ConkayExportModel | null {
  return currentModel;
}

const mm = (v: number) => v / 1000;

export function currentModelFromStudy(
  inputs: {
    name: string;
    materialId: string;
    loadN: number;
    support: string;
    dims: {
      length: number;
      height: number;
      flangeWidth: number;
      flangeThickness: number;
      webThickness: number;
    };
  },
  solved: {
    maxStressMPa: number;
    maxDeflectionMm: number;
    utilization: number;
    safetyFactor: number;
    pass: boolean;
    jobId: string | null;
    elapsedMs?: number;
    handCheck: unknown;
    analysisReceipt?: { solver?: string };
  } | null
): ConkayExportModel {
  return {
    name: inputs.name,
    kind: 'i-beam',
    designType: 'i-beam',
    material: inputs.materialId,
    params: {
      length: mm(inputs.dims.length),
      height: mm(inputs.dims.height),
      flangeWidth: mm(inputs.dims.flangeWidth),
      flangeThickness: mm(inputs.dims.flangeThickness),
      webThickness: mm(inputs.dims.webThickness),
    },
    study: { loadN: inputs.loadN, support: inputs.support, dims: { ...inputs.dims } },
    results: solved
      ? {
          maxStressMPa: solved.maxStressMPa,
          maxDeflectionMm: solved.maxDeflectionMm,
          utilization: solved.utilization,
          safetyFactor: solved.safetyFactor,
          pass: solved.pass,
          jobId: solved.jobId,
          elapsedMs: solved.elapsedMs ?? null,
          handCheck: solved.handCheck,
        }
      : null,
    solverVersion: solved?.analysisReceipt?.solver || null,
  };
}
