'use client';

/** Threads north star — one open conversation and the replies under it. */

import { useMemo, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthGreeting, QuietMore, northCtaClass } from '@/components/code/CodeFamilyChrome';
import { NorthError, northPage } from '@/components/lens/NorthStarChrome';
import { ChatFamilyPill } from '@/components/chat/ChatFamilyPill';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { useAuth } from '@/hooks/useAuth';
import { useLensNav } from '@/hooks/useLensNav';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

type Node = { id: string; parentNodeId: string | null; content: string; createdAt: string };
type ThreadData = { nodes?: Node[] };

export function WhichBranch({ onOpenDesk }: { onOpenDesk: () => void }) {
  useLensNav('thread');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const { items, isLoading, isError, error, create, refetch } = useLensData<ThreadData>('thread', 'conversation', { noSeed: true, limit: 20 });
  const run = useRunArtifact('thread');
  const open = useMemo(
    () => items.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null,
    [items],
  );
  const stack = useMemo(() => {
    const nodes = open?.data?.nodes || [];
    const byTime = (a: Node, b: Node) => a.createdAt.localeCompare(b.createdAt);
    const root = nodes.filter((n) => !n.parentNodeId).sort(byTime)[0] || nodes.slice().sort(byTime)[0];
    if (!root) return [];
    return [root, ...nodes.filter((n) => n.id !== root.id).sort(byTime)];
  }, [open]);

  const [composing, setComposing] = useState(false);
  const [body, setBody] = useState('');
  const [localError, setLocalError] = useState('');
  const [busy, setBusy] = useState(false);

  const reply = async () => {
    const content = body.trim();
    if (content.length < 1) {
      setLocalError('A reply needs words.');
      return;
    }
    setBusy(true);
    setLocalError('');
    try {
      let threadId = open?.id;
      if (!threadId) {
        const created = await create({
          title: content.split('\n')[0].slice(0, 80),
          data: { nodes: [] },
        }) as { ok?: boolean; artifact?: { id: string }; error?: string };
        threadId = created?.artifact?.id;
        if (!threadId) {
          setLocalError(created?.error || 'The thread was not opened.');
          return;
        }
      }
      const parentNodeId = stack[0]?.id ?? null;
      const res = await run.mutateAsync({
        id: threadId,
        action: 'branch',
        params: { parentNodeId, content },
      });
      if (!res.ok) {
        setLocalError('The reply was not posted.');
        return;
      }
      setBody('');
      setComposing(false);
      await refetch();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'The reply was not posted.');
    } finally {
      setBusy(false);
    }
  };

  const loadError = isError ? (error instanceof Error ? error.message : 'The threads did not answer.') : '';

  return (
    <LensShell lensId="thread" asMain={false} disableAgentFab>
      <div data-lens-theme="thread" className={northPage}>
        <div className="flex items-start justify-between gap-4">
          <NorthGreeting kicker="Threads" title={who ? `Which branch, ${who}` : 'Which branch'} />
          <QuietMore
            items={[
              { id: 'map', label: 'Map' },
              { id: 'composer', label: 'Composer' },
              { id: 'studio', label: 'Studio' },
              { id: 'feed', label: 'Feed' },
            ]}
            onPick={onOpenDesk}
          />
        </div>
        <ChatFamilyPill active="thread" />

        {(loadError || localError) && <NorthError message={localError || loadError} />}

        {!isLoading && !isError && stack.length === 0 && (
          <div className="mt-6 max-w-xl rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-[14px] text-zinc-400" data-testid="thread-empty">
            One thread. Replies stack under it. Map, studio, and tree stay in the palette.
          </div>
        )}

        {stack.length > 0 && (
          <article className="mt-6 max-w-xl space-y-3" data-testid="thread-stack">
            {open?.title && <p className="text-[13px] text-zinc-500">{open.title}</p>}
            {stack.map((node, i) => (
              <p key={node.id} className={i === 0 ? 'text-[16px] text-zinc-100' : 'border-l border-white/10 pl-3 text-[15px] text-zinc-300'}>
                {node.content}
              </p>
            ))}
          </article>
        )}

        {composing && (
          <form className="mt-4 max-w-xl space-y-2" onSubmit={(e) => { e.preventDefault(); void reply(); }}>
            <textarea aria-label="Reply" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Reply" className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-[14px]" />
            <button type="submit" disabled={busy} className="rounded-full bg-white/10 px-4 py-2 text-[14px] disabled:opacity-50">Send</button>
          </form>
        )}

        <button type="button" className={northCtaClass} onClick={() => setComposing(true)}>Reply</button>
      </div>
    </LensShell>
  );
}
