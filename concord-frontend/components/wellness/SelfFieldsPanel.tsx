'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * SelfFieldsPanel — self-composed therapeutic refusal-fields. The user
 * gates their OWN cognitive patterns directly (not therapist mode).
 * Privacy-first: any field can be revoked at any time. Wired to
 * wellness.self-field-{compose,list,deactivate}.
 */

import { useCallback, useEffect, useState } from 'react';
import { ShieldHalf, Loader2, Plus, X } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface SelfField {
  id: string;
  number: string;
  fieldKind: string;
  intention: string;
  durationSeconds: number;
  createdAt: number;
  expiresAt: number;
  status: string;
  msRemaining: number;
}

const FIELD_KINDS = [
  'binary_thinking', 'catastrophising', 'self_judgment', 'numbing',
  'compulsion', 'rumination', 'perfectionism', 'shame_spiral',
];
const DURATIONS = [
  { label: '6 hours', seconds: 6 * 3600 },
  { label: '24 hours', seconds: 24 * 3600 },
  { label: '3 days', seconds: 3 * 86400 },
  { label: '7 days', seconds: 7 * 86400 },
];

function humanRemaining(ms: number): string {
  if (ms <= 0) return 'expired';
  const h = Math.floor(ms / 3_600_000);
  if (h >= 48) return `${Math.floor(h / 24)}d left`;
  if (h >= 1) return `${h}h left`;
  return `${Math.max(1, Math.floor(ms / 60_000))}m left`;
}

export function SelfFieldsPanel() {
  const [fields, setFields] = useState<SelfField[]>([]);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState(FIELD_KINDS[0]);
  const [intention, setIntention] = useState('');
  const [durationSeconds, setDurationSeconds] = useState(DURATIONS[1].seconds);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun({ domain: 'wellness', action: 'self-field-list', input: {} });
    if (r.data?.ok && r.data.result) setFields((r.data.result as any).fields || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function compose() {
    setBusy(true);
    const r = await lensRun({
      domain: 'wellness', action: 'self-field-compose',
      input: { fieldKind: kind, intention: intention.trim(), durationSeconds },
    });
    setBusy(false);
    if (r.data?.ok) { setIntention(''); await refresh(); }
  }

  async function deactivate(id: string) {
    const r = await lensRun({ domain: 'wellness', action: 'self-field-deactivate', input: { id } });
    if (r.data?.ok) await refresh();
  }

  const active = fields.filter(f => f.status === 'active');

  return (
    <div className="rounded-lg border border-purple-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-purple-500/10 pb-2">
        <ShieldHalf className="h-4 w-4 text-purple-400" />
        <h3 className="text-sm font-semibold text-white">Self-composed fields</h3>
        {loading && <Loader2 className="w-3 h-3 animate-spin text-zinc-500" />}
        <span className="ml-auto text-[10px] text-zinc-500">{active.length} active</span>
      </header>

      <div className="rounded border border-white/10 bg-black/30 p-3 space-y-2">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Gate one of your own patterns</div>
        <div className="grid grid-cols-2 gap-2">
          <select value={kind} onChange={e => setKind(e.target.value)}
            className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-[11px] text-white">
            {FIELD_KINDS.map(k => <option key={k} value={k}>{k.replace(/_/g, ' ')}</option>)}
          </select>
          <select value={durationSeconds} onChange={e => setDurationSeconds(Number(e.target.value))}
            className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-[11px] text-white">
            {DURATIONS.map(d => <option key={d.seconds} value={d.seconds}>{d.label}</option>)}
          </select>
        </div>
        <input type="text" value={intention} maxLength={280}
          onChange={e => setIntention(e.target.value)}
          placeholder="Intention (optional) — why you're gating this pattern"
          className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-[11px] text-white" />
        <button type="button" onClick={compose} disabled={busy}
          className="w-full inline-flex items-center justify-center gap-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs py-1.5 rounded font-semibold">
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
          Compose field
        </button>
      </div>

      {fields.length === 0 ? (
        <div className="py-6 text-center text-xs text-zinc-500">No fields composed yet.</div>
      ) : (
        <ul className="space-y-1.5">
          {fields.map(f => (
            <li key={f.id} className={cn('rounded border bg-black/30 p-2.5',
              f.status === 'active' ? 'border-purple-500/30' : 'border-white/5 opacity-60')}>
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-mono text-zinc-500">{f.number}</span>
                <span className="text-sm text-white flex-1 truncate">{f.fieldKind.replace(/_/g, ' ')}</span>
                <span className={cn('text-[10px] font-mono px-1.5 py-0.5 rounded',
                  f.status === 'active' ? 'bg-purple-500/15 text-purple-300' : 'bg-white/5 text-zinc-500')}>
                  {f.status === 'active' ? humanRemaining(f.msRemaining) : f.status}
                </span>
                {f.status === 'active' && (
                  <button type="button" onClick={() => deactivate(f.id)}
                    className="p-1 text-rose-400 hover:text-rose-300" title="Revoke">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              {f.intention && <div className="text-[10px] text-zinc-400 mt-1">{f.intention}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default SelfFieldsPanel;
