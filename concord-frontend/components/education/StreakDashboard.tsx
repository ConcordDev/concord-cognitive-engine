'use client';

import { useEffect, useState } from 'react';
import { Flame, Zap, Trophy, Loader2, TrendingUp, Plus, Check, AlertTriangle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Status {
  totalPoints: number; streak: number; level: number;
  skillPoints: number; nextLevelAt: number;
  recentPoints: Array<{ amount: number; source: string; timestamp: string }>;
}

const LOG_SOURCES = [
  { id: 'offline_reading', label: 'Read outside Concord' },
  { id: 'office_hours', label: 'Attended office hours' },
  { id: 'study_group', label: 'Study group session' },
  { id: 'self_practice', label: 'Independent practice' },
];

export function StreakDashboard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);

  const [logging, setLogging] = useState(false);
  const [logSource, setLogSource] = useState(LOG_SOURCES[0].id);
  const [logAmount, setLogAmount] = useState('25');
  const [awarding, setAwarding] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'education', action: 'gamification-status', input: {} });
      setStatus((res.data?.result as Status) || null);
    } catch (e) { console.error('[Streak] failed', e); }
    finally { setLoading(false); }
  }

  async function logActivity() {
    const amount = Math.max(1, Math.min(10000, Number(logAmount) || 0));
    setAwarding(true);
    setFeedback(null);
    try {
      const r = await lensRun({ domain: 'education', action: 'points-award', input: { amount, source: logSource } });
      if (r.data.ok === false) {
        setFeedback({ kind: 'err', text: r.data.error || 'award failed' });
      } else {
        setFeedback({ kind: 'ok', text: `+${amount} logged.` });
        setLogging(false);
        await refresh();
      }
    } catch (e) { console.error('[Streak] log activity failed', e); setFeedback({ kind: 'err', text: 'request failed' }); }
    finally { setAwarding(false); }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Trophy className="w-4 h-4 text-amber-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Progress & gamification</span>
        <button onClick={() => setLogging(v => !v)} className="ml-auto p-1 text-gray-400 hover:text-white" aria-label="Log activity"><Plus className="w-4 h-4" /></button>
      </header>

      {logging && (
        <div className="px-4 py-3 border-b border-white/10 bg-white/[0.02] space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-gray-400">Log activity credit — for offline learning Concord can&apos;t observe directly</div>
          <div className="flex items-center gap-2">
            <select value={logSource} onChange={e => setLogSource(e.target.value)} className="flex-1 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
              {LOG_SOURCES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <input type="number" min="1" max="10000" value={logAmount} onChange={e => setLogAmount(e.target.value)} className="w-20 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <button disabled={awarding} onClick={logActivity} className="px-3 py-1.5 text-xs rounded bg-amber-500 text-black font-bold hover:bg-amber-400 disabled:opacity-40 inline-flex items-center gap-1">
              {awarding && <Loader2 className="w-3 h-3 animate-spin" />}Log
            </button>
          </div>
          {feedback && (
            <div className={cn('flex items-center gap-1.5 text-[11px]', feedback.kind === 'ok' ? 'text-emerald-300' : 'text-red-300')}>
              {feedback.kind === 'ok' ? <Check className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}{feedback.text}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-10 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
      ) : !status ? (
        <div className="p-10 text-center text-xs text-gray-400">No data yet</div>
      ) : (
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <BigTile icon={Flame} value={status.streak} label="Day streak" tone="orange" />
            <BigTile icon={Zap} value={status.totalPoints.toLocaleString()} label="Energy points" tone="amber" />
            <BigTile icon={Trophy} value={status.level} label="Level" tone="violet" />
          </div>

          <div className="rounded-md border border-white/10 bg-white/[0.03] p-3">
            <div className="flex items-center gap-2 mb-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-xs text-gray-300">Level progress</span>
              <span className="ml-auto text-xs font-mono text-emerald-300">{status.skillPoints} / {status.nextLevelAt} skill pts</span>
            </div>
            <div className="h-2 bg-white/10 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-cyan-500 to-violet-500" style={{ width: `${Math.min(100, (status.skillPoints / status.nextLevelAt) * 100)}%` }} />
            </div>
          </div>

          <div className="rounded-md border border-white/10 bg-white/[0.03] p-3">
            <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1.5">Recent points</div>
            {status.recentPoints.length === 0 ? (
              <div className="text-xs text-gray-400 py-2">Earn points by completing lessons + mastering skills.</div>
            ) : (
              <ul className="space-y-1">
                {status.recentPoints.map((p, i) => (
                  <li key={i} className="flex items-center gap-2 text-xs">
                    <Zap className="w-3 h-3 text-amber-400" />
                    <span className="text-amber-300 font-mono font-bold">+{p.amount}</span>
                    <span className="text-gray-400 truncate flex-1">{p.source.replace(/_/g, ' ')}</span>
                    <span className="text-[10px] text-gray-400">{new Date(p.timestamp).toLocaleString()}</span>
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

const TONES: Record<string, string> = { orange: 'border-orange-500/30 bg-orange-500/10 text-orange-300', amber: 'border-amber-500/30 bg-amber-500/10 text-amber-300', violet: 'border-violet-500/30 bg-violet-500/10 text-violet-300' };

function BigTile({ icon: Icon, value, label, tone }: { icon: typeof Flame; value: number | string; label: string; tone: string }) {
  return (
    <div className={cn('rounded-lg border p-3 text-center', TONES[tone])}>
      <Icon className="w-6 h-6 mx-auto mb-1" />
      <div className="text-2xl font-mono font-bold tabular-nums">{value}</div>
      <div className="text-[10px] uppercase tracking-wider opacity-70">{label}</div>
    </div>
  );
}

export default StreakDashboard;
