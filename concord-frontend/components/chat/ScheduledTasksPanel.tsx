'use client';

import { useEffect, useState, useCallback } from 'react';
import { Clock, Plus, X, Trash2, Loader2, Calendar, Repeat, Save } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface ScheduledTask {
  id: string;
  prompt: string;
  runAt: string;
  projectId: string | null;
  recurring: 'daily' | 'weekly' | 'monthly' | null;
  status: 'pending' | 'completed' | 'cancelled';
  createdAt: string;
  cancelledAt?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  activeProjectId?: string | null;
}

function formatRunAt(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function timeUntil(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms)) return '';
  if (ms <= 0) return 'overdue';
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `in ${h}h`;
  const d = Math.floor(h / 24);
  return `in ${d}d`;
}

export function ScheduledTasksPanel({ open, onClose, activeProjectId }: Props) {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<{
    prompt: string;
    runAt: string;
    recurring: '' | 'daily' | 'weekly' | 'monthly';
  }>({ prompt: '', runAt: '', recurring: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.post('/api/lens/run', {
        domain: 'chat',
        action: 'scheduled-list',
        input: {},
      });
      const result = (res.data as { result?: { tasks?: ScheduledTask[] } })?.result;
      setTasks(result?.tasks || []);
    } catch (e) {
      console.error('[ScheduledTasksPanel] list failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const startCreate = () => {
    setCreating(true);
    setError(null);
    // Default to 1 hour from now, rounded to next 15-min
    const now = new Date(Date.now() + 60 * 60 * 1000);
    now.setMinutes(Math.ceil(now.getMinutes() / 15) * 15, 0, 0);
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
      .toISOString()
      .slice(0, 16);
    setDraft({ prompt: '', runAt: local, recurring: '' });
  };

  const cancelEdit = () => {
    setCreating(false);
    setDraft({ prompt: '', runAt: '', recurring: '' });
    setError(null);
  };

  const save = async () => {
    if (!draft.prompt.trim() || !draft.runAt) return;
    setSaving(true);
    setError(null);
    try {
      const isoUtc = new Date(draft.runAt).toISOString();
      const res = await api.post('/api/lens/run', {
        domain: 'chat',
        action: 'scheduled-create',
        input: {
          prompt: draft.prompt,
          runAt: isoUtc,
          recurring: draft.recurring || undefined,
          projectId: activeProjectId || undefined,
        },
      });
      const ok = (res.data as { ok?: boolean; error?: string })?.ok;
      if (!ok) {
        setError((res.data as { error?: string })?.error || 'Failed to schedule');
        return;
      }
      cancelEdit();
      await refresh();
    } catch (e) {
      console.error('[ScheduledTasksPanel] save failed', e);
      setError('Failed to schedule');
    } finally {
      setSaving(false);
    }
  };

  const cancel = async (id: string) => {
    if (!window.confirm('Cancel this scheduled task?')) return;
    try {
      await api.post('/api/lens/run', {
        domain: 'chat',
        action: 'scheduled-cancel',
        input: { id },
      });
      await refresh();
    } catch (e) {
      console.error('[ScheduledTasksPanel] cancel failed', e);
    }
  };

  if (!open) return null;

  const pending = tasks.filter((t) => t.status === 'pending');
  const cancelled = tasks.filter((t) => t.status !== 'pending');

  return (
    <div className="fixed inset-y-0 right-0 w-[440px] max-w-[100vw] z-40 bg-[#0d1117] border-l border-cyan-500/20 shadow-2xl overflow-hidden flex flex-col">
      <header className="px-4 py-3 border-b border-white/10 flex items-center justify-between bg-gradient-to-r from-amber-950/40 to-transparent">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-amber-400" />
          <span className="text-sm font-semibold text-gray-200">Scheduled</span>
          <span className="text-[10px] text-gray-400 ml-1">{pending.length} pending</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={startCreate}
            className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-200 hover:brightness-110"
          >
            <Plus className="w-3 h-3" /> Schedule
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md hover:bg-white/5 text-gray-400"
            aria-label="Close scheduled tasks"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {creating && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
            <textarea
              value={draft.prompt}
              onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
              placeholder="Prompt to run at the scheduled time"
              maxLength={4000}
              rows={4}
              className="w-full px-2 py-1.5 text-sm bg-black/40 border border-white/10 rounded text-gray-100 placeholder-gray-500 focus:border-amber-500/50 focus:outline-none resize-none"
            />
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wider text-gray-400 inline-flex items-center gap-1">
                  <Calendar className="w-3 h-3" /> Run at
                </span>
                <input
                  type="datetime-local"
                  value={draft.runAt}
                  onChange={(e) => setDraft({ ...draft, runAt: e.target.value })}
                  className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 focus:border-amber-500/50 focus:outline-none"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wider text-gray-400 inline-flex items-center gap-1">
                  <Repeat className="w-3 h-3" /> Repeat
                </span>
                <select
                  value={draft.recurring}
                  onChange={(e) =>
                    setDraft({ ...draft, recurring: e.target.value as typeof draft.recurring })
                  }
                  className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 focus:border-amber-500/50 focus:outline-none"
                >
                  <option value="">Once</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </label>
            </div>
            {error && <p className="text-[11px] text-rose-300">{error}</p>}
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={save}
                disabled={saving || !draft.prompt.trim() || !draft.runAt}
                className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/15 px-3 py-1 text-xs text-amber-100 hover:brightness-110 disabled:opacity-40"
              >
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                Schedule
              </button>
              <button
                type="button"
                onClick={cancelEdit}
                className="px-3 py-1 text-xs text-gray-400 hover:text-gray-200"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-8 text-xs text-gray-400">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
          </div>
        ) : pending.length === 0 && !creating ? (
          <div className="text-center py-8 px-4">
            <Clock className="w-8 h-8 mx-auto text-gray-600 mb-2" />
            <p className="text-xs text-gray-400">No scheduled tasks</p>
            <p className="text-[10px] text-gray-400 mt-1">
              Schedule a prompt to run at a future time. Recurring options: daily, weekly, monthly.
            </p>
          </div>
        ) : (
          <>
            {pending.map((t) => (
              <div
                key={t.id}
                className="rounded-md border border-amber-500/20 bg-black/20 p-3 hover:bg-white/5 transition group"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-100 line-clamp-3">{t.prompt}</p>
                    <div className="flex items-center gap-2 mt-2 text-[10px] text-gray-400 flex-wrap">
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="w-2.5 h-2.5" />
                        {formatRunAt(t.runAt)}
                      </span>
                      <span className={cn(
                        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded',
                        timeUntil(t.runAt) === 'overdue'
                          ? 'bg-rose-500/10 text-rose-300'
                          : 'bg-amber-500/10 text-amber-300',
                      )}>
                        {timeUntil(t.runAt)}
                      </span>
                      {t.recurring && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-300">
                          <Repeat className="w-2.5 h-2.5" /> {t.recurring}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => cancel(t.id)}
                    className="p-1 text-gray-400 hover:text-rose-300 opacity-0 group-hover:opacity-100 transition"
                    aria-label="Cancel scheduled task"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
            {cancelled.length > 0 && (
              <details className="mt-4">
                <summary className="text-[10px] uppercase tracking-wider text-gray-400 cursor-pointer hover:text-gray-400">
                  {cancelled.length} cancelled / completed
                </summary>
                <div className="mt-2 space-y-1.5">
                  {cancelled.map((t) => (
                    <div key={t.id} className="rounded-md border border-white/5 bg-black/10 p-2 opacity-60">
                      <p className="text-[11px] text-gray-400 line-clamp-2">{t.prompt}</p>
                      <span className="text-[9px] text-gray-400 mt-1 block">
                        {t.status} · {formatRunAt(t.runAt)}
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default ScheduledTasksPanel;
