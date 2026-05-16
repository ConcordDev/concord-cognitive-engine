'use client';

/**
 * TimelineSourceTools — bespoke historical analysis surface for the
 * history lens. Wires history.timelineBuild + history.sourceEvaluate.
 *
 *   • Timeline: editable event rows (event/date/era/category/significance)
 *     → sorted timeline + span + pivotal-events list + category tags
 *   • Source evaluation: type / bias / author / date inputs → reliability
 *     score (0-100), classification badge, corroboration recommendation
 *   • Save-as-DTU captures inputs + both reports
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { History, Loader2, Plus, Trash2, ScrollText, Scale } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface HistEvent { name: string; date: string; era: string; category: string; significance: 'low' | 'medium' | 'high' | 'critical' }
interface Source { title: string; type: 'primary' | 'secondary' | 'tertiary'; author: string; date: string; bias: 'none' | 'low' | 'moderate' | 'high' }
interface TimelineResult { timeline?: Array<{ event: string; date: string; era?: string; significance?: string; category?: string }>; totalEvents?: number; timeSpan?: string; categories?: string[]; eras?: string[]; pivotalEvents?: Array<{ event: string; date: string }> }
interface SourceResult { title?: string; type?: string; reliabilityScore?: number; classification?: string; corroborationNeeded?: boolean; evaluation?: { sourceType: number; biasAssessment: number; authorAttribution: string; dateProvenance: string } }

async function callHist<T>(action: string, input: Record<string, unknown>): Promise<T | null> {
  try {
    const r = await apiHelpers.lens.runDomain('history', action, { input });
    const env = (r as { data?: { ok: boolean; result?: T } }).data;
    if (!env?.ok) return null;
    const result = env.result as unknown as { ok?: boolean; result?: T } | T;
    if (result && typeof result === 'object' && 'ok' in result && 'result' in result) {
      return (result as { result: T }).result;
    }
    return env.result as T;
  } catch { return null; }
}

const CATEGORIES = ['political', 'military', 'cultural', 'economic', 'scientific', 'religious', 'social'] as const;
const SIGNIFICANCES = ['low', 'medium', 'high', 'critical'] as const;
const TYPES = ['primary', 'secondary', 'tertiary'] as const;
const BIASES = ['none', 'low', 'moderate', 'high'] as const;

const DEFAULT_EVENTS: HistEvent[] = [
  { name: 'Magna Carta signed', date: '1215', era: 'High Middle Ages', category: 'political', significance: 'critical' },
  { name: 'Fall of Constantinople', date: '1453', era: 'Late Middle Ages', category: 'military', significance: 'high' },
  { name: 'Gutenberg press', date: '1440', era: 'Renaissance', category: 'cultural', significance: 'critical' },
  { name: 'Black Death peak', date: '1349', era: 'High Middle Ages', category: 'social', significance: 'high' },
];

export function TimelineSourceTools() {
  const [events, setEvents] = useState<HistEvent[]>(DEFAULT_EVENTS);
  const [source, setSource] = useState<Source>({ title: 'Magna Carta facsimile (British Library)', type: 'primary', author: 'Anonymous scribes', date: '1215', bias: 'low' });
  const [timeline, setTimeline] = useState<TimelineResult | null>(null);
  const [sourceResult, setSourceResult] = useState<SourceResult | null>(null);

  const analyze = useMutation({
    mutationFn: async () => {
      const evs = events.filter((e) => e.name.trim() && e.date.trim());
      const [t, s] = await Promise.all([
        callHist<TimelineResult>('timelineBuild', { artifact: { data: { events: evs } } }),
        callHist<SourceResult>('sourceEvaluate', { artifact: { title: source.title, data: source } }),
      ]);
      setTimeline(t);
      setSourceResult(s);
      return { t, s };
    },
  });

  const addEvent = () => setEvents((es) => [...es, { name: '', date: '', era: '', category: 'political', significance: 'medium' }]);
  const updateEvent = <K extends keyof HistEvent>(i: number, key: K, value: HistEvent[K]) =>
    setEvents((es) => es.map((e, idx) => (idx === i ? { ...e, [key]: value } : e)));
  const removeEvent = (i: number) => setEvents((es) => es.filter((_, idx) => idx !== i));

  const reliabilityColour = (score?: number) => {
    if (!score) return 'text-zinc-400';
    if (score >= 70) return 'text-emerald-200';
    if (score >= 40) return 'text-amber-200';
    return 'text-rose-200';
  };

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <History className="h-5 w-5 text-amber-400" />
          <h2 className="text-sm font-semibold text-white">Timeline + source evaluator</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">history.timelineBuild + sourceEvaluate</span>
        </div>
        {(timeline || sourceResult) && (
          <SaveAsDtuButton
            compact
            apiSource="concord-history-timeline-source"
            title={`History analysis — ${timeline?.totalEvents ?? 0} events · source ${sourceResult?.reliabilityScore ?? '—'}/100`}
            content={`Timeline (${timeline?.timeSpan || '—'}):\n${(timeline?.timeline || []).map((e) => `  ${e.date} — ${e.event} [${e.category}, ${e.significance}]`).join('\n')}\n\nPivotal: ${timeline?.pivotalEvents?.map((p) => p.event).join(', ') || 'none'}\n\nSource evaluation:\n  Title: ${sourceResult?.title}\n  Type: ${sourceResult?.type} | Reliability: ${sourceResult?.reliabilityScore}/100 (${sourceResult?.classification})\n  Corroboration needed: ${sourceResult?.corroborationNeeded ? 'yes' : 'no'}`}
            extraTags={['history', 'timeline', 'sources']}
            rawData={{ events, source, timeline, sourceResult }}
          />
        )}
      </header>

      <div className="space-y-2">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500">Historical events</div>
        <div className="grid grid-cols-[1fr_90px_110px_110px_90px_30px] gap-1.5 text-[9px] uppercase tracking-wider text-zinc-500">
          <span>Event</span><span>Date</span><span>Era</span><span>Category</span><span>Sig.</span><span></span>
        </div>
        {events.map((e, i) => (
          <div key={i} className="grid grid-cols-[1fr_90px_110px_110px_90px_30px] gap-1.5">
            <input className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white" placeholder="Event name" value={e.name} onChange={(ev) => updateEvent(i, 'name', ev.target.value)} />
            <input className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white font-mono" placeholder="1215" value={e.date} onChange={(ev) => updateEvent(i, 'date', ev.target.value)} />
            <input className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white" placeholder="Era" value={e.era} onChange={(ev) => updateEvent(i, 'era', ev.target.value)} />
            <select className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white" value={e.category} onChange={(ev) => updateEvent(i, 'category', ev.target.value)}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white" value={e.significance} onChange={(ev) => updateEvent(i, 'significance', ev.target.value as HistEvent['significance'])}>
              {SIGNIFICANCES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button type="button" onClick={() => removeEvent(i)} className="rounded border border-zinc-800 text-xs text-zinc-500 hover:text-rose-300" aria-label="Remove"><Trash2 className="mx-auto h-3 w-3" /></button>
          </div>
        ))}
        <button type="button" onClick={addEvent} className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300 hover:border-amber-500/40 hover:text-amber-200"><Plus className="h-3 w-3" />Add event</button>
      </div>

      <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500">Source to evaluate</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-5">
          <label className="block sm:col-span-2"><span className="block text-[9px] uppercase tracking-wider text-zinc-500">Title</span>
            <input className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white" value={source.title} onChange={(e) => setSource({ ...source, title: e.target.value })} /></label>
          <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-500">Type</span>
            <select className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white" value={source.type} onChange={(e) => setSource({ ...source, type: e.target.value as Source['type'] })}>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select></label>
          <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-500">Author</span>
            <input className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white" value={source.author} onChange={(e) => setSource({ ...source, author: e.target.value })} /></label>
          <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-500">Bias</span>
            <select className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white" value={source.bias} onChange={(e) => setSource({ ...source, bias: e.target.value as Source['bias'] })}>
              {BIASES.map((b) => <option key={b} value={b}>{b}</option>)}
            </select></label>
        </div>
      </div>

      <button type="button" onClick={() => analyze.mutate()} disabled={analyze.isPending} className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/15 px-3 py-1.5 text-xs font-mono text-amber-200 hover:bg-amber-500/25 disabled:opacity-50">
        {analyze.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <History className="h-3.5 w-3.5" />}
        Analyze
      </button>

      {analyze.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">Analysis failed.</div>}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
          <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500"><ScrollText className="h-3 w-3" />Timeline</div>
          {!timeline && <div className="text-[11px] text-zinc-500">Analyze to build.</div>}
          {timeline?.timeline && (
            <div className="space-y-1 text-[11px]">
              <div className="text-zinc-400">{timeline.totalEvents} events · {timeline.timeSpan}</div>
              {timeline.timeline.map((t, i) => (
                <div key={i} className="flex items-start gap-2 rounded border border-amber-500/15 bg-zinc-950/40 px-2 py-1">
                  <span className="font-mono text-[10px] text-amber-200 shrink-0">{t.date}</span>
                  <div className="flex-1">
                    <div className="text-zinc-100">{t.event}</div>
                    <div className="flex gap-1 text-[9px] text-zinc-500">
                      {t.category && <span className="rounded bg-zinc-800 px-1">{t.category}</span>}
                      {t.significance && <span className={`rounded px-1 ${t.significance === 'critical' ? 'bg-rose-500/20 text-rose-200' : t.significance === 'high' ? 'bg-amber-500/20 text-amber-200' : 'bg-zinc-800'}`}>{t.significance}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-3">
          <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500"><Scale className="h-3 w-3" />Source reliability</div>
          {!sourceResult && <div className="text-[11px] text-zinc-500">Analyze to score.</div>}
          {sourceResult && (
            <div className="space-y-2 text-[11px]">
              <div className="flex items-baseline gap-2">
                <span className={`font-mono text-3xl ${reliabilityColour(sourceResult.reliabilityScore)}`}>{sourceResult.reliabilityScore}</span>
                <span className="text-zinc-500">/100</span>
              </div>
              <div className={`inline-block rounded px-2 py-0.5 text-[10px] ${sourceResult.reliabilityScore && sourceResult.reliabilityScore >= 70 ? 'bg-emerald-500/20 text-emerald-200' : sourceResult.reliabilityScore && sourceResult.reliabilityScore >= 40 ? 'bg-amber-500/20 text-amber-200' : 'bg-rose-500/20 text-rose-200'}`}>{sourceResult.classification}</div>
              {sourceResult.corroborationNeeded && <div className="text-amber-300">⚠ Corroboration recommended</div>}
              {sourceResult.evaluation && (
                <div className="grid grid-cols-2 gap-1 pt-1">
                  <div className="rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1"><div className="text-[9px] text-zinc-500">Source type</div><div className="font-mono text-zinc-200">{sourceResult.evaluation.sourceType}/90</div></div>
                  <div className="rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1"><div className="text-[9px] text-zinc-500">Bias</div><div className="font-mono text-zinc-200">{sourceResult.evaluation.biasAssessment}/90</div></div>
                  <div className="rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1"><div className="text-[9px] text-zinc-500">Author</div><div className="font-mono text-zinc-200">{sourceResult.evaluation.authorAttribution}</div></div>
                  <div className="rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1"><div className="text-[9px] text-zinc-500">Date prov.</div><div className="font-mono text-zinc-200">{sourceResult.evaluation.dateProvenance}</div></div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
