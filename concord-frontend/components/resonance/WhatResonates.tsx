'use client';

/** Resonance north star — history readings the boundary route actually returns. */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LensShell } from '@/components/lens/LensShell';
import { NorthGreeting, QuietMore, northCtaClass } from '@/components/code/CodeFamilyChrome';
import { NorthError, northPage } from '@/components/lens/NorthStarChrome';
import { api } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { useLensNav } from '@/hooks/useLensNav';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

type Reading = { classification?: string; timestamp?: string };

function readReadings(data: unknown): Reading[] {
  if (!data || typeof data !== 'object') return [];
  const bag = data as { readings?: unknown; result?: { readings?: unknown } };
  const rows = Array.isArray(bag.readings) ? bag.readings : bag.result?.readings;
  if (!Array.isArray(rows)) throw new Error('Resonance history did not answer.');
  return rows.filter((row): row is Reading => !!row && typeof row === 'object');
}

export function WhatResonates({ onOpenDesk }: { onOpenDesk: () => void }) {
  useLensNav('resonance');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const client = useQueryClient();
  const historyQ = useQuery({
    queryKey: ['resonance-northstar', 'history'],
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const res = await api.get('/api/resonance/history', { params: { limit: 12 } });
      return readReadings(res.data);
    },
  });
  const readings = historyQ.data ?? [];
  const loadError = historyQ.error instanceof Error ? historyQ.error.message : '';

  return (
    <LensShell lensId="resonance" asMain={false} disableAgentFab>
      <div data-lens-theme="resonance" className={northPage}>
        <div className="flex items-start justify-between gap-4">
          <NorthGreeting kicker="Resonance" title={who ? `What still resonates, ${who}` : 'What still resonates'} />
          <QuietMore items={[{ id: 'live', label: 'Live desk' }]} onPick={onOpenDesk} />
        </div>

        {loadError && <NorthError message={loadError} />}

        {historyQ.data && readings.length === 0 && (
          <div className="mt-6 min-h-[420px] rounded-2xl border border-white/10 px-4 py-4" data-testid="resonance-empty">
            <p className="text-[14px] text-zinc-400">Nothing returned yet.</p>
          </div>
        )}

        {readings.length > 0 && (
          <ul className="mt-6 min-h-[420px] divide-y divide-white/10 rounded-2xl border border-white/10" data-testid="resonance-readings">
            {readings.map((row, i) => (
              <li key={row.timestamp || String(i)} className="px-4 py-3">
                <p className="text-[15px] text-zinc-100">{row.classification || 'Reading'}</p>
                {row.timestamp && <p className="mt-1 text-[13px] text-zinc-500">{row.timestamp}</p>}
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          className={northCtaClass}
          disabled={historyQ.isFetching}
          onClick={() => { void client.invalidateQueries({ queryKey: ['resonance-northstar', 'history'] }); }}
        >
          Review
        </button>
      </div>
    </LensShell>
  );
}
