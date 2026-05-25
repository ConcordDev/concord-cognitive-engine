'use client';

/**
 * PainBoard — Productboard-style pain-point board. Severity/frequency/impact/
 * effort scoring, a sortable ranked list, theme assignment, status workflow,
 * and inline evidence-quote attachment. Every value comes from the
 * `suffering` domain macros (pain-list / pain-create / pain-update /
 * pain-delete / evidence-add / evidence-remove / theme-list).
 */

import { useCallback, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  Plus, Trash2, Loader2, ChevronDown, ChevronRight, Quote, X,
  ArrowUpDown,
} from 'lucide-react';

export interface Evidence {
  id: string;
  quote: string;
  source: string;
  kind: string;
  addedAt: string;
}
export interface Pain {
  id: string;
  title: string;
  description: string;
  severity: number;
  frequency: number;
  impact: number;
  effort: number;
  status: string;
  themeId: string | null;
  evidence: Evidence[];
  priorityScore: number;
  createdAt: string;
  updatedAt: string;
}
export interface Theme {
  id: string;
  name: string;
  color: string;
  painCount: number;
  openCount: number;
  totalImpact: number;
}

const STATUSES = ['open', 'investigating', 'in_progress', 'resolved'] as const;
const STATUS_TONE: Record<string, string> = {
  open: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  investigating: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  in_progress: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  resolved: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
};
type SortKey = 'priorityScore' | 'severity' | 'frequency' | 'impact' | 'effort';

export function PainBoard({
  pains, themes, loading, onChanged,
}: {
  pains: Pain[];
  themes: Theme[];
  loading: boolean;
  onChanged: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('priorityScore');

  const [draft, setDraft] = useState({
    title: '', description: '', severity: 5, frequency: 5, impact: 5, effort: 5,
    themeId: '',
  });

  const run = useCallback(async (action: string, input: Record<string, unknown>) => {
    setBusy(true);
    setErr(null);
    const res = await lensRun('suffering', action, input);
    setBusy(false);
    if (!res.data.ok) { setErr(res.data.error || `${action} failed`); return false; }
    onChanged();
    return true;
  }, [onChanged]);

  const submit = useCallback(async () => {
    if (!draft.title.trim()) { setErr('Title is required'); return; }
    const ok = await run('pain-create', {
      title: draft.title, description: draft.description,
      severity: draft.severity, frequency: draft.frequency,
      impact: draft.impact, effort: draft.effort,
      themeId: draft.themeId || undefined,
    });
    if (ok) {
      setDraft({ title: '', description: '', severity: 5, frequency: 5, impact: 5, effort: 5, themeId: '' });
      setShowForm(false);
    }
  }, [draft, run]);

  const sorted = [...pains].sort((a, b) => (b[sortKey] as number) - (a[sortKey] as number));

  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold flex items-center gap-2">
          Pain-Point Board
          <span className="text-xs text-gray-400">({pains.length})</span>
          {(loading || busy) && <Loader2 className="w-4 h-4 animate-spin text-neon-cyan" />}
        </h3>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-gray-400">
            <ArrowUpDown className="w-3.5 h-3.5" />
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="bg-white/5 border border-white/10 rounded px-1.5 py-1 text-xs text-gray-200"
            >
              <option value="priorityScore">Priority</option>
              <option value="severity">Severity</option>
              <option value="frequency">Frequency</option>
              <option value="impact">Impact</option>
              <option value="effort">Effort</option>
            </select>
          </label>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-neon-cyan/20 text-neon-cyan rounded-lg text-sm hover:bg-neon-cyan/30 focus:outline-none focus:ring-2 focus:ring-amber-500"
          >
            <Plus className="w-4 h-4" /> New Pain Point
          </button>
        </div>
      </div>

      {err && (
        <div className="mb-3 bg-red-500/10 border border-red-500/30 rounded px-3 py-1.5 text-xs text-red-400 flex justify-between">
          <span>{err}</span>
          <button onClick={() => setErr(null)} aria-label="Dismiss"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {showForm && (
        <div className="mb-4 p-3 rounded-lg bg-white/[0.03] border border-white/10 space-y-3">
          <input
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="Pain point title (e.g. Checkout flow is confusing)"
            className="w-full bg-white/5 border border-white/10 rounded px-2.5 py-1.5 text-sm"
          />
          <textarea
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            placeholder="Description / observed behaviour"
            rows={2}
            className="w-full bg-white/5 border border-white/10 rounded px-2.5 py-1.5 text-sm"
          />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {(['severity', 'frequency', 'impact', 'effort'] as const).map((k) => (
              <label key={k} className="text-xs text-gray-400">
                <span className="capitalize flex justify-between">
                  {k} <span className="text-neon-cyan font-bold">{draft[k]}</span>
                </span>
                <input
                  type="range" min={1} max={10}
                  value={draft[k]}
                  onChange={(e) => setDraft({ ...draft, [k]: Number(e.target.value) })}
                  className="w-full accent-neon-cyan"
                />
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <select
              value={draft.themeId}
              onChange={(e) => setDraft({ ...draft, themeId: e.target.value })}
              className="bg-white/5 border border-white/10 rounded px-2 py-1.5 text-sm text-gray-200"
            >
              <option value="">No theme</option>
              {themes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button
              onClick={submit}
              disabled={busy}
              className="px-3 py-1.5 bg-neon-cyan/20 text-neon-cyan rounded text-sm hover:bg-neon-cyan/30 disabled:opacity-50"
            >
              Create
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-3 py-1.5 text-gray-400 text-sm hover:text-white"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {pains.length === 0 ? (
        <p className="text-gray-400 text-sm text-center py-6">
          No pain points yet. Capture your first one above.
        </p>
      ) : (
        <div className="space-y-2">
          {sorted.map((p) => (
            <PainRow
              key={p.id}
              pain={p}
              themes={themes}
              expanded={expanded === p.id}
              onToggle={() => setExpanded(expanded === p.id ? null : p.id)}
              onRun={run}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PainRow({
  pain, themes, expanded, onToggle, onRun,
}: {
  pain: Pain;
  themes: Theme[];
  expanded: boolean;
  onToggle: () => void;
  onRun: (action: string, input: Record<string, unknown>) => Promise<boolean>;
}) {
  const [quote, setQuote] = useState('');
  const [source, setSource] = useState('');
  const theme = themes.find((t) => t.id === pain.themeId);

  return (
    <div className="rounded-lg bg-white/[0.03] border border-white/10">
      <div className="flex items-center gap-2 p-2.5">
        <button onClick={onToggle} className="text-gray-400 hover:text-gray-200" aria-label="Expand">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{pain.title}</span>
            {theme && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded-full"
                style={{ backgroundColor: `${theme.color}22`, color: theme.color }}
              >
                {theme.name}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-[11px] text-gray-400 mt-0.5">
            <span>S{pain.severity}</span>
            <span>F{pain.frequency}</span>
            <span>I{pain.impact}</span>
            <span>E{pain.effort}</span>
            {pain.evidence?.length > 0 && (
              <span className="flex items-center gap-0.5">
                <Quote className="w-3 h-3" />{pain.evidence.length}
              </span>
            )}
          </div>
        </div>
        <span className="text-sm font-bold text-neon-purple shrink-0" title="Priority score">
          {pain.priorityScore}
        </span>
        <select
          value={pain.status}
          onChange={(e) => onRun('pain-update', { id: pain.id, status: e.target.value })}
          className={`text-[11px] rounded border px-1.5 py-1 ${STATUS_TONE[pain.status]}`}
        >
          {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
        <button
          onClick={() => onRun('pain-delete', { id: pain.id })}
          className="text-gray-600 hover:text-red-400"
          aria-label="Delete pain point"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {expanded && (
        <div className="border-t border-white/10 p-3 space-y-3">
          {pain.description && (
            <p className="text-xs text-gray-400">{pain.description}</p>
          )}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-400">Theme:</span>
            <select
              value={pain.themeId || ''}
              onChange={(e) => onRun('pain-update', { id: pain.id, themeId: e.target.value || null })}
              className="bg-white/5 border border-white/10 rounded px-1.5 py-1 text-gray-200"
            >
              <option value="">None</option>
              {themes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>

          <div>
            <p className="text-xs text-gray-400 mb-1.5 flex items-center gap-1">
              <Quote className="w-3 h-3" /> Evidence ({pain.evidence?.length || 0})
            </p>
            {pain.evidence?.map((ev) => (
              <div key={ev.id} className="flex items-start gap-2 mb-1.5 text-xs bg-white/[0.03] rounded px-2 py-1.5">
                <span className="flex-1">
                  <span className="text-gray-300">&ldquo;{ev.quote}&rdquo;</span>
                  {ev.source && <span className="text-gray-400 ml-1">— {ev.source}</span>}
                </span>
                <button
                  onClick={() => onRun('evidence-remove', { painId: pain.id, evidenceId: ev.id })}
                  className="text-gray-600 hover:text-red-400 shrink-0"
                  aria-label="Remove evidence"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            <div className="flex items-center gap-2 mt-1.5">
              <input
                value={quote}
                onChange={(e) => setQuote(e.target.value)}
                placeholder="Quote / observation"
                className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs"
              />
              <input
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder="Source"
                className="w-28 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs"
              />
              <button
                onClick={async () => {
                  if (!quote.trim()) return;
                  const ok = await onRun('evidence-add', { painId: pain.id, quote, source });
                  if (ok) { setQuote(''); setSource(''); }
                }}
                className="px-2 py-1 bg-neon-cyan/20 text-neon-cyan rounded text-xs hover:bg-neon-cyan/30"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
