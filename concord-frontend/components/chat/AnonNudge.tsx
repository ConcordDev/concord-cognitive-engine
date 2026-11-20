'use client';

// AnonNudge — soft inline prompt for anonymous users at message ~3 to
// save their conversation. No modal, no popup, no friction — just a
// one-line "Save this conversation?" inside the message stream that
// dismisses on click.
//
// Why: the chat lens lets anon users start chatting with zero friction
// (good). But after 5–10 messages they close the browser and lose
// everything because backend session state is owner-id keyed and they
// don't have one. Frontend localStorage holds the conversation list but
// not the messages. Without this nudge the user never knows the data is
// at risk.

import { Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import Link from 'next/link';

interface AnonNudgeProps {
  visible: boolean;
  onDismiss: () => void;
}

export default function AnonNudge({ visible, onDismiss }: AnonNudgeProps) {
  const [hidden, setHidden] = useState(false);
  if (!visible || hidden) return null;
  const close = () => { setHidden(true); onDismiss(); };
  return (
    <div className="my-3 flex items-center gap-2 rounded-lg border border-[color:var(--nb-ochre,rgba(251,191,36,0.3))] bg-[var(--nb-hl,rgba(245,158,11,0.1))] px-3 py-2 text-xs">
      <Sparkles className="w-3.5 h-3.5 text-[color:var(--nb-ochre,#fcd34d)] shrink-0" />
      <span className="text-[color:var(--nb-ochre,rgba(253,230,138,0.9))] flex-1">
        Save this conversation across devices.{' '}
        <Link href="/register" className="font-medium underline hover:text-[color:var(--nb-ochre,#fef3c7)]">
          Create a free account
        </Link>
        {' '}or{' '}
        <Link href="/login" className="font-medium underline hover:text-[color:var(--nb-ochre,#fef3c7)]">
          sign in
        </Link>
        {' '}— takes 10 seconds.
      </span>
      <button
        onClick={close}
        className="text-[color:var(--nb-ochre,rgba(252,211,77,0.7))] hover:text-[color:var(--nb-ochre,#fde68a)] shrink-0"
        aria-label="Dismiss"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
