'use client';

import { useEffect, useState, useCallback } from 'react';
import { CalendarDays, Loader2, Plus, Trash2, ClipboardList, FileCheck, Video, MapPin } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Meeting {
  id: string; title: string; body: string; scheduledAt: string; location: string; virtualUrl: string;
  agenda: string[]; minutes: string; status: 'scheduled' | 'minutes_published'; createdAt: string;
  minutesPublishedAt?: string;
}

const BODIES = [
  ['city_council', 'City Council'], ['planning_commission', 'Planning Commission'],
  ['school_board', 'School Board'], ['zoning_board', 'Zoning Board'],
  ['budget_committee', 'Budget Committee'], ['public_hearing', 'Public Hearing'],
  ['special_session', 'Special Session'], ['other', 'Other'],
];

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

export function MeetingsPanel() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUpcoming, setShowUpcoming] = useState(false);
  const [form, setForm] = useState({ title: '', body: 'city_council', scheduledAt: '', location: '', virtualUrl: '', agenda: '' });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [minutesDraft, setMinutesDraft] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'government', action: 'meetings-list', input: { upcoming: showUpcoming } });
      setMeetings((res.data?.result?.meetings || []) as Meeting[]);
    } catch (e) { console.error('[Meetings] refresh', e); }
    finally { setLoading(false); }
  }, [showUpcoming]);

  useEffect(() => { refresh(); }, [refresh]);

  async function schedule() {
    if (!form.title.trim() || !form.scheduledAt.trim()) return;
    try {
      const agenda = form.agenda.split('\n').map(s => s.trim()).filter(Boolean);
      const res = await lensRun({ domain: 'government', action: 'meetings-schedule', input: { ...form, agenda } });
      if (res.data?.ok === false) { alert(res.data?.error); return; }
      setForm({ title: '', body: 'city_council', scheduledAt: '', location: '', virtualUrl: '', agenda: '' });
      await refresh();
    } catch (e) { console.error('[Meetings] schedule', e); }
  }

  async function remove(id: string) {
    try {
      await lensRun({ domain: 'government', action: 'meetings-delete', input: { id } });
      setMeetings(prev => prev.filter(m => m.id !== id));
    } catch (e) { console.error('[Meetings] delete', e); }
  }

  async function publishMinutes(id: string) {
    if (!minutesDraft.trim()) return;
    try {
      const res = await lensRun({ domain: 'government', action: 'meetings-publish-minutes', input: { id, minutes: minutesDraft } });
      if (res.data?.ok === false) { alert(res.data?.error); return; }
      setMinutesDraft('');
      await refresh();
    } catch (e) { console.error('[Meetings] publishMinutes', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <CalendarDays className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Public meeting calendar</span>
        <label className="ml-auto text-[10px] text-gray-400 inline-flex items-center gap-1 cursor-pointer">
          <input type="checkbox" checked={showUpcoming} onChange={e => setShowUpcoming(e.target.checked)} className="accent-cyan-500" />
          Upcoming only
        </label>
      </header>

      {/* Schedule a meeting */}
      <div className="p-3 border-b border-white/10 space-y-2">
        <div className="grid grid-cols-6 gap-2">
          <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Meeting title" className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <select value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            {BODIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input value={form.scheduledAt} onChange={e => setForm({ ...form, scheduledAt: e.target.value })} type="datetime-local" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} placeholder="Location (e.g. Council Chambers)" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={form.virtualUrl} onChange={e => setForm({ ...form, virtualUrl: e.target.value })} placeholder="Virtual meeting URL (optional)" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        </div>
        <textarea value={form.agenda} onChange={e => setForm({ ...form, agenda: e.target.value })} placeholder="Agenda items, one per line" rows={2} className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <button onClick={schedule} className="px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 inline-flex items-center gap-1"><Plus className="w-3 h-3" />Schedule meeting</button>
      </div>

      <div className="max-h-96 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" />Loading…</div>
        ) : meetings.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><CalendarDays className="w-6 h-6 mx-auto mb-2 opacity-30" />No meetings scheduled yet.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {meetings.map(m => {
              const isOpen = expanded === m.id;
              return (
                <li key={m.id} className="px-3 py-2 hover:bg-white/[0.03] group">
                  <div className="flex items-center gap-2">
                    <button onClick={() => { setExpanded(isOpen ? null : m.id); setMinutesDraft(m.minutes || ''); }} className="flex-1 min-w-0 text-left">
                      <div className="text-sm text-white truncate">{m.title}</div>
                      <div className="text-[10px] text-gray-400 inline-flex items-center gap-2">
                        <span>{BODIES.find(b => b[0] === m.body)?.[1] || m.body}</span>
                        <span>· {fmtDate(m.scheduledAt)}</span>
                        {m.location && <span className="inline-flex items-center gap-0.5"><MapPin className="w-2.5 h-2.5" />{m.location}</span>}
                      </div>
                    </button>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${m.status === 'minutes_published' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>
                      {m.status === 'minutes_published' ? 'minutes published' : 'scheduled'}
                    </span>
                    <button aria-label="Delete" onClick={() => remove(m.id)} className="opacity-0 group-hover:opacity-100 p-1 text-rose-400"><Trash2 className="w-3 h-3" /></button>
                  </div>
                  {isOpen && (
                    <div className="mt-2 pl-2 border-l-2 border-cyan-500/20 space-y-2">
                      {m.virtualUrl && (
                        <a href={m.virtualUrl} target="_blank" rel="noreferrer" className="text-[10px] text-cyan-400 inline-flex items-center gap-1 hover:underline">
                          <Video className="w-3 h-3" />Join virtual meeting
                        </a>
                      )}
                      <div>
                        <div className="text-[10px] uppercase text-gray-400 mb-1 inline-flex items-center gap-1"><ClipboardList className="w-3 h-3" />Agenda</div>
                        {m.agenda.length === 0 ? (
                          <div className="text-[10px] text-gray-400">No agenda items.</div>
                        ) : (
                          <ol className="list-decimal list-inside text-xs text-gray-300 space-y-0.5">
                            {m.agenda.map((a, i) => <li key={i}>{a}</li>)}
                          </ol>
                        )}
                      </div>
                      <div>
                        <div className="text-[10px] uppercase text-gray-400 mb-1 inline-flex items-center gap-1"><FileCheck className="w-3 h-3" />Minutes</div>
                        {m.status === 'minutes_published' ? (
                          <p className="text-xs text-gray-300 whitespace-pre-wrap">{m.minutes}</p>
                        ) : (
                          <>
                            <textarea value={minutesDraft} onChange={e => setMinutesDraft(e.target.value)} placeholder="Draft minutes…" rows={3} className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
                            <button onClick={() => publishMinutes(m.id)} disabled={!minutesDraft.trim()} className="mt-1 px-3 py-1 text-[10px] rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-40">Publish minutes</button>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export default MeetingsPanel;
