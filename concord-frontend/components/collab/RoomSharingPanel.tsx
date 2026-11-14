'use client';

/**
 * RoomSharingPanel — FIX-collab-001 C2/C3 front end for one room.
 *
 * Renders, for the room it is given: who is here now (presence), who
 * belongs (owner + members with their tiers), the owner's invite form,
 * and the room's discussion thread. Every verb is the collab domain's
 * own membership/discussion/presence set (room-members, room-invite,
 * room-member-remove, room-comment-add/list, room-presence-update/
 * state); the panel holds no state of its own beyond the server's
 * answers, and every load fails soft to a plain line rather than
 * breaking the room surface around it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { lensRun } from '@/lib/api/client';

interface MemberRow {
  userId?: string;
  displayName: string;
  tier: string;
  status: string;
  isMine: boolean;
}

interface CommentRow {
  id: string;
  authorName: string;
  text: string;
  createdAt: number;
}

interface PresenceRow {
  userId: string;
  name: string;
  isOwner: boolean;
}

interface MembersResult {
  owner: { displayName: string; isOwner: boolean };
  members: MemberRow[];
  myTier: string;
  isOwner: boolean;
  memberCount: number;
}

async function run<T>(name: string, input: Record<string, unknown>): Promise<T> {
  const response = await lensRun<T>('collab', name, input);
  if (response.data?.ok && response.data.result) return response.data.result;
  throw new Error(response.data?.error || 'Something went wrong.');
}

const TIERS = ['view', 'comment', 'edit'] as const;

export function RoomSharingPanel({ roomId }: { roomId: string }) {
  const [members, setMembers] = useState<MembersResult | null>(null);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [presence, setPresence] = useState<PresenceRow[]>([]);
  const [error, setError] = useState('');
  const [invitee, setInvitee] = useState('');
  const [tier, setTier] = useState<string>('view');
  const [inviteNote, setInviteNote] = useState('');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);

  const loadMembers = useCallback(async () => {
    const result = await run<MembersResult>('room-members', { id: roomId });
    // Shape-guard: a malformed answer is a load failure, never a render
    // crash on the room surface around the panel.
    if (!result || typeof result !== 'object' || !result.owner || !Array.isArray(result.members)) {
      throw new Error('Could not load the room members.');
    }
    if (alive.current) setMembers(result);
  }, [roomId]);

  const loadComments = useCallback(async () => {
    const result = await run<{ comments: CommentRow[] }>('room-comment-list', { id: roomId });
    if (alive.current) setComments(Array.isArray(result?.comments) ? result.comments : []);
  }, [roomId]);

  const loadPresence = useCallback(async () => {
    await run('room-presence-update', { id: roomId }).catch(() => {});
    const result = await run<{ presence: PresenceRow[] }>('room-presence-state', { id: roomId });
    if (alive.current) setPresence(Array.isArray(result?.presence) ? result.presence : []);
  }, [roomId]);

  useEffect(() => {
    alive.current = true;
    setError('');
    loadMembers().catch((err) => { if (alive.current) setError(err instanceof Error ? err.message : 'Could not load the room members.'); });
    loadComments().catch(() => {});
    loadPresence().catch(() => {});
    const timer = setInterval(() => { loadPresence().catch(() => {}); }, 30000);
    return () => { alive.current = false; clearInterval(timer); };
  }, [loadMembers, loadComments, loadPresence]);

  const canComment = members?.isOwner || members?.myTier === 'comment' || members?.myTier === 'edit';

  const invite = useCallback(async () => {
    const target = invitee.trim();
    if (!target || busy) return;
    setBusy(true);
    setInviteNote('');
    try {
      const result = await run<{ invite: { status: string }; duplicate?: boolean }>(
        'room-invite',
        { id: roomId, inviteeId: target, tier },
      );
      setInviteNote(result.duplicate
        ? `${target} already has a pending invitation to this room.`
        : `Invited ${target} — they will see it under room invitations.`);
      setInvitee('');
      await loadMembers().catch(() => {});
    } catch (err) {
      setInviteNote(err instanceof Error ? err.message : 'Could not send that invitation.');
    } finally {
      setBusy(false);
    }
  }, [busy, invitee, loadMembers, roomId, tier]);

  const remove = useCallback(async (userId: string) => {
    setBusy(true);
    try {
      await run('room-member-remove', { id: roomId, userId });
      await loadMembers().catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove that member.');
    } finally {
      setBusy(false);
    }
  }, [busy, loadMembers, roomId]);

  const post = useCallback(async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await run('room-comment-add', { id: roomId, text });
      setDraft('');
      await loadComments().catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not post that comment.');
    } finally {
      setBusy(false);
    }
  }, [busy, draft, loadComments, roomId]);

  return (
    <div data-testid="cb-room-sharing" className="mt-6 border-t border-white/10 pt-5">
      {presence.length > 0 && (
        <p data-testid="cb-room-presence" className="text-[13px] text-zinc-500">
          Here now: {presence.map((row) => row.name).join(', ')}
        </p>
      )}

      <h2 className="mt-2 text-[14px] font-medium text-zinc-200">Members</h2>
      {members ? (
        <ul data-testid="cb-room-members" className="mt-2 space-y-1.5 text-[14px] text-zinc-300">
          <li>
            {members.owner.displayName} <span className="text-zinc-500">· owner</span>
          </li>
          {members.members.map((row, index) => (
            <li key={row.userId || `member-${index}`} className="flex items-center gap-3">
              <span>
                {row.displayName} <span className="text-zinc-500">· {row.tier}{row.status !== 'accepted' ? ` · ${row.status}` : ''}</span>
              </span>
              {(members.isOwner || row.isMine) && row.userId && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => { void remove(row.userId as string); }}
                  className="text-[13px] text-zinc-400 underline hover:text-zinc-200 disabled:opacity-60"
                >
                  {row.isMine && !members.isOwner ? 'Leave' : 'Remove'}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[14px] text-zinc-500">Loading members…</p>
      )}

      {members?.isOwner && (
        <div className="mt-4">
          <label className="block text-[14px] text-zinc-400">
            Invite by user id
            <span className="mt-1 flex flex-wrap items-center gap-3">
              <input
                data-testid="cb-invite-id"
                value={invitee}
                onChange={(event) => setInvitee(event.target.value)}
                className="min-w-[12rem] flex-1 border-b border-white/15 bg-transparent pb-1.5 text-[14px] text-zinc-100 outline-none"
              />
              <select
                data-testid="cb-invite-tier"
                value={tier}
                onChange={(event) => setTier(event.target.value)}
                aria-label="Invitation tier"
                className="border border-white/15 bg-zinc-950 px-2 py-1.5 text-[14px] text-zinc-100"
              >
                {TIERS.map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => { void invite(); }}
                disabled={busy || !invitee.trim()}
                className="text-[14px] text-zinc-100 underline disabled:opacity-60"
              >
                Invite
              </button>
            </span>
          </label>
          {inviteNote && <p role="status" className="mt-2 text-[13px] text-zinc-400">{inviteNote}</p>}
        </div>
      )}

      <h2 className="mt-6 text-[14px] font-medium text-zinc-200">Discussion</h2>
      {comments.length > 0 ? (
        <ul data-testid="cb-room-comments" className="mt-2 space-y-2.5">
          {comments.map((comment) => (
            <li key={comment.id} className="text-[14px]">
              <span className="text-zinc-400">{comment.authorName}: </span>
              <span className="text-zinc-200">{comment.text}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[14px] text-zinc-500">No comments yet.</p>
      )}
      {canComment && (
        <div className="mt-3 flex items-end gap-3">
          <label className="block flex-1 text-[14px] text-zinc-400">
            Add a comment
            <input
              data-testid="cb-comment-input"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void post(); } }}
              className="mt-1 w-full border-b border-white/15 bg-transparent pb-1.5 text-[14px] text-zinc-100 outline-none"
            />
          </label>
          <button
            type="button"
            onClick={() => { void post(); }}
            disabled={busy || !draft.trim()}
            className="text-[14px] text-zinc-100 underline disabled:opacity-60"
          >
            Post
          </button>
        </div>
      )}

      {error && <p role="alert" className="mt-3 text-[13px] text-red-300">{error}</p>}
    </div>
  );
}
