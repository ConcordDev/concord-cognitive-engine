// concord-frontend/lib/conkay/artifact-kinds.ts
//
// Unit F9 (K5) — the ConKay "artifact → interactive 3D" pipeline's canonical
// schema + kind registry. This is the generalized sibling of the store's
// `feaResultFromRun` (conkayHudStore.ts): where that reshapes ONE macro kind
// (engineering.runFEA) into one viewer's prop shape, this reshapes MANY real
// macro results into a typed `ConkayArtifact` a registry-driven viewer can
// render as interactive 3D — each kind bound to a REAL producing macro.
//
// HONESTY CONTRACT (the whole reason this file is pure + tested):
//   - A normalizer returns `ConkayArtifact | null` — it returns null unless the
//     macro result GENUINELY carries that kind's real fields, exactly like
//     `feaResultFromRun`. Never a guess, never a fabricated stand-in. If a
//     result doesn't normalize, the viewer shows an explicit "inspectable soon"
//     STOP-POINT label — not a fake shape (see ArtifactViewer.tsx).
//   - Every field on a `ConkayArtifact` traces to a field a real backend macro
//     actually returns (shapes verified against the live handlers, 2026-07):
//       ar-render        ← ar.render         → { drawList[], title }         (server/domains/ar.js#render)
//       fea-frame        ← engineering.runFEA→ { displacements, utilization,  (server/domains/engineering.js#runFEA
//                                                stresses } + input model      + server/lib/simulation/fea-solver.js)
//       foundry-worldspec← foundry.preview   → { previewWorldId, universeType,(server/domains/foundry.js#preview)
//                                                activatedSystems, skippedStubs }
//       forge-app        ← forge.sandbox     → { html, projectId, fileCount } (server/domains/forge.js#sandbox)
//       building         ← game-design.building-publish → { ok, dtuId, buildingId, spawned, citation }
//                                                (server/domains/gamedesign.js#building-publish; the artifact's
//                                                 buildings[] is CONSTRUCTED from the publish call's real INPUT
//                                                 — archetype/feature/dimensions/name/position — + the result's
//                                                 buildingId, see normalizeBuildingPublish)
//                        ← (shape-driven)    → { buildings[], validationData[] }  — see normalizeBuilding's note
//
// This module is intentionally React-free so it can be unit-tested as a pure
// function (see tests/lib/conkay/artifact-kinds.test.ts). The mapping from
// `kind` → the real component that renders it lives on the React side, in
// components/conkay/artifacts/ArtifactViewer.tsx's adapter map — kept separate
// so the heavy Three.js adapters never get pulled into the pure normalizer path.

// The FEA reshape + its result shape are REUSED verbatim from the store — the
// fea-frame kind must be byte-identical to what ForwardSimPanel already renders,
// so we import the one canonical producer rather than re-deriving it. This is a
// type-only + one runtime import of `feaResultFromRun`; the store imports only
// the `ConkayArtifact` TYPE back from here (`import type`, erased at runtime),
// so there is no runtime import cycle.
import { feaResultFromRun, type ConkayFeaResult } from '@/components/conkay/conkayHudStore';
// Type-only reuse of the real building renderer's prop shapes — so the building
// artifact carries EXACTLY what BuildingRenderer3D consumes, nothing invented.
import type { BuildingDTU, ValidationData } from '@/components/world-lens/BuildingRenderer3D';

/** The artifact kinds that have a registered real-macro normalizer + adapter. */
export type ConkayArtifactKind =
  | 'ar-render'
  | 'fea-frame'
  | 'building'
  | 'foundry-worldspec'
  | 'forge-app';

/** A kind-agnostic summary of one inspectable sub-part of an artifact (a
 *  drawList object / FEA member / activated system / project). Used for the
 *  panel header count + part lists — every entry is a real component of the
 *  real artifact, never padding. */
export interface ConkayArtifactComponent {
  id: string;
  label: string;
  /** The part's own kind tag (drawList kind / 'member' / 'system' / …). */
  kind: string;
}

interface ConkayArtifactBase {
  /** Real inspectable sub-parts (see ConkayArtifactComponent). */
  components: ConkayArtifactComponent[];
  /** Provenance — the real macro domain that produced this artifact. */
  sourceDomain: string;
  /** Provenance — the real macro name that produced this artifact. */
  sourceMacro: string;
}

/** One `ar.render` drawList object — structurally the shape ConKayArtifactExploded
 *  already consumes (its internal `DrawPart`), reused so the ArAdapter can hand
 *  the real drawList straight through with no reshape. */
export interface ConkayDrawPart {
  id?: string;
  kind?: string;
  color?: string;
  transform?: { position?: { x?: number; y?: number; z?: number }; scale?: number | { x?: number } };
}

/** A real `ar.render` scene — rendered as ConKay's exploded artifact view. */
export interface ConkayArArtifact extends ConkayArtifactBase {
  kind: 'ar-render';
  /** The scene title the macro reported (or null). */
  title: string | null;
  /** The genuine part descriptors straight from the macro's drawList. */
  drawList: ConkayDrawPart[];
}

/** A completed `engineering.runFEA` solve — rendered via FEAResultViewer. The
 *  payload is the store's exact ConkayFeaResult (from `feaResultFromRun`). */
export interface ConkayFeaArtifact extends ConkayArtifactBase {
  kind: 'fea-frame';
  fea: ConkayFeaResult;
}

/** A structural building set — rendered via BuildingRenderer3D's stress heatmap.
 *  Payload is the renderer's own prop types (BuildingDTU / ValidationData). */
export interface ConkayBuildingArtifact extends ConkayArtifactBase {
  kind: 'building';
  buildings: BuildingDTU[];
  validation: ValidationData[];
}

/** A compiled `foundry.preview` world — rendered by mounting the real 3D engine
 *  (ConcordiaScene) against the genuine, persisted `previewWorldId`. */
export interface ConkayFoundryArtifact extends ConkayArtifactBase {
  kind: 'foundry-worldspec';
  /** A REAL `worlds` row id (status='preview') the backend just compiled. */
  previewWorldId: string;
  /** The world's universe type the macro reported (or null). */
  universeType: string | null;
  /** Ids of the systems the compile actually activated. */
  activatedSystems: string[];
  /** Ids of stub systems the compile skipped (not yet built — honestly noted). */
  skippedStubs: string[];
}

/** A generated `forge.sandbox` app — rendered in a sandboxed iframe from the
 *  REAL generated HTML document (the same real artifact ForgeStudio renders). */
export interface ConkayForgeArtifact extends ConkayArtifactBase {
  kind: 'forge-app';
  /** The real generated sandbox document (never fabricated). */
  html: string;
  /** The Forge project id (or null). */
  projectId: string | null;
  /** How many files the version compiled into, per the macro (or null). */
  fileCount: number | null;
}

/** The canonical artifact union — every member is a pure function of a real
 *  macro result (see the per-normalizer sources above). */
export type ConkayArtifact =
  | ConkayArArtifact
  | ConkayFeaArtifact
  | ConkayBuildingArtifact
  | ConkayFoundryArtifact
  | ConkayForgeArtifact;

// ── small honest coercers (mirror conkayHudStore's `num`/`asRecordArray`) ────
function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}
function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

// ── normalizers — one per kind, each PURE and null-unless-real ───────────────

/** ar.render → an exploded-view artifact. Requires a real, non-empty drawList. */
function normalizeAr(domain: string, macro: string, _input: unknown, result: unknown): ConkayArArtifact | null {
  if (domain !== 'ar' || macro !== 'render') return null;
  const res = asObj(result);
  const drawList = asArray(res.drawList) as ConkayDrawPart[];
  // Nothing real to inspect ⟹ no artifact (the viewer falls to its empty state).
  if (drawList.length === 0) return null;
  const components: ConkayArtifactComponent[] = drawList.map((d, i) => ({
    id: str(d?.id) ?? `part_${i}`,
    label: str(d?.id) ?? `part ${i}`,
    kind: str(d?.kind) ?? 'object',
  }));
  return {
    kind: 'ar-render',
    title: str(res.title),
    drawList,
    components,
    sourceDomain: domain,
    sourceMacro: macro,
  };
}

/** engineering.runFEA → a solved-frame artifact. Reuses the store's exact
 *  `feaResultFromRun` (needs the run INPUT model for geometry + the solver
 *  return), so this kind is byte-identical to ForwardSimPanel's embed. */
function normalizeFea(domain: string, macro: string, input: unknown, result: unknown): ConkayFeaArtifact | null {
  if (domain !== 'engineering' || macro !== 'runFEA') return null;
  const fea = feaResultFromRun(input, result);
  if (!fea) return null; // partial/failed solve ⟹ no half-real preview
  const components: ConkayArtifactComponent[] = fea.members.map((m) => ({
    id: m.id,
    label: `${m.nodeI} → ${m.nodeJ}`,
    kind: 'member',
  }));
  return { kind: 'fea-frame', fea, components, sourceDomain: domain, sourceMacro: macro };
}

/** foundry.preview → a compiled-world artifact. Requires a real previewWorldId
 *  (the genuine persisted `worlds` row the adapter mounts the 3D engine on). */
function normalizeFoundry(domain: string, macro: string, _input: unknown, result: unknown): ConkayFoundryArtifact | null {
  if (domain !== 'foundry' || macro !== 'preview') return null;
  const res = asObj(result);
  const previewWorldId = str(res.previewWorldId);
  if (!previewWorldId) return null; // only a real preview world is renderable
  // activatedSystems / skippedStubs are id lists (tolerate {id} objects too).
  const idOf = (s: unknown, i: number, prefix: string): string =>
    typeof s === 'string' ? s : (str(asObj(s).id) ?? `${prefix}_${i}`);
  const activatedSystems = asArray(res.activatedSystems).map((s, i) => idOf(s, i, 'system'));
  const skippedStubs = asArray(res.skippedStubs).map((s, i) => idOf(s, i, 'stub'));
  const components: ConkayArtifactComponent[] = activatedSystems.map((id) => ({ id, label: id, kind: 'system' }));
  return {
    kind: 'foundry-worldspec',
    previewWorldId,
    universeType: str(res.universeType),
    activatedSystems,
    skippedStubs,
    components,
    sourceDomain: domain,
    sourceMacro: macro,
  };
}

/** forge.sandbox → a generated-app artifact. Requires the real generated HTML. */
function normalizeForge(domain: string, macro: string, _input: unknown, result: unknown): ConkayForgeArtifact | null {
  if (domain !== 'forge' || macro !== 'sandbox') return null;
  const res = asObj(result);
  const html = str(res.html);
  if (!html) return null; // no real generated document ⟹ nothing honest to frame
  const projectId = str(res.projectId);
  const fileCount = typeof res.fileCount === 'number' && Number.isFinite(res.fileCount) ? res.fileCount : null;
  const components: ConkayArtifactComponent[] = projectId
    ? [{ id: projectId, label: `project ${projectId}`, kind: 'forge-app' }]
    : [];
  return { kind: 'forge-app', html, projectId, fileCount, components, sourceDomain: domain, sourceMacro: macro };
}

/** True iff a value carries the load-bearing fields BuildingRenderer3D needs to
 *  render honestly (id + numeric w/h/d dimensions + a structure spec). */
function isBuildingDtu(v: unknown): v is BuildingDTU {
  const o = asObj(v);
  const dim = asObj(o.dimensions);
  return (
    typeof o.id === 'string' &&
    typeof dim.width === 'number' &&
    typeof dim.height === 'number' &&
    typeof dim.depth === 'number' &&
    o.structure != null &&
    typeof o.structure === 'object'
  );
}

/** game-design.building-publish → a structural-building artifact CONSTRUCTED
 *  from the publish call's real fields, not from a macro result that already
 *  carries a `buildings[]` array (that's the shape-driven `normalizeBuilding`
 *  below). building-publish's own return is just `{ ok, dtuId, buildingId,
 *  spawned, citation }` (server/domains/gamedesign.js) — the RENDER fields
 *  (archetype/feature/dimensions/name/position) live entirely on the call's
 *  INPUT (see AssetStudioPanel.tsx's payload), which the backend validated
 *  and just persisted verbatim. So this is a render of the real authored
 *  spec: every field traces to input (archetype/feature/dimensions/name/
 *  position/rotationY) or result (buildingId as the building's id) — nothing
 *  guessed.
 *
 *  Honest failure: `result.ok === false`, a missing `buildingId`, a missing/
 *  unknown `archetype`, or non-positive dimensions all return null — no
 *  half-real placeholder building.
 *
 *  `floors` / `material` / `style` / `structure` are NOT part of
 *  building-publish's input at all. They're documented, minimal, inert
 *  structural defaults required only to satisfy the `BuildingDTU` type +
 *  `isBuildingDtu`'s structural check — building-publish only accepts
 *  archetypes from the same 5-set BuildingRenderer3D's `renderFromDTU`
 *  recognises as "explicit archetype" (tavern/archive/forge/market/tower;
 *  compare `GD_BUILDING_ARCHETYPES` in gamedesign.js to `knownArchetypes` in
 *  BuildingRenderer3D.tsx), so the renderer ALWAYS takes its rich procedural
 *  `createBuilding()` path for a building-publish artifact — a path that
 *  reads only id/name/dimensions/position + the `archetype`/`feature`
 *  fields below (via the same inline type-cast reads `renderFromDTU` already
 *  uses for seed/world buildings), never structure/material/style/floors.
 *  Those four are dead weight on this path; `floors: 1` in particular is not
 *  arbitrary — it is the minimum value that keeps the (unreachable-here)
 *  legacy fallback's `height / dtu.floors` division defined, should
 *  `createBuilding` ever throw. */
function normalizeBuildingPublish(domain: string, macro: string, input: unknown, result: unknown): ConkayBuildingArtifact | null {
  if (domain !== 'game-design' || macro !== 'building-publish') return null;
  const res = asObj(result);
  if (res.ok === false) return null; // honest failure ⟹ no artifact, never a placeholder
  const buildingId = str(res.buildingId);
  if (!buildingId) return null; // nothing real to anchor the artifact on

  const inp = asObj(input);
  const archetype = str(inp.archetype);
  if (!archetype) return null; // no genuine archetype ⟹ nothing honest to render

  const dims = asObj(inp.dimensions);
  const width = num(dims.width);
  const height = num(dims.height);
  const depth = num(dims.depth);
  if (width <= 0 || height <= 0 || depth <= 0) return null; // no genuine geometry ⟹ nothing honest to render

  const pos = asObj(inp.position);
  const name = str(inp.name) ?? 'Untitled building';
  const feature = str(inp.feature);

  const building: BuildingDTU & { archetype: string; feature?: string } = {
    id: buildingId,
    name,
    position: { x: num(pos.x), y: num(pos.y), z: num(pos.z) },
    dimensions: { width, height, depth },
    // Inert structural placeholders — see the doc comment above. Never read
    // on the archetype-driven render path this artifact always takes.
    floors: 1,
    material: 'usb',
    style: 'mixed',
    structure: {
      columns: { count: 0, spacing: 0, radius: 0 },
      beams: { count: 0, height: 0 },
      roofType: 'flat',
      hasBasement: false,
      windowRows: 0,
      windowsPerRow: 0,
    },
    building_type: archetype,
    // Extra fields BuildingRenderer3D reads via inline type-cast (its
    // `explicitArch`/`feature` reads in renderFromDTU) — the REAL authored
    // archetype + iconic feature, carried through untouched.
    archetype,
    ...(feature ? { feature } : {}),
  };

  const components: ConkayArtifactComponent[] = [{ id: building.id, label: building.name, kind: 'building' }];
  return { kind: 'building', buildings: [building], validation: [], components, sourceDomain: domain, sourceMacro: macro };
}

/** Shape-driven (NOT domain-gated) → a structural-building artifact. Matches any
 *  macro result carrying a real `buildings[]` array of BuildingDTU-shaped rows
 *  (+ optional `validationData[]`), so it renders live the moment a macro emits
 *  that shape.
 *
 *  HONEST NOTE (do not read this as a wired feature): as of 2026-07 NO lens
 *  macro reachable through `/api/lens/run` returns the BuildingDTU shape — the
 *  world/building data flows through routes + the world lens, not a macro. So
 *  this normalizer is a REAL, typed detector on a REAL renderer that is
 *  currently *unfed* by the capture point: dormant, not fabricated. The wire is
 *  honest by construction — when a structural-render macro lands that returns
 *  `buildings[]`, it lights up with zero further work; until then it simply
 *  never matches (returns null), and the viewer's STOP-POINT covers the case. */
function normalizeBuilding(domain: string, macro: string, _input: unknown, result: unknown): ConkayBuildingArtifact | null {
  const res = asObj(result);
  const buildings = asArray(res.buildings).filter(isBuildingDtu);
  if (buildings.length === 0) return null;
  const validation = asArray(res.validationData).filter(
    (v): v is ValidationData => typeof asObj(v).buildingId === 'string',
  );
  const components: ConkayArtifactComponent[] = buildings.map((b) => ({
    id: b.id,
    label: b.name || b.id,
    kind: 'building',
  }));
  return { kind: 'building', buildings, validation, components, sourceDomain: domain, sourceMacro: macro };
}

/** A registry entry: the kind, a human label, and its pure normalizer. The
 *  "which real component renders it" half of the registry lives on the React
 *  side (ArtifactViewer's adapter map) so this module stays Three.js-free. */
export interface ArtifactKindEntry {
  kind: ConkayArtifactKind;
  label: string;
  normalize: (domain: string, macro: string, input: unknown, result: unknown) => ConkayArtifact | null;
}

/** The kind registry. Order matters: the domain-gated kinds are tried before
 *  the shape-driven `building` detector so a domain-specific match always wins.
 *  The `building` entry itself composes two normalizers behind one kind (kept
 *  as ONE registry row, not two, so `ARTIFACT_KINDS` stays a 5-kind, unique-
 *  key registry): the domain-gated `game-design.building-publish` detector
 *  tried first, falling back to the shape-driven `buildings[]` detector when
 *  it doesn't match — the same domain-gated-before-shape-driven ordering the
 *  rest of this array follows, just localized to one entry. */
export const ARTIFACT_KINDS: ArtifactKindEntry[] = [
  { kind: 'ar-render', label: 'AR scene', normalize: normalizeAr },
  { kind: 'fea-frame', label: 'FEA frame', normalize: normalizeFea },
  { kind: 'foundry-worldspec', label: 'Foundry world', normalize: normalizeFoundry },
  { kind: 'forge-app', label: 'Forge app', normalize: normalizeForge },
  {
    kind: 'building',
    label: 'Structural building',
    normalize: (domain, macro, input, result) =>
      normalizeBuildingPublish(domain, macro, input, result) ?? normalizeBuilding(domain, macro, input, result),
  },
];

/**
 * PURE — run a real macro result through every registered normalizer and return
 * the first `ConkayArtifact` that matches, or null when none does. `input` is
 * the macro's INPUT object (only fea-frame needs it — geometry lives there);
 * all other normalizers ignore it. Null is the honest default: a result that
 * doesn't genuinely match any kind produces no artifact (never a guessed one).
 */
export function detectArtifact(domain: string, macro: string, input: unknown, result: unknown): ConkayArtifact | null {
  for (const entry of ARTIFACT_KINDS) {
    const artifact = entry.normalize(domain, macro, input, result);
    if (artifact) return artifact;
  }
  return null;
}

/** The human label for a kind (falls back to the raw kind string for an
 *  unregistered one — the STOP-POINT case). */
export function artifactKindLabel(kind: string): string {
  return ARTIFACT_KINDS.find((e) => e.kind === kind)?.label ?? kind;
}
