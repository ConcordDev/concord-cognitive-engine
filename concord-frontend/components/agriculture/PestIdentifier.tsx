'use client';

/**
 * PestIdentifier — bespoke pest/disease identification surface for the
 * agriculture lens. Backed by agriculture.identify-pest, which scans an
 * authored LIBRARY of common North American crop pests/diseases for
 * keyword matches and returns ranked candidates with treatment.
 *
 * Per category-leader UX research against Plantix, FarmQA, John Deere
 * Operations Center, Climate FieldView, AgriWebb:
 *
 *   • Crop selector chip grid (corn / soybeans / wheat / alfalfa)
 *   • Symptom-keyword chip set + free-text observation field
 *   • Ranked candidate cards with confidence bar + treatment
 *   • Save-as-DTU per candidate so vetted IDs become citable creator-
 *     economy artifacts (an extension agent's curated pest set is a
 *     tradeable knowledge bundle)
 */

import { useState, useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bug, Loader2, Sprout, Wheat,
  Leaf, ShieldCheck, AlertTriangle,
} from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Candidate {
  name: string;
  crops?: string[];
  keywords?: string[];
  treatment: string;
  hits?: number;
  confidence: number;
}

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('agriculture', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

const CROPS = [
  { id: 'corn', label: 'Corn', icon: Wheat },
  { id: 'soybeans', label: 'Soybeans', icon: Sprout },
  { id: 'wheat', label: 'Wheat', icon: Wheat },
  { id: 'alfalfa', label: 'Alfalfa', icon: Leaf },
];

const SYMPTOM_CHIPS = [
  'yellowing', 'wilting', 'spot', 'lesion', 'aphid', 'rust', 'tan', 'cigar', 'slime',
  'sticky', 'rootlodging', 'leaf', 'beetle', 'fungal', 'border', 'pustule',
];

export function PestIdentifier() {
  const [crop, setCrop] = useState<string>('corn');
  const [observation, setObservation] = useState('');
  const [activeChips, setActiveChips] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<{ candidates: Candidate[]; topCandidate: Candidate | null; summary: string } | null>(null);

  const identifyMutation = useMutation({
    mutationFn: async (params: { observation: string; crop: string }) =>
      callMacro<{ candidates: Candidate[]; topCandidate: Candidate | null; summary: string }>('identify-pest', params),
    onSuccess: (env) => {
      if (env.ok && env.result) setResult(env.result);
      else setResult(null);
    },
  });

  const combinedObservation = useMemo(() => {
    const chips = Array.from(activeChips).join(' ');
    return [observation.trim(), chips].filter(Boolean).join(' ');
  }, [observation, activeChips]);

  const toggleChip = (s: string) => {
    setActiveChips((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!combinedObservation) return;
    identifyMutation.mutate({ observation: combinedObservation, crop });
  };

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Bug className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Pest & Disease Identifier</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
            authored library
          </span>
        </div>
      </header>

      <div>
        <div className="mb-2 text-[10px] uppercase tracking-wider text-zinc-400">Crop</div>
        <div className="flex flex-wrap gap-1.5">
          {CROPS.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCrop(c.id)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium transition-colors ${
                crop === c.id
                  ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-200'
                  : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-cyan-500/30 hover:text-zinc-200'
              }`}
            >
              <c.icon className="h-3 w-3" />
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 text-[10px] uppercase tracking-wider text-zinc-400">Symptom keywords (multi-select)</div>
        <div className="flex flex-wrap gap-1.5">
          {SYMPTOM_CHIPS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => toggleChip(s)}
              className={`rounded-full border px-2.5 py-0.5 text-[10px] transition-colors ${
                activeChips.has(s)
                  ? 'border-amber-500/50 bg-amber-500/15 text-amber-200'
                  : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-amber-500/30'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <form onSubmit={submit} className="flex items-center gap-2">
        <input
          type="text"
          value={observation}
          onChange={(e) => setObservation(e.target.value)}
          placeholder="What are you seeing? (e.g. 'circular tan spots with brown border on leaves')"
          className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs text-white placeholder-zinc-600 focus:border-cyan-500/40 focus:outline-none"
        />
        <button
          type="submit"
          disabled={!combinedObservation || identifyMutation.isPending}
          className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20 disabled:opacity-50"
        >
          {identifyMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
          Identify
        </button>
      </form>

      {!result && !identifyMutation.isPending && (
        <div className="rounded-md border border-dashed border-zinc-800 bg-zinc-950/40 px-3 py-6 text-center text-xs text-zinc-400">
          Pick a crop + tap symptom chips (or describe what you see) → get a ranked match
          from the authored pest/disease library with treatment recommendations.
        </div>
      )}

      {result && (
        <div className="space-y-2">
          {result.candidates.length > 0 && (
            <div className="rounded-md border border-cyan-500/20 bg-cyan-500/5 p-3 text-xs">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-cyan-300">
                <AlertTriangle className="h-3 w-3" />
                Summary
              </div>
              <p className="mt-1 text-zinc-200">{result.summary}</p>
            </div>
          )}
          <AnimatePresence initial={false}>
            {result.candidates.map((c, i) => <CandidateCard key={`${c.name}-${i}`} cand={c} crop={crop} />)}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

function CandidateCard({ cand, crop }: { cand: Candidate; crop: string }) {
  const conf = Math.round((cand.confidence || 0) * 100);
  const barColor = conf >= 60 ? 'bg-emerald-500' : conf >= 30 ? 'bg-amber-500' : 'bg-zinc-600';
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.15 }}
      className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h3 className="text-sm font-semibold text-white">{cand.name}</h3>
            <span className="rounded-full bg-zinc-800 px-2 py-0.5 font-mono text-[10px] text-cyan-300">{conf}%</span>
          </div>
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-zinc-800">
            <div className={`h-full transition-all ${barColor}`} style={{ width: `${conf}%` }} />
          </div>
          <p className="mt-2 text-xs leading-relaxed text-zinc-300">{cand.treatment}</p>
          {cand.crops && cand.crops.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[10px] text-zinc-400">
              <span>Affects:</span>
              {cand.crops.map((c) => (
                <span key={c} className="rounded bg-zinc-800 px-1.5 py-0.5">{c}</span>
              ))}
            </div>
          )}
        </div>
        <SaveAsDtuButton
          compact
          apiSource="concord-pest-library"
          title={`${cand.name} on ${crop} (${conf}% match)`}
          content={[
            `Pest/disease: ${cand.name}`,
            `Crop: ${crop}`,
            `Confidence: ${conf}%`,
            cand.crops ? `Also affects: ${cand.crops.join(', ')}` : '',
            cand.keywords ? `Indicator keywords: ${cand.keywords.join(', ')}` : '',
            '',
            `Treatment: ${cand.treatment}`,
          ].filter(Boolean).join('\n')}
          extraTags={['agriculture', 'pest', crop, cand.name.toLowerCase().replace(/\s+/g, '-')]}
          rawData={cand}
        />
      </div>
    </motion.div>
  );
}
