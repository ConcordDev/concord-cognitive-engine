'use client';

import { useState } from 'react';
import { Bookmark, Globe, Hash, Lock, PenLine } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { withContentLicense } from '@/components/dtu/ContentClassLicenseFields';
import {
  dtuReadBackCall,
  dtuReadBackMatches,
  handoffCalls,
  handoffOutcome,
  handoffRecordId,
  sendDtuOutcome,
  sendDtuToTimelineCall,
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
  const [busy, setBusy] = useState<HandoffKind | 'send-dtu' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [savedDtuId, setSavedDtuId] = useState<string | null>(null);
  const [timelinePostId, setTimelinePostId] = useState<string | null>(null);
  const ready = messages.some((m) => (m.content || '').trim().length > 0);

  function say(text: string) {
    setNote(text);
    onNote?.(text);
  }

  async function run(kind: HandoffKind) {
    if (busy) return;
    const calls = handoffCalls({ title, sessionId, messages });
    if (!calls) {
      say('Nothing in this conversation to send.');
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
      if (kind !== 'dtu') {
        say(outcome.text);
        return;
      }
      const id = handoffRecordId('dtu', response.data);
      if (!outcome.claimed || !id) {
        setSavedDtuId(null);
        say(outcome.text);
        return;
      }
      const read = await lensRun(dtuReadBackCall(id));
      if (!dtuReadBackMatches(id, read.data)) {
        setSavedDtuId(null);
        say(`Not saved. DTU ${id} could not be read back.`);
        return;
      }
      setSavedDtuId(id);
      say(`Saved as DTU ${id}.`);
    } catch (err) {
      const text = `Not saved. ${err instanceof Error ? err.message : 'Request failed.'}`;
      say(text);
    } finally {
      setBusy(null);
    }
  }

  async function sendDtu() {
    if (busy || !savedDtuId) return;
    const call = sendDtuToTimelineCall({ title, sessionId, messages, dtuId: savedDtuId });
    if (!call) {
      say('Not sent. This DTU has no transcript to post.');
      return;
    }
    setBusy('send-dtu');
    setNote(null);
    try {
      const response = await lensRun({ domain: call.domain, name: call.action, input: call.input });
      const outcome = sendDtuOutcome(savedDtuId, response.data);
      if (outcome.claimed) setTimelinePostId(outcome.postId);
      say(outcome.text);
    } catch (err) {
      say(`Not sent. ${err instanceof Error ? err.message : 'Request failed.'}`);
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
      {savedDtuId && (
        <button
          type="button"
          onClick={() => { void sendDtu(); }}
          disabled={busy !== null}
          className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-200 hover:bg-lattice-bg transition-colors disabled:opacity-50 text-left border-t border-lattice-border"
        >
          <Lock className="w-4 h-4 shrink-0" aria-hidden />
          {busy === 'send-dtu' ? 'Sending DTU…' : 'Send this DTU to Timeline'}
        </button>
      )}
      {note && (
        <p className="px-4 py-2 text-xs text-gray-300 border-t border-lattice-border" role="status">
          {note}
        </p>
      )}
      {timelinePostId && (
        <a
          href={`/lenses/timeline?tab=feed`}
          className="block px-4 py-2 text-xs text-gray-200 underline border-t border-lattice-border"
        >
          Open Timeline post {timelinePostId}
        </a>
      )}
    </div>
  );
}
