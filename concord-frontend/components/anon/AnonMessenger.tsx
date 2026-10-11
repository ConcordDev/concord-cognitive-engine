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
import { anonEncryptionNotice, claimEndToEnd } from '@/lib/anon/encryption-copy';
import {
  buildAnonSendPayload,
  buildIdentityParams,
  isAnonClientE2EFlagOn,
  loadOrCreateClientKey,
  openSealed,
  createClientKeyPair,
  writeStoredClientKey,
  sealEnvelopes,
  safetyNumberGroups,
  type ClientKeyMaterial,
} from '@/lib/anon/client-e2e';

// ── Wire shapes ──
interface Identity {
  anonId: string;
  alias: string;
  publicKey: string;
  fingerprint: string;
  keyCustody?: 'client' | 'server';
  createdAt: number;
  rotatedAt: number | null;
  verifiedPeerCount: number;
}
interface Peer {
  anonId: string;
  alias: string;
  fingerprint: string;
  publicKey?: string;
  keyCustody?: 'client' | 'server';
  verified: boolean;
}
interface ConversationSummary {
  conversationId: string;
  kind: 'direct' | 'group';
  title: string | null;
  members: MemberRef[];
  memberCount: number;
  disappearDefaultSec: number;
  messageCount: number;
  lastActivityAt: number;
  lastSenderAnonId: string | null;
}
interface MemberRef {
  anonId: string;
  alias: string;
  publicKey?: string;
  keyCustody?: 'client' | 'server';
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
  envelope?: { ciphertext: string; iv: string; tag: string } | null;
  senderPublicKey?: string;
  clientDecrypt?: boolean;
}
interface ConversationView {
  conversationId: string;
  kind: 'direct' | 'group';
  title: string | null;
  members: MemberRef[];
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
  // True only when this browser holds the private key the server has the
  // matching public key for. Server-held identities stay false so existing
  // conversations keep using the plaintext send path.
  const [clientHeld, setClientHeld] = useState(false);
  const [keyMismatch, setKeyMismatch] = useState(false);
  const localKeyRef = useRef<ClientKeyMaterial | null>(null);

  // Composer flags
  const [sealedSender, setSealedSender] = useState(false);
  const [ephemeralOverride, setEphemeralOverride] = useState<number | null>(null);

  // New-conversation modal
  const [showNew, setShowNew] = useState(false);
  useEffect(() => {
    const open = () => setShowNew(true);
    window.addEventListener('anon:new-conversation', open);
    return () => window.removeEventListener('anon:new-conversation', open);
  }, []);
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
    const flagOn = isAnonClientE2EFlagOn();
    let key: ClientKeyMaterial | null = null;
    if (flagOn) {
      try {
        key = await loadOrCreateClientKey();
        localKeyRef.current = key;
      } catch {
        // This browser cannot mint an X25519 key. Stay on the server-held
        // path instead of failing the whole messenger.
        key = null;
        localKeyRef.current = null;
      }
    }
    const r = await lensRun('anon', 'identity', buildIdentityParams(flagOn && !!key, key));
    if (r.data?.ok) {
      const ident = r.data.result as Identity;
      setIdentity(ident);
      const match = !!key && key.publicKeySpkiB64 === ident.publicKey;
      setClientHeld(flagOn && ident.keyCustody === 'client' && match);
      setKeyMismatch(flagOn && ident.keyCustody === 'client' && !match);
    }
  }, []);

  const loadDirectory = useCallback(async () => {
    const r = await lensRun('anon', 'directory', {});
    if (r.data?.ok) setPeers((r.data.result as any).peers || []);
  }, []);

  const loadConversations = useCallback(async () => {
    const r = await lensRun('anon', 'listConversations', {});
    if (r.data?.ok) setConversations((r.data.result as any).conversations || []);
  }, []);

  const decryptView = useCallback(async (view: ConversationView): Promise<ConversationView> => {
    const key = localKeyRef.current;
    if (!key) return view;
    const messages = await Promise.all(view.messages.map(async (m) => {
      if (m.content || !m.envelope || !m.senderPublicKey) return m;
      try {
        const content = await openSealed(key.privateKeyPkcs8B64, m.senderPublicKey, m.envelope);
        return { ...m, content, decryptError: null };
      } catch {
        return { ...m, decryptError: 'could not decrypt' };
      }
    }));
    return { ...view, messages };
  }, []);

  const openConversation = useCallback(async (cid: string) => {
    setActiveId(cid);
    const r = await lensRun('anon', 'readConversation', { conversationId: cid });
    if (r.data?.ok) {
      setActiveView(await decryptView(r.data.result as ConversationView));
    } else {
      setErr(r.data?.error || 'Failed to open conversation');
    }
  }, [decryptView]);

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
    // Server-held identities keep the historical server rotation so an
    // existing conversation's key is not swapped out from under it unless
    // this browser already holds (or lost) a client key.
    let params: Record<string, unknown> = {};
    if (isAnonClientE2EFlagOn() && (clientHeld || keyMismatch)) {
      const fresh = await createClientKeyPair();
      writeStoredClientKey(fresh);
      localKeyRef.current = fresh;
      params = { publicKey: fresh.publicKeySpkiB64 };
    }
    const r = await lensRun('anon', 'rotateIdentity', params);
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
    if (keyMismatch) {
      setErr('This browser does not hold the private key for this pseudonym.');
      return;
    }
    setSending(true);
    setErr(null);
    const text = draft.trim();
    try {
      let envelopes: Record<string, { ciphertext: string; iv: string; tag: string }> | null = null;
      if (clientHeld) {
        const key = localKeyRef.current;
        const members = activeView?.members || [];
        if (!key || members.some((m) => !m.publicKey)) {
          setErr('Missing device key or peer public key.');
          return;
        }
        envelopes = await sealEnvelopes(
          key.privateKeyPkcs8B64,
          members.map((m) => ({ anonId: m.anonId, publicKey: m.publicKey as string })),
          text,
        );
      }
      const params = buildAnonSendPayload({
        clientHeld,
        conversationId: activeId,
        draft: text,
        sealedSender,
        ephemeralSec: ephemeralOverride,
        envelopes,
      });
      const r = await lensRun('anon', 'sendMessage', params);
      if (r.data?.ok) {
        setDraft('');
        await openConversation(activeId);
        await loadConversations();
      } else {
        setErr(r.data?.error || 'Send failed');
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Send failed');
    } finally {
      setSending(false);
    }
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
    const peer = peers.find((p) => p.anonId === peerAnonId);
    const r = await lensRun('anon', 'safetyNumber', { peerAnonId });
    if (!r.data?.ok && !(clientHeld && identity?.publicKey && peer?.publicKey)) {
      setErr(r.data?.error || 'Could not compute safety number');
      return;
    }
    let groups: string[] = r.data?.ok ? (r.data.result as any).safetyNumber : [];
    if (clientHeld && identity?.publicKey && peer?.publicKey) {
      groups = await safetyNumberGroups(identity.publicKey, peer.publicKey);
    }
    setSafety({
      peerAnonId,
      peerAlias: peer?.alias || (r.data?.ok ? (r.data.result as any).peerAlias : peerAnonId),
      safetyNumber: groups,
      verified: r.data?.ok ? !!(r.data.result as any).verified : false,
    });
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

  const e2eClaim = claimEndToEnd({
    flagOn: isAnonClientE2EFlagOn(),
    myKeyCustody: clientHeld ? 'client' : 'server',
    members: activeView?.members || [],
  });
  const notice = anonEncryptionNotice(e2eClaim);
  const safetyPeer = safety ? peers.find((p) => p.anonId === safety.peerAnonId) : undefined;
  const safetyDeviceHeld = clientHeld && safetyPeer?.keyCustody === 'client';

  return (
    <div className="space-y-4">
      {keyMismatch && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          This browser does not hold the private key for this pseudonym. Rotate to mint a new device key. Older messages stay unreadable.
        </p>
      )}

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
            <div className="flex h-full min-h-[24rem] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-800 px-6 text-center text-gray-400">
              <Lock className="h-8 w-8" />
              <p className="text-sm">Select or start a conversation</p>
              <p className="max-w-md text-xs">{notice.body}</p>
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
                {notice.badge ? (
                  <span title={notice.body} className="flex items-center gap-1 rounded bg-neon-green/10 px-1.5 py-0.5 text-[10px] text-neon-green">
                    <Lock className="h-2.5 w-2.5" /> {notice.badge}
                  </span>
                ) : (
                  <span title={notice.body} className="flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-200/90">
                    <Lock className="h-2.5 w-2.5" /> Server-readable
                  </span>
                )}
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
                    No messages yet.
                  </p>
                )}
                <p className="px-1 pb-2 text-[11px] text-zinc-500">{notice.body}</p>
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
                        <span title={notice.body} className="inline-flex"><Lock className="h-2.5 w-2.5 text-neon-green" aria-label={notice.body} /></span>
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
                    placeholder="Message…"
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
                {safetyDeviceHeld
                  ? 'Compare these 12 groups with your peer on another channel. They are computed in this browser from the public keys on your devices. Concord does not hold those private keys.'
                  : 'These groups are derived from public keys Concord stores. Concord holds the private keys for server-managed identities, so a match does not mean Concord cannot read the messages.'}
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
