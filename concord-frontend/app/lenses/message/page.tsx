'use client';

/**
 * /lenses/message — direct messaging lens.
 *
 * The message lens didn't exist as a page (only the chat lens covered
 * the conversational surface, which is 1:1 with Concord-the-AI itself
 * and not the right shape for human-to-human N-way correspondence).
 * This page mounts InboxShell with the Gmail-shape silhouette so the
 * lens has a real surface; live data wiring comes through the
 * messaging adapters when a real backing thread store is hooked up.
 */

import { useState } from 'react';

import { LensShell } from '@/components/lens/LensShell';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { InboxShell, type InboxThread } from '@/components/message/InboxShell';

const SEED_THREADS: InboxThread[] = [
  { id: 't1', from: 'Aria Voss',   subject: 'Royalty cascade — gen 3 hit',
    snippet: 'Your fighting style "Stance Against the Cold" earned 12 CC from a 3rd-gen derivative…',
    timestamp: new Date().toISOString(), unread: true, labels: ['royalty'] },
  { id: 't2', from: 'Concord',     subject: 'Initiative: morning context',
    snippet: 'You logged off after authoring 2 NPCs. Want me to draft an arc that ties them together?',
    timestamp: new Date(Date.now() - 7200_000).toISOString(), starred: true, labels: ['concord'] },
  { id: 't3', from: 'Mira',        subject: 'Twilight Commune — co-author?',
    snippet: 'I love what you started. Want to take it from gen 2?',
    timestamp: new Date(Date.now() - 86400_000).toISOString(), labels: ['collab'] },
  { id: 't4', from: 'Marketplace', subject: 'Dome-Buckler Stance sold (50 CC)',
    snippet: 'Vex purchased your style. 95% to you, royalty cascade armed.',
    timestamp: new Date(Date.now() - 172800_000).toISOString(), hasAttachment: true },
];

export default function MessageLensPage() {
  useLensNav('message');

  const [activeLabelId, setActiveLabelId] = useState('inbox');
  const [activeThreadId, setActiveThreadId] = useState<string | null>('t1');

  useLensCommand(
    [
      { id: 'goto-inbox',   keys: 'g i', description: 'Inbox',   category: 'navigation', action: () => setActiveLabelId('inbox') },
      { id: 'goto-starred', keys: 'g s', description: 'Starred', category: 'navigation', action: () => setActiveLabelId('starred') },
      { id: 'goto-sent',    keys: 'g t', description: 'Sent',    category: 'navigation', action: () => setActiveLabelId('sent') },
      { id: 'compose',      keys: 'c',   description: 'Compose', category: 'actions',     action: () => { /* compose handler wires when send-message API is ready */ } },
    ],
    { lensId: 'message' }
  );

  const activeThread = SEED_THREADS.find((t) => t.id === activeThreadId);

  return (
    <LensShell lensId="message" asMain={false}>
      <ManifestActionBar />
      <div className="h-[calc(100vh-6rem)]">
        <InboxShell
          labels={[
            { id: 'inbox',   label: 'Inbox',   count: SEED_THREADS.filter(t => t.unread).length, icon: 'inbox' },
            { id: 'starred', label: 'Starred', count: SEED_THREADS.filter(t => t.starred).length, icon: 'starred' },
            { id: 'snoozed', label: 'Snoozed', icon: 'snoozed' },
            { id: 'sent',    label: 'Sent',    icon: 'sent' },
            { id: 'archive', label: 'Archive', icon: 'archive' },
            { id: 'trash',   label: 'Trash',   icon: 'trash' },
          ]}
          activeLabelId={activeLabelId}
          threads={SEED_THREADS}
          activeThreadId={activeThreadId ?? undefined}
          onSelectLabel={(label) => setActiveLabelId(label.id)}
          onSelectThread={(t) => setActiveThreadId(t.id)}
        >
          {activeThread && (
            <article className="prose dark:prose-invert max-w-none">
              <header className="mb-4 not-prose">
                <h1 className="text-xl font-semibold">{activeThread.subject}</h1>
                <div className="text-sm text-gray-500 mt-1">
                  From {activeThread.from} ·{' '}
                  {new Date(activeThread.timestamp).toLocaleString()}
                </div>
              </header>
              <p>{activeThread.snippet}</p>
            </article>
          )}
        </InboxShell>
      </div>
    </LensShell>
  );
}
