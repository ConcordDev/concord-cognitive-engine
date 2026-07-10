'use client';

import { useEffect, useState } from 'react';
import { Calendar, Loader2, Plus, AlertCircle, Gavel, Users, FileText, ScanText, Check } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Matter { id: string; name: string }
interface CalEvent {
  id: string; number: string; title: string; kind: 'deadline' | 'hearing' | 'meeting' | 'filing' | 'other';
  date: string; time: string; location: string;
  matterId: string | null; description: string; sourceRule: string;
}

const KIND_ICON: Record<CalEvent['kind'], typeof Calendar> = {
  deadline: AlertCircle, hearing: Gavel, meeting: Users, filing: FileText, other: Calendar,
};

const KINDS: CalEvent['kind'][] = ['deadline', 'hearing', 'meeting', 'filing', 'other'];

interface CourtDocSuggestion {
  kind: 'deadline' | 'hearing'; source: string; days?: number; context: string; suggestedDate: string;
}

const RULES = [
  { id: 'frcp-12-answer',          name: 'FRCP 12(a)(1)(A) — Answer (21 days)' },
  { id: 'frcp-12-answer-removed',  name: 'FRCP 81(c)(2) — Answer after removal (7 days)' },
  { id: 'frcp-12-motion',          name: 'FRCP 12 — Motion to dismiss (21 days)' },
  { id: 'frcp-26-conference',      name: 'FRCP 26(f) — Discovery conference (21 days)' },
  { id: 'frcp-26-disclosures',     name: 'FRCP 26(a)(1)(C) — Initial disclosures (14 days)' },
  { id: 'frcp-33-interrogatories', name: 'FRCP 33(b)(2) — Answer interrogatories (30 days)' },
  { id: 'frcp-34-rfp',             name: 'FRCP 34(b)(2) — Respond to RFP (30 days)' },
  { id: 'frcp-36-rfa',             name: 'FRCP 36(a)(3) — Respond to RFA (30 days)' },
  { id: 'frcp-56-msj-response',    name: 'FRCP 56 — MSJ response (21 days, local-rule typical)' },
  { id: 'frap-4-notice-appeal',    name: 'FRAP 4(a)(1)(A) — Notice of appeal (30 days)' },
];

export function CalendarPanel() {
  const [list, setList] = useState<CalEvent[]>([]);
  const [matters, setMatters] = useState<Matter[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showCalc, setShowCalc] = useState(false);
  const [draft, setDraft] = useState<{ title: string; kind: CalEvent['kind']; date: string; time: string; location: string; matterId: string; description: string }>({ title: '', kind: 'deadline', date: '', time: '', location: '', matterId: '', description: '' });
  const [calc, setCalc] = useState({ rule: '', triggerDate: '', matterId: '' });
  const [calcResult, setCalcResult] = useState<{ rule: string; ruleName: string; adjustedDeadline: string; rawDeadline: string; rolledForward: boolean; days: number } | null>(null);
  const [showParse, setShowParse] = useState(false);
  const [docText, setDocText] = useState('');
  const [parseMatterId, setParseMatterId] = useState('');
  const [parseTriggerDate, setParseTriggerDate] = useState('');
  const [suggestions, setSuggestions] = useState<CourtDocSuggestion[] | null>(null);
  const [parseBusy, setParseBusy] = useState(false);
  const [addedKeys, setAddedKeys] = useState<Set<string>>(new Set());

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const [e, m] = await Promise.all([
        lensRun({ domain: 'legal', action: 'calendar-list', input: {} }),
        lensRun({ domain: 'legal', action: 'matters-list', input: { status: 'open' } }),
      ]);
      setList((e.data?.result?.events || []) as CalEvent[]);
      setMatters((m.data?.result?.matters || []) as Matter[]);
    } catch (err) { console.error('[Calendar] refresh failed', err); }
    finally { setLoading(false); }
  }

  async function create() {
    if (!draft.title.trim()) return;
    try {
      await lensRun({ domain: 'legal', action: 'calendar-create', input: draft });
      setDraft({ title: '', kind: 'deadline', date: '', time: '', location: '', matterId: '', description: '' });
      setShowCreate(false);
      await refresh();
    } catch (e) { console.error('[Calendar] create failed', e); }
  }

  async function runCalc() {
    if (!calc.rule || !calc.triggerDate) return;
    try {
      const r = await lensRun({ domain: 'legal', action: 'court-rules-deadline', input: { rule: calc.rule, triggerDate: calc.triggerDate } });
      setCalcResult(r.data?.result);
    } catch (e) { console.error('[Calendar] calc failed', e); }
  }

  async function bookCalcResult() {
    if (!calcResult || !calc.rule) return;
    try {
      await lensRun({
        domain: 'legal', action: 'calendar-create',
        input: {
          title: calcResult.ruleName,
          kind: 'deadline',
          date: calcResult.adjustedDeadline,
          matterId: calc.matterId || undefined,
          sourceRule: calc.rule,
          description: `Auto-computed from court rule ${calc.rule} triggered ${calc.triggerDate} (${calcResult.days} days). ${calcResult.rolledForward ? 'Rolled forward past weekend/holiday per FRCP 6(a).' : ''}`,
        },
      });
      setCalcResult(null);
      setCalc({ rule: '', triggerDate: '', matterId: '' });
      setShowCalc(false);
      await refresh();
    } catch (e) { console.error('[Calendar] book calc failed', e); }
  }

  async function parseCourtDoc() {
    if (docText.trim().length < 40) return;
    setParseBusy(true);
    setSuggestions(null);
    setAddedKeys(new Set());
    try {
      const r = await lensRun({
        domain: 'legal', action: 'ai-court-doc-to-calendar',
        input: { text: docText.trim(), triggerDate: parseTriggerDate || undefined },
      });
      if (r.data?.ok === false) { alert(r.data?.error); return; }
      setSuggestions((r.data?.result?.suggestions || []) as CourtDocSuggestion[]);
    } catch (e) { console.error('[Calendar] parse court doc failed', e); }
    finally { setParseBusy(false); }
  }

  async function addSuggestion(s: CourtDocSuggestion, key: string) {
    try {
      await lensRun({
        domain: 'legal', action: 'calendar-create',
        input: {
          title: s.kind === 'hearing' ? 'Hearing (from court document)' : `Deadline${s.days ? ` (${s.days} days)` : ''} (from court document)`,
          kind: s.kind,
          date: s.suggestedDate,
          matterId: parseMatterId || undefined,
          description: s.context,
          sourceRule: s.source,
        },
      });
      setAddedKeys((prev) => new Set(prev).add(key));
      await refresh();
    } catch (e) { console.error('[Calendar] add suggestion failed', e); }
  }

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = list.filter(e => e.date >= today);
  const past = list.filter(e => e.date < today);

  return (
    <div className="space-y-3">
      {/* Court rules calculator (Clio parity headline feature) */}
      <div className="bg-amber-500/[0.05] border border-amber-500/20 rounded-lg overflow-hidden">
        <header className="px-4 py-2.5 border-b border-amber-500/20 flex items-center gap-2">
          <Gavel className="w-4 h-4 text-amber-400" />
          <span className="text-sm font-semibold text-amber-200">Court rules deadline calculator</span>
          <button onClick={() => setShowCalc(v => !v)} className="ml-auto text-[10px] text-amber-300 underline">{showCalc ? 'Hide' : 'Compute a deadline'}</button>
        </header>
        {showCalc && (
          <div className="p-3 grid grid-cols-12 gap-2">
            <select value={calc.rule} onChange={e => setCalc({ ...calc, rule: e.target.value })} className="col-span-6 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
              <option value="">Pick a rule…</option>
              {RULES.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <input type="date" value={calc.triggerDate} onChange={e => setCalc({ ...calc, triggerDate: e.target.value })} className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
            <select value={calc.matterId} onChange={e => setCalc({ ...calc, matterId: e.target.value })} className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
              <option value="">No matter</option>
              {matters.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <button onClick={runCalc} disabled={!calc.rule || !calc.triggerDate} className="col-span-12 px-3 py-1.5 text-xs rounded bg-amber-500 text-black font-bold hover:bg-amber-400 disabled:opacity-40">Compute</button>
            {calcResult && (
              <div className="col-span-12 mt-1 rounded border border-emerald-500/30 bg-emerald-500/[0.05] p-3 text-xs">
                <div className="text-emerald-200 font-semibold">Deadline: {calcResult.adjustedDeadline}</div>
                <div className="text-gray-400 mt-1">{calcResult.ruleName}</div>
                <div className="text-[10px] text-gray-400 mt-1">
                  {calcResult.days} days from {calc.triggerDate}.
                  {calcResult.rolledForward && ` Raw was ${calcResult.rawDeadline}; rolled forward to next business day per FRCP 6(a)(1)(C).`}
                </div>
                <button onClick={bookCalcResult} className="mt-2 px-2.5 py-1 text-[11px] rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400">Add to calendar</button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Court document deadline parser (Clio Manage AI parity) */}
      <div className="bg-amber-500/[0.05] border border-amber-500/20 rounded-lg overflow-hidden">
        <header className="px-4 py-2.5 border-b border-amber-500/20 flex items-center gap-2">
          <ScanText className="w-4 h-4 text-amber-400" />
          <span className="text-sm font-semibold text-amber-200">Parse court document for deadlines</span>
          <button onClick={() => setShowParse(v => !v)} className="ml-auto text-[10px] text-amber-300 underline">{showParse ? 'Hide' : 'Paste a document'}</button>
        </header>
        {showParse && (
          <div className="p-3 space-y-2">
            <textarea value={docText} onChange={e => setDocText(e.target.value)} rows={5}
              placeholder="Paste the body of a court order, notice, or scheduling document…"
              className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
            <div className="grid grid-cols-12 gap-2">
              <input type="date" value={parseTriggerDate} onChange={e => setParseTriggerDate(e.target.value)} title="Trigger date for 'within N days' clauses (defaults to today)" className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
              <select value={parseMatterId} onChange={e => setParseMatterId(e.target.value)} className="col-span-5 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
                <option value="">No matter</option>
                {matters.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              <button onClick={parseCourtDoc} disabled={docText.trim().length < 40 || parseBusy} className="col-span-4 px-3 py-1.5 text-xs rounded bg-amber-500 text-black font-bold hover:bg-amber-400 disabled:opacity-40 inline-flex items-center justify-center gap-1">
                {parseBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}Extract deadlines
              </button>
            </div>
            {suggestions && (
              suggestions.length === 0 ? (
                <p className="text-xs text-gray-400 italic">No deadline or hearing language detected in that text.</p>
              ) : (
                <ul className="space-y-1.5">
                  {suggestions.map((s, i) => {
                    const key = `${s.suggestedDate}-${s.kind}-${i}`;
                    const added = addedKeys.has(key);
                    return (
                      <li key={key} className="rounded border border-white/10 bg-black/30 p-2 flex items-start gap-2">
                        <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded shrink-0', s.kind === 'hearing' ? 'bg-cyan-500/15 text-cyan-300' : 'bg-rose-500/15 text-rose-300')}>{s.kind}</span>
                        <div className="flex-1 min-w-0 text-xs">
                          <div className="text-white font-mono">{s.suggestedDate}{s.days ? ` · ${s.days} days` : ''}</div>
                          <div className="text-[10px] text-gray-400 truncate">&hellip;{s.context}&hellip;</div>
                        </div>
                        <button onClick={() => addSuggestion(s, key)} disabled={added}
                          className="shrink-0 px-2 py-1 text-[10px] rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400 disabled:opacity-40 inline-flex items-center gap-1">
                          {added ? <Check className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                          {added ? 'Added' : 'Add to calendar'}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )
            )}
          </div>
        )}
      </div>

      {/* Events */}
      <div className="bg-[#0d1117] border border-amber-500/15 rounded-lg overflow-hidden">
        <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
          <Calendar className="w-4 h-4 text-amber-400" />
          <span className="text-sm font-semibold text-gray-200">Calendar</span>
          <span className="text-[10px] text-gray-400">{upcoming.length} upcoming</span>
          <button onClick={() => setShowCreate(v => !v)} className="ml-auto px-2.5 py-1 text-xs rounded bg-amber-500 text-black font-semibold hover:bg-amber-400 inline-flex items-center gap-1">
            <Plus className="w-3 h-3" />New event
          </button>
        </header>

        {showCreate && (
          <div className="p-3 grid grid-cols-12 gap-2 border-b border-white/10">
            <input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} placeholder="Title *" className="col-span-6 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <select value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value as CalEvent['kind'] })} className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
              {KINDS.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
            <input type="date" value={draft.date} onChange={e => setDraft({ ...draft, date: e.target.value })} className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
            <select value={draft.matterId} onChange={e => setDraft({ ...draft, matterId: e.target.value })} className="col-span-5 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
              <option value="">No matter</option>
              {matters.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <input type="time" value={draft.time} onChange={e => setDraft({ ...draft, time: e.target.value })} className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
            <input value={draft.location} onChange={e => setDraft({ ...draft, location: e.target.value })} placeholder="Location" className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <textarea value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} placeholder="Description" rows={2} className="col-span-12 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <button onClick={create} className="col-span-12 px-3 py-1.5 text-xs rounded bg-amber-500 text-black font-bold hover:bg-amber-400">Save event</button>
          </div>
        )}

        <div className="max-h-[28rem] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
          ) : list.length === 0 ? (
            <div className="px-3 py-10 text-center text-xs text-gray-400"><Calendar className="w-6 h-6 mx-auto mb-2 opacity-30" />No events scheduled.</div>
          ) : (
            <>
              {upcoming.length > 0 && (
                <>
                  <div className="px-4 py-1 bg-amber-500/[0.04] text-[10px] uppercase tracking-wider text-amber-300 font-semibold">Upcoming</div>
                  <EventList events={upcoming} />
                </>
              )}
              {past.length > 0 && (
                <>
                  <div className="px-4 py-1 bg-white/[0.02] text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Past</div>
                  <EventList events={past.slice(-15).reverse()} muted />
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function EventList({ events, muted }: { events: CalEvent[]; muted?: boolean }) {
  return (
    <ul className="divide-y divide-white/5">
      {events.map(e => {
        const Icon = KIND_ICON[e.kind];
        return (
          <li key={e.id} className={cn('px-4 py-2 flex items-center gap-3', muted && 'opacity-60')}>
            <Icon className={cn('w-3.5 h-3.5', e.kind === 'deadline' ? 'text-rose-400' : e.kind === 'hearing' ? 'text-amber-400' : 'text-cyan-400')} />
            <span className="font-mono text-[10px] text-gray-400 w-20">{e.date}</span>
            {e.time && <span className="font-mono text-[10px] text-gray-400">{e.time}</span>}
            <div className="flex-1 min-w-0">
              <div className="text-xs text-white truncate">{e.title}</div>
              {(e.location || e.description) && <div className="text-[10px] text-gray-400 truncate">{e.location} {e.description && `· ${e.description}`}</div>}
              {e.sourceRule && <div className="text-[9px] text-amber-300 font-mono">{e.sourceRule}</div>}
            </div>
            <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-white/5 text-gray-400">{e.kind}</span>
          </li>
        );
      })}
    </ul>
  );
}

export default CalendarPanel;
