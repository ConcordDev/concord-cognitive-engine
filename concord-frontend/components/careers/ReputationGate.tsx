'use client';

/**
 * ReputationGate — surfaces the player's real career reputation for a track
 * and which tiers it currently gates them out of (checklist item 7,
 * docs/lens-specs/careers-capability-map.md: "Reputation visibly gates which
 * tiers I can work/contract at"). Calls `careers.myReputation`, which
 * computes the number server-side from real career_contracts + worked-shift
 * history (server/lib/career-contracts.js#deriveWorkerReputation) and runs
 * it through the SAME reputationGateTier/reputationWageMultiplier functions
 * domains/careers.js#offer enforces — so what's shown here is guaranteed
 * consistent with what actually gates a contract offer, never a
 * separately-reimplemented number.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Award, Lock } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';

export interface ReputationInfo {
  trackId: string | null;
  reputation: number;
  gateTier: number;
  wageMultiplier: number;
  gatedTiers: number[];
}

interface Props {
  trackId: string;
  /** Fires whenever fresh reputation data (or null, e.g. signed out) loads — lets a parent (e.g. the tier ladder) mark gated tiers. */
  onLoaded?: (info: ReputationInfo | null) => void;
}

export function ReputationGate({ trackId, onLoaded }: Props) {
  const { user } = useAuth();
  const [reputation, setReputation] = useState<ReputationInfo | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (tid: string) => {
    if (!user?.id) { setReputation(null); onLoaded?.(null); return; }
    setLoading(true);
    try {
      const r = (await lensRun<{ ok: boolean; reason?: string } & ReputationInfo>('careers', 'myReputation', { trackId: tid })).data.result;
      const info = r?.ok ? r : null;
      setReputation(info);
      onLoaded?.(info);
    } catch {
      setReputation(null);
      onLoaded?.(null);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);
  useEffect(() => { if (trackId) void load(trackId); }, [trackId, load]);

  return (
    <section className="mb-6 rounded-lg border border-white/10 bg-black/40 p-4" aria-label="My reputation">
      <h2 className="text-sm font-semibold text-amber-100 mb-2 flex items-center gap-1">
        <Award className="w-4 h-4" aria-hidden="true" /> My {trackId} reputation
      </h2>
      {loading ? (
        <div role="status" aria-live="polite" aria-busy="true" className="text-gray-400 text-xs flex items-center gap-2">
          <Loader2 className="w-3 h-3 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Loading reputation…
        </div>
      ) : !reputation ? (
        <p className="text-gray-500 text-xs">{user?.id ? 'No reputation data for this track yet.' : 'Sign in to see your reputation for this track.'}</p>
      ) : (
        <div className="text-xs text-gray-300 space-y-1.5">
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 rounded bg-white/10 overflow-hidden" role="progressbar" aria-valuenow={reputation.reputation} aria-valuemin={0} aria-valuemax={100} aria-label={`${trackId} reputation`}>
              <div className="h-full bg-amber-400" style={{ width: `${reputation.reputation}%` }} />
            </div>
            <span className="tabular-nums text-amber-200">{reputation.reputation}/100</span>
          </div>
          <p>Hireable up to <span className="text-amber-200">tier {reputation.gateTier}</span> · wage ×{reputation.wageMultiplier.toFixed(2)}</p>
          {reputation.gatedTiers.length > 0 ? (
            <p className="text-gray-500 flex items-center gap-1">
              <Lock className="w-3 h-3 shrink-0" aria-hidden="true" /> Gated out of tier{reputation.gatedTiers.length > 1 ? 's' : ''} {reputation.gatedTiers.join(', ')} until your reputation grows — sign more contracts or work more shifts.
            </p>
          ) : (
            <p className="text-gray-500">No tier gate — your reputation clears every tier in this track.</p>
          )}
        </div>
      )}
    </section>
  );
}
