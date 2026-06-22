'use client';

/**
 * ConcordLinkPanel — player-facing UI for cross-world messaging.
 *
 * Renders three tabs:
 *   - Inbox    list of received messages, mark read on click
 *   - Compose  send a message; pulls cost preview live; rejects on
 *              insufficient sparks with a clear inline error
 *   - Anchors  read-only display of the user's current world's anchors
 *
 * Mounts as a slide-in panel from the right edge. Driven by a
 * `concordia:concord-link-toggle` window event so any nearby UI surface
 * (a HUD button, an /inbox link, a key bind) can pop it open.
 *
 * Realtime: subscribes to 'concord-link:message' and prepends new arrivals
 * + fires a notification SFX + a small unread-count badge.
 *
 * Currency: every cost is denominated in sparks. The compose pane fetches
 * GET /api/concord-link/cost on every relevant field change and shows
 * "X sparks" inline. There is no real-money charge anywhere.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { subscribe } from '@/lib/realtime/socket';
import { useUIStore } from '@/store/ui';

interface InboxMessage {
  id: string;
  sender_id: string;
  sender_kind: string;
  source_world: string;
  dest_world: string;
  message_type: string;
  payload: string;
  encryption_level: string;
  cost_paid: number;
  cost_currency: string | null;
  emotional_weight: number;
  status: string;
  corruption_note: string | null;
  sent_at: number;
  delivered_at: number | null;
  read_at: number | null;
}

interface AnchorRow {
  id: string;
  world_id: string;
  name: string;
  access_method: string;
  description: string;
  controlled_by_faction: string | null;
  stability: number;
}

interface CostPreview {
  ok: boolean;
  cost?: number;
  base?: number;
  multiplier?: number;
  sameWorldDiscount?: boolean;
  encryptionMultiplier?: number;
}

interface WalkerRow {
  id: string;
  npc_id: string;
  home_world: string;
  current_world: string;
  status: string;
  reputation: number;
}

const MESSAGE_TYPES = ['text', 'voice', 'data', 'dream', 'echo', 'physical', 'broadcast'] as const;
const ENCRYPTION_LEVELS = ['none', 'basic', 'high', 'shadow'] as const;

const fmtTime = (epochSec: number) => {
  const d = new Date(epochSec * 1000);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleDateString();
};

export function ConcordLinkPanel({ myUserId: _myUserId }: { myUserId: string }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'inbox' | 'compose' | 'anchors' | 'walkers' | 'forge'>('inbox');
  // WAVE L1 — Forge tab: a dead-simple skill on-ramp through the Link.
  const [forgeElement, setForgeElement] = useState('fire');
  const [forgeIntent, setForgeIntent] = useState('bolt');
  const [forgeName, setForgeName] = useState('');
  const [forgeResult, setForgeResult] = useState<string | null>(null);
  const [inbox, setInbox] = useState<InboxMessage[]>([]);
  const [unread, setUnread] = useState(0);
  const [currentWorld, setCurrentWorld] = useState('concordia');
  const [anchors, setAnchors] = useState<AnchorRow[]>([]);
  const [walkers, setWalkers] = useState<WalkerRow[]>([]);

  const [composeReceiver, setComposeReceiver] = useState('');
  const [composeDest, setComposeDest] = useState('concordia');
  const [composeType, setComposeType] = useState<typeof MESSAGE_TYPES[number]>('text');
  const [composeEncryption, setComposeEncryption] = useState<typeof ENCRYPTION_LEVELS[number]>('basic');
  const [composeBody, setComposeBody] = useState('');
  const [composeWeight, setComposeWeight] = useState(0);
  const [costPreview, setCostPreview] = useState<CostPreview | null>(null);
  const [sending, setSending] = useState(false);
  const [composeError, setComposeError] = useState<string | null>(null);

  // ── Toggle via window event ────────────────────────────────────────────
  useEffect(() => {
    const onToggle = () => setOpen((v) => !v);
    window.addEventListener('concordia:concord-link-toggle', onToggle);
    return () => window.removeEventListener('concordia:concord-link-toggle', onToggle);
  }, []);

  // ── Load current world + inbox + anchors when opened ───────────────────
  const reload = useCallback(async () => {
    try {
      const meRes = await fetch('/api/world-travel/me', { credentials: 'same-origin' });
      if (meRes.ok) {
        const json = await meRes.json();
        if (json?.currentWorld) setCurrentWorld(json.currentWorld);
      }
    } catch { /* default keeps */ }

    try {
      const inboxRes = await fetch('/api/concord-link/inbox', { credentials: 'same-origin' });
      if (inboxRes.ok) {
        const json = await inboxRes.json();
        if (Array.isArray(json?.messages)) {
          setInbox(json.messages);
          setUnread(json.messages.filter((m: InboxMessage) => m.read_at == null).length);
        }
      }
    } catch { /* keep last */ }
  }, []);

  useEffect(() => {
    if (open) reload();
  }, [open, reload]);

  // Load anchors for the current world whenever it changes
  useEffect(() => {
    if (!currentWorld) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/concord-link/anchors/${encodeURIComponent(currentWorld)}`);
        if (!res.ok || cancelled) return;
        const json = await res.json();
        if (Array.isArray(json?.anchors)) setAnchors(json.anchors);
      } catch { /* network errors silent */ }
    })();
    return () => { cancelled = true; };
  }, [currentWorld]);

  // Load walkers when the tab opens or world changes
  useEffect(() => {
    if (tab !== 'walkers' || !currentWorld) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/concord-link/walkers?homeWorld=${encodeURIComponent(currentWorld)}`);
        if (!res.ok || cancelled) return;
        const json = await res.json();
        if (Array.isArray(json?.walkers)) setWalkers(json.walkers);
      } catch { /* network errors silent */ }
    })();
    return () => { cancelled = true; };
  }, [tab, currentWorld]);

  // ── Realtime: prepend new messages + raise unread + sfx ───────────────
  useEffect(() => {
    const off = subscribe<{ messageId: string; senderId: string; sourceWorld: string; payload: string; messageType: string; emotionalWeight: number; encryption: string; ts: string }>(
      'concord-link:message',
      (msg) => {
        const synth: InboxMessage = {
          id: msg.messageId,
          sender_id: msg.senderId,
          sender_kind: 'user',
          source_world: msg.sourceWorld,
          dest_world: currentWorld,
          message_type: msg.messageType,
          payload: msg.payload,
          encryption_level: msg.encryption,
          cost_paid: 0,
          cost_currency: 'sparks',
          emotional_weight: msg.emotionalWeight,
          status: 'delivered',
          corruption_note: null,
          sent_at: Math.floor(new Date(msg.ts).getTime() / 1000),
          delivered_at: Math.floor(new Date(msg.ts).getTime() / 1000),
          read_at: null,
        };
        setInbox((prev) => [synth, ...prev].slice(0, 200));
        setUnread((c) => c + 1);
        try {
          window.dispatchEvent(new CustomEvent('concordia:soundscape-command', {
            detail: { action: 'triggerSFX', sfxId: 'notification' },
          }));
        } catch { /* sfx best-effort */ }
        try {
          useUIStore.getState().addToast({
            type: 'info',
            message: `Concord Link: new message from ${msg.senderId.slice(0, 8)}`,
            duration: 6000,
          });
        } catch { /* toast best-effort */ }
      },
    );
    return off;
  }, [currentWorld]);

  // ── Cost preview (debounced via key dep) ───────────────────────────────
  useEffect(() => {
    if (tab !== 'compose') return;
    let cancelled = false;
    (async () => {
      try {
        const url = `/api/concord-link/cost?messageType=${encodeURIComponent(composeType)}&sourceWorld=${encodeURIComponent(currentWorld)}&destWorld=${encodeURIComponent(composeDest)}&encryption=${encodeURIComponent(composeEncryption)}`;
        const res = await fetch(url);
        if (!res.ok || cancelled) return;
        const json: CostPreview = await res.json();
        if (json.ok) setCostPreview(json);
      } catch { /* keep last */ }
    })();
    return () => { cancelled = true; };
  }, [tab, composeType, composeEncryption, composeDest, currentWorld]);

  // ── Mark read on click ─────────────────────────────────────────────────
  const markRead = useCallback(async (m: InboxMessage) => {
    if (m.read_at) return;
    try {
      await fetch(`/api/concord-link/${encodeURIComponent(m.id)}/read`, {
        method: 'POST',
        credentials: 'same-origin',
      });
      setInbox((prev) => prev.map((x) => x.id === m.id ? { ...x, read_at: Math.floor(Date.now() / 1000) } : x));
      setUnread((c) => Math.max(0, c - 1));
    } catch { /* best-effort */ }
  }, []);

  // ── Send ───────────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    setComposeError(null);
    if (!composeReceiver.trim() || !composeBody.trim()) {
      setComposeError('Recipient and message body required.');
      return;
    }
    setSending(true);
    try {
      const res = await fetch('/api/concord-link/send', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receiverId: composeReceiver.trim(),
          receiverKind: 'user',
          sourceWorld: currentWorld,
          destWorld: composeDest,
          messageType: composeType,
          payload: composeBody.trim(),
          encryption: composeEncryption,
          emotionalWeight: composeWeight,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        if (json.reason && /^insufficient_sparks/.test(json.reason)) {
          const m = json.reason.match(/have_(\d+)_need_(\d+)/);
          setComposeError(m ? `Need ${m[2]} sparks; you have ${m[1]}.` : 'Not enough sparks for this message.');
        } else if (json.reason === 'shadow_burn_cooldown') {
          const sec = Math.ceil((json.cooldownRemaining || 0) / 1000);
          setComposeError(`Shadow Burn cooldown: ${sec}s remaining.`);
        } else {
          setComposeError(json.reason || json.error || 'Send failed.');
        }
        return;
      }
      // Success
      try {
        useUIStore.getState().addToast({
          type: 'success',
          message: `Message sent (${json.cost} sparks${json.corrupted ? ' — corrupted in transit' : ''})`,
          duration: 4500,
        });
      } catch { /* toast best-effort */ }
      setComposeBody('');
      setComposeError(null);
    } catch (e: unknown) {
      setComposeError(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setSending(false);
    }
  }, [composeReceiver, composeBody, currentWorld, composeDest, composeType, composeEncryption, composeWeight]);

  const doForge = useCallback(async () => {
    setForgeResult('Forging…');
    try {
      const res = await fetch('/api/lens/run', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: 'skill_forge', name: 'quick', input: { element: forgeElement, intent: forgeIntent, name: forgeName || undefined } }),
      });
      const json = await res.json();
      const r = json?.data?.result ?? json?.result ?? json;
      setForgeResult(r?.ok ? `✦ Forged "${forgeName || `${forgeElement} ${forgeIntent}`}" — ready to use in combat.` : `Forge failed: ${r?.reason || 'error'}`);
    } catch { setForgeResult('Forge failed.'); }
  }, [forgeElement, forgeIntent, forgeName]);

  const tabs = useMemo(() => ([
    { id: 'inbox' as const, label: 'Inbox', badge: unread },
    { id: 'compose' as const, label: 'Compose' },
    { id: 'anchors' as const, label: 'Anchors' },
    { id: 'walkers' as const, label: 'Walkers' },
    { id: 'forge' as const, label: 'Forge' },
  ]), [unread]);

  if (!open) {
    // Always render a tiny pill on screen so users can find it. No-op if hidden.
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed top-4 right-4 z-30 flex items-center gap-2 rounded-full border border-cyan-500/50 bg-slate-900/80 px-3 py-1.5 text-xs text-cyan-200 backdrop-blur-sm hover:bg-slate-800/80"
        aria-label="Open Concord Link"
      >
        <span className="font-medium">Link</span>
        {unread > 0 && (
          <span className="rounded-full bg-cyan-500 px-1.5 py-0.5 text-[10px] font-semibold text-slate-900">
            {unread}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-cyan-500/30 bg-slate-950/95 backdrop-blur-md">
      <header className="flex items-center justify-between border-b border-cyan-500/20 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-cyan-100">The Concord Link</h2>
          <p className="text-[10px] uppercase tracking-wider text-cyan-400/80">in {currentWorld}</p>
        </div>
        <button
          onClick={() => setOpen(false)}
          className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          aria-label="Close"
        >
          ×
        </button>
      </header>

      <nav className="flex border-b border-cyan-500/20">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`relative flex-1 px-3 py-2 text-xs font-medium transition-colors ${
              tab === t.id
                ? 'border-b-2 border-cyan-400 text-cyan-200'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {t.label}
            {t.id === 'inbox' && (t.badge ?? 0) > 0 && (
              <span className="ml-1.5 rounded-full bg-cyan-500 px-1.5 py-0.5 text-[9px] font-semibold text-slate-900">
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className="flex-1 overflow-y-auto p-3">
        {tab === 'inbox' && (
          <div className="space-y-2">
            {inbox.length === 0 ? (
              <p className="py-8 text-center text-xs text-slate-400">No messages yet.</p>
            ) : inbox.map((m) => (
              <button
                key={m.id}
                onClick={() => markRead(m)}
                className={`block w-full rounded border p-2 text-left transition-colors ${
                  m.read_at
                    ? 'border-slate-800 bg-slate-900/40 text-slate-400'
                    : 'border-cyan-500/40 bg-cyan-950/30 text-slate-100'
                } hover:border-cyan-400/60`}
              >
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <span className="truncate font-mono text-[10px] text-cyan-300">
                    {m.sender_id.slice(0, 12)}
                  </span>
                  <span className="text-[10px] text-slate-400">{fmtTime(m.sent_at)}</span>
                </div>
                <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-400">
                  {m.source_world} → {m.dest_world} · {m.message_type} · {m.encryption_level}
                  {m.status === 'corrupted' && (
                    <span className="ml-1 rounded bg-rose-700/40 px-1 text-rose-200">corrupted</span>
                  )}
                </div>
                <p className="truncate text-xs">{m.payload}</p>
                {m.corruption_note && (
                  <p className="mt-1 text-[10px] italic text-rose-300/80">{m.corruption_note}</p>
                )}
              </button>
            ))}
          </div>
        )}

        {tab === 'compose' && (
          <div className="space-y-3 text-xs">
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-wider text-cyan-400">Recipient (user id)</span>
              <input
                type="text"
                value={composeReceiver}
                onChange={(e) => setComposeReceiver(e.target.value)}
                className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-slate-100 focus:border-cyan-400 focus:outline-none"
                placeholder="user_abc123…"
              />
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label>
                <span className="mb-1 block text-[10px] uppercase tracking-wider text-cyan-400">From (your world)</span>
                <input
                  type="text"
                  value={currentWorld}
                  disabled
                  className="w-full rounded border border-slate-800 bg-slate-900/60 px-2 py-1.5 text-slate-300"
                />
              </label>
              <label>
                <span className="mb-1 block text-[10px] uppercase tracking-wider text-cyan-400">To (world)</span>
                <input
                  type="text"
                  value={composeDest}
                  onChange={(e) => setComposeDest(e.target.value)}
                  className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-slate-100 focus:border-cyan-400 focus:outline-none"
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label>
                <span className="mb-1 block text-[10px] uppercase tracking-wider text-cyan-400">Type</span>
                <select
                  value={composeType}
                  onChange={(e) => setComposeType(e.target.value as typeof MESSAGE_TYPES[number])}
                  className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-slate-100 focus:border-cyan-400 focus:outline-none"
                >
                  {MESSAGE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <label>
                <span className="mb-1 block text-[10px] uppercase tracking-wider text-cyan-400">Encryption</span>
                <select
                  value={composeEncryption}
                  onChange={(e) => setComposeEncryption(e.target.value as typeof ENCRYPTION_LEVELS[number])}
                  className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-slate-100 focus:border-cyan-400 focus:outline-none"
                >
                  {ENCRYPTION_LEVELS.map((e) => <option key={e} value={e}>{e}</option>)}
                </select>
              </label>
            </div>

            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-wider text-cyan-400">
                Emotional weight ({composeWeight.toFixed(2)})
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={composeWeight}
                onChange={(e) => setComposeWeight(Number(e.target.value))}
                className="w-full"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-wider text-cyan-400">Message</span>
              <textarea
                value={composeBody}
                onChange={(e) => setComposeBody(e.target.value)}
                rows={4}
                className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-slate-100 focus:border-cyan-400 focus:outline-none"
                placeholder="Speak across the Veil…"
              />
            </label>

            <div className="rounded border border-cyan-500/30 bg-slate-900/60 p-2">
              <div className="flex items-baseline justify-between">
                <span className="text-[10px] uppercase tracking-wider text-cyan-400">Cost</span>
                <span className="text-sm font-semibold text-cyan-200">
                  {costPreview?.cost ?? '—'} <span className="text-[10px] text-cyan-400">sparks</span>
                </span>
              </div>
              {costPreview?.sameWorldDiscount && (
                <p className="mt-0.5 text-[10px] text-cyan-300/80">Same-world discount applied (×0.3).</p>
              )}
              {costPreview && costPreview.encryptionMultiplier && costPreview.encryptionMultiplier > 1 && (
                <p className="mt-0.5 text-[10px] text-cyan-300/80">
                  Encryption multiplier ×{costPreview.encryptionMultiplier}.
                </p>
              )}
            </div>

            {composeError && (
              <div className="rounded border border-rose-500/40 bg-rose-950/40 px-2 py-1.5 text-[11px] text-rose-200">
                {composeError}
              </div>
            )}

            <button
              type="button"
              onClick={handleSend}
              disabled={sending}
              className="w-full rounded bg-cyan-600 px-3 py-2 text-sm font-medium text-slate-50 hover:bg-cyan-500 disabled:cursor-not-allowed disabled:bg-slate-700"
            >
              {sending ? 'Sending…' : `Send${costPreview?.cost ? ` (−${costPreview.cost} sparks)` : ''}`}
            </button>
            <p className="text-center text-[10px] text-slate-400">
              All Concord Link costs are paid in sparks. No real-money charges.
            </p>
          </div>
        )}

        {tab === 'anchors' && (
          <div className="space-y-2">
            <p className="mb-2 text-[10px] uppercase tracking-wider text-cyan-400">
              Anchor points in {currentWorld}
            </p>
            {anchors.length === 0 ? (
              <p className="py-8 text-center text-xs text-slate-400">No anchors registered for this world.</p>
            ) : anchors.map((a) => (
              <div key={a.id} className="rounded border border-slate-800 bg-slate-900/40 p-2">
                <div className="flex items-baseline justify-between gap-2">
                  <h4 className="text-xs font-semibold text-slate-100">{a.name}</h4>
                  <span className="text-[10px] text-cyan-300">stability {a.stability.toFixed(2)}</span>
                </div>
                <p className="mb-1 text-[10px] uppercase tracking-wider text-slate-400">
                  {a.access_method.replace(/_/g, ' ')}
                  {a.controlled_by_faction && ` · ${a.controlled_by_faction}`}
                </p>
                <p className="text-[11px] text-slate-300">{a.description}</p>
              </div>
            ))}
          </div>
        )}

        {tab === 'walkers' && (
          <div className="space-y-2">
            <p className="mb-2 text-[10px] uppercase tracking-wider text-cyan-400">
              Available walkers in {currentWorld}
            </p>
            <p className="mb-3 text-[10px] text-slate-400">
              Physical messages auto-dispatch the highest-reputation walker available
              when you press <span className="text-cyan-300">Send</span> in Compose.
              Walkers carry packages between worlds in real time; their journey
              advances every heartbeat tick (~15s). Reputation rises on delivery,
              falls on interception.
            </p>
            {walkers.length === 0 ? (
              <p className="py-8 text-center text-xs text-slate-400">
                No walkers currently available in this world.
              </p>
            ) : walkers.map((w) => (
              <div key={w.id} className="rounded border border-slate-800 bg-slate-900/40 p-2">
                <div className="flex items-baseline justify-between gap-2">
                  <h4 className="text-xs font-semibold text-slate-100">{w.npc_id}</h4>
                  <span className="text-[10px] text-cyan-300">rep {w.reputation}</span>
                </div>
                <p className="text-[10px] uppercase tracking-wider text-slate-400">
                  {w.status} · home {w.home_world} · here {w.current_world}
                </p>
              </div>
            ))}
          </div>
        )}

        {tab === 'forge' && (
          <div className="space-y-3">
            <p className="mb-1 text-[10px] uppercase tracking-wider text-cyan-400">
              Forge a power through the Link
            </p>
            <p className="mb-2 text-[10px] text-slate-400">
              Pick an element and a shape, name it, and the Link weaves you a usable
              power. It works in combat immediately — no materials, no menus. Power
              users can still open the advanced Glyph composer.
            </p>
            <label className="block text-[10px] uppercase tracking-wider text-slate-400">
              Element
              <select
                value={forgeElement}
                onChange={(e) => setForgeElement(e.target.value)}
                className="mt-1 w-full rounded border border-slate-700 bg-slate-900/60 px-2 py-1 text-xs text-slate-100"
              >
                {['fire', 'ice', 'water', 'lightning', 'bio', 'energy', 'physical', 'psychic', 'refusal'].map((el) => (
                  <option key={el} value={el}>{el}</option>
                ))}
              </select>
            </label>
            <label className="block text-[10px] uppercase tracking-wider text-slate-400">
              Shape
              <select
                value={forgeIntent}
                onChange={(e) => setForgeIntent(e.target.value)}
                className="mt-1 w-full rounded border border-slate-700 bg-slate-900/60 px-2 py-1 text-xs text-slate-100"
              >
                {['strike', 'bolt', 'ward', 'dash'].map((it) => (
                  <option key={it} value={it}>{it}</option>
                ))}
              </select>
            </label>
            <label className="block text-[10px] uppercase tracking-wider text-slate-400">
              Name <span className="text-slate-500">(optional)</span>
              <input
                value={forgeName}
                onChange={(e) => setForgeName(e.target.value)}
                placeholder={`${forgeElement} ${forgeIntent}`}
                className="mt-1 w-full rounded border border-slate-700 bg-slate-900/60 px-2 py-1 text-xs text-slate-100 placeholder:text-slate-400"
              />
            </label>
            <button
              type="button"
              onClick={() => void doForge()}
              className="w-full rounded border border-cyan-500/50 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200 hover:bg-cyan-500/20"
            >
              Forge
            </button>
            {forgeResult && (
              <p className="text-[11px] text-slate-200">{forgeResult}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
