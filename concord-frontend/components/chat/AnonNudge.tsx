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
    <div className="my-3 flex items-center gap-2 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs">
      <Sparkles className="w-3.5 h-3.5 text-amber-300 shrink-0" />
      <span className="text-amber-200/90 flex-1">
        Save this conversation across devices.{' '}
        <Link href="/register" className="font-medium underline hover:text-amber-100">
          Create a free account
        </Link>
        {' '}or{' '}
        <Link href="/login" className="font-medium underline hover:text-amber-100">
          sign in
        </Link>
        {' '}— takes 10 seconds.
      </span>
      <button
        onClick={close}
        className="text-amber-300/70 hover:text-amber-200 shrink-0"
        aria-label="Dismiss"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
