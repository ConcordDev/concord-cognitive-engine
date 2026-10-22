'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api/client';

const NOTE_TYPES = ['comment', 'mention', 'share', 'repost', 'dm', 'message_request'] as const;

/** Interests, who can DM, read receipts, and which notifications to keep. */
export function SocialPreferencesForm() {
  const [topics, setTopics] = useState<string[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [dmPolicy, setDmPolicy] = useState<'everyone' | 'followers' | 'nobody'>('everyone');
  const [readReceipts, setReadReceipts] = useState(true);
  const [notes, setNotes] = useState<Record<string, boolean>>({
    comment: true, mention: true, share: true, repost: true, dm: true, message_request: true,
  });
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    void api.get<{ topics?: Array<{ tag?: string }> }>('/api/social/topics/trending')
      .then((res) => {
        if (cancel) return;
        const tags = (res.data?.topics || [])
          .map((row) => String(row.tag || '').replace(/^#/, '').trim().toLowerCase())
          .filter(Boolean);
        setTopics([...new Set(tags)].slice(0, 12));
      })
      .catch(() => { if (!cancel) setTopics([]); });
    return () => { cancel = true; };
  }, []);

  function toggleTopic(tag: string) {
    setPicked((current) => current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag]);
  }

  async function save() {
    setMessage(null);
    try {
      const res = await api.post('/api/social/preferences', {
        interests: picked,
        dmPolicy,
        readReceipts,
        notificationTypes: notes,
      });
      if (res.data?.ok === false) {
        setMessage(res.data.error || 'Could not save settings.');
        return;
      }
      const saved = (res.data?.interests || picked) as string[];
      setPicked(saved);
      setMessage(saved.length ? `Saved topics: ${saved.join(', ')}` : 'Settings saved.');
    } catch {
      setMessage('Could not save settings.');
    }
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-[#111] p-3 text-sm">
      <h2 className="mb-2 text-xs text-zinc-400">Interests and privacy</h2>
      {topics.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {topics.map((tag) => (
            <button
              key={tag}
              type="button"
              aria-pressed={picked.includes(tag)}
              onClick={() => toggleTopic(tag)}
              className={`rounded-full px-2 py-0.5 text-xs ${picked.includes(tag) ? 'bg-teal-400 text-black' : 'bg-white/5 text-zinc-300'}`}
            >
              #{tag}
            </button>
          ))}
        </div>
      )}
      <label className="mb-2 block text-xs text-zinc-400">
        Who can message me
        <select
          aria-label="Who can message me"
          value={dmPolicy}
          onChange={(e) => setDmPolicy(e.target.value as 'everyone' | 'followers' | 'nobody')}
          className="mt-1 block w-full rounded bg-zinc-900 px-2 py-1 text-zinc-100"
        >
          <option value="everyone">Everyone</option>
          <option value="followers">People I follow</option>
          <option value="nobody">Nobody</option>
        </select>
      </label>
      <label className="mb-2 flex items-center gap-2 text-xs text-zinc-300">
        <input
          type="checkbox"
          checked={readReceipts}
          onChange={(e) => setReadReceipts(e.target.checked)}
        />
        Send read receipts
      </label>
      <fieldset className="mb-2">
        <legend className="mb-1 text-xs text-zinc-400">Notifications</legend>
        {NOTE_TYPES.map((type) => (
          <label key={type} className="mr-3 inline-flex items-center gap-1 text-xs text-zinc-300">
            <input
              type="checkbox"
              checked={notes[type] !== false}
              onChange={(e) => setNotes((current) => ({ ...current, [type]: e.target.checked }))}
            />
            {type}
          </label>
        ))}
      </fieldset>
      <label className="mb-2 block text-xs text-zinc-400">
        Default feed
        <select
          aria-label="Default feed"
          className="mt-1 block w-full rounded bg-zinc-900 px-2 py-1 text-zinc-100"
          defaultValue="following"
          onChange={(e) => {
            void api.post('/api/social/feed/preference', { feedDefault: e.target.value }).then((res) => {
              setMessage(res.data?.ok === false ? (res.data.error || 'Could not save the default feed.') : 'Default feed saved.');
            }).catch(() => setMessage('Could not save the default feed.'));
          }}
        >
          <option value="following">Following</option>
          <option value="forYou">For You</option>
        </select>
      </label>
      <button type="button" onClick={() => void save()} className="rounded bg-teal-400 px-3 py-1 text-xs font-medium text-black">
        Save settings
      </button>
      {message && <p className="mt-2 text-[11px] text-zinc-400">{message}</p>}
    </section>
  );
}
