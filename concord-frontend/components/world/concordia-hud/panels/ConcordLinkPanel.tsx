'use client';

/**
 * ConcordLinkPanel — cross-world communication panel mounted in PanelHost.
 *
 * Tabs:
 *   - Inbox    — list messages received by the auth'd user
 *   - Compose  — send a message to (receiverId, destWorld)
 *   - Anchors  — list anchor points reachable from the current world
 *
 * Wires existing /api/concord-link/{inbox,send,anchors/:worldId} routes.
 * Cost is previewed via GET /api/concord-link/cost before sending so the
 * player sees the wallet hit + Shadow Burn impact ahead of time.
 */

import { useCallback, useEffect, useState } from 'react';
import { useHUDContext } from '../HUDContextProvider';

interface InboxMessage {
  id: string;
  sender_id: string;
  source_world: string;
  dest_world: string;
  message_type: string;
  payload: string;
  emotional_weight: number;
  read_at: number | null;
  delivered_at: number;
}

interface AnchorRow {
  id: string;
  name: string;
  access_method?: string;
  stability?: number;
  controlled_by_faction?: string | null;
}

type Tab = 'inbox' | 'compose' | 'anchors';

export function ConcordLinkPanel() {
  const worldId = useHUDContext((s) => s.worldId);
  const [tab, setTab] = useState<Tab>('inbox');
  const [inbox, setInbox] = useState<InboxMessage[]>([]);
  const [anchors, setAnchors] = useState<AnchorRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [receiverId, setReceiverId] = useState('');
  const [destWorld, setDestWorld] = useState('');
  const [body, setBody] = useState('');
  const [costPreview, setCostPreview] = useState<number | null>(null);

  const fetchInbox = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/concord-link/inbox?limit=50');
      const j = await r.json();
      if (j.ok) setInbox(j.messages || []);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAnchors = useCallback(async (wId: string) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/concord-link/anchors/${encodeURIComponent(wId)}`);
      const j = await r.json();
      if (j.ok) setAnchors(j.anchors || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'inbox') fetchInbox();
    if (tab === 'anchors') fetchAnchors(worldId);
  }, [tab, worldId, fetchInbox, fetchAnchors]);

  // Cost preview — debounce on destWorld changes
  useEffect(() => {
    if (!destWorld) { setCostPreview(null); return; }
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/concord-link/cost?messageType=text&sourceWorld=${encodeURIComponent(worldId)}&destWorld=${encodeURIComponent(destWorld)}&encryption=basic`);
        const j = await r.json();
        if (j.ok && typeof j.cost === 'number') setCostPreview(j.cost);
      } catch { /* preview is best-effort */ }
    }, 250);
    return () => clearTimeout(t);
  }, [worldId, destWorld]);

  async function markRead(id: string) {
    try {
      await fetch(`/api/concord-link/${encodeURIComponent(id)}/read`, { method: 'POST' });
      setInbox((cur) => cur.map((m) => (m.id === id ? { ...m, read_at: Math.floor(Date.now() / 1000) } : m)));
    } catch { /* ignored */ }
  }

  async function submit() {
    if (!receiverId || !destWorld || !body) {
      setStatus('All fields required.');
      return;
    }
    setStatus('Sending…');
    try {
      const r = await fetch('/api/concord-link/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receiverId,
          sourceWorld: worldId,
          destWorld,
          messageType: 'text',
          payload: body,
          encryption: 'basic',
          emotionalWeight: 0.1,
        }),
      });
      const j = await r.json();
      if (j.ok) {
        setStatus(`Sent to ${receiverId} in ${destWorld}.`);
        setReceiverId(''); setDestWorld(''); setBody('');
      } else {
        setStatus(`Failed: ${j.reason || j.error || 'unknown'}`);
      }
    } catch (err) {
      setStatus(`Network error: ${err instanceof Error ? err.message : String(err)}`);
    }
    setTimeout(() => setStatus(null), 5000);
  }

  return (
    <div className="text-sm" data-testid="concord-link-panel">
      <p className="text-xs text-zinc-400 mb-2">
        Cross-world message routing via the Concordant Web. Source world is
        <span className="font-bold text-amber-200"> {worldId}</span>.
      </p>

      <div className="flex gap-1 mb-3 border-b border-zinc-800">
        {(['inbox', 'compose', 'anchors'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            data-tab={t}
            aria-pressed={tab === t}
            className={`px-3 py-1 text-xs font-medium rounded-t ${
              tab === t ? 'bg-zinc-800 text-amber-200' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {status && (
        <div role="status" aria-live="polite" className="mb-2 bg-amber-950/50 border border-amber-700/50 text-amber-200 px-3 py-1.5 rounded text-xs">{status}</div>
      )}

      {tab === 'inbox' && (
        <div className="space-y-1.5 max-h-[24rem] overflow-auto">
          {loading && <p className="text-xs text-zinc-500">Loading…</p>}
          {!loading && inbox.length === 0 && (
            <p className="text-xs text-zinc-500 italic">Inbox empty. Send a message via the Compose tab.</p>
          )}
          {inbox.map((m) => (
            <div
              key={m.id}
              data-message-id={m.id}
              className={`p-2 rounded border ${m.read_at ? 'bg-zinc-900/40 border-zinc-800' : 'bg-amber-950/30 border-amber-800/60'}`}
            >
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[10px] font-mono text-zinc-400">{m.sender_id}</span>
                <span className="text-[10px] font-mono text-zinc-500">{m.source_world}</span>
              </div>
              <p className="text-xs text-zinc-200 break-words">{m.payload}</p>
              {!m.read_at && (
                <button
                  type="button"
                  onClick={() => markRead(m.id)}
                  className="mt-1 text-[10px] text-amber-300 hover:text-amber-100"
                  aria-label={`Mark message ${m.id} read`}
                >
                  Mark read
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === 'compose' && (
        <div className="space-y-2">
          <label className="block">
            <span className="block text-[10px] text-zinc-500 mb-0.5">Receiver (user id)</span>
            <input
              type="text"
              value={receiverId}
              onChange={(e) => setReceiverId(e.target.value)}
              aria-label="Receiver"
              placeholder="user_xxx"
              className="w-full bg-zinc-800 border border-zinc-700 text-zinc-100 rounded px-2 py-1 text-xs"
            />
          </label>
          <label className="block">
            <span className="block text-[10px] text-zinc-500 mb-0.5">Destination world</span>
            <input
              type="text"
              value={destWorld}
              onChange={(e) => setDestWorld(e.target.value)}
              aria-label="Destination world"
              placeholder="tunya"
              className="w-full bg-zinc-800 border border-zinc-700 text-zinc-100 rounded px-2 py-1 text-xs"
            />
          </label>
          <label className="block">
            <span className="block text-[10px] text-zinc-500 mb-0.5">Message</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              aria-label="Message body"
              rows={4}
              className="w-full bg-zinc-800 border border-zinc-700 text-zinc-100 rounded px-2 py-1 text-xs resize-none"
            />
          </label>
          {costPreview !== null && (
            <p className="text-[10px] font-mono text-zinc-500">Cost: <span className="text-amber-300">{costPreview} CC</span></p>
          )}
          <button
            type="button"
            onClick={submit}
            aria-label="Send message"
            className="w-full text-xs px-3 py-1.5 rounded bg-amber-700 hover:bg-amber-600 text-white font-medium"
          >
            Send
          </button>
        </div>
      )}

      {tab === 'anchors' && (
        <div className="space-y-1.5 max-h-[24rem] overflow-auto">
          {loading && <p className="text-xs text-zinc-500">Loading…</p>}
          {!loading && anchors.length === 0 && (
            <p className="text-xs text-zinc-500 italic">No anchors registered for {worldId}.</p>
          )}
          {anchors.map((a) => (
            <div key={a.id} data-anchor-id={a.id} className="p-2 rounded border bg-zinc-900/40 border-zinc-800">
              <div className="flex items-center justify-between mb-0.5">
                <span className="font-medium text-zinc-100">{a.name}</span>
                {typeof a.stability === 'number' && (
                  <span className="text-[10px] font-mono text-zinc-500">{Math.round(a.stability * 100)}%</span>
                )}
              </div>
              {a.access_method && (
                <p className="text-[10px] text-zinc-500">via {a.access_method}</p>
              )}
              {a.controlled_by_faction && (
                <p className="text-[10px] text-amber-300/70">controlled by {a.controlled_by_faction}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
