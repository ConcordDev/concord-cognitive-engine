'use client';

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Users, Loader2, Send } from 'lucide-react';
import { api } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Voice { id: string; name?: string; archetype?: string; weight?: number; lens?: string; description?: string; tone?: string }
interface Verdict { voice: string; vote?: string; rationale?: string; score?: number }
interface Evaluation { verdicts?: Verdict[]; consensus?: string; weightedScore?: number }

export function CouncilVoices() {
  const [proposal, setProposal] = useState('');
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);

  const voices = useQuery({
    queryKey: ['council-voices'],
    queryFn: async () => {
      const r = await api.get('/api/council/voices');
      const data = r.data as { voices?: Voice[] };
      return (data.voices || []) as Voice[];
    },
    staleTime: 60 * 60 * 1000,
  });

  const evaluate = useMutation({
    mutationFn: async () => {
      const r = await api.post('/api/council/voices/evaluate', { proposal: proposal.trim() });
      return r.data as Evaluation;
    },
    onSuccess: (data) => setEvaluation(data),
  });

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Council voices</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">/api/council/voices · live archetype evaluator</span>
        </div>
        {(voices.data?.length || evaluation) && (
          <SaveAsDtuButton
            compact
            apiSource="concord-council"
            title={`Council eval — "${proposal.slice(0, 40)}"`}
            content={`Proposal: ${proposal}\n\nVoices (${voices.data?.length ?? 0}):\n${(voices.data || []).map((v) => `  ${v.id || v.name} (${v.archetype || ''}) · weight ${v.weight ?? '-'}`).join('\n')}\n\nVerdicts:\n${(evaluation?.verdicts || []).map((v) => `  ${v.voice}: ${v.vote || '?'} (${v.score ?? '-'}) — ${(v.rationale || '').slice(0, 200)}`).join('\n')}\n\nConsensus: ${evaluation?.consensus || '—'} (score ${evaluation?.weightedScore ?? '—'})`}
            extraTags={['council', 'evaluation']}
            rawData={{ proposal, voices: voices.data, evaluation }}
          />
        )}
      </header>
      <form onSubmit={(e) => { e.preventDefault(); if (proposal.trim()) evaluate.mutate(); }} className="space-y-2">
        <textarea value={proposal} onChange={(e) => setProposal(e.target.value)} placeholder="Proposal to evaluate (e.g. 'Should Concord raise the marketplace fee to 6%?')" rows={3} className="w-full rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-white" />
        <button type="submit" disabled={!proposal.trim() || evaluate.isPending} className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
          {evaluate.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          Convene council
        </button>
      </form>
      {voices.data && voices.data.length > 0 && (
        <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
          <div className="mb-2 text-xs font-semibold text-zinc-200">Seated voices ({voices.data.length})</div>
          <div className="flex flex-wrap gap-1">
            {voices.data.map((v) => (
              <span key={v.id || v.name} className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300" title={v.description}>
                {v.id || v.name}{v.weight != null ? ` ×${v.weight}` : ''}
              </span>
            ))}
          </div>
        </div>
      )}
      {evaluation?.verdicts && evaluation.verdicts.length > 0 && (
        <div className="rounded-lg border border-cyan-500/20 bg-zinc-950/60 p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-semibold text-zinc-200">Verdicts</div>
            {evaluation.consensus && <span className={`rounded px-2 py-0.5 font-mono text-[11px] ${evaluation.consensus === 'approve' || evaluation.consensus === 'support' ? 'bg-emerald-500/20 text-emerald-300' : evaluation.consensus === 'reject' || evaluation.consensus === 'oppose' ? 'bg-red-500/20 text-red-300' : 'bg-amber-500/20 text-amber-300'}`}>{evaluation.consensus}{evaluation.weightedScore != null ? ` (${evaluation.weightedScore.toFixed(2)})` : ''}</span>}
          </div>
          <div className="space-y-1.5">
            {evaluation.verdicts.map((v) => (
              <div key={v.voice} className="rounded border border-zinc-800 bg-zinc-950 p-2">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-mono text-cyan-300">{v.voice}</span>
                  <span className={`font-mono ${v.score != null && v.score > 0.5 ? 'text-emerald-300' : v.score != null && v.score < -0.5 ? 'text-red-300' : 'text-zinc-400'}`}>{v.vote || '?'}{v.score != null ? ` (${v.score.toFixed(2)})` : ''}</span>
                </div>
                {v.rationale && <p className="mt-1 line-clamp-3 text-[11px] text-zinc-400">{v.rationale}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
      {(voices.isPending || evaluate.isPending) && <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Convening…</div>}
    </div>
  );
}
