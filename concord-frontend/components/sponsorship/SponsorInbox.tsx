'use client';

import { useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';

interface ThankYou { id: string; creatorId: string; creatorName: string; body: string; sentAt: number; read: boolean; }

export function SponsorInbox({ refreshKey }: { refreshKey: number }) {
  const [messages, setMessages] = useState<ThankYou[]>([]);
  const [unread, setUnread] = useState(0);
  // Creator-side compose form (for sponsored NPC-mentors who are real players).
  const [form, setForm] = useState({ toUserId: '', creatorId: '', body: '' });
  const [msg, setMsg] = useState<string | null>(null);

  const load = async () => {
    const r = await lensRun('sponsorship', 'list_messages', {});
    if (r.data?.ok && r.data.result) {
      setMessages(r.data.result.messages || []);
      setUnread(r.data.result.unread || 0);
    }
  };

  useEffect(() => { void load(); }, [refreshKey]);

  const markRead = async (id: string) => {
    const r = await lensRun('sponsorship', 'mark_message_read', { messageId: id });
    if (r.data?.ok) await load();
  };

  const sendThanks = async () => {
    if (!form.toUserId || !form.creatorId || !form.body.trim()) return;
    const r = await lensRun('sponsorship', 'send_thanks', form);
    if (r.data?.ok) {
      setMsg('Thank-you sent.');
      setForm({ toUserId: '', creatorId: '', body: '' });
      await load();
    } else {
      setMsg(`Failed: ${r.data?.error || 'unknown'}`);
    }
    window.setTimeout(() => setMsg(null), 4000);
  };

  return (
    <div className="space-y-4">
      <section>
        <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-wider mb-1.5">
          Messages from creators {unread > 0 && <span className="ml-1 text-amber-400">({unread} unread)</span>}
        </h3>
        {messages.length === 0 ? (
          <p className="text-[11px] text-zinc-600 italic">No messages from your sponsored creators yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {messages.map((m) => (
              <li
                key={m.id}
                className={`rounded-lg border px-3 py-2 text-sm ${m.read ? 'bg-zinc-950 border-zinc-800' : 'bg-amber-950/30 border-amber-700/40'}`}
              >
                <div className="flex justify-between items-baseline">
                  <p className="text-zinc-200 font-medium text-[12px]">{m.creatorName}</p>
                  <span className="text-[9px] text-zinc-600">{new Date(m.sentAt * 1000).toLocaleString()}</span>
                </div>
                <p className="text-[12px] text-zinc-300 mt-0.5">{m.body}</p>
                {!m.read && (
                  <button type="button" onClick={() => void markRead(m.id)}
                    className="mt-1 text-[10px] text-emerald-400 hover:text-emerald-300">Mark read</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bg-zinc-900/80 border border-emerald-800/50 rounded-xl p-3 space-y-2">
        <h3 className="text-xs font-bold text-emerald-300 uppercase tracking-wider">Send a thank-you (creator)</h3>
        <p className="text-[10px] text-zinc-500">As a sponsored NPC-mentor, thank one of your active sponsors.</p>
        {msg && <div className="bg-emerald-950/50 border border-emerald-700/50 text-emerald-200 px-2 py-1 rounded text-[11px]">{msg}</div>}
        <div className="flex flex-wrap gap-2">
          <input
            type="text" placeholder="Sponsor user id"
            value={form.toUserId}
            onChange={(e) => setForm({ ...form, toUserId: e.target.value })}
            className="flex-1 min-w-[120px] bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-[12px] text-zinc-100"
          />
          <input
            type="text" placeholder="Your creator id"
            value={form.creatorId}
            onChange={(e) => setForm({ ...form, creatorId: e.target.value })}
            className="flex-1 min-w-[120px] bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-[12px] text-zinc-100"
          />
        </div>
        <textarea
          placeholder="Your message…"
          value={form.body}
          onChange={(e) => setForm({ ...form, body: e.target.value })}
          rows={2}
          className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-[12px] text-zinc-100"
        />
        <button
          type="button" onClick={() => void sendThanks()}
          disabled={!form.toUserId || !form.creatorId || !form.body.trim()}
          className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-[12px] px-3 py-1.5 rounded focus:outline-none focus:ring-2 focus:ring-amber-500"
        >Send thank-you</button>
      </section>
    </div>
  );
}
