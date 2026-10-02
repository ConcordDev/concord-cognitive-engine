'use client';

/** CRI north star — the scoring index, only after it is asked for. */

import { useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthGreeting, QuietMore, northCtaClass } from '@/components/code/CodeFamilyChrome';
import { NorthError, northPage, useMacro } from '@/components/lens/NorthStarChrome';
import { useAuth } from '@/hooks/useAuth';
import { useLensNav } from '@/hooks/useLensNav';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

type Index = { weights?: Record<string, number>; dimensions?: string[] };

export function TheIndex({ onOpenDesk }: { onOpenDesk: () => void }) {
  useLensNav('cri');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [armed, setArmed] = useState(false);
  const indexQ = useMacro<Index>(
    ['cri-northstar', 'index'],
    'cri',
    'scoreRules-get',
    {},
    (result) => {
      if (!result.weights || typeof result.weights !== 'object' || !Array.isArray(result.dimensions)) {
        throw new Error('The index did not answer.');
      }
      return result;
    },
    armed,
  );
  const rows = (indexQ.data?.dimensions ?? []).flatMap((dim) => {
    const weight = indexQ.data?.weights?.[dim];
    return typeof weight === 'number' ? [{ dim, weight }] : [];
  });
  const loadError = indexQ.error instanceof Error ? indexQ.error.message : '';

  return (
    <LensShell lensId="cri" asMain={false} disableAgentFab>
      <div data-lens-theme="cri" className={northPage}>
        <div className="flex items-start justify-between gap-4">
          <NorthGreeting kicker="CRI" title={who ? `The index, ${who}` : 'The index'} />
          <QuietMore items={[{ id: 'desk', label: 'Scores' }]} onPick={onOpenDesk} />
        </div>
        {loadError && <NorthError message={loadError} />}
        <div className="mt-6 min-h-[420px] rounded-2xl border border-white/10 px-4 py-4" data-testid="cri-index">
          {!armed && <p className="text-[14px] text-zinc-400">The index has not answered.</p>}
          {armed && indexQ.data && rows.length === 0 && <p className="text-[14px] text-zinc-400">The index came back empty.</p>}
          {rows.length > 0 && (
            <ul className="divide-y divide-white/10">
              {rows.map((row) => (
                <li key={row.dim} className="flex items-center justify-between py-3 text-[15px] text-zinc-100">
                  <span>{row.dim}</span>
                  <span className="tabular-nums text-zinc-400">{row.weight}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button type="button" className={northCtaClass} onClick={() => setArmed(true)} disabled={indexQ.isFetching}>
          Open the index
        </button>
      </div>
    </LensShell>
  );
}
