'use client';

import { useState } from 'react';
import { Bookmark, Globe, Hash, Lock, PenLine } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { withContentLicense } from '@/components/dtu/ContentClassLicenseFields';
import {
  handoffCalls,
  handoffOutcome,
  type HandoffKind,
  type HandoffMessage,
} from '@/components/chat/chatHandoff';

const ACTIONS: { kind: HandoffKind; label: string; pending: string; Icon: typeof Bookmark }[] = [
  { kind: 'dtu', label: 'Save transcript as DTU', pending: 'Saving DTU…', Icon: Bookmark },
  { kind: 'timeline-private', label: 'Post privately on Timeline', pending: 'Posting privately…', Icon: Lock },
  { kind: 'timeline-public', label: 'Post publicly on Timeline', pending: 'Posting publicly…', Icon: Globe },
  { kind: 'forum', label: 'Open a Forum topic', pending: 'Creating topic…', Icon: Hash },
  { kind: 'thread-draft', label: 'Save as Thread draft', pending: 'Saving draft…', Icon: PenLine },
];

export function ChatHandoffMenu({
  messages,
  sessionId,
  title,
  onNote,
}: {
  messages: HandoffMessage[];
  sessionId: string | null;
  title: string;
  onNote?: (text: string) => void;
}) {
  const [busy, setBusy] = useState<HandoffKind | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const ready = messages.some((m) => (m.content || '').trim().length > 0);

  async function run(kind: HandoffKind) {
    if (busy) return;
    const calls = handoffCalls({ title, sessionId, messages });
    if (!calls) {
      const text = 'Nothing in this conversation to send.';
      setNote(text);
      onNote?.(text);
      return;
    }
    setBusy(kind);
    setNote(null);
    try {
      const call = calls[kind];
      const input = kind === 'dtu'
        ? withContentLicense(call.input, 'knowledge', ['private'])
        : call.input;
      const response = await lensRun({ domain: call.domain, name: call.action, input });
      const outcome = handoffOutcome(kind, response.data);
      setNote(outcome.text);
      onNote?.(outcome.text);
    } catch (err) {
      const text = `Not saved. ${err instanceof Error ? err.message : 'Request failed.'}`;
      setNote(text);
      onNote?.(text);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="border-t border-lattice-border" role="group" aria-label="Send this conversation">
      {ACTIONS.map(({ kind, label, pending, Icon }) => (
        <button
          key={kind}
          type="button"
          onClick={() => { void run(kind); }}
          disabled={!ready || busy !== null}
          className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-200 hover:bg-lattice-bg transition-colors disabled:opacity-50 text-left"
        >
          <Icon className="w-4 h-4 shrink-0" aria-hidden />
          {busy === kind ? pending : label}
        </button>
      ))}
      {note && (
        <p className="px-4 py-2 text-xs text-gray-300 border-t border-lattice-border" role="status">
          {note}
        </p>
      )}
    </div>
  );
}
