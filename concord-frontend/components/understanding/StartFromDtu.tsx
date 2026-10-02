'use client';

/** Understanding north star — compose only from a DTU id the user supplies. */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { LensShell } from '@/components/lens/LensShell';
import { NorthGreeting, QuietMore, northCtaClass } from '@/components/code/CodeFamilyChrome';
import { NorthError, northPage } from '@/components/lens/NorthStarChrome';
import { lensRun } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { useLensNav } from '@/hooks/useLensNav';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

type Started = { id?: string; text?: string };

function readStarted(result: unknown): Started {
  if (!result || typeof result !== 'object') return {};
  const bag = result as { id?: string; text?: string; understanding?: { id?: string; text?: string } };
  return {
    id: bag.understanding?.id || bag.id,
    text: typeof bag.understanding?.text === 'string' ? bag.understanding.text : (typeof bag.text === 'string' ? bag.text : undefined),
  };
}

export function StartFromDtu({ onOpenDesk }: { onOpenDesk: () => void }) {
  useLensNav('understanding');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [dtuId, setDtuId] = useState('');
  const start = useMutation({
    mutationFn: async (subjectId: string) => {
      const res = await lensRun('understanding', 'compose', { subjectKind: 'dtu', subjectId, composer: 'rules' });
      if (!res.data.ok || res.data.result == null) {
        throw new Error(res.data.error || 'The understanding did not start.');
      }
      return readStarted(res.data.result);
    },
  });
  const actError = start.error instanceof Error ? start.error.message : '';
  const started = start.data;

  function begin() {
    const subjectId = dtuId.trim();
    if (!subjectId) return;
    start.mutate(subjectId);
  }

  return (
    <LensShell lensId="understanding" asMain={false} disableAgentFab>
      <div data-lens-theme="understanding" className={northPage}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <NorthGreeting kicker="Understanding" title={who ? `What you understand, ${who}` : 'What you understand'} />
            <p className="mt-3 text-[14px] text-zinc-500">Bring one unit in when you are ready.</p>
          </div>
          <QuietMore items={[{ id: 'notes', label: 'Notes' }]} onPick={onOpenDesk} />
        </div>

        <label className="mt-6 block max-w-md text-[13px] text-zinc-500">
          DTU
          <input
            value={dtuId}
            onChange={(e) => setDtuId(e.target.value)}
            className="mt-1 w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-[15px] text-zinc-100 outline-none"
          />
        </label>

        {actError && <NorthError message={actError} />}

        {started && (started.text || started.id) && (
          <article className="mt-6 max-w-xl" data-testid="understanding-started">
            {started.text && <p className="text-[15px] text-zinc-100">{started.text}</p>}
            {started.id && <p className="mt-2 text-[13px] text-zinc-500">{started.id}</p>}
          </article>
        )}

        <button type="button" className={northCtaClass} onClick={begin} disabled={start.isPending}>
          Start from a DTU
        </button>
      </div>
    </LensShell>
  );
}
