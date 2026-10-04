'use client';

import { useState } from 'react';
import { Bookmark, Hash, PenLine } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { withContentLicense } from '@/components/dtu/ContentClassLicenseFields';
import {
  forumAllowed,
  keepCalls,
  keepOutcome,
  type KeepKind,
  type KeepPost,
} from '@/components/timeline/postKeep';

const ACTIONS: { kind: KeepKind; label: string; pending: string; Icon: typeof Bookmark }[] = [
  { kind: 'dtu', label: 'Save as private DTU', pending: 'Saving DTU…', Icon: Bookmark },
  { kind: 'forum', label: 'Open a Forum topic', pending: 'Creating topic…', Icon: Hash },
  { kind: 'thread-draft', label: 'Save as Thread draft', pending: 'Saving draft…', Icon: PenLine },
];

const FORUM_BLOCK = 'Friends-only posts by someone else stay on Timeline. A forum topic is not limited to those friends.';

export function PostKeepMenu({ post, viewerId }: { post: KeepPost; viewerId: string }) {
  const [busy, setBusy] = useState<KeepKind | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const calls = keepCalls(post);
  const forumOk = forumAllowed(post, viewerId);

  async function run(kind: KeepKind) {
    if (busy || !calls) return;
    if (kind === 'forum' && !forumOk) {
      setNote(FORUM_BLOCK);
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
      setNote(keepOutcome(kind, response.data).text);
    } catch (err) {
      setNote(`Not saved. ${err instanceof Error ? err.message : 'Request failed.'}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="border-t border-gray-700" role="group" aria-label="Keep this post">
      {ACTIONS.map(({ kind, label, pending, Icon }) => {
        const blocked = kind === 'forum' && !forumOk;
        return (
          <button
            key={kind}
            type="button"
            onClick={() => { void run(kind); }}
            disabled={!calls || busy !== null || blocked}
            title={blocked ? FORUM_BLOCK : undefined}
            className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-200 hover:bg-[#3a3b3c] disabled:opacity-50 text-left"
          >
            <Icon className="w-4 h-4 shrink-0" aria-hidden />
            {busy === kind ? pending : label}
          </button>
        );
      })}
      {!forumOk && (
        <p className="px-4 pb-2 text-xs text-gray-400">{FORUM_BLOCK}</p>
      )}
      {note && (
        <p className="px-4 py-2 text-xs text-gray-300 border-t border-gray-700" role="status">{note}</p>
      )}
    </div>
  );
}
