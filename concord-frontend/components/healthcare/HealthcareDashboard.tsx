'use client';

import { useEffect, useState } from 'react';
import { Users, ClipboardList, Mail, Pill, AlertTriangle, FlaskConical, Calendar, Loader2 } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import type { EpicNav } from './EpicShell';

interface Summary {
  patientCount: number;
  todaysVisits: number;
  unsignedNotes: number;
  inboxUnread: number;
  pendingRefills: number;
  criticalLabs: number;
  activeProblems: number;
  allergiesCount: number;
}

export function HealthcareDashboard({ onJumpTo }: { onJumpTo?: (n: EpicNav) => void }) {
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const r = await api.post('/api/lens/run', { domain: 'healthcare', action: 'dashboard-summary', input: {} });
        if (!cancelled) setData((r.data?.result as Summary) || null);
      } catch (e) { console.error('[Dash] failed', e); }
      finally { if (!cancelled) setLoading(false); }
    }
    refresh();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <div className="flex items-center justify-center py-12 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>;
  if (!data) return <div className="p-10 text-center text-xs text-gray-500">No data yet.</div>;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Patients" value={String(data.patientCount)} icon={Users} onClick={() => onJumpTo?.('patients')} />
        <Tile label="Today's visits" value={String(data.todaysVisits)} icon={Calendar} onClick={() => onJumpTo?.('schedule')} />
        <Tile label="Unsigned notes" value={String(data.unsignedNotes)} icon={ClipboardList} tone={data.unsignedNotes > 0 ? 'amber' : 'neutral'} onClick={() => onJumpTo?.('encounters')} />
        <Tile label="Critical labs" value={String(data.criticalLabs)} icon={FlaskConical} tone={data.criticalLabs > 0 ? 'negative' : 'positive'} onClick={() => onJumpTo?.('chart')} />
      </div>

      {(data.inboxUnread > 0 || data.pendingRefills > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {data.inboxUnread > 0 && (
            <button onClick={() => onJumpTo?.('inbox')} className="p-3 rounded border border-rose-500/30 bg-rose-500/[0.04] hover:bg-rose-500/[0.08] flex items-center gap-3 text-left">
              <Mail className="w-4 h-4 text-rose-400" />
              <div className="flex-1">
                <div className="text-sm font-semibold text-rose-200">{data.inboxUnread} unread message{data.inboxUnread === 1 ? '' : 's'}</div>
                <div className="text-[11px] text-rose-300/70">Patient inquiries waiting for clinician response.</div>
              </div>
            </button>
          )}
          {data.pendingRefills > 0 && (
            <button onClick={() => onJumpTo?.('refills')} className="p-3 rounded border border-amber-500/30 bg-amber-500/[0.04] hover:bg-amber-500/[0.08] flex items-center gap-3 text-left">
              <Pill className="w-4 h-4 text-amber-400" />
              <div className="flex-1">
                <div className="text-sm font-semibold text-amber-200">{data.pendingRefills} refill request{data.pendingRefills === 1 ? '' : 's'}</div>
                <div className="text-[11px] text-amber-300/70">Click to approve / deny / mark filled.</div>
              </div>
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 text-center">
        <div className="p-3 rounded border border-white/10 bg-black/30">
          <ClipboardList className="w-3.5 h-3.5 text-cyan-300 mx-auto mb-1" />
          <div className="text-2xl font-mono text-cyan-300">{data.activeProblems}</div>
          <div className="text-[10px] text-gray-500">active problems across all patients</div>
        </div>
        <div className="p-3 rounded border border-white/10 bg-black/30">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-300 mx-auto mb-1" />
          <div className="text-2xl font-mono text-amber-300">{data.allergiesCount}</div>
          <div className="text-[10px] text-gray-500">allergies documented</div>
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, icon: Icon, tone = 'neutral', onClick }: { label: string; value: string; icon: typeof Users; tone?: 'positive' | 'negative' | 'amber' | 'neutral'; onClick?: () => void }) {
  const c = tone === 'positive' ? 'text-emerald-300' : tone === 'negative' ? 'text-rose-300' : tone === 'amber' ? 'text-amber-300' : 'text-white';
  return (
    <button onClick={onClick} className="p-3 rounded-lg border border-white/10 bg-black/30 text-left hover:bg-white/[0.04]">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="w-3 h-3 text-gray-500" />
        <span className="text-[10px] uppercase tracking-wider text-gray-500">{label}</span>
      </div>
      <div className={cn('text-2xl font-mono tabular-nums', c)}>{value}</div>
    </button>
  );
}

export default HealthcareDashboard;
