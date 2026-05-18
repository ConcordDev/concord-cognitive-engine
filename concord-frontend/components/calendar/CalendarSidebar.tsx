'use client';

import { useState, useCallback } from 'react';
import { callCalendarMacro, type Calendar } from '@/lib/api/calendar';
import { Plus, Check, Circle } from 'lucide-react';

interface Props {
  calendars: Calendar[];
  enabledIds: Set<string>;
  onToggle: (id: string) => void;
  onCreate: () => void;
}

const KIND_OPTIONS = ['personal', 'work', 'project', 'team', 'focus', 'holiday'] as const;

export function CalendarSidebar({ calendars, enabledIds, onToggle, onCreate }: Props) {
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftKind, setDraftKind] = useState<typeof KIND_OPTIONS[number]>('personal');
  const [draftColor, setDraftColor] = useState('#22d3ee');
  const [busy, setBusy] = useState(false);

  const submit = useCallback(async () => {
    if (!draftName.trim()) return;
    setBusy(true);
    try {
      await callCalendarMacro('calendar_create', { name: draftName, kind: draftKind, color: draftColor });
      setCreating(false); setDraftName(''); setDraftKind('personal'); setDraftColor('#22d3ee');
      onCreate();
    } finally { setBusy(false); }
  }, [draftName, draftKind, draftColor, onCreate]);

  return (
    <aside className="w-64 border-r border-white/10 flex flex-col bg-black/60">
      <div className="flex items-center justify-between p-3 border-b border-white/10">
        <h2 className="text-sm font-semibold text-white/80">Calendars</h2>
        <button onClick={() => setCreating(true)} className="p-1.5 rounded hover:bg-white/10 text-white/70" title="New calendar">
          <Plus className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {calendars.length === 0 ? (
          <div className="text-xs text-white/40 text-center p-4">No calendars yet.</div>
        ) : (
          calendars.map((c) => {
            const on = enabledIds.has(c.id);
            return (
              <button
                key={c.id}
                onClick={() => onToggle(c.id)}
                className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/5"
              >
                <span className="w-4 h-4 flex items-center justify-center">
                  {on ? <Check className="w-3 h-3 text-white" /> : <Circle className="w-3 h-3 text-white/30" />}
                </span>
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: c.color || '#22d3ee' }} />
                <span className={`flex-1 text-sm truncate ${on ? 'text-white' : 'text-white/50'}`}>{c.name}</span>
                <span className="text-[10px] text-white/30 uppercase">{c.kind}</span>
              </button>
            );
          })
        )}
      </div>
      {creating && (
        <div className="border-t border-white/10 p-3 space-y-2">
          <input
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            placeholder="Calendar name"
            autoFocus
            className="w-full px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white"
          />
          <select
            value={draftKind}
            onChange={(e) => setDraftKind(e.target.value as typeof KIND_OPTIONS[number])}
            className="w-full px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white"
          >
            {KIND_OPTIONS.map((k) => <option key={k} value={k} className="bg-black">{k}</option>)}
          </select>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={draftColor}
              onChange={(e) => setDraftColor(e.target.value)}
              className="w-10 h-8 rounded border border-white/10 bg-transparent"
            />
            <div className="flex-1 flex gap-1">
              <button onClick={() => setCreating(false)} className="flex-1 py-1 rounded hover:bg-white/10 text-white/70 text-xs">Cancel</button>
              <button
                onClick={submit}
                disabled={busy || !draftName.trim()}
                className="flex-1 py-1 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 text-xs font-medium disabled:opacity-40"
              >Create</button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
