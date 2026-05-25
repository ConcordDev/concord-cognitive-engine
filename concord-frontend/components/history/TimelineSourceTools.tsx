'use client';

/**
 * TimelineSourceTools — historical timeline + source-reliability surface
 * for the history lens. Wires history.timelineBuild + history.sourceEvaluate.
 *
 * Refactored to use `CalcPanel` primitive. See
 * `concord-frontend/components/lens-primitives/CalcPanel.tsx`.
 */

import { useState } from 'react';
import { History, Plus, Trash2, ScrollText, Scale } from 'lucide-react';
import { CalcPanel } from '@/components/lens-primitives/CalcPanel';

interface HistEvent { name: string; date: string; era: string; category: string; significance: 'low' | 'medium' | 'high' | 'critical' }
interface Source { title: string; type: 'primary' | 'secondary' | 'tertiary'; author: string; date: string; bias: 'none' | 'low' | 'moderate' | 'high' }
interface TimelineResult { timeline?: Array<{ event: string; date: string; era?: string; significance?: string; category?: string }>; totalEvents?: number; timeSpan?: string; categories?: string[]; eras?: string[]; pivotalEvents?: Array<{ event: string; date: string }> }
interface SourceResult { title?: string; type?: string; reliabilityScore?: number; classification?: string; corroborationNeeded?: boolean; evaluation?: { sourceType: number; biasAssessment: number; authorAttribution: string; dateProvenance: string } }

const CATEGORIES = ['political', 'military', 'cultural', 'economic', 'scientific', 'religious', 'social'] as const;
const SIGNIFICANCES = ['low', 'medium', 'high', 'critical'] as const;
const TYPES = ['primary', 'secondary', 'tertiary'] as const;
const BIASES = ['none', 'low', 'moderate', 'high'] as const;

const reliabilityColour = (score?: number) => {
  if (!score) return 'text-zinc-400';
  if (score >= 70) return 'text-emerald-200';
  if (score >= 40) return 'text-amber-200';
  return 'text-rose-200';
};

export function TimelineSourceTools() {
  const [events, setEvents] = useState<HistEvent[]>([{ name: '', date: '', era: '', category: 'political', significance: 'medium' }]);
  const [source, setSource] = useState<Source>({ title: '', type: 'primary', author: '', date: '', bias: 'none' });

  const addEvent = () => setEvents((es) => [...es, { name: '', date: '', era: '', category: 'political', significance: 'medium' }]);
  const updateEvent = <K extends keyof HistEvent>(i: number, key: K, value: HistEvent[K]) =>
    setEvents((es) => es.map((e, idx) => (idx === i ? { ...e, [key]: value } : e)));
  const removeEvent = (i: number) => setEvents((es) => es.filter((_, idx) => idx !== i));

  return (
    <CalcPanel<TimelineResult, SourceResult>
      title="Timeline + source evaluator"
      domain="history"
      icon={<History className="h-5 w-5 text-amber-400" />}
      macroBadge="history.timelineBuild + sourceEvaluate"
      accent="amber"
      left={{
        macro: 'timelineBuild',
        buildArtifact: () => ({ data: { events: events.filter((e) => e.name.trim() && e.date.trim()) } }),
        render: (
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-zinc-400">Historical events</div>
            <div className="grid grid-cols-[1fr_90px_110px_110px_90px_30px] gap-1.5 text-[9px] uppercase tracking-wider text-zinc-400">
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
                <button type="button" onClick={() => removeEvent(i)} className="rounded border border-zinc-800 text-xs text-zinc-400 hover:text-rose-300" aria-label="Remove"><Trash2 className="mx-auto h-3 w-3" /></button>
              </div>
            ))}
            <button type="button" onClick={addEvent} className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300 hover:border-amber-500/40 hover:text-amber-200"><Plus className="h-3 w-3" />Add event</button>
          </div>
        ),
      }}
      right={{
        macro: 'sourceEvaluate',
        buildArtifact: () => ({ title: source.title, data: source }),
        render: (
          <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="text-[10px] uppercase tracking-wider text-zinc-400">Source to evaluate</div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-5">
              <label className="block sm:col-span-2"><span className="block text-[9px] uppercase tracking-wider text-zinc-400">Title</span>
                <input className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white" value={source.title} onChange={(e) => setSource({ ...source, title: e.target.value })} /></label>
              <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-400">Type</span>
                <select className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white" value={source.type} onChange={(e) => setSource({ ...source, type: e.target.value as Source['type'] })}>
                  {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select></label>
              <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-400">Author</span>
                <input className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white" value={source.author} onChange={(e) => setSource({ ...source, author: e.target.value })} /></label>
              <label className="block"><span className="block text-[9px] uppercase tracking-wider text-zinc-400">Bias</span>
                <select className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white" value={source.bias} onChange={(e) => setSource({ ...source, bias: e.target.value as Source['bias'] })}>
                  {BIASES.map((b) => <option key={b} value={b}>{b}</option>)}
                </select></label>
            </div>
          </div>
        ),
      }}
      renderResults={(timeline, sourceResult) => (
        <>
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
            <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><ScrollText className="h-3 w-3" />Timeline</div>
            {!timeline && <div className="text-[11px] text-zinc-400">Analyze to build.</div>}
            {timeline?.timeline && (
              <div className="space-y-1 text-[11px]">
                <div className="text-zinc-400">{timeline.totalEvents} events · {timeline.timeSpan}</div>
                {timeline.timeline.map((t, i) => (
                  <div key={i} className="flex items-start gap-2 rounded border border-amber-500/15 bg-zinc-950/40 px-2 py-1">
                    <span className="font-mono text-[10px] text-amber-200 shrink-0">{t.date}</span>
                    <div className="flex-1">
                      <div className="text-zinc-100">{t.event}</div>
                      <div className="flex gap-1 text-[9px] text-zinc-400">
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
            <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Scale className="h-3 w-3" />Source reliability</div>
            {!sourceResult && <div className="text-[11px] text-zinc-400">Analyze to score.</div>}
            {sourceResult && (
              <div className="space-y-2 text-[11px]">
                <div className="flex items-baseline gap-2">
                  <span className={`font-mono text-3xl ${reliabilityColour(sourceResult.reliabilityScore)}`}>{sourceResult.reliabilityScore}</span>
                  <span className="text-zinc-400">/100</span>
                </div>
                <div className={`inline-block rounded px-2 py-0.5 text-[10px] ${sourceResult.reliabilityScore && sourceResult.reliabilityScore >= 70 ? 'bg-emerald-500/20 text-emerald-200' : sourceResult.reliabilityScore && sourceResult.reliabilityScore >= 40 ? 'bg-amber-500/20 text-amber-200' : 'bg-rose-500/20 text-rose-200'}`}>{sourceResult.classification}</div>
                {sourceResult.corroborationNeeded && <div className="text-amber-300">⚠ Corroboration recommended</div>}
                {sourceResult.evaluation && (
                  <div className="grid grid-cols-2 gap-1 pt-1">
                    <div className="rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1"><div className="text-[9px] text-zinc-400">Source type</div><div className="font-mono text-zinc-200">{sourceResult.evaluation.sourceType}/90</div></div>
                    <div className="rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1"><div className="text-[9px] text-zinc-400">Bias</div><div className="font-mono text-zinc-200">{sourceResult.evaluation.biasAssessment}/90</div></div>
                    <div className="rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1"><div className="text-[9px] text-zinc-400">Author</div><div className="font-mono text-zinc-200">{sourceResult.evaluation.authorAttribution}</div></div>
                    <div className="rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1"><div className="text-[9px] text-zinc-400">Date prov.</div><div className="font-mono text-zinc-200">{sourceResult.evaluation.dateProvenance}</div></div>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
      dtu={{
        apiSource: 'concord-history-timeline-source',
        title: (t, s) => `History analysis — ${t.totalEvents ?? 0} events · source ${s.reliabilityScore ?? '—'}/100`,
        content: (t, s) => `Timeline (${t.timeSpan || '—'}):\n${(t.timeline || []).map((e) => `  ${e.date} — ${e.event} [${e.category}, ${e.significance}]`).join('\n')}\n\nPivotal: ${t.pivotalEvents?.map((p) => p.event).join(', ') || 'none'}\n\nSource evaluation:\n  Title: ${s.title}\n  Type: ${s.type} | Reliability: ${s.reliabilityScore}/100 (${s.classification})\n  Corroboration needed: ${s.corroborationNeeded ? 'yes' : 'no'}`,
        tags: () => ['history', 'timeline', 'sources'],
        rawData: (t, s) => ({ events, source, timeline: t, sourceResult: s }),
      }}
    />
  );
}
