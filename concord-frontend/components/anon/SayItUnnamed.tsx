'use client';

/** Anonymous north star — a post whose stored record has no name. */

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { LensShell } from '@/components/lens/LensShell';
import { NorthGreeting, QuietMore, northCtaClass } from '@/components/code/CodeFamilyChrome';
import { FamilyPill, NorthError, northPage, useMacro } from '@/components/lens/NorthStarChrome';
import { lensRun } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { useLensNav } from '@/hooks/useLensNav';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

type Conversation = { id: string; lastActivityAt?: number };

export function SayItUnnamed({ onOpenDesk }: { onOpenDesk: () => void }) {
  useLensNav('anon');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const client = useQueryClient();
  const convQ = useMacro<{ conversations?: Conversation[] }>(
    ['anon-northstar', 'conversations'],
    'anon',
    'listConversations',
    {},
    (result) => {
      if (!Array.isArray(result.conversations)) throw new Error('The conversations did not answer.');
      return result;
    },
  );
  const conversation = (convQ.data?.conversations ?? [])
    .slice()
    .sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0))[0] ?? null;

  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [sealed, setSealed] = useState(false);
  const [busy, setBusy] = useState(false);

  const post = async () => {
    const content = body.trim();
    if (!content) {
      setError('A post needs words.');
      return;
    }
    if (!conversation) {
      setError('No conversation to seal this into.');
      return;
    }
    setBusy(true);
    setError('');
    setSealed(false);
    try {
      const res = await lensRun('anon', 'sendMessage', {
        conversationId: conversation.id,
        content,
        sealedSender: true,
      });
      if (!res.data.ok) {
        setError(res.data.error || 'The post was not sealed.');
        return;
      }
      setBody('');
      setSealed(true);
      await client.invalidateQueries({ queryKey: ['anon-northstar', 'conversations'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The post was not sealed.');
    } finally {
      setBusy(false);
    }
  };

  const loadError = convQ.error instanceof Error ? convQ.error.message : '';

  return (
    <LensShell lensId="anon" asMain={false} disableAgentFab>
      <div data-lens-theme="anon" className={northPage}>
        <div className="flex items-start justify-between gap-4">
          <NorthGreeting kicker="Anonymous" title={who ? `Say it unnamed, ${who}` : 'Say it unnamed'} />
          <QuietMore items={[{ id: 'desk', label: 'Desk' }]} onPick={onOpenDesk} />
        </div>
        <FamilyPill
          label="Anonymous"
          active="anon"
          items={[
            { id: 'chat', label: 'Chat', href: '/lenses/chat' },
            { id: 'anon', label: 'Anonymous', href: '/lenses/anon' },
            { id: 'forum', label: 'Forum', href: '/lenses/forum' },
          ]}
        />

        {(loadError || error) && <NorthError message={error || loadError} />}

        <form
          className="mt-6 max-w-xl rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4"
          onSubmit={(e) => { e.preventDefault(); void post(); }}
        >
          <p className="text-[14px] text-zinc-400">Identity is stripped before this is stored.</p>
          <textarea
            aria-label="Post"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="mt-3 h-24 w-full rounded-xl border border-white/10 bg-black px-3 py-2 text-[14px]"
          />
          {sealed && <p className="mt-3 text-[13px] text-zinc-500" data-testid="anon-sealed">Sealed. The stored record has no name.</p>}
        </form>

        <button type="button" className={northCtaClass} disabled={busy} onClick={() => void post()}>Post</button>
      </div>
    </LensShell>
  );
}
