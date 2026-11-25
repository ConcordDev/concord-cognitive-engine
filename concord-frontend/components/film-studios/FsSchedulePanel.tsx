'use client';

/**
 * FsSchedulePanel — stripboard scheduling (assign scenes to shoot days)
 * and one-click call sheet generation.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, CalendarDays, FileText } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ErrorState } from '@/components/ui';

interface Scene { id: string; number: string; slugline: string; pageEighths: number }
interface Day {
  id: string; dayNumber: number; date: string | null; location: string | null;
  scenes: Scene[]; sceneCount: number; pageEighths: number;
}
interface CallSheet {
  day: { dayNumber: number; date: string | null; location: string | null; generalCall: string | null };
  scenes: { number: string; slugline: string; pageEighths: number }[];
  cast: { name: string; characterName: string | null }[];
  crew: { name: string; department: string; position: string | null }[];
  totalPageEighths: number; sceneCount: number;
}

export function FsSchedulePanel({ projectId, onChange }: { projectId: string; onChange: () => void }) {
  const [days, setDays] = useState<Day[]>([]);
  const [unscheduled, setUnscheduled] = useState<Scene[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dayForm, setDayForm] = useState({ date: '', location: '', generalCall: '' });
  const [callSheet, setCallSheet] = useState<CallSheet | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('film-studios', 'stripboard', { projectId });
    if (r.data?.ok === false) {
      setLoadError(r.data?.error || 'Could not load stripboard.');
      setLoading(false);
      return;
    }
    setLoadError(null);
    setDays(r.data?.result?.days || []);
    setUnscheduled(r.data?.result?.unscheduled || []);
    setLoading(false);
    onChange();
  }, [projectId, onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const addDay = async () => {
    await lensRun('film-studios', 'shoot-day-create', {
      projectId, date: dayForm.date, location: dayForm.location.trim(), generalCall: dayForm.generalCall.trim(),
    });
    setDayForm({ date: '', location: '', generalCall: '' });
    await refresh();
  };

  const delDay = async (id: string) => {
    await lensRun('film-studios', 'shoot-day-delete', { id });
    setCallSheet(null);
    await refresh();
  };

  const assign = async (sceneId: string, shootDayId: string) => {
    await lensRun('film-studios', 'strip-assign', { sceneId, shootDayId: shootDayId || undefined });
    await refresh();
  };

  const genCallSheet = async (shootDayId: string) => {
    const r = await lensRun('film-studios', 'call-sheet', { shootDayId });
    setCallSheet((r.data?.result as CallSheet | null) || null);
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-[var(--fo-muted,#a1a1aa)]"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  if (loadError) {
    return <div className="p-4"><ErrorState message={loadError} onRetry={refresh} /></div>;
  }

  return (
    <div className="space-y-4">
      {/* New shoot day */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-[var(--fo-paper-2,rgba(24,24,27,0.7))] border border-[var(--fo-rule,#27272a)] rounded-xl p-3">
        <input type="date" value={dayForm.date} onChange={(e) => setDayForm({ ...dayForm, date: e.target.value })}
          className="bg-[var(--fo-input,#09090b)] border border-[var(--fo-rule-2,#3f3f46)] rounded-lg px-2 py-1.5 text-xs text-[var(--fo-ink,#f4f4f5)]" />
        <input placeholder="Location" value={dayForm.location} onChange={(e) => setDayForm({ ...dayForm, location: e.target.value })}
          className="bg-[var(--fo-input,#09090b)] border border-[var(--fo-rule-2,#3f3f46)] rounded-lg px-2 py-1.5 text-xs text-[var(--fo-ink,#f4f4f5)]" />
        <input placeholder="Call time" value={dayForm.generalCall} onChange={(e) => setDayForm({ ...dayForm, generalCall: e.target.value })}
          className="bg-[var(--fo-input,#09090b)] border border-[var(--fo-rule-2,#3f3f46)] rounded-lg px-2 py-1.5 text-xs text-[var(--fo-ink,#f4f4f5)]" />
        <button type="button" onClick={addDay}
          className="flex items-center justify-center gap-1 bg-[var(--fo-tape,#c026d3)] hover:bg-[#b72d23] text-white text-xs font-medium rounded-lg">
          <Plus className="w-3.5 h-3.5" /> Shoot day
        </button>
      </section>

      {/* Stripboard */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-[var(--fo-ink-2,#d4d4d8)] mb-2">
          <CalendarDays className="w-3.5 h-3.5 text-[var(--fo-tape,#e879f9)]" /> Stripboard
        </h3>
        {days.length === 0 ? (
          <p className="text-[11px] text-[var(--fo-muted,#a1a1aa)] italic">No shoot days yet.</p>
        ) : (
          <ul className="space-y-2">
            {days.map((d) => (
              <li key={d.id} className="bg-[var(--fo-paper-2,rgba(24,24,27,0.7))] border border-[var(--fo-rule,#27272a)] rounded-xl p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-semibold text-[var(--fo-ink,#f4f4f5)]">
                    Day {d.dayNumber}
                    {d.date && <span className="text-[var(--fo-muted,#a1a1aa)] font-normal"> · {d.date}</span>}
                    {d.location && <span className="text-[var(--fo-muted,#a1a1aa)] font-normal"> · {d.location}</span>}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-[var(--fo-muted,#a1a1aa)]">{d.sceneCount} sc · {(d.pageEighths / 8).toFixed(1)} pg</span>
                    <button type="button" onClick={() => genCallSheet(d.id)}
                      className="flex items-center gap-1 text-[10px] px-2 py-0.5 bg-[var(--fo-paper-2,#27272a)] hover:bg-[var(--fo-rule,#3f3f46)] text-[var(--fo-ink,#e4e4e7)] rounded">
                      <FileText className="w-3 h-3" /> Call sheet
                    </button>
                    <button type="button" onClick={() => delDay(d.id)} className="text-[var(--fo-faint,#52525b)] hover:text-[var(--fo-bad,#fb7185)] text-xs">×</button>
                  </div>
                </div>
                {d.scenes.length > 0 ? (
                  <ul className="space-y-1">
                    {d.scenes.map((sc) => (
                      <li key={sc.id} className="flex items-center gap-2 bg-[var(--fo-paper-2,rgba(9,9,11,0.6))] border-l-2 border-[var(--fo-tape,#c026d3)] rounded px-2 py-1">
                        <span className="text-[10px] font-mono text-[var(--fo-tape,#e879f9)]">{sc.number}</span>
                        <span className="text-[11px] text-[var(--fo-ink,#e4e4e7)] flex-1 truncate">{sc.slugline}</span>
                        <button type="button" onClick={() => assign(sc.id, '')}
                          className="text-[10px] text-[var(--fo-muted,#a1a1aa)] hover:text-[var(--fo-ink,#e4e4e7)]">unassign</button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[10px] text-[var(--fo-muted,#a1a1aa)] italic">No scenes assigned.</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Unscheduled */}
      {unscheduled.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-[var(--fo-ink-2,#d4d4d8)] mb-2">Unscheduled scenes</h3>
          <ul className="space-y-1">
            {unscheduled.map((sc) => (
              <li key={sc.id} className="flex items-center gap-2 bg-[var(--fo-paper-2,rgba(24,24,27,0.7))] border border-[var(--fo-rule,#27272a)] rounded-lg px-2 py-1.5">
                <span className="text-[10px] font-mono text-[var(--fo-muted,#a1a1aa)]">{sc.number}</span>
                <span className="text-[11px] text-[var(--fo-ink,#e4e4e7)] flex-1 truncate">{sc.slugline}</span>
                <select defaultValue="" onChange={(e) => assign(sc.id, e.target.value)}
                  className="bg-[var(--fo-input,#09090b)] border border-[var(--fo-rule-2,#3f3f46)] rounded px-1.5 py-0.5 text-[10px] text-[var(--fo-ink,#f4f4f5)]">
                  <option value="" disabled>Assign to…</option>
                  {days.map((d) => <option key={d.id} value={d.id}>Day {d.dayNumber}</option>)}
                </select>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Call sheet */}
      {callSheet && (
        <section className="bg-[var(--fo-paper-2,rgba(24,24,27,0.7))] border border-[rgba(214,58,47,0.35)] rounded-xl p-3">
          <h3 className="text-xs font-semibold text-[var(--fo-tape,#e879f9)] mb-1.5">
            Call Sheet — Day {callSheet.day.dayNumber}
            {callSheet.day.date && ` · ${callSheet.day.date}`}
          </h3>
          <p className="text-[11px] text-[var(--fo-muted,#a1a1aa)] mb-2">
            {callSheet.day.location || 'Location TBD'} · General call {callSheet.day.generalCall || 'TBD'} ·
            {' '}{callSheet.sceneCount} scenes · {(callSheet.totalPageEighths / 8).toFixed(1)} pages
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] font-semibold text-[var(--fo-muted,#a1a1aa)] uppercase mb-1">Cast</p>
              {callSheet.cast.length === 0 ? <p className="text-[10px] text-[var(--fo-muted,#a1a1aa)]">—</p> : (
                <ul className="space-y-0.5">
                  {callSheet.cast.map((c, i) => (
                    <li key={i} className="text-[11px] text-[var(--fo-ink-2,#d4d4d8)]">{c.name}{c.characterName && ` — ${c.characterName}`}</li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="text-[10px] font-semibold text-[var(--fo-muted,#a1a1aa)] uppercase mb-1">Crew</p>
              {callSheet.crew.length === 0 ? <p className="text-[10px] text-[var(--fo-muted,#a1a1aa)]">—</p> : (
                <ul className="space-y-0.5">
                  {callSheet.crew.map((c, i) => (
                    <li key={i} className="text-[11px] text-[var(--fo-ink-2,#d4d4d8)]">{c.name}{c.position && ` — ${c.position}`}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
