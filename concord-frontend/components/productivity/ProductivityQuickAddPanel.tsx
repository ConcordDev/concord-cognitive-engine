'use client';

/**
 * ProductivityQuickAddPanel — natural-language quick add.
 * Type "submit report tomorrow 5pm p1 #work @urgent every weekday" and
 * the productivity.task-parse macro shows a live preview; task-quick-add
 * persists the parsed task. All data is the user's own typed text.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Wand2, Plus } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Parsed {
  content: string;
  priority: number;
  dueDate: string | null;
  dueTime: string | null;
  project: string | null;
  labels: string[];
  recurring: string | null;
}

const PRIORITY_COLOR: Record<number, string> = {
  1: 'text-rose-400', 2: 'text-amber-400', 3: 'text-sky-400', 4: 'text-zinc-500',
};

export function ProductivityQuickAddPanel({ onChange }: { onChange: () => void }) {
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [parsing, setParsing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runParse = useCallback(async (value: string) => {
    if (!value.trim()) { setParsed(null); return; }
    setParsing(true);
    const r = await lensRun('productivity', 'task-parse', { text: value });
    if (r.data?.ok && r.data.result?.parsed) setParsed(r.data.result.parsed as Parsed);
    else setParsed(null);
    setParsing(false);
  }, []);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => { void runParse(text); }, 250);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [text, runParse]);

  const add = async () => {
    if (!text.trim()) { setError('Type a task first.'); return; }
    setAdding(true); setError(null); setConfirm(null);
    const r = await lensRun('productivity', 'task-quick-add', { text });
    setAdding(false);
    if (r.data?.ok && r.data.result?.task) {
      setConfirm(`Added: "${r.data.result.task.content}"`);
      setText(''); setParsed(null);
      onChange();
    } else {
      setError(r.data?.error || 'Quick add failed.');
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-zinc-500">
        Natural language — tokens are parsed out: <code className="text-zinc-400">p1-p4</code> priority,
        {' '}<code className="text-zinc-400">#project</code>, <code className="text-zinc-400">@label</code>,
        {' '}dates (<code className="text-zinc-400">today</code>, <code className="text-zinc-400">tomorrow</code>,
        {' '}<code className="text-zinc-400">in 3 days</code>, weekday names, ISO), times
        (<code className="text-zinc-400">5pm</code>), and recurrence (<code className="text-zinc-400">every weekday</code>).
      </p>

      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void add(); }}
          placeholder="submit report tomorrow 5pm p1 #work @urgent"
          aria-label="Natural language quick add"
          className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:ring-2 focus:ring-red-500"
        />
        <button type="button" onClick={add} disabled={adding || !text.trim()}
          className="flex items-center gap-1 px-3 py-2 text-xs font-medium bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white rounded-lg">
          {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Add
        </button>
      </div>

      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}
      {confirm && <div className="text-xs text-emerald-400 bg-emerald-950/40 border border-emerald-900/50 rounded-lg px-3 py-2">{confirm}</div>}

      {/* Live parse preview */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-zinc-500 mb-2">
          <Wand2 className="w-3 h-3" /> Parsed preview {parsing && <Loader2 className="w-3 h-3 animate-spin" />}
        </div>
        {!parsed ? (
          <p className="text-xs text-zinc-600 italic">Start typing to see the parse.</p>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-zinc-100 font-medium">{parsed.content || '(no title)'}</p>
            <div className="flex flex-wrap gap-1.5">
              <Chip className={PRIORITY_COLOR[parsed.priority]}>P{parsed.priority}</Chip>
              {parsed.dueDate && <Chip className="text-sky-400">{parsed.dueDate}</Chip>}
              {parsed.dueTime && <Chip className="text-cyan-400">{parsed.dueTime}</Chip>}
              {parsed.project && <Chip className="text-violet-400">#{parsed.project}</Chip>}
              {parsed.recurring && <Chip className="text-emerald-400">↻ {parsed.recurring.replace(/_/g, ' ')}</Chip>}
              {parsed.labels.map((l) => <Chip key={l} className="text-amber-400">@{l}</Chip>)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('text-[11px] px-2 py-0.5 rounded-full border border-zinc-700 bg-zinc-950', className)}>
      {children}
    </span>
  );
}
