'use client';

/**
 * InitiativeBell — Sprint 11B
 *
 * Top-right bell that shows pending initiative count from Concord's
 * conversational initiative engine. Backed by the existing
 * /api/initiative/pending HTTP route.
 *
 * The initiative engine has 7 trigger types (substrate_discovery,
 * citation_alert, check_in, pending_work, world_event, reflective_followup,
 * morning_context) and emits proactive outreach (double-texts) with
 * fluidity matching the user's style. This component surfaces those
 * pending initiatives so the user can read / dismiss / respond.
 */

import { useEffect, useState, useCallback } from 'react';
import { Bell, X, Check, Sparkles } from 'lucide-react';

interface Initiative {
  id: string;
  trigger: string;
  priority: string;
  message: string;
  created_at: number;
  status: string;
}

interface PendingResponse {
  ok: boolean;
  initiatives?: Initiative[];
}

const TRIGGER_LABELS: Record<string, string> = {
  substrate_discovery: 'Discovery',
  citation_alert: 'Citation',
  check_in: 'Check-in',
  pending_work: 'Pending work',
  world_event: 'World event',
  reflective_followup: 'Follow-up',
  morning_context: 'Good morning',
};

function fmtAgo(unix: number): string {
  const diff = Math.floor(Date.now() / 1000) - unix;
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

export default function InitiativeBell() {
  const [pending, setPending] = useState<Initiative[]>([]);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/initiative/pending', { credentials: 'include' });
      if (!r.ok) return;
      const j = (await r.json()) as PendingResponse;
      if (j?.ok && Array.isArray(j.initiatives)) {
        setPending(j.initiatives);
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  const dismiss = async (id: string) => {
    try {
      await fetch(`/api/initiative/${encodeURIComponent(id)}/dismiss`, {
        method: 'POST', credentials: 'include',
      });
      setPending(p => p.filter(i => i.id !== id));
    } catch { /* silent */ }
  };

  const markRead = async (id: string) => {
    try {
      await fetch(`/api/initiative/${encodeURIComponent(id)}/read`, {
        method: 'POST', credentials: 'include',
      });
      setPending(p => p.filter(i => i.id !== id));
    } catch { /* silent */ }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="relative p-2 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
        title="Initiative — Concord may have something to tell you"
      >
        <Bell className="w-4 h-4" />
        {pending.length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-amber-500 text-amber-50 text-[10px] font-semibold flex items-center justify-center">
            {pending.length > 9 ? '9+' : pending.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-2 w-96 max-h-[70vh] overflow-y-auto rounded-xl bg-zinc-900/97 backdrop-blur-md ring-1 ring-zinc-800 shadow-2xl z-50">
          <header className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <h3 className="text-sm font-semibold text-zinc-100">Initiatives</h3>
            </div>
            <button onClick={() => setOpen(false)} className="p-1 rounded text-zinc-500 hover:text-zinc-200">
              <X className="w-4 h-4" />
            </button>
          </header>
          {pending.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-zinc-500">
              <p>No pending initiatives.</p>
              <p className="mt-1 text-zinc-600">
                Concord reaches out proactively when there&apos;s something worth saying — a new
                citation, a discovery in your substrate, a check-in.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-zinc-800">
              {pending.map(init => (
                <li key={init.id} className="px-4 py-3">
                  <div className="flex items-baseline justify-between gap-2 mb-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[10px] uppercase tracking-wide text-amber-400 font-semibold">
                        {TRIGGER_LABELS[init.trigger] || init.trigger}
                      </span>
                      <span className="text-[10px] text-zinc-500">{fmtAgo(init.created_at)} ago</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => markRead(init.id)}
                        className="p-1 rounded text-zinc-500 hover:text-emerald-400"
                        title="Mark read"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => dismiss(init.id)}
                        className="p-1 rounded text-zinc-500 hover:text-red-400"
                        title="Dismiss"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-zinc-200 leading-relaxed whitespace-pre-wrap">
                    {init.message}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
