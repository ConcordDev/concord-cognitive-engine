'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield, Send, RefreshCw, Lock, Users, Plus, Timer, ShieldCheck,
  Fingerprint, KeyRound, EyeOff, Check, X, Loader2, MessageSquare,
  CircleDot, Radio,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { useSocket } from '@/hooks/useSocket';

// ── Wire shapes ──
interface Identity {
  anonId: string;
  alias: string;
  publicKey: string;
  fingerprint: string;
  createdAt: number;
  rotatedAt: number | null;
  verifiedPeerCount: number;
}
interface Peer {
  anonId: string;
  alias: string;
  fingerprint: string;
  verified: boolean;
}
interface ConversationSummary {
  conversationId: string;
  kind: 'direct' | 'group';
  title: string | null;
  members: { anonId: string; alias: string }[];
  memberCount: number;
  disappearDefaultSec: number;
  messageCount: number;
  lastActivityAt: number;
  lastSenderAnonId: string | null;
}
interface DecryptedMessage {
  id: string;
  fromAnonId: string | null;
  fromAlias: string | null;
  sealedSender: boolean;
  mine: boolean;
  content: string | null;
  decryptError: string | null;
  sentAt: number;
  expiresAt: number | null;
}
interface ConversationView {
  conversationId: string;
  kind: 'direct' | 'group';
  title: string | null;
  members: { anonId: string; alias: string }[];
  disappearDefaultSec: number;
  messages: DecryptedMessage[];
  messageCount: number;
  sweptExpired: number;
}

const DISAPPEAR_OPTIONS = [
  { label: 'Off', sec: 0 },
  { label: '30s', sec: 30 },
  { label: '5m', sec: 300 },
  { label: '1h', sec: 3600 },
  { label: '1d', sec: 86400 },
  { label: '1w', sec: 604800 },
];

function relTime(ms: number): string {
  const d = Date.now() - ms;
  if (d < 60000) return 'now';
  if (d < 3600000) return `${Math.floor(d / 60000)}m`;
  if (d < 86400000) return `${Math.floor(d / 3600000)}h`;
  return `${Math.floor(d / 86400000)}d`;
}

export function AnonMessenger() {
  const { on, off, isConnected } = useSocket({ autoConnect: true });

  const [identity, setIdentity] = useState<Identity | null>(null);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ConversationView | null>(null);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Composer flags
  const [sealedSender, setSealedSender] = useState(false);
  const [ephemeralOverride, setEphemeralOverride] = useState<number | null>(null);

  // New-conversation modal
  const [showNew, setShowNew] = useState(false);
  const [selectedPeers, setSelectedPeers] = useState<string[]>([]);
  const [groupTitle, setGroupTitle] = useState('');
  const [newDisappear, setNewDisappear] = useState(0);

  // Safety-number modal
  const [safety, setSafety] = useState<{
    peerAnonId: string; peerAlias: string; safetyNumber: string[]; verified: boolean;
  } | null>(null);

  const msgEndRef = useRef<HTMLDivElement | null>(null);

  // ── Loaders ──
  const loadIdentity = useCallback(async () => {
    const r = await lensRun('anon', 'identity', {});
    if (r.data?.ok) setIdentity(r.data.result as Identity);
  }, []);

  const loadDirectory = useCallback(async () => {
    const r = await lensRun('anon', 'directory', {});
    if (r.data?.ok) setPeers((r.data.result as any).peers || []);
  }, []);

  const loadConversations = useCallback(async () => {
    const r = await lensRun('anon', 'listConversations', {});
    if (r.data?.ok) setConversations((r.data.result as any).conversations || []);
  }, []);

  const openConversation = useCallback(async (cid: string) => {
    setActiveId(cid);
    const r = await lensRun('anon', 'readConversation', { conversationId: cid });
    if (r.data?.ok) {
      setActiveView(r.data.result as ConversationView);
    } else {
      setErr(r.data?.error || 'Failed to open conversation');
    }
  }, []);

  // Initial load.
  useEffect(() => {
    (async () => {
      await loadIdentity();
      await loadDirectory();
      await loadConversations();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll to newest message.
  useEffect(() => {
    msgEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeView?.messages.length]);

  // ── Real-time delivery: socket pushes instead of polling ──
  useEffect(() => {
    const onMessage = (payload: any) => {
      loadConversations();
      if (payload?.conversationId && payload.conversationId === activeId) {
        openConversation(payload.conversationId);
      }
    };
    const onConvCreated = () => loadConversations();
    on('anon:message', onMessage);
    on('anon:conversation-created', onConvCreated);
    return () => {
      off('anon:message', onMessage);
      off('anon:conversation-created', onConvCreated);
    };
  }, [activeId, on, off, loadConversations, openConversation]);

  // ── Actions ──
  const rotateIdentity = async () => {
    setRotating(true);
    setErr(null);
    const r = await lensRun('anon', 'rotateIdentity', {});
    if (r.data?.ok) {
      await loadIdentity();
      await loadConversations();
    } else {
      setErr(r.data?.error || 'Rotation failed');
    }
    setRotating(false);
  };

  const sendMessage = async () => {
    if (!draft.trim() || !activeId) return;
    setSending(true);
    setErr(null);
    const params: Record<string, unknown> = {
      conversationId: activeId,
      content: draft.trim(),
      sealedSender,
    };
    if (ephemeralOverride != null) params.ephemeralSec = ephemeralOverride;
    const r = await lensRun('anon', 'sendMessage', params);
    if (r.data?.ok) {
      setDraft('');
      await openConversation(activeId);
      await loadConversations();
    } else {
      setErr(r.data?.error || 'Send failed');
    }
    setSending(false);
  };

  const createConversation = async () => {
    if (selectedPeers.length === 0) return;
    setBusy(true);
    setErr(null);
    const r = await lensRun('anon', 'startConversation', {
      peerAnonIds: selectedPeers,
      title: selectedPeers.length > 1 ? groupTitle : undefined,
      disappearDefaultSec: newDisappear,
    });
    if (r.data?.ok) {
      setShowNew(false);
      setSelectedPeers([]);
      setGroupTitle('');
      setNewDisappear(0);
      await loadConversations();
      await openConversation((r.data.result as any).conversationId);
    } else {
      setErr(r.data?.error || 'Could not start conversation');
    }
    setBusy(false);
  };

  const changeDisappearing = async (sec: number) => {
    if (!activeId) return;
    setBusy(true);
    const r = await lensRun('anon', 'setDisappearing', {
      conversationId: activeId,
      disappearDefaultSec: sec,
    });
    if (r.data?.ok) {
      await openConversation(activeId);
      await loadConversations();
    } else {
      setErr(r.data?.error || 'Could not change timer');
    }
    setBusy(false);
  };

  const sweepNow = async () => {
    setBusy(true);
    await lensRun('anon', 'sweepEphemeral', {});
    await loadConversations();
    if (activeId) await openConversation(activeId);
    setBusy(false);
  };

  const openSafety = async (peerAnonId: string) => {
    const r = await lensRun('anon', 'safetyNumber', { peerAnonId });
    if (r.data?.ok) {
      setSafety(r.data.result as any);
    } else {
      setErr(r.data?.error || 'Could not compute safety number');
    }
  };

  const verifyPeer = async (peerAnonId: string, verified: boolean) => {
    const r = await lensRun('anon', 'verifyPeer', { peerAnonId, verified });
    if (r.data?.ok) {
      await loadDirectory();
      await loadIdentity();
      if (safety && safety.peerAnonId === peerAnonId) {
        setSafety({ ...safety, verified });
      }
    }
  };

  const peerName = (anonId: string) =>
    peers.find((p) => p.anonId === anonId)?.alias || anonId.slice(0, 12);

  return (
    <div className="space-y-4">
      {err && (
        <div className="flex items-center justify-between rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          <span>{err}</span>
          <button onClick={() => setErr(null)} aria-label="Dismiss error">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Identity bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
        <Fingerprint className="h-5 w-5 text-neon-purple" />
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-gray-400">Your pseudonym</p>
          <p className="truncate font-mono text-sm text-white">
            {identity?.alias || '…'}{' '}
            <span className="text-gray-400">· {identity?.anonId?.slice(0, 14) || ''}</span>
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="flex items-center gap-1 rounded bg-neon-green/10 px-2 py-1 text-[10px] text-neon-green">
            <KeyRound className="h-3 w-3" /> {identity?.fingerprint || '—'}
          </span>
          <span className="flex items-center gap-1 rounded bg-zinc-800 px-2 py-1 text-[10px] text-gray-300">
            <ShieldCheck className="h-3 w-3" /> {identity?.verifiedPeerCount ?? 0} verified
          </span>
          <span
            className={`flex items-center gap-1 rounded px-2 py-1 text-[10px] ${
              isConnected ? 'bg-neon-green/10 text-neon-green' : 'bg-zinc-800 text-gray-400'
            }`}
          >
            <Radio className="h-3 w-3" /> {isConnected ? 'live' : 'offline'}
          </span>
          <button
            onClick={rotateIdentity}
            disabled={rotating}
            className="flex items-center gap-1 rounded-lg border border-lattice-border bg-lattice-deep px-3 py-1.5 text-xs text-gray-200 hover:border-neon-purple/50 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${rotating ? 'animate-spin' : ''}`} />
            Rotate
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Conversation list */}
        <div className="space-y-3 lg:col-span-1">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
              <MessageSquare className="h-4 w-4 text-neon-blue" /> Conversations
            </h3>
            <button
              onClick={() => setShowNew(true)}
              className="flex items-center gap-1 rounded-lg bg-neon-blue/20 px-2 py-1 text-xs text-neon-blue hover:bg-neon-blue/30"
            >
              <Plus className="h-3.5 w-3.5" /> New
            </button>
          </div>
          <div className="space-y-1.5">
            {conversations.length === 0 && (
              <p className="rounded-lg border border-dashed border-zinc-800 px-3 py-6 text-center text-xs text-gray-400">
                No conversations. Start one with a peer.
              </p>
            )}
            {conversations.map((c) => (
              <button
                key={c.conversationId}
                onClick={() => openConversation(c.conversationId)}
                className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${
                  activeId === c.conversationId
                    ? 'border-neon-blue/60 bg-neon-blue/10'
                    : 'border-zinc-800 bg-zinc-950/40 hover:border-zinc-700'
                }`}
              >
                {c.kind === 'group' ? (
                  <Users className="h-4 w-4 flex-shrink-0 text-neon-purple" />
                ) : (
                  <CircleDot className="h-4 w-4 flex-shrink-0 text-neon-green" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-white">
                    {c.title ||
                      c.members
                        .filter((m) => m.anonId !== identity?.anonId)
                        .map((m) => m.alias)
                        .join(', ') ||
                      'Conversation'}
                  </p>
                  <p className="truncate text-[10px] text-gray-400">
                    {c.messageCount} msg
                    {c.disappearDefaultSec > 0 && ' · ⏱ disappearing'}
                  </p>
                </div>
                <span className="text-[10px] text-gray-400">{relTime(c.lastActivityAt)}</span>
              </button>
            ))}
          </div>

          {/* Peer directory */}
          <div className="space-y-2 pt-2">
            <h4 className="flex items-center gap-2 text-xs font-semibold text-gray-400">
              <Users className="h-3.5 w-3.5" /> Peer directory ({peers.length})
            </h4>
            {peers.length === 0 && (
              <p className="text-[10px] text-gray-400">No other pseudonyms online yet.</p>
            )}
            {peers.map((p) => (
              <div
                key={p.anonId}
                className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 px-2.5 py-1.5"
              >
                <Fingerprint className="h-3.5 w-3.5 text-gray-400" />
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-gray-200">
                  {p.alias}
                </span>
                {p.verified ? (
                  <span className="flex items-center gap-0.5 text-[10px] text-neon-green">
                    <ShieldCheck className="h-3 w-3" /> verified
                  </span>
                ) : (
                  <button
                    onClick={() => openSafety(p.anonId)}
                    className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-gray-300 hover:bg-zinc-700"
                  >
                    verify
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Active conversation */}
        <div className="lg:col-span-2">
          {!activeView ? (
            <div className="flex h-full min-h-[24rem] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-800 text-gray-400">
              <Lock className="h-8 w-8" />
              <p className="text-sm">Select or start a conversation</p>
              <p className="text-xs">Messages are X25519 + AES-256-GCM end-to-end encrypted</p>
            </div>
          ) : (
            <div className="flex h-full min-h-[24rem] flex-col rounded-xl border border-zinc-800 bg-zinc-950/60">
              {/* Conversation header */}
              <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-4 py-3">
                {activeView.kind === 'group' ? (
                  <Users className="h-4 w-4 text-neon-purple" />
                ) : (
                  <Shield className="h-4 w-4 text-neon-green" />
                )}
                <span className="text-sm font-semibold text-white">
                  {activeView.title ||
                    activeView.members
                      .filter((m) => m.anonId !== identity?.anonId)
                      .map((m) => m.alias)
                      .join(', ')}
                </span>
                <span className="flex items-center gap-1 rounded bg-neon-green/10 px-1.5 py-0.5 text-[10px] text-neon-green">
                  <Lock className="h-2.5 w-2.5" /> E2E
                </span>
                <div className="ml-auto flex items-center gap-2">
                  {/* Disappearing-message default */}
                  <div className="flex items-center gap-1">
                    <Timer className="h-3.5 w-3.5 text-neon-cyan" />
                    <select
                      value={activeView.disappearDefaultSec}
                      onChange={(e) => changeDisappearing(Number(e.target.value))}
                      disabled={busy}
                      className="rounded border border-lattice-border bg-lattice-deep px-1.5 py-1 text-[10px] text-gray-200"
                      aria-label="Disappearing message timer"
                    >
                      {DISAPPEAR_OPTIONS.map((o) => (
                        <option key={o.sec} value={o.sec}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    onClick={sweepNow}
                    disabled={busy}
                    className="rounded border border-lattice-border bg-lattice-deep px-2 py-1 text-[10px] text-gray-300 hover:border-neon-cyan/50 disabled:opacity-50"
                    title="Purge expired messages now"
                  >
                    Sweep
                  </button>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 space-y-2 overflow-y-auto p-4">
                {activeView.messages.length === 0 && (
                  <p className="py-8 text-center text-xs text-gray-400">
                    No messages yet — say something encrypted.
                  </p>
                )}
                {activeView.messages.map((m) => (
                  <motion.div
                    key={m.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-lg px-3 py-2 ${
                        m.mine
                          ? 'bg-neon-blue/20 text-white'
                          : 'bg-zinc-800/80 text-gray-100'
                      }`}
                    >
                      {!m.mine && (
                        <p className="mb-0.5 text-[10px] text-gray-400">
                          {m.sealedSender ? (
                            <span className="flex items-center gap-1">
                              <EyeOff className="h-2.5 w-2.5" /> sealed sender
                            </span>
                          ) : (
                            m.fromAlias || peerName(m.fromAnonId || '')
                          )}
                        </p>
                      )}
                      <p className="text-sm">
                        {m.content ?? (
                          <span className="italic text-red-400">
                            [decrypt failed: {m.decryptError}]
                          </span>
                        )}
                      </p>
                      <div className="mt-1 flex items-center gap-2 text-[10px] text-gray-400">
                        <span>{new Date(m.sentAt).toLocaleTimeString()}</span>
                        <Lock className="h-2.5 w-2.5 text-neon-green" />
                        {m.expiresAt && (
                          <span className="flex items-center gap-0.5 text-neon-pink">
                            <Timer className="h-2.5 w-2.5" /> {relTime(m.expiresAt)}
                          </span>
                        )}
                      </div>
                    </div>
                  </motion.div>
                ))}
                <div ref={msgEndRef} />
              </div>

              {/* Composer */}
              <div className="space-y-2 border-t border-zinc-800 p-3">
                <div className="flex items-center gap-3 text-[10px] text-gray-400">
                  <label className="flex cursor-pointer items-center gap-1">
                    <input
                      type="checkbox"
                      checked={sealedSender}
                      onChange={(e) => setSealedSender(e.target.checked)}
                      className="rounded border-lattice-border bg-lattice-deep"
                    />
                    <EyeOff className="h-3 w-3" /> Sealed sender
                  </label>
                  <label className="flex items-center gap-1">
                    <Timer className="h-3 w-3" /> Ephemeral:
                    <select
                      value={ephemeralOverride ?? ''}
                      onChange={(e) =>
                        setEphemeralOverride(e.target.value === '' ? null : Number(e.target.value))
                      }
                      className="rounded border border-lattice-border bg-lattice-deep px-1 py-0.5 text-[10px] text-gray-200"
                      aria-label="Ephemeral timer for this message"
                    >
                      <option value="">conv. default</option>
                      {DISAPPEAR_OPTIONS.map((o) => (
                        <option key={o.sec} value={o.sec}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="flex items-end gap-2">
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        sendMessage();
                      }
                    }}
                    placeholder="Encrypted message…"
                    rows={2}
                    className="input-lattice flex-1 resize-none text-sm"
                  />
                  <button
                    onClick={sendMessage}
                    disabled={sending || !draft.trim()}
                    className="btn-neon flex items-center gap-1.5"
                  >
                    {sending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    Send
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* New-conversation modal */}
      <AnimatePresence>
        {showNew && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
            onClick={() => setShowNew(false)}
          >
            <motion.div
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 10 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md space-y-3 rounded-xl border border-zinc-800 bg-zinc-950 p-5"
            >
              <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
                <Plus className="h-4 w-4 text-neon-blue" /> Start conversation
              </h3>
              <p className="text-xs text-gray-400">
                Pick one peer for a direct message, or several for a group.
              </p>
              <div className="max-h-48 space-y-1.5 overflow-y-auto">
                {peers.length === 0 && (
                  <p className="text-xs text-gray-400">No peers available.</p>
                )}
                {peers.map((p) => {
                  const sel = selectedPeers.includes(p.anonId);
                  return (
                    <button
                      key={p.anonId}
                      onClick={() =>
                        setSelectedPeers((prev) =>
                          sel ? prev.filter((x) => x !== p.anonId) : [...prev, p.anonId],
                        )
                      }
                      className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left ${
                        sel
                          ? 'border-neon-blue/60 bg-neon-blue/10'
                          : 'border-zinc-800 bg-zinc-950/40'
                      }`}
                    >
                      <span
                        className={`flex h-4 w-4 items-center justify-center rounded border ${
                          sel ? 'border-neon-blue bg-neon-blue/30' : 'border-zinc-600'
                        }`}
                      >
                        {sel && <Check className="h-3 w-3 text-neon-blue" />}
                      </span>
                      <span className="flex-1 truncate font-mono text-xs text-gray-200">
                        {p.alias}
                      </span>
                      {p.verified && <ShieldCheck className="h-3.5 w-3.5 text-neon-green" />}
                    </button>
                  );
                })}
              </div>
              {selectedPeers.length > 1 && (
                <input
                  value={groupTitle}
                  onChange={(e) => setGroupTitle(e.target.value)}
                  placeholder="Group name (optional)"
                  className="input-lattice text-sm"
                />
              )}
              <div className="flex items-center gap-2">
                <Timer className="h-3.5 w-3.5 text-neon-cyan" />
                <span className="text-xs text-gray-400">Disappearing default:</span>
                <select
                  value={newDisappear}
                  onChange={(e) => setNewDisappear(Number(e.target.value))}
                  className="rounded border border-lattice-border bg-lattice-deep px-2 py-1 text-xs text-gray-200"
                  aria-label="Default disappearing timer"
                >
                  {DISAPPEAR_OPTIONS.map((o) => (
                    <option key={o.sec} value={o.sec}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={() => setShowNew(false)}
                  className="rounded-lg border border-lattice-border px-3 py-1.5 text-xs text-gray-300"
                >
                  Cancel
                </button>
                <button
                  onClick={createConversation}
                  disabled={busy || selectedPeers.length === 0}
                  className="btn-neon flex items-center gap-1.5 text-xs disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  Start
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Safety-number modal */}
      <AnimatePresence>
        {safety && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
            onClick={() => setSafety(null)}
          >
            <motion.div
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 10 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md space-y-4 rounded-xl border border-zinc-800 bg-zinc-950 p-5"
            >
              <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
                <ShieldCheck className="h-4 w-4 text-neon-green" /> Safety number ·{' '}
                <span className="font-mono text-gray-400">{safety.peerAlias}</span>
              </h3>
              <p className="text-xs text-gray-400">
                Compare these 12 groups with your peer out-of-band. A match proves no
                man-in-the-middle on the X25519 key exchange.
              </p>
              <div className="grid grid-cols-3 gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
                {safety.safetyNumber.map((g, i) => (
                  <span key={i} className="text-center font-mono text-sm tracking-wider text-neon-green">
                    {g}
                  </span>
                ))}
              </div>
              <div className="flex items-center justify-between">
                <span
                  className={`flex items-center gap-1 text-xs ${
                    safety.verified ? 'text-neon-green' : 'text-gray-400'
                  }`}
                >
                  {safety.verified ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                  {safety.verified ? 'Verified' : 'Not verified'}
                </span>
                <div className="flex gap-2">
                  {safety.verified ? (
                    <button
                      onClick={() => verifyPeer(safety.peerAnonId, false)}
                      className="rounded-lg border border-lattice-border px-3 py-1.5 text-xs text-gray-300"
                    >
                      Revoke
                    </button>
                  ) : (
                    <button
                      onClick={() => verifyPeer(safety.peerAnonId, true)}
                      className="btn-neon text-xs"
                    >
                      Mark verified
                    </button>
                  )}
                  <button
                    onClick={() => setSafety(null)}
                    className="rounded-lg border border-lattice-border px-3 py-1.5 text-xs text-gray-300"
                  >
                    Close
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
