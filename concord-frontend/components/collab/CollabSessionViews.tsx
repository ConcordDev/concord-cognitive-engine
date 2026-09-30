'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { apiHelpers, api, lensRun } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import {
  Users, Clock, Send, X, Handshake,
  Globe, Lock, Mail, UserPlus, LogOut, Settings, Upload, Monitor,
  MessageSquare, Check, XCircle, Loader2, Crown, Hash, Paperclip,
  Timer, Archive,
} from 'lucide-react';
import { SharedSessionChat } from '@/components/social/SharedSessionChat';
import {
  TYPE_ICONS, TYPE_COLORS, STATUS_STYLES, ROLE_BADGE,
  avatarForUser, formatDuration, formatTimeAgo, formatTimestamp,
} from '@/components/collab/collab-model';
import type {
  CollabSession, Participant, ChatMessage, Invitation, HistoryEntry, ProjectType, Privacy,
} from '@/components/collab/collab-model';

// ---------------------------------------------------------------------------
// Session Card
// ---------------------------------------------------------------------------

export function SessionCard({ session, onJoin }: { session: CollabSession; onJoin: () => void }) {
  const TypeIcon = TYPE_ICONS[session.projectType];
  const [elapsed, setElapsed] = useState(() => Date.now() - session.startedAt);
  useEffect(() => {
    const t = setInterval(() => setElapsed(Date.now() - session.startedAt), 1000);
    return () => clearInterval(t);
  }, [session.startedAt]);
  const isPrivate = session.privacy === 'private' || session.privacy === 'invite-only';

  return (
    <motion.div
      layout
      className="lens-card p-4 space-y-3 hover:border-neon-blue/30 transition-colors cursor-pointer group"
      onClick={onJoin}
    >
      {/* Top row: type icon + name + status */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={cn(
              'w-8 h-8 rounded-lg flex items-center justify-center bg-lattice-surface shrink-0',
              TYPE_COLORS[session.projectType]
            )}
          >
            <TypeIcon className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-sm truncate group-hover:text-neon-blue transition-colors">
              {session.name}
            </h3>
            <p className="text-[11px] text-gray-400 capitalize">{session.projectType}</p>
          </div>
        </div>
        <span
          className={cn(
            'text-[10px] px-2 py-0.5 rounded-full border shrink-0 capitalize font-medium',
            STATUS_STYLES[session.status]
          )}
        >
          {session.status}
        </span>
      </div>

      {/* Host */}
      <div className="flex items-center gap-2">
        <div
          className={cn(
            'w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white',
            session.host.avatar
          )}
        >
          {session.host.name[0]}
        </div>
        <span className="text-xs text-gray-400">
          Hosted by <span className="text-gray-200">{session.host.name}</span>
        </span>
      </div>

      {/* Genre tags */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {session.genre.map((g) => (
          <span
            key={g}
            className="text-[10px] px-2 py-0.5 bg-lattice-surface border border-lattice-border rounded-full text-gray-400"
          >
            <Hash className="w-2.5 h-2.5 inline mr-0.5 -mt-px" />
            {g}
          </span>
        ))}
      </div>

      {/* Bottom row: participants + timer + join */}
      <div className="flex items-center justify-between pt-1 border-t border-lattice-border">
        <div className="flex items-center gap-3">
          {/* Stacked avatars */}
          <div className="flex items-center -space-x-1.5">
            {session.participants.slice(0, 3).map((p, i) => (
              <div
                key={p.id}
                className={cn(
                  'w-6 h-6 rounded-full border-2 border-lattice-surface flex items-center justify-center text-[8px] font-bold text-white',
                  p.avatar
                )}
                style={{ zIndex: 10 - i }}
                title={p.name}
              >
                {p.name[0]}
              </div>
            ))}
            {session.participants.length > 3 && (
              <div
                className="w-6 h-6 rounded-full border-2 border-lattice-surface bg-gray-700 flex items-center justify-center text-[9px] text-gray-300 font-medium"
                style={{ zIndex: 6 }}
              >
                +{session.participants.length - 3}
              </div>
            )}
          </div>
          <span className="text-[11px] text-gray-400">
            {session.participants.length}/{session.maxCapacity}
          </span>
          <div className="flex items-center gap-1 text-[11px] text-gray-400">
            <Timer className="w-3 h-3" />
            {formatDuration(elapsed)}
          </div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onJoin();
          }}
          className={cn(
            'text-xs px-3 py-1 rounded-md font-medium transition-colors',
            session.status === 'full'
              ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
              : isPrivate
                ? 'bg-neon-purple/20 text-neon-purple hover:bg-neon-purple/30'
                : 'bg-neon-blue/20 text-neon-blue hover:bg-neon-blue/30'
          )}
          disabled={session.status === 'full'}
        >
          {session.status === 'full' ? 'Full' : isPrivate ? 'Request' : 'Join'}
        </button>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Active Session View
// ---------------------------------------------------------------------------

export function ActiveSessionView({
  session,
  currentUserId,
  currentUserName,
  onLeave,
}: {
  session: CollabSession;
  currentUserId: string;
  currentUserName: string;
  onLeave: () => void;
}) {
  const isHost = session.host.id === currentUserId;
  // Every shared-state slice below (`chat` / `shared-notes` / `shared-file`)
  // is tagged with this session's id, both on read (the `tags` filter) and
  // on write (`meta.tags` at creation) — without this, all sessions in the
  // domain would read/write the exact same global rows (they share one
  // (domain, type) pair with no other session-scoping field).
  const sessionTag = session.id;

  // --- Live participant roster (real join/leave tracking) ---
  // The static `session.participants` array is a creation-time snapshot and
  // never changes; this is the genuinely-live joined set, backed by
  // collab.sessionJoin/sessionLeave/sessionRoster (server/domains/collab.js).
  // Entering this view IS joining — the effect below fires the join macro on
  // mount and the leave macro on unmount, for host and guest alike, so the
  // roster always reflects who is actually present.
  const [liveRoster, setLiveRoster] = useState<{ userId: string; name: string; joinedAt: number }[]>([]);

  useEffect(() => {
    let cancelled = false;
    lensRun('collab', 'sessionJoin', { sessionId: session.id })
      .then((r) => {
        if (!cancelled && r.data.ok && r.data.result) {
          setLiveRoster((r.data.result as { participants: typeof liveRoster }).participants || []);
        }
      })
      .catch((err) => console.error('[Collab] sessionJoin failed:', err));

    let socket: ReturnType<typeof import('@/lib/realtime/socket').getSocket> | null = null;
    import('@/lib/realtime/socket').then(({ getSocket }) => {
      if (cancelled) return;
      socket = getSocket();
      socket.emit('room:join', { room: `collab:${session.id}` });
      socket.on(
        'collab:participant-joined',
        (evt: { sessionId: string; userId: string; name: string; joinedAt: number }) => {
          if (evt.sessionId !== session.id) return;
          setLiveRoster((prev) =>
            prev.some((p) => p.userId === evt.userId)
              ? prev
              : [...prev, { userId: evt.userId, name: evt.name, joinedAt: evt.joinedAt }]
          );
        }
      );
      socket.on(
        'collab:participant-left',
        (evt: { sessionId: string; userId: string }) => {
          if (evt.sessionId !== session.id) return;
          setLiveRoster((prev) => prev.filter((p) => p.userId !== evt.userId));
        }
      );
    });

    return () => {
      cancelled = true;
      socket?.off('collab:participant-joined');
      socket?.off('collab:participant-left');
      // Best-effort — the request can outlive this component (page unload),
      // and a failed leave call just means the roster self-corrects on the
      // next join by someone else / server-side presence GC, never a crash.
      lensRun('collab', 'sessionLeave', { sessionId: session.id }).catch(() => {});
    };
  }, [session.id]);

  // Merge the live roster into real Participant rows for display. Host
  // identity + avatar come from the static session data (set once at
  // creation and never fabricated); everyone else who is genuinely present
  // gets an honest 'participant' role rather than an invented specialty.
  const displayParticipants: Participant[] = liveRoster.map((p) => ({
    id: p.userId,
    name: p.name,
    avatar: avatarForUser(p.userId),
    role: p.userId === session.host.id ? 'host' : 'participant',
    online: true,
  }));

  // --- Targeted (1:1) session invitations ---
  // Real producer: collab.sessionInvite (server/domains/collab.js). Same
  // "text-input-for-userId" pattern the alliance lens's DM/invite flow
  // uses (components/alliance/AllianceWorkspace.tsx) — this codebase has
  // no dedicated user-picker component to reuse instead.
  const [showInvitePanel, setShowInvitePanel] = useState(false);
  const [inviteTargetId, setInviteTargetId] = useState('');
  const [isInviting, setIsInviting] = useState(false);
  const sendSessionInvite = useCallback(async () => {
    const targetId = inviteTargetId.trim();
    if (!targetId) return;
    setIsInviting(true);
    try {
      const r = await lensRun('collab', 'sessionInvite', {
        sessionId: session.id,
        inviteeId: targetId,
      });
      if (!r.data.ok) {
        useUIStore.getState().addToast({ type: 'error', message: r.data.error || 'Failed to send invite' });
        return;
      }
      useUIStore.getState().addToast({ type: 'success', message: `Invited ${targetId} to this session` });
      setInviteTargetId('');
      setShowInvitePanel(false);
    } catch (err) {
      console.error('[Collab] Failed to send session invite:', err);
      useUIStore
        .getState()
        .addToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to send invite' });
    } finally {
      setIsInviting(false);
    }
  }, [inviteTargetId, session.id]);

  const [chatInput, setChatInput] = useState('');
  const { items: chatItems, create: createChatMessage } = useLensData('collab', 'chat', {
    seed: [],
    tags: [sessionTag],
  });
  const messages: ChatMessage[] = chatItems.map((i) => i.data as unknown as ChatMessage);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [elapsed, setElapsed] = useState(() => Date.now() - session.startedAt);

  // --- Shared notes persistence ---
  const {
    items: notesItems,
    create: createNote,
    update: updateNote,
  } = useLensData('collab', 'shared-notes', {
    tags: [sessionTag],
    noSeed: true,
  });
  const notesItem = notesItems[0];
  const [notesText, setNotesText] = useState('');
  const [notesSaving, setNotesSaving] = useState(false);
  const notesSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync notes from backend on load
  useEffect(() => {
    if (notesItem?.data) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate pad from lens-artifact store
      setNotesText(((notesItem.data as Record<string, unknown>).text as string) || '');
    }
  }, [notesItem]);

  // Auto-save notes with debounce
  const handleNotesChange = useCallback(
    (value: string) => {
      setNotesText(value);
      if (notesSaveTimer.current) clearTimeout(notesSaveTimer.current);
      notesSaveTimer.current = setTimeout(async () => {
        setNotesSaving(true);
        try {
          if (notesItem) {
            await updateNote(notesItem.id, { data: { text: value } });
          } else {
            await createNote({
              title: 'session-notes',
              data: { text: value },
              meta: { tags: [sessionTag] },
            });
          }
        } catch (err) {
          console.error('[Collab] Failed to save notes:', err);
        } finally {
          setNotesSaving(false);
        }
      }, 800);
    },
    [notesItem, updateNote, createNote, sessionTag]
  );

  // --- File upload state ---
  const { items: fileItems, create: createFileEntry } = useLensData('collab', 'shared-file', {
    tags: [sessionTag],
    noSeed: true,
  });
  const sharedFiles = fileItems.map(
    (i) => i.data as unknown as { name: string; size: string; by: string; uploadedAt: number }
  );
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = useCallback(
    async (file: File) => {
      setIsUploading(true);
      try {
        const arrayBuffer = await file.arrayBuffer();
        const base64Data = btoa(
          new Uint8Array(arrayBuffer).reduce((d, byte) => d + String.fromCharCode(byte), '')
        );
        await apiHelpers.artistry.blobs.upload({
          data: base64Data,
          mimeType: file.type,
          filename: file.name,
        });
        const sizeStr =
          file.size < 1024
            ? `${file.size} B`
            : file.size < 1024 * 1024
              ? `${(file.size / 1024).toFixed(1)} KB`
              : `${(file.size / (1024 * 1024)).toFixed(1)} MB`;
        await createFileEntry({
          title: file.name,
          data: { name: file.name, size: sizeStr, by: currentUserName, uploadedAt: Date.now() },
          meta: { tags: [sessionTag] },
        });
        useUIStore.getState().addToast({ type: 'success', message: `Uploaded "${file.name}"` });
      } catch (err) {
        console.error('[Collab] File upload failed:', err);
        useUIStore.getState().addToast({
          type: 'error',
          message: `Upload failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        });
      } finally {
        setIsUploading(false);
      }
    },
    [createFileEntry, currentUserName, sessionTag]
  );

  // --- Screen sharing (WebRTC) ---
  const [isSharing, setIsSharing] = useState(false);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const ICE_SERVERS = useRef<RTCIceServer[]>([{ urls: 'stun:stun.l.google.com:19302' }]);
  const shareRoom = `collab:${session.id}`;

  const stopScreenShare = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    setIsSharing(false);
    try {
      import('@/lib/realtime/socket')
        .then(({ getSocket }) => {
          getSocket().emit('screen-share:stop', { room: shareRoom });
        })
        .catch(() => {
          /* socket unavailable */
        });
    } catch (_) {
      /* socket unavailable */
    }
  }, [shareRoom]);

  const startScreenShare = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      stream.getVideoTracks()[0].onended = stopScreenShare;

      const { getSocket } = await import('@/lib/realtime/socket');
      const socket = getSocket();
      socket.emit('room:join', { room: shareRoom });

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS.current });
      pcRef.current = pc;
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      pc.onicecandidate = ({ candidate }) => {
        if (candidate)
          socket.emit('screen-share:ice-candidate', { to: null, room: shareRoom, candidate });
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('screen-share:start', { room: shareRoom });
      socket.emit('screen-share:offer', { room: shareRoom, offer });

      socket.on(
        'screen-share:answer',
        async ({ answer }: { answer: RTCSessionDescriptionInit }) => {
          if (pc.signalingState !== 'closed') await pc.setRemoteDescription(answer);
        }
      );

      setIsSharing(true);
    } catch (err) {
      if ((err as Error).name !== 'NotAllowedError') {
        useUIStore
          .getState()
          .addToast({
            type: 'error',
            message: 'Screen share failed: ' + (err instanceof Error ? err.message : String(err)),
          });
      }
    }
  }, [shareRoom, stopScreenShare]);

  // Receive incoming screen share from another participant
  useEffect(() => {
    let socket: ReturnType<typeof import('@/lib/realtime/socket').getSocket>;
    let cleanup = false;

    import('@/lib/realtime/socket').then(({ getSocket }) => {
      if (cleanup) return;
      socket = getSocket();
      socket.emit('room:join', { room: shareRoom });

      socket.on('screen-share:start', () => {
        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS.current });
        pcRef.current = pc;
        pc.ontrack = (e) => setRemoteStream(e.streams[0]);
        pc.onicecandidate = ({ candidate }) => {
          if (candidate)
            socket.emit('screen-share:ice-candidate', { to: null, room: shareRoom, candidate });
        };
        socket.on(
          'screen-share:offer',
          async ({ from, offer }: { from: string; offer: RTCSessionDescriptionInit }) => {
            await pc.setRemoteDescription(offer);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit('screen-share:answer', { to: from, answer });
          }
        );
        socket.on(
          'screen-share:ice-candidate',
          async ({ candidate }: { candidate: RTCIceCandidateInit }) => {
            if (pc.remoteDescription) await pc.addIceCandidate(candidate);
          }
        );
      });

      socket.on('screen-share:stop', () => {
        pcRef.current?.close();
        pcRef.current = null;
        setRemoteStream(null);
      });
    });

    return () => {
      cleanup = true;
      pcRef.current?.close();
    };
  }, [shareRoom]);

  useEffect(() => {
    const t = setInterval(() => setElapsed(Date.now() - session.startedAt), 1000);
    return () => clearInterval(t);
  }, [session.startedAt]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const sendMessage = useCallback(() => {
    if (!chatInput.trim()) return;
    const newMsg: ChatMessage = {
      id: `m-${Date.now()}`,
      senderId: currentUserId,
      senderName: currentUserName,
      senderAvatar: avatarForUser(currentUserId),
      text: chatInput.trim(),
      timestamp: Date.now(),
    };
    createChatMessage({
      title: newMsg.senderName,
      data: newMsg as unknown as Record<string, unknown>,
      meta: { tags: [sessionTag] },
    });
    setChatInput('');
  }, [chatInput, createChatMessage, currentUserId, currentUserName, sessionTag, setChatInput]);

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Top bar */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-lattice-border bg-lattice-surface/50">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'w-8 h-8 rounded-lg flex items-center justify-center',
              TYPE_COLORS[session.projectType]
            )}
          >
            {(() => {
              const I = TYPE_ICONS[session.projectType];
              return <I className="w-4 h-4" />;
            })()}
          </div>
          <div>
            <h2 className="font-semibold text-sm">{session.name}</h2>
            <div className="flex items-center gap-3 text-[11px] text-gray-400">
              <span className="flex items-center gap-1">
                <Timer className="w-3 h-3" />
                {formatDuration(elapsed)}
              </span>
              <span className="flex items-center gap-1">
                <Users className="w-3 h-3" />
                {displayParticipants.length}/{session.maxCapacity}
              </span>
            </div>
          </div>
        </div>
        <button
          onClick={async () => {
            // The host additionally ends the session for everyone (flips
            // `status` so it drops out of "Active Sessions" for other
            // viewers of this shared directory); a non-host just stops
            // watching. Either way, the live roster's leave-tracking is
            // handled by the join/leave effect's cleanup (collab.sessionLeave),
            // not here — this button only decides whether to also close the
            // session record itself.
            if (isHost) {
              try {
                await api.put(`/api/lens/collab/${session.id}`, {
                  data: { ...session, status: 'closed' },
                });
              } catch (err) {
                console.error('[Collab] Failed to close session:', err);
                useUIStore
                  .getState()
                  .addToast({ type: 'error', message: 'Failed to close session' });
              }
            }
            onLeave();
          }}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors font-medium"
        >
          <LogOut className="w-3.5 h-3.5" />
          {isHost ? 'End Session' : 'Leave'}
        </button>
      </div>

      {/* Main content: 3-panel layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel: participants */}
        <div className="w-56 border-r border-lattice-border bg-lattice-surface/30 p-3 flex flex-col gap-1 overflow-y-auto shrink-0">
          <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1">
            Participants ({displayParticipants.length})
          </h3>
          {displayParticipants.length === 0 && (
            <p className="text-[11px] text-gray-500 px-1 py-2">Connecting…</p>
          )}
          {displayParticipants.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-lattice-surface transition-colors"
            >
              <div className="relative">
                <div
                  className={cn(
                    'w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white',
                    p.avatar
                  )}
                >
                  {p.name[0]}
                </div>
                <span
                  className={cn(
                    'absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-lattice-surface',
                    p.online ? 'bg-emerald-400' : 'bg-gray-600'
                  )}
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium truncate">{p.name}</p>
                <span
                  className={cn(
                    'text-[9px] px-1.5 py-0.5 rounded-full font-medium',
                    ROLE_BADGE[p.role].color
                  )}
                >
                  {p.role === 'host' && <Crown className="w-2 h-2 inline mr-0.5 -mt-px" />}
                  {ROLE_BADGE[p.role].label}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Center: shared workspace */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 p-5 overflow-y-auto space-y-4">
            {/* Remote screen share video */}
            {remoteStream && (
              <div className="panel p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-neon-green animate-pulse" />
                  <h3 className="text-xs font-semibold text-neon-green uppercase tracking-wider">
                    Live Screen Share
                  </h3>
                </div>
                <video
                  autoPlay
                  playsInline
                  className="w-full rounded-lg bg-black"
                  style={{ maxHeight: 320 }}
                  ref={(el) => {
                    (remoteVideoRef as React.MutableRefObject<HTMLVideoElement | null>).current =
                      el;
                    if (el && remoteStream) el.srcObject = remoteStream;
                  }}
                />
              </div>
            )}
            {/* Shared notes — persisted via lens data API */}
            <div className="panel p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  Shared Notes
                </h3>
                {notesSaving && (
                  <span className="flex items-center gap-1 text-[10px] text-neon-cyan">
                    <Loader2 className="w-3 h-3 animate-spin" /> Saving...
                  </span>
                )}
                {!notesSaving && notesItem && (
                  <span className="text-[10px] text-gray-400">Auto-saved</span>
                )}
              </div>
              <textarea
                value={notesText}
                onChange={(e) => handleNotesChange(e.target.value)}
                placeholder="Add shared notes for this session..."
                rows={6}
                className="w-full bg-lattice-surface rounded-lg p-3 text-sm text-gray-300 min-h-[80px] border border-lattice-border focus:outline-none focus:border-neon-blue/50 resize-y leading-relaxed"
              />
            </div>

            {/* Shared files */}
            <div className="panel p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  Shared Files
                </h3>
                <span className="text-[10px] text-gray-400">{sharedFiles.length} uploaded</span>
              </div>
              <div className="space-y-1.5">
                {sharedFiles.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-3">
                    No files uploaded yet. Use the Upload File button below.
                  </p>
                ) : (
                  sharedFiles.map((f) => (
                    <div
                      key={`${f.name}-${f.uploadedAt}`}
                      className="flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-lattice-surface transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <Paperclip className="w-3.5 h-3.5 text-neon-cyan" />
                        <span className="text-xs font-medium">{f.name}</span>
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-gray-400">
                        <span>{f.size}</span>
                        <span>{f.by}</span>
                        {f.uploadedAt && <span>{formatTimeAgo(f.uploadedAt)}</span>}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Bottom action bar */}
          <div className="flex items-center gap-2 px-5 py-3 border-t border-lattice-border bg-lattice-surface/50">
            <button
              onClick={isSharing ? stopScreenShare : startScreenShare}
              className={cn(
                'flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border transition-colors',
                isSharing
                  ? 'bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20'
                  : 'bg-lattice-surface border-lattice-border text-gray-300 hover:border-neon-blue/40'
              )}
            >
              <Monitor className="w-3.5 h-3.5" /> {isSharing ? 'Stop Sharing' : 'Share Screen'}
            </button>
            {remoteStream && (
              <span className="flex items-center gap-1.5 text-xs text-neon-green">
                <span className="w-1.5 h-1.5 rounded-full bg-neon-green animate-pulse" />
                Receiving screen share
              </span>
            )}
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileUpload(file);
                e.target.value = '';
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-lattice-surface border border-lattice-border text-gray-300 hover:border-neon-blue/40 transition-colors disabled:opacity-50"
            >
              {isUploading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Upload className="w-3.5 h-3.5" />
              )}
              {isUploading ? 'Uploading...' : 'Upload File'}
            </button>
            <button
              onClick={async () => {
                const link = `${window.location.origin}/lenses/collab?session=${encodeURIComponent(session.id)}`;
                try {
                  await navigator.clipboard.writeText(link);
                  useUIStore
                    .getState()
                    .addToast({ type: 'success', message: 'Invite link copied to clipboard' });
                } catch (err) {
                  console.error('[Collab] Clipboard write failed:', err);
                  useUIStore
                    .getState()
                    .addToast({ type: 'error', message: `Could not copy — link: ${link}` });
                }
              }}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-lattice-surface border border-lattice-border text-gray-300 hover:border-neon-blue/40 transition-colors"
            >
              <UserPlus className="w-3.5 h-3.5" /> Copy Link
            </button>
            <div className="relative">
              <button
                onClick={() => setShowInvitePanel((v) => !v)}
                className={cn(
                  'flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border transition-colors',
                  showInvitePanel
                    ? 'bg-neon-blue/20 border-neon-blue/40 text-neon-blue'
                    : 'bg-lattice-surface border-lattice-border text-gray-300 hover:border-neon-blue/40'
                )}
              >
                <Mail className="w-3.5 h-3.5" /> Invite a User
              </button>
              {showInvitePanel && (
                <div className="absolute bottom-full mb-2 left-0 z-10 panel p-3 w-64 space-y-2 shadow-lg">
                  <label className="text-[11px] font-medium text-gray-400 block">
                    Invite by user ID
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={inviteTargetId}
                      onChange={(e) => setInviteTargetId(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && sendSessionInvite()}
                      placeholder="user id to invite"
                      className="flex-1 text-xs px-2 py-1.5 bg-lattice-surface border border-lattice-border rounded-md focus:outline-none focus:border-neon-blue/50"
                    />
                    <button
                      onClick={sendSessionInvite}
                      disabled={isInviting || !inviteTargetId.trim()}
                      className="text-xs px-2.5 py-1.5 rounded-md bg-neon-blue/20 text-neon-blue hover:bg-neon-blue/30 font-medium transition-colors disabled:opacity-50 shrink-0"
                    >
                      {isInviting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Send'}
                    </button>
                  </div>
                </div>
              )}
            </div>
            <button
              onClick={() =>
                useUIStore.getState().addToast({ type: 'info', message: 'Session settings' })
              }
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-lattice-surface border border-lattice-border text-gray-300 hover:border-neon-blue/40 transition-colors"
            >
              <Settings className="w-3.5 h-3.5" /> Settings
            </button>
          </div>
        </div>

        {/* Right panel: live chat */}
        <div className="w-72 border-l border-lattice-border flex flex-col shrink-0">
          {/* Multi-sovereign shared session chat */}
          <div className="border-b border-lattice-border">
            <SharedSessionChat
              sessionId={session.id}
              currentUserId="current-user"
              onEnd={() => onLeave()}
            />
          </div>
          <div className="px-3 py-2.5 border-b border-lattice-border">
            <h3 className="text-xs font-semibold text-gray-400 flex items-center gap-1.5">
              <MessageSquare className="w-3.5 h-3.5" /> Live Chat
            </h3>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {messages.map((msg) => (
              <div key={msg.id}>
                {msg.isSystem ? (
                  <p className="text-[10px] text-gray-400 text-center italic py-1">{msg.text}</p>
                ) : (
                  <div className="flex gap-2">
                    <div
                      className={cn(
                        'w-6 h-6 rounded-full flex items-center justify-center text-[8px] font-bold text-white shrink-0 mt-0.5',
                        msg.senderAvatar
                      )}
                    >
                      {msg.senderName[0]}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-[11px] font-semibold text-gray-300">
                          {msg.senderName}
                        </span>
                        <span className="text-[9px] text-gray-400">
                          {formatTimestamp(msg.timestamp)}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 leading-relaxed break-words">
                        {msg.text}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <div className="p-2 border-t border-lattice-border">
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="p-1.5 text-gray-400 hover:text-gray-300 transition-colors"
                title="Attach file"
              >
                <Paperclip className="w-3.5 h-3.5" />
              </button>
              <input
                type="text"
                placeholder="Type a message..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                className="flex-1 text-xs py-1.5 px-2.5 bg-lattice-surface border border-lattice-border rounded-md focus:outline-none focus:border-neon-blue/50"
              />
              <button
                onClick={sendMessage}
                className="p-1.5 text-neon-blue hover:text-neon-cyan transition-colors"
              aria-label="Send">
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Invitation Card
// ---------------------------------------------------------------------------

export function InvitationCard({
  invitation,
  onResponded,
}: {
  invitation: Invitation;
  onResponded: (accepted: boolean) => void;
}) {
  const [responded, setResponded] = useState<'accepted' | 'declined' | null>(
    invitation.status === 'pending' ? null : invitation.status
  );
  const [busy, setBusy] = useState(false);
  // projectType/genre are honestly nullable — a session isn't required to
  // have them — so fall back to a neutral icon/color rather than crashing
  // on an undefined lookup.
  const TypeIcon = (invitation.projectType && TYPE_ICONS[invitation.projectType]) || Handshake;
  const typeColor = (invitation.projectType && TYPE_COLORS[invitation.projectType]) || 'text-gray-400';
  const fromAvatar = avatarForUser(invitation.fromId);

  const respond = async (accept: boolean) => {
    setBusy(true);
    try {
      const r = await lensRun<{ invite: Invitation }>('collab', 'sessionInviteRespond', {
        inviteId: invitation.id,
        accept,
      });
      if (!r.data.ok) {
        useUIStore.getState().addToast({
          type: 'error',
          message: r.data.error || `Failed to ${accept ? 'accept' : 'decline'} invitation`,
        });
        return;
      }
      setResponded(accept ? 'accepted' : 'declined');
      onResponded(accept);
    } catch (err) {
      console.error(`[Collab] Failed to ${accept ? 'accept' : 'decline'} invitation:`, err);
      useUIStore.getState().addToast({
        type: 'error',
        message: err instanceof Error ? err.message : `Failed to ${accept ? 'accept' : 'decline'} invitation`,
      });
    } finally {
      setBusy(false);
    }
  };

  if (responded) {
    return (
      <motion.div
        initial={{ opacity: 1 }}
        animate={{ opacity: 0.5 }}
        className="panel p-4 flex items-center justify-between"
      >
        <span className="text-sm text-gray-400">
          {responded === 'accepted' ? 'Accepted' : 'Declined'}: {invitation.sessionName}
        </span>
        <span
          className={cn(
            'text-xs px-2 py-0.5 rounded-full',
            responded === 'accepted'
              ? 'bg-emerald-500/20 text-emerald-400'
              : 'bg-red-500/20 text-red-400'
          )}
        >
          {responded === 'accepted' ? (
            <Check className="w-3 h-3 inline mr-0.5" />
          ) : (
            <XCircle className="w-3 h-3 inline mr-0.5" />
          )}
          {responded}
        </span>
      </motion.div>
    );
  }

  return (
    <motion.div layout className="panel p-4 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <div
          className={cn(
            'w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white',
            fromAvatar
          )}
        >
          {invitation.fromName[0]}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">
            <span className="text-gray-200">{invitation.fromName}</span>
            <span className="text-gray-400"> invited you to </span>
            <span className="text-neon-blue">{invitation.sessionName}</span>
          </p>
          {invitation.message && (
            <p className="text-xs text-gray-400 italic mt-0.5 truncate">&quot;{invitation.message}&quot;</p>
          )}
          <div className="flex items-center gap-2 mt-0.5">
            <TypeIcon className={cn('w-3 h-3', typeColor)} />
            <span className="text-[11px] text-gray-400 capitalize">{invitation.projectType || 'session'}</span>
            {invitation.genre.length > 0 && (
              <>
                <span className="text-[11px] text-gray-400">|</span>
                <span className="text-[11px] text-gray-400">{invitation.genre.join(', ')}</span>
              </>
            )}
            <span className="text-[11px] text-gray-400">|</span>
            <span className="text-[11px] text-gray-400">{formatTimeAgo(invitation.sentAt)}</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={() => respond(false)}
          disabled={busy}
          className="text-xs px-3 py-1.5 rounded-md bg-lattice-surface border border-lattice-border text-gray-400 hover:text-red-400 hover:border-red-500/30 transition-colors disabled:opacity-50"
        >
          Decline
        </button>
        <button
          onClick={() => respond(true)}
          disabled={busy}
          className="text-xs px-3 py-1.5 rounded-md bg-neon-blue/20 text-neon-blue hover:bg-neon-blue/30 font-medium transition-colors disabled:opacity-50"
        >
          Accept
        </button>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// History Card
// ---------------------------------------------------------------------------

export function HistoryCard({ entry }: { entry: HistoryEntry }) {
  const TypeIcon = TYPE_ICONS[entry.projectType];
  return (
    <div className="panel p-4 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <div
          className={cn(
            'w-9 h-9 rounded-lg flex items-center justify-center bg-lattice-surface',
            TYPE_COLORS[entry.projectType]
          )}
        >
          <TypeIcon className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-medium truncate">{entry.sessionName}</h3>
          <p className="text-[11px] text-gray-400 capitalize">{entry.projectType} session</p>
        </div>
      </div>
      <div className="flex items-center gap-5 text-[11px] text-gray-400 shrink-0">
        <div className="flex items-center gap-1" title="Duration">
          <Clock className="w-3 h-3" />
          {formatDuration(entry.duration)}
        </div>
        <div className="flex items-center gap-1" title="Participants">
          <Users className="w-3 h-3" />
          {entry.participantCount}
        </div>
        <div className="flex items-center gap-1" title="Files shared">
          <Paperclip className="w-3 h-3" />
          {entry.filesShared}
        </div>
        <div className="flex items-center gap-1" title="Ended">
          <Archive className="w-3 h-3" />
          {formatTimeAgo(entry.endedAt)}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create Session Modal
// ---------------------------------------------------------------------------

export function CreateSessionModal({
  onClose,
  onCreate,
  hostId,
  hostName,
}: {
  onClose: () => void;
  onCreate: (input: { title?: string; data?: Record<string, unknown> }) => Promise<unknown>;
  hostId: string;
  hostName: string;
}) {
  const [form, setForm] = useState({
    name: '',
    type: 'design' as ProjectType,
    genre: '',
    maxParticipants: 6,
    privacy: 'public' as Privacy,
    description: '',
    linkedProjectId: '',
  });

  const { data: projectsData } = useQuery({
    queryKey: ['studio-projects-for-link'],
    queryFn: () => apiHelpers.artistry.studio.projects.list().then((r) => r.data),
    retry: 1,
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const host: Participant = {
        id: hostId,
        name: hostName,
        avatar: avatarForUser(hostId),
        role: 'host',
        online: true,
      };
      const session: Omit<CollabSession, 'id'> = {
        name: data.name,
        projectType: data.type,
        host,
        participants: [host],
        status: 'open',
        privacy: data.privacy,
        genre: data.genre ? data.genre.split(',').map((g) => g.trim()).filter(Boolean) : [],
        maxCapacity: data.maxParticipants,
        description: data.description,
        startedAt: Date.now(),
        ...(data.linkedProjectId ? { linkedProjectId: data.linkedProjectId } : {}),
      };
      const created = await onCreate({
        title: data.name,
        data: session as unknown as Record<string, unknown>,
      });

      // Best-effort only: linking an existing studio project also opens a
      // real Artistry live-jam session for it (project-scoped audio/asset
      // collab — a genuinely separate capability). Its failure must never
      // block or silently swallow the session the user actually asked to
      // create, which is why it isn't awaited into the primary result.
      if (data.linkedProjectId) {
        apiHelpers.artistry.collab.sessions
          .create({ projectId: data.linkedProjectId, maxParticipants: data.maxParticipants, mode: data.privacy })
          .catch((err) => {
            console.warn('[Collab] Linked-project jam session not started:', err instanceof Error ? err.message : err);
          });
      }
      return created;
    },
    onSuccess: () => {
      useUIStore.getState().addToast({ type: 'success', message: `Session "${form.name}" created.` });
      onClose();
    },
    onError: (err) => {
      console.error('[Collab] Failed to create session:', err instanceof Error ? err.message : err);
      useUIStore.getState().addToast({ type: 'error', message: 'Failed to create session.' });
    },
  });

  const projects: { id: string; title: string }[] = projectsData?.projects ?? [];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="bg-lattice-surface border border-lattice-border rounded-xl p-6 w-full max-w-lg space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Create Session</h2>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-300 transition-colors"
          aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Session name */}
        <div>
          <label className="text-xs font-medium text-gray-400 block mb-1">Session Name</label>
          <input
            type="text"
            placeholder="e.g. Q2 Design Sprint"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full px-3 py-2 text-sm bg-lattice-surface border border-lattice-border rounded-lg focus:outline-none focus:border-neon-blue/50"
          />
        </div>

        {/* Type + Genre row */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-gray-400 block mb-1">Type</label>
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as ProjectType })}
              className="w-full px-3 py-2 text-sm bg-lattice-surface border border-lattice-border rounded-lg focus:outline-none focus:border-neon-blue/50"
            >
              <option value="design">Design</option>
              <option value="development">Development</option>
              <option value="research">Research</option>
              <option value="art">Art</option>
              <option value="writing">Writing</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-400 block mb-1">Category</label>
            <input
              type="text"
              placeholder="e.g. UI/UX, Backend"
              value={form.genre}
              onChange={(e) => setForm({ ...form, genre: e.target.value })}
              className="w-full px-3 py-2 text-sm bg-lattice-surface border border-lattice-border rounded-lg focus:outline-none focus:border-neon-blue/50"
            />
          </div>
        </div>

        {/* Max participants + Privacy row */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-gray-400 block mb-1">Max Participants</label>
            <select
              value={form.maxParticipants}
              onChange={(e) => setForm({ ...form, maxParticipants: Number(e.target.value) })}
              className="w-full px-3 py-2 text-sm bg-lattice-surface border border-lattice-border rounded-lg focus:outline-none focus:border-neon-blue/50"
            >
              {[2, 3, 4, 5, 6, 8, 10].map((n) => (
                <option key={n} value={n}>
                  {n} participants
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-400 block mb-1">Privacy</label>
            <select
              value={form.privacy}
              onChange={(e) => setForm({ ...form, privacy: e.target.value as Privacy })}
              className="w-full px-3 py-2 text-sm bg-lattice-surface border border-lattice-border rounded-lg focus:outline-none focus:border-neon-blue/50"
            >
              <option value="public">Public</option>
              <option value="private">Private</option>
              <option value="invite-only">Invite Only</option>
            </select>
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="text-xs font-medium text-gray-400 block mb-1">Description</label>
          <textarea
            placeholder="What's this session about?"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={2}
            className="w-full px-3 py-2 text-sm bg-lattice-surface border border-lattice-border rounded-lg focus:outline-none focus:border-neon-blue/50 resize-none"
          />
        </div>

        {/* Link existing project */}
        <div>
          <label className="text-xs font-medium text-gray-400 block mb-1">
            Link Existing Project (optional)
          </label>
          <select
            value={form.linkedProjectId}
            onChange={(e) => setForm({ ...form, linkedProjectId: e.target.value })}
            className="w-full px-3 py-2 text-sm bg-lattice-surface border border-lattice-border rounded-lg focus:outline-none focus:border-neon-blue/50"
          >
            <option value="">No linked project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title || `Project ${p.id.slice(-6)}`}
              </option>
            ))}
          </select>
        </div>

        {/* Privacy indicator */}
        <div className="flex items-center gap-2 text-xs text-gray-400">
          {form.privacy === 'public' && (
            <>
              <Globe className="w-3.5 h-3.5 text-emerald-400" /> Anyone can join this session
            </>
          )}
          {form.privacy === 'private' && (
            <>
              <Lock className="w-3.5 h-3.5 text-neon-purple" /> Only people with the link can join
            </>
          )}
          {form.privacy === 'invite-only' && (
            <>
              <Mail className="w-3.5 h-3.5 text-amber-400" /> Only invited users can join
            </>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-3 justify-end pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => createMutation.mutate(form)}
            disabled={!form.name.trim() || createMutation.isPending}
            className={cn(
              'btn-primary px-5 py-2 rounded-lg text-sm font-medium',
              (!form.name.trim() || createMutation.isPending) && 'opacity-50 cursor-not-allowed'
            )}
          >
            {createMutation.isPending ? 'Creating...' : 'Create Session'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
