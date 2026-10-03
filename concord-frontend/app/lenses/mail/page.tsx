'use client';

/**
 * Mail: north-star chrome over async player-to-player mail with attachments
 * and COD. REST mail routes preserved in the folder + compose panels.
 */

import { useState, useSyncExternalStore } from 'react';
import { Send, Inbox, Pencil } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { MailFolderPanel } from '@/components/mail/MailFolderPanel';
import { ComposeMailPanel } from '@/components/mail/ComposeMailPanel';
import type { MailTab } from '@/components/mail/types';

const VIEWS: { id: MailTab; label: string; keys: string; title: string; icon: typeof Inbox }[] = [
  { id: 'inbox', label: 'Inbox', keys: '1', title: 'Waiting for you', icon: Inbox },
  { id: 'sent', label: 'Sent', keys: '2', title: 'What you sent', icon: Send },
  { id: 'compose', label: 'Compose', keys: '3', title: 'Write a letter', icon: Pencil },
];

const subscribeNoop = () => () => {};
const readHasTo = () => !!new URLSearchParams(window.location.search).get('to');

export default function MailLensPage() {
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [picked, setActive] = useState<MailTab | null>(null);
  const wantsCompose = useSyncExternalStore(subscribeNoop, readHasTo, () => false);
  const active: MailTab = picked ?? (wantsCompose ? 'compose' : 'inbox');

  useLensCommand(
    [
      ...VIEWS.map((v) => ({
        id: `mail-${v.id}`,
        keys: v.keys,
        description: v.label,
        category: 'navigation' as const,
        action: () => setActive(v.id),
      })),
      { id: 'mail-new', keys: 'n', description: 'Compose mail', category: 'actions' as const, action: () => setActive('compose') },
    ],
    { lensId: 'mail' },
  );

  const current = VIEWS.find((v) => v.id === active)!;

  return (
    <LensShell lensId="mail" asMain={false}>
      <NorthStarFrame
        lensId="mail"
        crumb="Mail"
        title={`${current.title}${active === 'inbox' && who ? `, ${who}` : ''}`}
        subtitle="Async player-to-player mail with attachments and COD."
        tabs={VIEWS.map((v) => ({ id: v.id, label: v.label, keys: v.keys, icon: v.icon }))}
        activeTab={active}
        onTab={(id) => setActive(id as MailTab)}
        cta={{ label: 'Compose', icon: Pencil, onClick: () => setActive('compose'), title: 'Compose mail (N)' }}
      >
        <div className="-mx-8 -mt-2">
          {active === 'compose' ? (
            <ComposeMailPanel onSent={() => setActive('sent')} />
          ) : (
            <MailFolderPanel folder={active} onCompose={() => setActive('compose')} />
          )}
        </div>
      </NorthStarFrame>
    </LensShell>
  );
}
