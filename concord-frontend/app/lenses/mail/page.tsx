'use client';

/**
 * Mail lens: a full email client over the user's own Gmail (conversations,
 * search, labels, drafts, attachments, reply / reply-all / forward, undo
 * send, Gmail keyboard shortcuts) with Concord player mail as one mailbox.
 */

import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { MailClient } from '@/components/mail/client/MailClient';

export default function MailLensPage() {
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [composeSignal, setComposeSignal] = useState(0);

  return (
    <LensShell lensId="mail" asMain={false}>
      <NorthStarFrame
        lensId="mail"
        crumb="Mail"
        title={`Who wrote${who ? `, ${who}` : ''}`}
        subtitle="Your Gmail, threaded and searchable, plus Concord player mail."
        cta={{ label: 'Compose', icon: Pencil, onClick: () => setComposeSignal((n) => n + 1), title: 'Compose (C)' }}
      >
        <MailClient composeSignal={composeSignal} />
      </NorthStarFrame>
    </LensShell>
  );
}
