'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api/client';

interface GroupRow {
  groupId: string;
  name: string;
  description?: string;
  visibility?: string;
  isMember?: boolean;
  memberCount?: number;
}

interface MemberRow {
  userId: string;
  role: string;
}

interface PostRow {
  postId: string;
  content: string;
  authorName?: string;
}

/** DB-backed groups from /api/social/groups. Private groups are omitted until you are a member. */
export function SocialGroups({ currentUserId }: { currentUserId: string }) {
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [openId, setOpenId] = useState<string | null>(null);
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [draft, setDraft] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    try {
      const res = await api.get<{ groups?: GroupRow[]; error?: string }>('/api/social/groups');
      setGroups(Array.isArray(res.data?.groups) ? res.data.groups : []);
      if (res.data?.error) setMessage(res.data.error);
    } catch {
      setMessage('Could not load groups.');
    }
  }

  useEffect(() => {
    let cancel = false;
    queueMicrotask(() => { if (!cancel) void load(); });
    return () => { cancel = true; };
  }, []);

  async function createGroup() {
    setMessage(null);
    try {
      const res = await api.post<{ ok?: boolean; error?: string; groupId?: string }>('/api/social/group', { name, visibility });
      if (res.data?.ok === false) {
        setMessage(res.data.error || 'Could not create the group.');
        return;
      }
      setName('');
      await load();
    } catch {
      setMessage('Could not create the group.');
    }
  }

  async function openGroup(groupId: string) {
    setOpenId(groupId);
    setMessage(null);
    try {
      const [feed, people] = await Promise.all([
        api.get<{ posts?: PostRow[]; error?: string }>(`/api/social/group/${groupId}/feed`),
        api.get<{ members?: MemberRow[]; error?: string }>(`/api/social/group/${groupId}/members`),
      ]);
      if (feed.data?.error || people.data?.error) {
        setPosts([]);
        setMembers([]);
        setMessage(feed.data?.error || people.data?.error || 'Group not found');
        return;
      }
      setPosts(Array.isArray(feed.data?.posts) ? feed.data.posts : []);
      setMembers(Array.isArray(people.data?.members) ? people.data.members : []);
    } catch {
      setMessage('Could not open that group.');
    }
  }

  async function join(groupId: string) {
    setMessage(null);
    try {
      const res = await api.post<{ ok?: boolean; error?: string }>(`/api/social/group/${groupId}/join`, {});
      if (res.data?.ok === false) {
        setMessage(res.data.error || 'Could not join.');
        return;
      }
      await load();
      await openGroup(groupId);
    } catch {
      setMessage('Could not join.');
    }
  }

  async function leave(groupId: string) {
    setMessage(null);
    try {
      const res = await api.post<{ ok?: boolean; error?: string }>(`/api/social/group/${groupId}/leave`, {});
      if (res.data?.ok === false) {
        setMessage(res.data.error || 'Could not leave.');
        return;
      }
      setOpenId(null);
      await load();
    } catch {
      setMessage('Could not leave.');
    }
  }

  async function publish() {
    if (!openId || !draft.trim()) return;
    setMessage(null);
    try {
      const res = await api.post<{ ok?: boolean; error?: string }>(`/api/social/group/${openId}/post`, { content: draft });
      if (res.data?.ok === false) {
        setMessage(res.data.error || 'Could not post.');
        return;
      }
      setDraft('');
      await openGroup(openId);
    } catch {
      setMessage('Could not post.');
    }
  }

  async function setRole(userId: string, role: string) {
    if (!openId) return;
    setMessage(null);
    try {
      const res = await api.post<{ ok?: boolean; error?: string }>(`/api/social/group/${openId}/role`, { userId, role });
      if (res.data?.ok === false) {
        setMessage(res.data.error || 'Could not change that role.');
        return;
      }
      await openGroup(openId);
    } catch {
      setMessage('Could not change that role.');
    }
  }

  const mine = members.find((member) => member.userId === currentUserId);
  const open = groups.find((group) => group.groupId === openId);

  return (
    <section className="rounded-2xl border border-white/10 bg-[#111] p-3 text-sm">
      <h2 className="mb-2 text-xs text-zinc-400">Groups</h2>
      <div className="mb-2 flex gap-1">
        <input
          aria-label="Group name"
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 60))}
          className="flex-1 rounded bg-zinc-900 px-2 py-1 text-zinc-100"
        />
        <select
          aria-label="Group visibility"
          value={visibility}
          onChange={(e) => setVisibility(e.target.value === 'private' ? 'private' : 'public')}
          className="rounded bg-zinc-900 px-2 py-1 text-zinc-100"
        >
          <option value="public">Public</option>
          <option value="private">Private</option>
        </select>
        <button type="button" onClick={() => void createGroup()} className="rounded bg-teal-400 px-2 py-1 text-xs font-medium text-black">
          Create
        </button>
      </div>
      <ul className="space-y-1">
        {groups.map((group) => (
          <li key={group.groupId} className="flex items-center gap-2 text-xs text-zinc-300">
            <button type="button" onClick={() => void openGroup(group.groupId)} className="truncate text-left hover:text-zinc-100">
              {group.name}
            </button>
            <span className="text-zinc-500">{group.visibility === 'private' ? 'private' : 'public'}</span>
            {group.isMember ? (
              <button type="button" onClick={() => void leave(group.groupId)} className="ml-auto text-zinc-400">Leave</button>
            ) : (
              <button type="button" onClick={() => void join(group.groupId)} className="ml-auto text-teal-300">Join</button>
            )}
          </li>
        ))}
      </ul>
      {open && (
        <div className="mt-2 border-t border-white/10 pt-2">
          <p className="text-xs text-zinc-400">{open.name}</p>
          <ul className="my-1 space-y-1">
            {posts.map((post) => (
              <li key={post.postId} className="text-xs text-zinc-300">{post.content}</li>
            ))}
          </ul>
          {open.isMember && (
            <div className="flex gap-1">
              <input
                aria-label="Group post"
                value={draft}
                onChange={(e) => setDraft(e.target.value.slice(0, 2000))}
                className="flex-1 rounded bg-zinc-900 px-2 py-1 text-xs text-zinc-100"
              />
              <button type="button" onClick={() => void publish()} className="rounded bg-white/10 px-2 py-1 text-xs">Post</button>
            </div>
          )}
          {mine?.role === 'admin' && members.map((member) => (
            <label key={member.userId} className="mt-1 flex items-center gap-2 text-[11px] text-zinc-400">
              {member.userId}
              <select
                aria-label={`Role for ${member.userId}`}
                value={member.role}
                onChange={(e) => void setRole(member.userId, e.target.value)}
                className="rounded bg-zinc-900 px-1 py-0.5"
              >
                <option value="member">member</option>
                <option value="mod">mod</option>
                <option value="admin">admin</option>
              </select>
            </label>
          ))}
        </div>
      )}
      {message && <p className="mt-2 text-[11px] text-zinc-400">{message}</p>}
    </section>
  );
}
