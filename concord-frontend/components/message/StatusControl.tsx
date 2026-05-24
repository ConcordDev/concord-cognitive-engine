'use client';

/**
 * StatusControl — Slack-shape user status + presence picker. Wires the
 * message.status-* macros. Lives at the foot of the activity rail.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Status { emoji: string; text: string; presence: string; expiresAt: string | null }

const PRESETS: { emoji: string; text: string }[] = [
  { emoji: '📅', text: 'In a meeting' },
  { emoji: '🎧', text: 'Focusing' },
  { emoji: '🍽️', text: 'Lunch' },
  { emoji: '🌴', text: 'On vacation' },
  { emoji: '🏠', text: 'Working remotely' },
  { emoji: '🤒', text: 'Out sick' },
];
const DURATIONS = [
  { label: "Don't clear", min: 0 },
  { label: '30 minutes', min: 30 },
  { label: '1 hour', min: 60 },
  { label: '4 hours', min: 240 },
  { label: 'Today', min: 480 },
];
const PRESENCE = ['active', 'away', 'dnd'] as const;

export function StatusControl() {
  const [status, setStatus] = useState<Status | null>(null);
  const [open, setOpen] = useState(false);
  const [emoji, setEmoji] = useState('💬');
  const [text, setText] = useState('');
  const [presence, setPresence] = useState<string>('active');
  const [durationMin, setDurationMin] = useState(0);

  const load = useCallback(async () => {
    const r = await lensRun({ domain: 'message', action: 'status-get', input: {} });
    setStatus((r.data?.result?.status as Status) || null);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    await lensRun({ domain: 'message', action: 'status-set', input: { emoji, text, presence, durationMin } });
    setOpen(false);
    await load();
  }
  async function clear() {
    await lensRun({ domain: 'message', action: 'status-clear', input: {} });
    setOpen(false);
    await load();
  }

  const presenceDot = status?.presence === 'dnd' ? 'bg-rose-500'
    : status?.presence === 'away' ? 'bg-amber-500' : 'bg-emerald-500';

  return (
    <div className="relative mt-auto">
      <button onClick={() => setOpen(v => !v)} title="Set a status"
        className="relative w-12 h-12 m-1 rounded flex items-center justify-center text-lg text-gray-400 hover:bg-white/[0.04]">
        {status?.emoji || '💬'}
        <span className={cn('absolute bottom-1 right-1 w-2.5 h-2.5 rounded-full border-2 border-[#0a0c10]', presenceDot)} />
      </button>
      {open && (
        <div className="absolute left-full bottom-0 ml-1 z-30 w-64 bg-[#0a0c10] border border-white/10 rounded shadow-lg p-3 space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-violet-300">Set a status</div>
          <div className="flex items-center gap-1">
            <input value={emoji} onChange={e => setEmoji(e.target.value.slice(0, 4))}
              className="w-10 px-1 py-1 text-center bg-black/40 border border-white/15 rounded text-white" />
            <input value={text} onChange={e => setText(e.target.value)} placeholder="What's your status?"
              className="flex-1 px-2 py-1 text-xs bg-black/40 border border-white/15 rounded text-white" />
          </div>
          <div className="flex flex-wrap gap-1">
            {PRESETS.map(p => (
              <button key={p.text} onClick={() => { setEmoji(p.emoji); setText(p.text); }}
                className="px-1.5 py-0.5 text-[10px] rounded bg-white/[0.04] border border-white/10 text-gray-300 hover:border-violet-500/30">
                {p.emoji} {p.text}
              </button>
            ))}
          </div>
          <div>
            <div className="text-[10px] text-gray-400 mb-1">Presence</div>
            <div className="flex gap-1">
              {PRESENCE.map(p => (
                <button key={p} onClick={() => setPresence(p)}
                  className={cn('flex-1 px-1.5 py-1 text-[10px] rounded capitalize',
                    presence === p ? 'bg-violet-500/15 text-violet-200 border border-violet-500/30' : 'bg-white/[0.03] text-gray-400 border border-transparent')}>
                  {p === 'dnd' ? 'Do not disturb' : p}
                </button>
              ))}
            </div>
          </div>
          <select value={durationMin} onChange={e => setDurationMin(Number(e.target.value))}
            className="w-full px-2 py-1 text-xs bg-black/40 border border-white/15 rounded text-white">
            {DURATIONS.map(d => <option key={d.min} value={d.min}>Clear after: {d.label}</option>)}
          </select>
          <div className="flex items-center gap-2">
            <button onClick={save} className="flex-1 px-3 py-1 text-xs rounded bg-violet-500 text-white font-bold hover:bg-violet-400">Save</button>
            <button onClick={clear} className="px-3 py-1 text-xs rounded border border-white/15 text-gray-300 hover:bg-white/[0.05]">Clear</button>
          </div>
        </div>
      )}
    </div>
  );
}
