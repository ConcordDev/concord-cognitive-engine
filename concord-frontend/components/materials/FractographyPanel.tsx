'use client';

/**
 * FractographyPanel — fracture-surface failure-mode classification +
 * root-cause analysis for the materials lens. Wires
 * materials.fractographyAnalysis + materials.fractographyRootCause.
 *
 * Evidence-based classification (ductile / brittle / fatigue / SCC /
 * creep) per ASM Handbook Volume 11 — see server/domains/materials.js.
 * Structurally mirrors `CorrosionThermalPanel.tsx`'s use of the shared
 * `CalcPanel` primitive (two macros run in parallel from one shared
 * input form, two result cards, Save-as-DTU).
 */

import { useState } from 'react';
import { Microscope, Layers, Search } from 'lucide-react';
import { CalcPanel } from '@/components/lens-primitives/CalcPanel';

interface FractographyInput {
  material: string;
  texture: '' | 'dull_fibrous' | 'bright_crystalline' | 'mixed_transitional';
  deformation: '' | 'significant_plastic' | 'minimal_plastic' | 'none';
  surfaceFeatures: string[];
  loadType: '' | 'static' | 'cyclic' | 'impact' | 'sustained_thermal';
  environment: '' | 'ambient' | 'corrosive' | 'elevated_temperature' | 'inert';
  environmentDetail: string;
  serviceTemperatureC: string;
  meltingPointC: string;
}

interface FractographyCandidate { mode: string; evidenceScore: number; supportingEvidence: string[] }
interface ClassifyResult {
  material?: string; loadType?: string; environment?: string;
  classification?: string; primaryMode?: string; evidenceForPrimary?: string[];
  candidates?: FractographyCandidate[]; ambiguityNote?: string | null;
  homologousTemperature?: number; confidence?: string; message?: string;
}
interface RootCauseResult {
  material?: string; classification?: string; candidateModes?: string[];
  rootCauseGuidance?: string; recommendedCorrectiveActions?: string[];
  recommendedFurtherTesting?: string[]; reference?: string; message?: string;
}

const TEXTURES: { value: FractographyInput['texture']; label: string }[] = [
  { value: '', label: 'Not observed' },
  { value: 'dull_fibrous', label: 'Dull, fibrous' },
  { value: 'bright_crystalline', label: 'Bright, crystalline / granular' },
  { value: 'mixed_transitional', label: 'Mixed — smooth-to-rough transition' },
];
const DEFORMATIONS: { value: FractographyInput['deformation']; label: string }[] = [
  { value: '', label: 'Not observed' },
  { value: 'significant_plastic', label: 'Significant plastic deformation' },
  { value: 'minimal_plastic', label: 'Minimal plastic deformation' },
  { value: 'none', label: 'No measurable deformation' },
];
const FEATURES: { key: string; label: string }[] = [
  { key: 'cup_and_cone', label: 'Cup-and-cone shape' },
  { key: 'necking', label: 'Necking' },
  { key: 'chevron_marks', label: 'Chevron marks' },
  { key: 'beach_marks', label: 'Beach marks' },
  { key: 'striations', label: 'Striations' },
  { key: 'intergranular_cracking', label: 'Intergranular cracking' },
  { key: 'branching_cracks', label: 'Branching cracks' },
  { key: 'grain_boundary_voids', label: 'Grain-boundary voids' },
];
const LOAD_TYPES: { value: FractographyInput['loadType']; label: string }[] = [
  { value: '', label: 'Unspecified' },
  { value: 'static', label: 'Static' },
  { value: 'cyclic', label: 'Cyclic / repeated' },
  { value: 'impact', label: 'Impact' },
  { value: 'sustained_thermal', label: 'Sustained (elevated temperature)' },
];
const ENVIRONMENTS: { value: FractographyInput['environment']; label: string }[] = [
  { value: '', label: 'Unspecified' },
  { value: 'ambient', label: 'Ambient' },
  { value: 'corrosive', label: 'Corrosive' },
  { value: 'elevated_temperature', label: 'Elevated temperature' },
  { value: 'inert', label: 'Inert' },
];

const MODE_COLOR: Record<string, string> = {
  ductile: 'text-emerald-200', brittle: 'text-rose-200', fatigue: 'text-amber-200',
  scc: 'text-sky-200', creep: 'text-orange-200', 'mixed evidence': 'text-zinc-300', indeterminate: 'text-zinc-400',
};

export function FractographyPanel() {
  const [input, setInput] = useState<FractographyInput>({
    material: '', texture: '', deformation: '', surfaceFeatures: [],
    loadType: '', environment: '', environmentDetail: '',
    serviceTemperatureC: '', meltingPointC: '',
  });

  function toggleFeature(key: string) {
    setInput((prev) => ({
      ...prev,
      surfaceFeatures: prev.surfaceFeatures.includes(key)
        ? prev.surfaceFeatures.filter((f) => f !== key)
        : [...prev.surfaceFeatures, key],
    }));
  }

  const buildData = () => ({
    material: input.material,
    texture: input.texture,
    deformation: input.deformation,
    surfaceFeatures: input.surfaceFeatures,
    loadType: input.loadType,
    environment: input.environment,
    environmentDetail: input.environmentDetail,
    serviceTemperatureC: input.serviceTemperatureC ? Number(input.serviceTemperatureC) : undefined,
    meltingPointC: input.meltingPointC ? Number(input.meltingPointC) : undefined,
  });

  return (
    <CalcPanel<ClassifyResult, RootCauseResult>
      title="Fractography / failure analysis"
      domain="materials"
      icon={<Microscope className="h-5 w-5 text-rose-400" />}
      macroBadge="materials.fractographyAnalysis + fractographyRootCause"
      accent="red"
      errorLabel="Fractography analysis failed."
      left={{
        macro: 'fractographyAnalysis',
        buildArtifact: () => ({ data: buildData() }),
        render: (
          <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Search className="h-3 w-3" />Fracture surface observations</div>
            <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-400">Material</span>
              <input className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white" value={input.material} onChange={(e) => setInput({ ...input, material: e.target.value })} placeholder="e.g. stainless steel 304" /></label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-400">Surface texture</span>
                <select className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white" value={input.texture} onChange={(e) => setInput({ ...input, texture: e.target.value as FractographyInput['texture'] })}>
                  {TEXTURES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select></label>
              <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-400">Plastic deformation</span>
                <select className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white" value={input.deformation} onChange={(e) => setInput({ ...input, deformation: e.target.value as FractographyInput['deformation'] })}>
                  {DEFORMATIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select></label>
            </div>
            <div>
              <span className="mb-1 block text-[9px] uppercase tracking-wider text-zinc-400">Observed features</span>
              <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                {FEATURES.map((f) => (
                  <label key={f.key} className="flex items-center gap-1.5 text-[11px] text-zinc-300">
                    <input type="checkbox" checked={input.surfaceFeatures.includes(f.key)} onChange={() => toggleFeature(f.key)} />
                    {f.label}
                  </label>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-400">Load type</span>
                <select className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white" value={input.loadType} onChange={(e) => setInput({ ...input, loadType: e.target.value as FractographyInput['loadType'] })}>
                  {LOAD_TYPES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                </select></label>
              <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-400">Environment</span>
                <select className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white" value={input.environment} onChange={(e) => setInput({ ...input, environment: e.target.value as FractographyInput['environment'] })}>
                  {ENVIRONMENTS.map((n) => <option key={n.value} value={n.value}>{n.label}</option>)}
                </select></label>
            </div>
            <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-400">Corrosive agent (if known)</span>
              <input className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white" value={input.environmentDetail} onChange={(e) => setInput({ ...input, environmentDetail: e.target.value })} placeholder="e.g. chloride, ammonia, caustic" /></label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-400">Service temp (°C)</span>
                <input type="number" className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" value={input.serviceTemperatureC} onChange={(e) => setInput({ ...input, serviceTemperatureC: e.target.value })} /></label>
              <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-400">Melting point (°C)</span>
                <input type="number" className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white font-mono" value={input.meltingPointC} onChange={(e) => setInput({ ...input, meltingPointC: e.target.value })} /></label>
            </div>
          </div>
        ),
      }}
      right={{
        macro: 'fractographyRootCause',
        buildArtifact: () => ({ data: buildData() }),
        render: (
          <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Layers className="h-3 w-3" />Root-cause investigation</div>
            <p className="text-[11px] text-zinc-400">Uses the same observations at left to derive corrective actions and recommended further testing per ASM Handbook Vol. 11.</p>
          </div>
        ),
      }}
      renderResults={(classify, rootCause) => (
        <>
          <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3">
            <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Search className="h-3 w-3" />Classification</div>
            {!classify && <div className="text-[11px] text-zinc-400">Analyze to classify.</div>}
            {classify?.message && (
              <div className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-200">{classify.message}</div>
            )}
            {classify?.classification && (
              <div className="mt-2 space-y-2 text-[11px]">
                <div className={`inline-block rounded bg-zinc-800/60 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide ${MODE_COLOR[classify.classification] || 'text-zinc-300'}`}>
                  {classify.classification}
                </div>
                {classify.ambiguityNote && (
                  <div className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-amber-200">{classify.ambiguityNote}</div>
                )}
                {classify.evidenceForPrimary && classify.evidenceForPrimary.length > 0 && (
                  <div>
                    <div className="mb-0.5 text-[9px] uppercase tracking-wider text-zinc-400">Supporting evidence</div>
                    <ul className="list-disc space-y-0.5 pl-4 text-zinc-300">
                      {classify.evidenceForPrimary.map((ev, i) => <li key={i}>{ev}</li>)}
                    </ul>
                  </div>
                )}
                {classify.candidates && classify.candidates.length > 1 && (
                  <div>
                    <div className="mb-0.5 text-[9px] uppercase tracking-wider text-zinc-400">All candidate modes</div>
                    <ul className="space-y-0.5">
                      {classify.candidates.map((c) => (
                        <li key={c.mode} className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-900/50 px-2 py-0.5">
                          <span className={MODE_COLOR[c.mode] || 'text-zinc-300'}>{c.mode}</span>
                          <span className="ml-auto font-mono text-zinc-400">score {c.evidenceScore}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {classify.homologousTemperature != null && (
                  <div className="text-zinc-400">Homologous temperature T/T<sub>m</sub>: <span className="font-mono text-zinc-200">{classify.homologousTemperature}</span></div>
                )}
              </div>
            )}
          </div>
          <div className="rounded-lg border border-orange-500/20 bg-orange-500/5 p-3">
            <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Layers className="h-3 w-3" />Root cause + corrective action</div>
            {!rootCause && <div className="text-[11px] text-zinc-400">Analyze to investigate root cause.</div>}
            {rootCause?.message && (
              <div className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-200">{rootCause.message}</div>
            )}
            {rootCause?.rootCauseGuidance && (
              <div className="mt-2 space-y-2 text-[11px]">
                <p className="text-zinc-200">{rootCause.rootCauseGuidance}</p>
                {rootCause.recommendedCorrectiveActions && rootCause.recommendedCorrectiveActions.length > 0 && (
                  <div>
                    <div className="mb-0.5 text-[9px] uppercase tracking-wider text-zinc-400">Corrective actions</div>
                    <ul className="list-disc space-y-0.5 pl-4 text-zinc-300">
                      {rootCause.recommendedCorrectiveActions.map((a, i) => <li key={i}>{a}</li>)}
                    </ul>
                  </div>
                )}
                {rootCause.recommendedFurtherTesting && rootCause.recommendedFurtherTesting.length > 0 && (
                  <div>
                    <div className="mb-0.5 text-[9px] uppercase tracking-wider text-zinc-400">Recommended further testing</div>
                    <ul className="list-disc space-y-0.5 pl-4 text-zinc-300">
                      {rootCause.recommendedFurtherTesting.map((t, i) => <li key={i}>{t}</li>)}
                    </ul>
                  </div>
                )}
                {rootCause.reference && <div className="text-[9px] text-zinc-500">Reference: {rootCause.reference}</div>}
              </div>
            )}
          </div>
        </>
      )}
      dtu={{
        apiSource: 'concord-materials-fractography',
        title: (c) => `${input.material || 'Fracture'} — ${c.classification ?? 'analysis'}`,
        content: (c, r) => `Fractography (${input.material}):\n  Classification: ${c.classification ?? '—'}\n${(c.evidenceForPrimary || []).map((e) => `  • ${e}`).join('\n')}\n${c.ambiguityNote ? `  Note: ${c.ambiguityNote}\n` : ''}\nRoot cause:\n  ${r.rootCauseGuidance ?? '—'}\n${(r.recommendedCorrectiveActions || []).map((a) => `  • ${a}`).join('\n')}\n\nFurther testing:\n${(r.recommendedFurtherTesting || []).map((t) => `  • ${t}`).join('\n')}`,
        tags: () => ['materials', 'fractography', input.loadType, input.environment].filter(Boolean),
        rawData: (c, r) => ({ input, classify: c, rootCause: r }),
      }}
    />
  );
}
