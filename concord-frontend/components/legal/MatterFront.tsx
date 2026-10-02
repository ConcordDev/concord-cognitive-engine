'use client';

/**
 * Legal north star — the matter in front of you, and one document when one exists.
 */

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { LensShell } from '@/components/lens/LensShell';
import { NorthGreeting, QuietMore, northCtaClass } from '@/components/code/CodeFamilyChrome';
import { FamilyPill, NorthError, NorthNote, northPage, useMacro } from '@/components/lens/NorthStarChrome';
import { lensRun } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { useLensNav } from '@/hooks/useLensNav';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

type Matter = { id: string; name?: string; number?: string; status?: string; clientName?: string };
type Doc = { id: string; title?: string; name?: string };

const PILL = [
  { id: 'legal', label: 'Legal', href: '/lenses/legal' },
  { id: 'law', label: 'Law', href: '/lenses/law' },
  { id: 'disputes', label: 'Disputes', href: '/lenses/disputes' },
];

export function MatterFront({ onOpenDesk }: { onOpenDesk: () => void }) {
  useLensNav('legal');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const client = useQueryClient();
  const [preferredId, setPreferredId] = useState('');
  const mattersQ = useMacro<{ matters?: Matter[] }>(
    ['legal-northstar', 'matters'],
    'legal',
    'matters-list',
    {},
    (result) => {
      if (!Array.isArray(result.matters)) throw new Error('Matters did not answer.');
      return result;
    },
  );
  const list = mattersQ.data?.matters ?? null;
  const matter = list?.find((m) => m.id === preferredId) || list?.[0] || null;
  const docsQ = useMacro<{ documents?: Doc[] }>(
    ['legal-northstar', 'doc', matter?.id || 'none'],
    'legal',
    'documents-list',
    matter ? { matterId: matter.id } : {},
    (result) => result,
    Boolean(matter),
  );
  const doc = matter && docsQ.data && Array.isArray(docsQ.data.documents) ? docsQ.data.documents[0] || null : null;
  const [composing, setComposing] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const create = async () => {
    if (!name.trim()) {
      setError('A matter needs a name.');
      return;
    }
    setError('');
    const res = await lensRun<{ matter?: Matter }>('legal', 'matters-create', { name: name.trim() });
    const created = res.data.result?.matter;
    if (!res.data.ok || !created) {
      setError(res.data.error || 'The matter was not opened.');
      return;
    }
    setName('');
    setComposing(false);
    setPreferredId(created.id);
    await client.invalidateQueries({ queryKey: ['legal-northstar', 'matters'] });
  };

  return (
    <LensShell lensId="legal" asMain={false} disableAgentFab>
      <div data-lens-theme="legal" className={northPage}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <NorthGreeting kicker="Legal" title={who ? `The matter in front of you, ${who}` : 'The matter in front of you'} />
            <FamilyPill label="Legal" active="legal" items={PILL} />
          </div>
          <QuietMore items={[{ id: 'desk', label: 'Practice desk' }]} onPick={onOpenDesk} />
        </div>

        <p className="mt-6 max-w-xl text-[13px] text-amber-200/90">
          This tool assists with legal organization and practice management. It does not constitute legal advice.
        </p>

        {list && !matter && <NorthNote>No matter open</NorthNote>}
        {(error || mattersQ.error) && (
          <NorthError message={error || (mattersQ.error instanceof Error ? mattersQ.error.message : 'Matters did not answer.')} />
        )}

        {matter && (
          <article className="mt-6 max-w-xl">
            <h2 className="font-vault text-[1.75rem] text-zinc-100">{matter.name}</h2>
            <p className="mt-1 text-[13px] text-zinc-500">{[matter.number, matter.clientName, matter.status].filter(Boolean).join(' · ')}</p>
            {doc && <p className="mt-4 text-[15px] text-zinc-200">{doc.title || doc.name}</p>}
          </article>
        )}

        {composing && (
          <form className="mt-6 max-w-xl" onSubmit={(e) => { e.preventDefault(); void create(); }}>
            <input aria-label="Matter name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Matter name" className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-[14px]" />
            <button type="submit" className="mt-3 rounded-full bg-white/10 px-4 py-2 text-[14px]">Open matter</button>
          </form>
        )}

        <button type="button" className={northCtaClass} onClick={() => setComposing(true)}>+ New matter</button>
      </div>
    </LensShell>
  );
}
