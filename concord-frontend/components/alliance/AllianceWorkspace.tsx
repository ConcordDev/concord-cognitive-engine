/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Hash, Plus, Send, MessageSquare, Users, Mail, FileText, CheckCircle2,
  XCircle, Loader2, Crown, Shield, UserPlus, Bell, ChevronRight, CornerDownRight,
  ThumbsUp, Paperclip, Vote,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';

// ── Shared shapes ─────────────────────────────────────────────────
interface Member { userId: string; displayName: string; role: 'owner' | 'admin' | 'member' | 'guest'; joinedAt: string }
interface Alliance {
  id: string; name: string; description: string; type: string; status: string;
  members: Member[]; myRole: string | null; channelCount: number; activeProposals: number; createdAt: string;
}
interface Channel { id: string; name: string; topic: string; messageCount: number; unread: number; lastMessageAt: string | null }
interface Attachment { name: string; url: string; mime: string; sizeBytes: number }
interface Message {
  id: string; channelId: string; userId: string; displayName: string; content: string;
  parentId: string | null; attachments: Attachment[]; reactions: Record<string, string[]>;
  createdAt: string; replies?: Message[];
}
interface Invite { id: string; allianceId: string; allianceName: string; inviteeId: string; role: string; status: string; createdAt: string }
interface Tally { yes: number; no: number; abstain: number; cast: number; eligible: number; participation: number; quorumMet: boolean; passed: boolean }
interface Proposal {
  id: string; allianceId: string; title: string; body: string; createdBy: string; createdAt: string;
  status: string; quorum: number; eligibleVoters: number; decision: string | null; tally: Tally; myVote: string | null;
}
interface NotifAlliance { allianceId: string; name: string; unread: number; pendingVotes: number }
interface Notifications { totalUnread: number; pendingInvites: number; perAlliance: NotifAlliance[]; invites: Invite[] }

const REACTION_PALETTE = ['👍', '🎉', '🔥', '👀', '✅', '❤️'];
const TYPE_TINT: Record<string, string> = {
  research: 'text-neon-purple', security: 'text-neon-green',
  development: 'text-neon-cyan', governance: 'text-amber-400',
};

async function run<T = any>(action: string, input: Record<string, unknown>): Promise<{ ok: boolean; result: T | null; error: string | null }> {
  const r = await lensRun<T>('alliance', action, input);
  return r.data;
}

export function AllianceWorkspace() {
  // ── Core collections ──
  const [alliances, setAlliances] = useState<Alliance[]>([]);
  const [notifs, setNotifs] = useState<Notifications | null>(null);
  const [selAlliance, setSelAlliance] = useState<string | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selChannel, setSelChannel] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);

  // ── UI state ──
  const [tab, setTab] = useState<'chat' | 'proposals' | 'members'>('chat');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // ── Form state ──
  const [newAllianceName, setNewAllianceName] = useState('');
  const [newAllianceDesc, setNewAllianceDesc] = useState('');
  const [newAllianceType, setNewAllianceType] = useState('research');
  const [showCreateAlliance, setShowCreateAlliance] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelTopic, setNewChannelTopic] = useState('');
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [draft, setDraft] = useState('');
  const [attachName, setAttachName] = useState('');
  const [attachUrl, setAttachUrl] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [inviteUser, setInviteUser] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [propTitle, setPropTitle] = useState('');
  const [propBody, setPropBody] = useState('');
  const [propQuorum, setPropQuorum] = useState(0.5);
  const [showCreateProp, setShowCreateProp] = useState(false);

  const selAllianceData = useMemo(() => alliances.find((a) => a.id === selAlliance) || null, [alliances, selAlliance]);
  const myRole = selAllianceData?.myRole || null;
  const isAdmin = myRole === 'owner' || myRole === 'admin';

  // ── Loaders ──
  const loadAlliances = useCallback(async () => {
    const r = await run<{ alliances: Alliance[] }>('alliance-list', {});
    if (r.ok && r.result) setAlliances(r.result.alliances || []);
    else if (!r.ok) setErr(r.error || 'failed to load alliances');
  }, []);

  const loadNotifs = useCallback(async () => {
    const r = await run<Notifications>('notifications', {});
    if (r.ok && r.result) { setNotifs(r.result); setInvites(r.result.invites || []); }
  }, []);

  const loadChannels = useCallback(async (allianceId: string) => {
    const r = await run<{ channels: Channel[] }>('channel-list', { allianceId });
    if (r.ok && r.result) {
      const ch = r.result.channels || [];
      setChannels(ch);
      setSelChannel((cur) => (cur && ch.some((c) => c.id === cur) ? cur : ch[0]?.id || null));
    }
  }, []);

  const loadMessages = useCallback(async (channelId: string) => {
    const r = await run<{ messages: Message[] }>('message-list', { channelId });
    if (r.ok && r.result) setMessages(r.result.messages || []);
  }, []);

  const loadProposals = useCallback(async (allianceId: string) => {
    const r = await run<{ proposals: Proposal[] }>('proposal-list', { allianceId });
    if (r.ok && r.result) setProposals(r.result.proposals || []);
  }, []);

  // ── Initial load ──
  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([loadAlliances(), loadNotifs()]);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Alliance selection cascade ──
  useEffect(() => {
    if (!selAlliance) { setChannels([]); setProposals([]); setSelChannel(null); return; }
    loadChannels(selAlliance);
    loadProposals(selAlliance);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selAlliance]);

  // ── Channel selection cascade ──
  useEffect(() => {
    if (!selChannel) { setMessages([]); return; }
    loadMessages(selChannel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selChannel]);

  // ── Live poll: notifications + active channel messages ──
  useEffect(() => {
    const id = setInterval(() => {
      loadNotifs();
      if (selChannel) loadMessages(selChannel);
    }, 12000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selChannel]);

  // ── Mutations ──
  const guard = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setErr(null);
    try { await fn(); } catch (e) { setErr(e instanceof Error ? e.message : 'action failed'); }
    setBusy(null);
  };

  const createAlliance = () => guard('create-alliance', async () => {
    if (!newAllianceName.trim()) return;
    const r = await run<{ alliance: Alliance }>('alliance-create', {
      name: newAllianceName.trim(), description: newAllianceDesc.trim(), type: newAllianceType,
    });
    if (!r.ok) { setErr(r.error); return; }
    setNewAllianceName(''); setNewAllianceDesc(''); setShowCreateAlliance(false);
    await loadAlliances();
    if (r.result?.alliance) setSelAlliance(r.result.alliance.id);
  });

  const createChannel = () => guard('create-channel', async () => {
    if (!selAlliance || !newChannelName.trim()) return;
    const r = await run('channel-create', { allianceId: selAlliance, name: newChannelName.trim(), topic: newChannelTopic.trim() });
    if (!r.ok) { setErr(r.error); return; }
    setNewChannelName(''); setNewChannelTopic(''); setShowCreateChannel(false);
    await loadChannels(selAlliance);
  });

  const sendMessage = () => guard('send', async () => {
    if (!selChannel || !draft.trim()) return;
    const attachments = attachName.trim()
      ? [{ name: attachName.trim(), url: attachUrl.trim(), mime: 'application/octet-stream', sizeBytes: 0 }]
      : [];
    const r = await run('message-send', {
      channelId: selChannel, content: draft.trim(), parentId: replyTo, attachments,
    });
    if (!r.ok) { setErr(r.error); return; }
    setDraft(''); setAttachName(''); setAttachUrl(''); setReplyTo(null);
    await loadMessages(selChannel);
  });

  const react = (messageId: string, emoji: string) => guard(`react-${messageId}-${emoji}`, async () => {
    if (!selChannel) return;
    const r = await run('message-react', { channelId: selChannel, messageId, emoji });
    if (!r.ok) { setErr(r.error); return; }
    await loadMessages(selChannel);
  });

  const markRead = (channelId: string) => guard(`mark-${channelId}`, async () => {
    await run('mark-read', { channelId });
    await Promise.all([loadNotifs(), selAlliance ? loadChannels(selAlliance) : Promise.resolve()]);
  });

  const sendInvite = () => guard('invite', async () => {
    if (!selAlliance || !inviteUser.trim()) return;
    const r = await run('invite-create', { allianceId: selAlliance, inviteeId: inviteUser.trim(), role: inviteRole });
    if (!r.ok) { setErr(r.error); return; }
    setInviteUser('');
  });

  const respondInvite = (inviteId: string, accept: boolean) => guard(`inv-${inviteId}`, async () => {
    const r = await run('invite-respond', { inviteId, accept });
    if (!r.ok) { setErr(r.error); return; }
    await Promise.all([loadAlliances(), loadNotifs()]);
  });

  const setMemberRole = (memberId: string, role: string) => guard(`role-${memberId}`, async () => {
    if (!selAlliance) return;
    const r = await run('member-set-role', { allianceId: selAlliance, memberId, role });
    if (!r.ok) { setErr(r.error); return; }
    await loadAlliances();
  });

  const removeMember = (memberId: string) => guard(`rm-${memberId}`, async () => {
    if (!selAlliance) return;
    const r = await run('member-remove', { allianceId: selAlliance, memberId });
    if (!r.ok) { setErr(r.error); return; }
    await loadAlliances();
  });

  const createProposal = () => guard('create-prop', async () => {
    if (!selAlliance || !propTitle.trim()) return;
    const r = await run('proposal-create', { allianceId: selAlliance, title: propTitle.trim(), body: propBody.trim(), quorum: propQuorum });
    if (!r.ok) { setErr(r.error); return; }
    setPropTitle(''); setPropBody(''); setShowCreateProp(false);
    await Promise.all([loadProposals(selAlliance), loadAlliances()]);
  });

  const voteProposal = (proposalId: string, choice: string) => guard(`vote-${proposalId}-${choice}`, async () => {
    if (!selAlliance) return;
    const r = await run('proposal-vote', { allianceId: selAlliance, proposalId, choice });
    if (!r.ok) { setErr(r.error); return; }
    await loadProposals(selAlliance);
  });

  const closeProposal = (proposalId: string) => guard(`close-${proposalId}`, async () => {
    if (!selAlliance) return;
    const r = await run('proposal-close', { allianceId: selAlliance, proposalId });
    if (!r.ok) { setErr(r.error); return; }
    await Promise.all([loadProposals(selAlliance), loadAlliances()]);
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-400">
        <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading collaboration workspace…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {err && (
        <div className="flex items-center gap-2 px-3 py-2 rounded bg-red-500/10 text-red-400 text-sm">
          <XCircle className="w-4 h-4" /> {err}
          <button onClick={() => setErr(null)} className="ml-auto text-red-300 hover:text-white" aria-label="dismiss">×</button>
        </div>
      )}

      {/* Notification bar */}
      {notifs && (notifs.totalUnread > 0 || notifs.pendingInvites > 0) && (
        <div className="flex items-center gap-3 flex-wrap px-3 py-2 rounded bg-amber-500/10 border border-amber-500/20 text-sm">
          <Bell className="w-4 h-4 text-amber-400" />
          {notifs.totalUnread > 0 && <span className="text-amber-300">{notifs.totalUnread} unread message{notifs.totalUnread !== 1 ? 's' : ''}</span>}
          {notifs.pendingInvites > 0 && <span className="text-neon-cyan">{notifs.pendingInvites} pending invite{notifs.pendingInvites !== 1 ? 's' : ''}</span>}
        </div>
      )}

      {/* Pending invites inbox */}
      {invites.length > 0 && (
        <div className="panel p-3 space-y-2">
          <h3 className="text-sm font-semibold flex items-center gap-2"><Mail className="w-4 h-4 text-neon-cyan" /> Invitations</h3>
          {invites.map((inv) => (
            <div key={inv.id} className="flex items-center gap-3 text-sm bg-lattice-deep p-2 rounded">
              <span>Join <strong className="text-white">{inv.allianceName}</strong> as <span className="text-neon-purple">{inv.role}</span></span>
              <button
                onClick={() => respondInvite(inv.id, true)}
                disabled={busy === `inv-${inv.id}`}
                className="ml-auto px-2 py-1 rounded bg-neon-green/20 text-neon-green text-xs hover:bg-neon-green/30 disabled:opacity-50"
              >Accept</button>
              <button
                onClick={() => respondInvite(inv.id, false)}
                disabled={busy === `inv-${inv.id}`}
                className="px-2 py-1 rounded bg-red-500/20 text-red-400 text-xs hover:bg-red-500/30 disabled:opacity-50"
              >Decline</button>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* ── Alliance rail ── */}
        <div className="panel p-3 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-2"><Users className="w-4 h-4 text-neon-purple" /> Alliances</h3>
            <button onClick={() => setShowCreateAlliance((v) => !v)} className="text-neon-cyan hover:text-white" aria-label="new alliance">
              <Plus className="w-4 h-4" />
            </button>
          </div>
          {showCreateAlliance && (
            <div className="space-y-2 p-2 bg-lattice-deep rounded">
              <input value={newAllianceName} onChange={(e) => setNewAllianceName(e.target.value)} placeholder="Alliance name" className="input-lattice w-full text-sm" />
              <input value={newAllianceDesc} onChange={(e) => setNewAllianceDesc(e.target.value)} placeholder="Description" className="input-lattice w-full text-sm" />
              <select value={newAllianceType} onChange={(e) => setNewAllianceType(e.target.value)} className="input-lattice w-full text-sm">
                <option value="research">Research</option>
                <option value="security">Security</option>
                <option value="development">Development</option>
                <option value="governance">Governance</option>
              </select>
              <button onClick={createAlliance} disabled={busy === 'create-alliance' || !newAllianceName.trim()} className="btn-neon green w-full text-sm disabled:opacity-50">
                {busy === 'create-alliance' ? 'Creating…' : 'Create'}
              </button>
            </div>
          )}
          {alliances.length === 0 && <p className="text-xs text-gray-400 py-2">No alliances yet. Form one to start collaborating.</p>}
          {alliances.map((a) => {
            const n = notifs?.perAlliance.find((x) => x.allianceId === a.id);
            return (
              <button
                key={a.id}
                onClick={() => { setSelAlliance(a.id); setTab('chat'); }}
                className={`w-full text-left p-2 rounded transition-colors ${selAlliance === a.id ? 'bg-neon-cyan/10 border border-neon-cyan/40' : 'bg-lattice-deep hover:bg-lattice-surface border border-transparent'}`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white truncate">{a.name}</span>
                  {n && n.unread > 0 && <span className="ml-auto text-[10px] px-1.5 rounded-full bg-amber-500 text-black font-bold">{n.unread}</span>}
                </div>
                <div className="flex items-center gap-2 text-[11px] text-gray-400 mt-0.5">
                  <span className={TYPE_TINT[a.type] || 'text-gray-400'}>{a.type}</span>
                  <span>· {a.members.length} member{a.members.length !== 1 ? 's' : ''}</span>
                  {a.activeProposals > 0 && <span className="text-neon-purple">· {a.activeProposals} prop</span>}
                </div>
              </button>
            );
          })}
        </div>

        {/* ── Main panel ── */}
        <div className="lg:col-span-3 space-y-3">
          {!selAllianceData ? (
            <div className="panel p-8 text-center text-gray-400">
              <Users className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p>Select an alliance to open its workspace</p>
            </div>
          ) : (
            <>
              {/* Header + tabs */}
              <div className="panel p-3">
                <div className="flex items-center gap-2 mb-3">
                  <h2 className="font-semibold text-white">{selAllianceData.name}</h2>
                  <span className={`text-xs ${TYPE_TINT[selAllianceData.type]}`}>{selAllianceData.type}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${selAllianceData.status === 'active' ? 'bg-neon-green/20 text-neon-green' : 'bg-gray-500/20 text-gray-400'}`}>
                    {selAllianceData.status}
                  </span>
                  {myRole && (
                    <span className="ml-auto text-xs flex items-center gap-1 text-amber-400">
                      {myRole === 'owner' ? <Crown className="w-3 h-3" /> : <Shield className="w-3 h-3" />}{myRole}
                    </span>
                  )}
                </div>
                <div className="flex gap-1">
                  {([['chat', MessageSquare, 'Channels'], ['proposals', Vote, 'Proposals'], ['members', Users, 'Members']] as const).map(([key, Icon, label]) => (
                    <button
                      key={key}
                      onClick={() => setTab(key)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition-colors ${tab === key ? 'bg-neon-cyan/15 text-neon-cyan' : 'text-gray-400 hover:text-white'}`}
                    >
                      <Icon className="w-3.5 h-3.5" /> {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* ── CHAT TAB ── */}
              {tab === 'chat' && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {/* Channels list */}
                  <div className="panel p-3 space-y-1.5">
                    <div className="flex items-center justify-between mb-1">
                      <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Channels</h4>
                      {isAdmin && (
                        <button onClick={() => setShowCreateChannel((v) => !v)} className="text-neon-cyan hover:text-white" aria-label="new channel">
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    {showCreateChannel && isAdmin && (
                      <div className="space-y-1.5 p-2 bg-lattice-deep rounded">
                        <input value={newChannelName} onChange={(e) => setNewChannelName(e.target.value)} placeholder="channel-name" className="input-lattice w-full text-xs" />
                        <input value={newChannelTopic} onChange={(e) => setNewChannelTopic(e.target.value)} placeholder="topic" className="input-lattice w-full text-xs" />
                        <button onClick={createChannel} disabled={busy === 'create-channel'} className="btn-neon w-full text-xs disabled:opacity-50">
                          {busy === 'create-channel' ? '…' : 'Add Channel'}
                        </button>
                      </div>
                    )}
                    {channels.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => setSelChannel(c.id)}
                        className={`w-full text-left px-2 py-1.5 rounded flex items-center gap-1.5 text-sm transition-colors ${selChannel === c.id ? 'bg-neon-cyan/10 text-neon-cyan' : 'text-gray-300 hover:bg-lattice-deep'}`}
                      >
                        <Hash className="w-3.5 h-3.5 opacity-60" />
                        <span className="truncate">{c.name}</span>
                        {c.unread > 0 && <span className="ml-auto text-[10px] px-1.5 rounded-full bg-amber-500 text-black font-bold">{c.unread}</span>}
                      </button>
                    ))}
                  </div>

                  {/* Messages */}
                  <div className="panel p-3 md:col-span-2 flex flex-col">
                    {!selChannel ? (
                      <p className="text-sm text-gray-400 py-8 text-center">Select a channel</p>
                    ) : (
                      <>
                        <div className="flex items-center gap-2 mb-2">
                          <Hash className="w-4 h-4 text-neon-cyan" />
                          <span className="font-medium text-white">{channels.find((c) => c.id === selChannel)?.name}</span>
                          <span className="text-xs text-gray-400 truncate">{channels.find((c) => c.id === selChannel)?.topic}</span>
                          <button onClick={() => markRead(selChannel)} className="ml-auto text-[11px] text-gray-400 hover:text-neon-cyan flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> Mark read
                          </button>
                        </div>
                        <div className="flex-1 space-y-2 max-h-80 overflow-auto pr-1">
                          {messages.length === 0 && <p className="text-sm text-gray-400 py-6 text-center">No messages yet</p>}
                          {messages.map((m) => (
                            <MessageBubble key={m.id} m={m} onReact={react} onReply={setReplyTo} busy={busy} />
                          ))}
                        </div>
                        {/* Composer */}
                        <div className="mt-2 space-y-1.5">
                          {replyTo && (
                            <div className="flex items-center gap-1.5 text-[11px] text-neon-cyan">
                              <CornerDownRight className="w-3 h-3" /> Replying in thread
                              <button onClick={() => setReplyTo(null)} className="text-gray-400 hover:text-white">cancel</button>
                            </div>
                          )}
                          {(attachName || attachUrl) && (
                            <div className="flex items-center gap-1.5 text-[11px] text-amber-300">
                              <Paperclip className="w-3 h-3" /> attachment armed
                            </div>
                          )}
                          <div className="flex gap-2">
                            <input
                              value={draft}
                              onChange={(e) => setDraft(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                              placeholder={replyTo ? 'Reply…' : 'Message channel…'}
                              className="input-lattice flex-1 text-sm"
                            />
                            <button onClick={sendMessage} disabled={busy === 'send' || !draft.trim()} className="btn-neon disabled:opacity-50" aria-label="send">
                              {busy === 'send' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                            </button>
                          </div>
                          <details className="text-[11px] text-gray-400">
                            <summary className="cursor-pointer hover:text-gray-300">+ attach file link</summary>
                            <div className="flex gap-1.5 mt-1">
                              <input value={attachName} onChange={(e) => setAttachName(e.target.value)} placeholder="file name" className="input-lattice flex-1 text-xs" />
                              <input value={attachUrl} onChange={(e) => setAttachUrl(e.target.value)} placeholder="url" className="input-lattice flex-1 text-xs" />
                            </div>
                          </details>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* ── PROPOSALS TAB ── */}
              {tab === 'proposals' && (
                <div className="panel p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold flex items-center gap-2"><FileText className="w-4 h-4 text-neon-purple" /> Joint Proposals</h4>
                    <button onClick={() => setShowCreateProp((v) => !v)} className="text-neon-cyan hover:text-white text-sm flex items-center gap-1">
                      <Plus className="w-3.5 h-3.5" /> New
                    </button>
                  </div>
                  {showCreateProp && (
                    <div className="space-y-2 p-2 bg-lattice-deep rounded">
                      <input value={propTitle} onChange={(e) => setPropTitle(e.target.value)} placeholder="Proposal title" className="input-lattice w-full text-sm" />
                      <textarea value={propBody} onChange={(e) => setPropBody(e.target.value)} placeholder="Body / rationale" rows={3} className="input-lattice w-full text-sm" />
                      <label className="text-xs text-gray-400 flex items-center gap-2">
                        Quorum: <span className="text-white">{Math.round(propQuorum * 100)}%</span>
                        <input type="range" min={0} max={1} step={0.05} value={propQuorum} onChange={(e) => setPropQuorum(parseFloat(e.target.value))} className="flex-1" />
                      </label>
                      <button onClick={createProposal} disabled={busy === 'create-prop' || !propTitle.trim()} className="btn-neon green w-full text-sm disabled:opacity-50">
                        {busy === 'create-prop' ? 'Creating…' : 'Create Proposal'}
                      </button>
                    </div>
                  )}
                  {proposals.length === 0 && <p className="text-sm text-gray-400 py-4 text-center">No proposals yet</p>}
                  {proposals.map((p) => (
                    <ProposalCard
                      key={p.id} p={p} busy={busy} isAdmin={isAdmin}
                      onVote={voteProposal} onClose={closeProposal}
                    />
                  ))}
                </div>
              )}

              {/* ── MEMBERS TAB ── */}
              {tab === 'members' && (
                <div className="panel p-3 space-y-3">
                  <h4 className="text-sm font-semibold flex items-center gap-2"><Users className="w-4 h-4 text-neon-cyan" /> Members & Roles</h4>
                  {isAdmin && (
                    <div className="flex gap-2 p-2 bg-lattice-deep rounded">
                      <input value={inviteUser} onChange={(e) => setInviteUser(e.target.value)} placeholder="user id to invite" className="input-lattice flex-1 text-sm" />
                      <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} className="input-lattice text-sm">
                        <option value="admin">admin</option>
                        <option value="member">member</option>
                        <option value="guest">guest</option>
                      </select>
                      <button onClick={sendInvite} disabled={busy === 'invite' || !inviteUser.trim()} className="btn-neon text-sm disabled:opacity-50 flex items-center gap-1">
                        <UserPlus className="w-3.5 h-3.5" /> Invite
                      </button>
                    </div>
                  )}
                  <div className="space-y-1.5">
                    {selAllianceData.members.map((m) => (
                      <div key={m.userId} className="flex items-center gap-2 text-sm bg-lattice-deep p-2 rounded">
                        {m.role === 'owner' ? <Crown className="w-4 h-4 text-amber-400" /> : <Shield className="w-4 h-4 text-gray-400" />}
                        <span className="text-white">{m.displayName}</span>
                        <span className="text-xs text-gray-400">{m.userId}</span>
                        {myRole === 'owner' && m.role !== 'owner' ? (
                          <select
                            value={m.role}
                            onChange={(e) => setMemberRole(m.userId, e.target.value)}
                            disabled={busy === `role-${m.userId}`}
                            className="ml-auto input-lattice text-xs"
                          >
                            <option value="admin">admin</option>
                            <option value="member">member</option>
                            <option value="guest">guest</option>
                          </select>
                        ) : (
                          <span className="ml-auto text-xs text-neon-purple">{m.role}</span>
                        )}
                        {isAdmin && m.role !== 'owner' && (
                          <button
                            onClick={() => removeMember(m.userId)}
                            disabled={busy === `rm-${m.userId}`}
                            className="text-red-400 hover:text-red-300 disabled:opacity-50"
                            aria-label="remove member"
                          ><XCircle className="w-4 h-4" /></button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Message bubble with threads, reactions, attachments ──
function MessageBubble({ m, onReact, onReply, busy }: {
  m: Message; onReact: (id: string, e: string) => void; onReply: (id: string) => void; busy: string | null;
}) {
  const [showReactions, setShowReactions] = useState(false);
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="bg-lattice-deep p-2 rounded">
      <div className="flex items-center gap-2 mb-0.5">
        <span className="text-sm font-medium text-neon-cyan">{m.displayName}</span>
        <span className="text-[11px] text-gray-400">{new Date(m.createdAt).toLocaleTimeString()}</span>
      </div>
      <p className="text-sm text-gray-200 whitespace-pre-wrap">{m.content}</p>
      {m.attachments?.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {m.attachments.map((a, i) => (
            <a key={i} href={a.url || '#'} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[11px] text-amber-300 hover:underline">
              <Paperclip className="w-3 h-3" /> {a.name}
            </a>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
        {Object.entries(m.reactions || {}).map(([emoji, users]) => (
          <button
            key={emoji}
            onClick={() => onReact(m.id, emoji)}
            disabled={busy === `react-${m.id}-${emoji}`}
            className="text-[11px] px-1.5 py-0.5 rounded-full bg-lattice-surface hover:bg-neon-cyan/20 disabled:opacity-50"
          >{emoji} {users.length}</button>
        ))}
        <button onClick={() => setShowReactions((v) => !v)} className="text-gray-400 hover:text-neon-cyan" aria-label="add reaction">
          <ThumbsUp className="w-3 h-3" />
        </button>
        <button onClick={() => onReply(m.id)} className="text-[11px] text-gray-400 hover:text-neon-cyan flex items-center gap-0.5">
          <CornerDownRight className="w-3 h-3" /> reply
        </button>
      </div>
      {showReactions && (
        <div className="flex gap-1 mt-1">
          {REACTION_PALETTE.map((e) => (
            <button key={e} onClick={() => { onReact(m.id, e); setShowReactions(false); }} className="text-sm hover:scale-125 transition-transform">{e}</button>
          ))}
        </div>
      )}
      {m.replies && m.replies.length > 0 && (
        <div className="mt-2 pl-3 border-l border-neon-cyan/20 space-y-1.5">
          {m.replies.map((r) => (
            <div key={r.id} className="text-sm">
              <div className="flex items-center gap-1.5">
                <ChevronRight className="w-3 h-3 text-gray-600" />
                <span className="text-xs font-medium text-neon-cyan">{r.displayName}</span>
                <span className="text-[10px] text-gray-400">{new Date(r.createdAt).toLocaleTimeString()}</span>
              </div>
              <p className="text-sm text-gray-300 pl-4">{r.content}</p>
              <div className="flex items-center gap-1.5 pl-4 mt-0.5">
                {Object.entries(r.reactions || {}).map(([emoji, users]) => (
                  <button key={emoji} onClick={() => onReact(r.id, emoji)} className="text-[10px] px-1 rounded-full bg-lattice-surface hover:bg-neon-cyan/20">
                    {emoji} {users.length}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

// ── Proposal card with quorum voting ──
function ProposalCard({ p, busy, isAdmin, onVote, onClose }: {
  p: Proposal; busy: string | null; isAdmin: boolean;
  onVote: (id: string, c: string) => void; onClose: (id: string) => void;
}) {
  const t = p.tally;
  const pct = (n: number) => (t.cast > 0 ? Math.round((n / t.cast) * 100) : 0);
  return (
    <div className="bg-lattice-deep p-3 rounded space-y-2">
      <div className="flex items-center gap-2">
        <Vote className="w-4 h-4 text-neon-purple" />
        <span className="font-medium text-white">{p.title}</span>
        <span className={`ml-auto text-[11px] px-1.5 py-0.5 rounded ${p.status === 'open' ? 'bg-neon-green/20 text-neon-green' : 'bg-gray-500/20 text-gray-400'}`}>
          {p.status}
        </span>
      </div>
      {p.body && <p className="text-xs text-gray-400">{p.body}</p>}
      <div className="flex items-center gap-3 text-[11px] text-gray-400">
        <span>Quorum {Math.round(p.quorum * 100)}%</span>
        <span>· Participation {Math.round(t.participation * 100)}%</span>
        <span className={t.quorumMet ? 'text-neon-green' : 'text-amber-400'}>{t.quorumMet ? 'quorum met' : 'awaiting quorum'}</span>
        {p.decision && <span className="text-white font-medium">→ {p.decision}</span>}
      </div>
      {/* Tally bar */}
      <div className="flex h-2 rounded-full overflow-hidden bg-lattice-surface">
        <div className="bg-neon-green" style={{ width: `${pct(t.yes)}%` }} />
        <div className="bg-red-500" style={{ width: `${pct(t.no)}%` }} />
        <div className="bg-gray-500" style={{ width: `${pct(t.abstain)}%` }} />
      </div>
      <div className="flex items-center gap-3 text-[11px]">
        <span className="text-neon-green">Yes {t.yes}</span>
        <span className="text-red-400">No {t.no}</span>
        <span className="text-gray-400">Abstain {t.abstain}</span>
        <span className="text-gray-400">· {t.cast}/{t.eligible} cast</span>
      </div>
      {p.status === 'open' && (
        <div className="flex items-center gap-2">
          {(['yes', 'no', 'abstain'] as const).map((c) => (
            <button
              key={c}
              onClick={() => onVote(p.id, c)}
              disabled={busy === `vote-${p.id}-${c}`}
              className={`px-2.5 py-1 rounded text-xs disabled:opacity-50 ${
                p.myVote === c
                  ? 'bg-neon-cyan text-black font-semibold'
                  : 'bg-lattice-surface text-gray-300 hover:bg-neon-cyan/20'
              }`}
            >{c}</button>
          ))}
          {isAdmin && (
            <button
              onClick={() => onClose(p.id)}
              disabled={busy === `close-${p.id}`}
              className="ml-auto px-2.5 py-1 rounded text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-50"
            >Close vote</button>
          )}
        </div>
      )}
    </div>
  );
}
