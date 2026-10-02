'use client';

/** Messages north star — one thread, then the words that are actually in it. */

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LensShell } from '@/components/lens/LensShell';
import { NorthGreeting, QuietMore, northCtaClass } from '@/components/code/CodeFamilyChrome';
import { FamilyPill, NorthError, northPage } from '@/components/lens/NorthStarChrome';
import { api } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { useLensNav } from '@/hooks/useLensNav';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

type Conversation = {
  id: string;
  otherUserId?: string;
  otherDisplayName?: string;
  lastMessage?: { content?: string };
};
type Mail = { id?: string; content?: string; fromUserId?: string };

const PILL = [
  { id: 'message', label: 'Messages', href: '/lenses/message' },
  { id: 'mail', label: 'Mail', href: '/lenses/mail' },
];

const quiet = { retry: false, refetchOnWindowFocus: false } as const;

function asList<T>(payload: unknown, key: string): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === 'object' && Array.isArray((payload as Record<string, unknown>)[key])) {
    return (payload as Record<string, T[]>)[key];
  }
  return [];
}

export function WhoWrote({ onOpenDesk }: { onOpenDesk: () => void }) {
  useLensNav('message');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const client = useQueryClient();
  const threadsQ = useQuery({
    queryKey: ['message-northstar', 'threads'],
    ...quiet,
    queryFn: async () => {
      const res = await api.get('/api/social/dm/conversations');
      return asList<Conversation>(res.data, 'conversations');
    },
  });
  const thread = threadsQ.data?.[0] ?? null;
  const messagesQ = useQuery({
    queryKey: ['message-northstar', 'messages', thread?.id],
    ...quiet,
    enabled: Boolean(thread?.id),
    queryFn: async () => {
      const res = await api.get(`/api/social/dm/${encodeURIComponent(thread?.id || '')}`);
      return asList<Mail>(res.data, 'messages');
    },
  });

  const name = thread?.otherDisplayName || thread?.otherUserId || null;
  const lines = (messagesQ.data ?? []).map((row) => row.content).filter((line): line is string => Boolean(line));
  const [composing, setComposing] = useState(false);
  const [to, setTo] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (!to.trim() || !body.trim()) {
      setError('A message needs a person and a body.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await api.post('/api/social/dm', { toUserId: to.trim(), content: body.trim() });
      if (res.data?.ok === false) {
        setError(res.data.error || 'The message was not sent.');
        return;
      }
      setTo('');
      setBody('');
      setComposing(false);
      await client.invalidateQueries({ queryKey: ['message-northstar'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The message was not sent.');
    } finally {
      setBusy(false);
    }
  };

  const loadError = threadsQ.error instanceof Error ? threadsQ.error.message : '';

  return (
    <LensShell lensId="message" asMain={false} disableAgentFab>
      <div data-lens-theme="message" className={northPage}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <NorthGreeting kicker="Messages" title={who ? `Who wrote, ${who}` : 'Who wrote'} />
            <FamilyPill label="Messages" active="message" items={PILL} />
          </div>
          <QuietMore items={[{ id: 'desk', label: 'Inbox' }]} onPick={onOpenDesk} />
        </div>

        {(loadError || error) && <NorthError message={error || loadError} />}

        {threadsQ.data && !thread && <p className="mt-8 text-[15px] text-zinc-500">No thread.</p>}
        {thread && (
          <article className="mt-8 max-w-xl">
            <p className="text-[16px] text-zinc-100">{name}</p>
            <ul className="mt-3 space-y-2">
              {(lines.length > 0 ? lines : [thread.lastMessage?.content].filter(Boolean) as string[]).map((line, index) => (
                <li key={`${thread.id}-${index}`} className="text-[14px] text-zinc-400">{line}</li>
              ))}
            </ul>
          </article>
        )}

        {composing && (
          <form className="mt-4 max-w-xl space-y-2" onSubmit={(e) => { e.preventDefault(); void send(); }}>
            <input aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} placeholder="To" className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-[14px]" />
            <textarea aria-label="Message" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Message" className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-[14px]" />
            <button type="submit" disabled={busy} className="rounded-full bg-white/10 px-4 py-2 text-[14px] disabled:opacity-50">Send</button>
          </form>
        )}

        <button type="button" className={northCtaClass} onClick={() => setComposing(true)}>+ New message</button>
      </div>
    </LensShell>
  );
}
