'use client';

/**
 * AuditTrailPanel — verification status + audit trail per activity entry.
 *
 * Lists the user's real logged activities, lets a verifier transition each
 * one (unverified → in_review → verified / rejected) via
 * environment.activity-set-verification, and renders the full chronological
 * audit log from environment.audit-trail. No mock entries — empty until
 * the user has logged activities.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  ShieldCheck,
  Loader2,
  ClipboardList,
  CircleDot,
  CheckCircle2,
  XCircle,
  Eye,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Activity {
  id: string;
  factorKey: string;
  amount: number;
  unit: string;
  scope: 1 | 2 | 3;
  co2eTonnes: number;
  date: string;
  facility: string;
  verificationStatus: string;
  verifier?: string;
}

interface AuditEvent {
  at: string;
  activityId: string;
  action: string;
  from: string | null;
  to: string;
  detail: string;
  verifier: string | null;
  note: string | null;
}

interface AuditResult {
  events: AuditEvent[];
  eventCount: number;
  statusRollup: { unverified: number; in_review: number; verified: number; rejected: number };
  totalActivities: number;
}

const STATUSES = ['unverified', 'in_review', 'verified', 'rejected'] as const;
type VerStatus = (typeof STATUSES)[number];

const STATUS_TONE: Record<VerStatus, { colour: string; icon: typeof CircleDot }> = {
  unverified: { colour: 'text-gray-400 bg-white/5', icon: CircleDot },
  in_review: { colour: 'text-amber-300 bg-amber-500/15', icon: Eye },
  verified: { colour: 'text-emerald-300 bg-emerald-500/15', icon: CheckCircle2 },
  rejected: { colour: 'text-rose-300 bg-rose-500/15', icon: XCircle },
};

export function AuditTrailPanel() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [audit, setAudit] = useState<AuditResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [verifier, setVerifier] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [a, t] = await Promise.all([
        lensRun('environment', 'activities-list', {}),
        lensRun('environment', 'audit-trail', {}),
      ]);
      if (a.data?.ok)
        setActivities((a.data.result as { activities: Activity[] }).activities || []);
      if (t.data?.ok) setAudit(t.data.result as AuditResult);
    } catch (e) {
      console.error('[AuditTrail] failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setStatus = useCallback(
    async (id: string, status: VerStatus) => {
      setBusyId(id);
      try {
        const r = await lensRun('environment', 'activity-set-verification', {
          id,
          status,
          verifier,
        });
        if (r.data?.ok) await refresh();
      } catch (e) {
        console.error('[AuditTrail] set status', e);
      } finally {
        setBusyId(null);
      }
    },
    [verifier, refresh],
  );

  return (
    <div className="bg-[#0d1117] border border-emerald-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-emerald-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">
          Verification &amp; audit trail
        </span>
        <input
          value={verifier}
          onChange={(e) => setVerifier(e.target.value)}
          placeholder="Verifier name"
          className="ml-auto w-40 px-2 py-1 text-[11px] bg-lattice-deep border border-lattice-border rounded text-white"
        />
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-xs text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
        </div>
      ) : (
        <div className="p-3 space-y-3">
          {/* Status rollup */}
          {audit && (
            <div className="grid grid-cols-4 gap-2">
              {STATUSES.map((st) => {
                const tone = STATUS_TONE[st];
                const Icon = tone.icon;
                return (
                  <div
                    key={st}
                    className="rounded border border-white/10 bg-white/[0.03] p-2"
                  >
                    <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-gray-500">
                      <Icon className="w-3 h-3" /> {st.replace(/_/g, ' ')}
                    </div>
                    <div className="text-base font-mono tabular-nums text-white">
                      {audit.statusRollup[st]}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Activity verification list */}
          <div className="rounded-md border border-white/10 overflow-hidden">
            <div className="px-3 py-1.5 bg-white/[0.03] text-[10px] uppercase tracking-wider text-emerald-300">
              Activities ({activities.length})
            </div>
            {activities.length === 0 ? (
              <div className="px-3 py-8 text-center text-xs text-gray-500">
                <ShieldCheck className="w-6 h-6 mx-auto mb-2 opacity-30" />
                No activities to verify yet.
              </div>
            ) : (
              <ul className="divide-y divide-white/5 max-h-72 overflow-y-auto">
                {activities.map((a) => {
                  const tone =
                    STATUS_TONE[(a.verificationStatus as VerStatus) || 'unverified'];
                  return (
                    <li key={a.id} className="px-3 py-2 flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-white truncate">
                          {a.factorKey.replace(/_/g, ' ')} ·{' '}
                          {a.amount.toLocaleString()} {a.unit}
                        </div>
                        <div className="text-[10px] text-gray-500">
                          {a.date} · S{a.scope} · {a.co2eTonnes.toFixed(2)} t
                          {a.verifier ? ` · by ${a.verifier}` : ''}
                        </div>
                      </div>
                      <span
                        className={cn(
                          'text-[9px] px-1.5 py-0.5 rounded',
                          tone.colour,
                        )}
                      >
                        {(a.verificationStatus || 'unverified').replace(/_/g, ' ')}
                      </span>
                      <select
                        value={a.verificationStatus || 'unverified'}
                        disabled={busyId === a.id}
                        onChange={(e) =>
                          setStatus(a.id, e.target.value as VerStatus)
                        }
                        className="text-[10px] px-1 py-0.5 bg-lattice-deep border border-lattice-border rounded text-white disabled:opacity-40"
                      >
                        {STATUSES.map((st) => (
                          <option key={st} value={st}>
                            {st.replace(/_/g, ' ')}
                          </option>
                        ))}
                      </select>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Audit log */}
          <div className="rounded-md border border-white/10 overflow-hidden">
            <div className="px-3 py-1.5 bg-white/[0.03] text-[10px] uppercase tracking-wider text-cyan-300 flex items-center gap-1">
              <ClipboardList className="w-3 h-3" /> Audit log
              {audit && (
                <span className="ml-auto text-gray-500 normal-case tracking-normal">
                  {audit.eventCount} event{audit.eventCount === 1 ? '' : 's'}
                </span>
              )}
            </div>
            {!audit || audit.events.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-gray-500">
                No audit events yet.
              </div>
            ) : (
              <ul className="divide-y divide-white/5 max-h-72 overflow-y-auto">
                {audit.events.map((e, i) => (
                  <li key={i} className="px-3 py-2 flex items-start gap-2">
                    <div className="text-[10px] font-mono text-gray-600 w-32 shrink-0">
                      {new Date(e.at).toLocaleString()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] text-gray-300">
                        <span className="text-cyan-300">
                          {e.action.replace(/_/g, ' ')}
                        </span>
                        {e.from ? (
                          <>
                            {' '}
                            <span className="text-gray-500">{e.from}</span> →{' '}
                          </>
                        ) : (
                          ' → '
                        )}
                        <span className="text-emerald-300">{e.to}</span>
                      </div>
                      <div className="text-[10px] text-gray-500 truncate">
                        {e.detail}
                        {e.verifier ? ` · ${e.verifier}` : ''}
                        {e.note ? ` · ${e.note}` : ''}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default AuditTrailPanel;
