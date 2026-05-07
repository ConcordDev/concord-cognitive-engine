'use client';

/**
 * SharedSessionChat — Multi-sovereign group chat.
 * Multiple users' Concords in one conversation. Each person's substrate
 * contributes context. Sovereignty preserved. Context dissolves on end.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { showToast } from '@/components/common/Toasts';
import { useSocket } from '@/hooks/useSocket';
import {
  sharedSessionDetails,
  sharedSessionChat,
  saveSharedArtifact,
  endSharedSession,
  shareSessionDTU,
  sharedSessionRunAction,
} from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/store/ui';
import {
  Users,
  Send,
  Share2,
  Download,
  Save,
  Loader,
  Zap,
} from 'lucide-react';

interface SharedMessage {
  id?: string;
  type: 'user' | 'ai' | 'artifact' | 'dtu_shared' | 'system';
  userId?: string;
  userName?: string;
  content?: string;
  ts?: string;
  contextSources?: string[];
  // artifact fields
  dtuId?: string;
  title?: string;
  domain?: string;
  dtuTitle?: string;
  dtuDomain?: string;
  hasArtifact?: boolean;
}

interface Participant {
  userId: string;
  name: string;
  sharingDomains: string[];
  sharingLevel: 'query' | 'full' | 'none';
  joinedAt: string;
}

interface SharedSessionChatProps {
  sessionId: string;
  currentUserId: string;
  onEnd?: () => void;
}

export function SharedSessionChat({ sessionId, currentUserId, onEnd }: SharedSessionChatProps) {
  const { on, off } = useSocket({ autoConnect: true });
  const [messages, setMessages] = useState<SharedMessage[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sessionStatus, setSessionStatus] = useState<'active' | 'ended'>('active');
  const [shareDtuId, setShareDtuId] = useState('');
  const [showShareInput, setShowShareInput] = useState(false);
  const [showActionMenu, setShowActionMenu] = useState(false);
  const [actionLens, setActionLens] = useState('');
  const [actionName, setActionName] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Load session details
  useEffect(() => {
    sharedSessionDetails(sessionId).then(data => {
      if (data.ok) {
        setParticipants(data.session.participants);
        setSessionStatus(data.session.status);
        // Load existing messages
        if (data.messages) {
          const loaded: SharedMessage[] = data.messages.map((m: { userId: string; content: string; ts: string; contextSources?: Array<{ source: string }> }) => ({
            type: m.userId === 'ai' ? 'ai' as const : 'user' as const,
            userId: m.userId,
            content: m.content,
            ts: m.ts,
            contextSources: m.contextSources?.map((c: { source: string }) => c.source),
          }));
          setMessages(loaded);
        }
      }
    }).catch(err => { console.error('[SharedSession] Failed to load messages:', err); showToast('error', 'Failed to load messages'); });
  }, [sessionId]);

  // WebSocket event listeners
  useEffect(() => {
    const handleMessage = (data: unknown) => {
      const d = data as { sessionId: string; message: { id: string; userId: string; content: string; ts: string }; userName: string };
      if (d.sessionId !== sessionId) return;
      if (d.message.userId === currentUserId) return; // skip own messages (already added)
      setMessages(prev => [...prev, {
        type: 'user',
        userId: d.message.userId,
        userName: d.userName,
        content: d.message.content,
        ts: d.message.ts,
      }]);
    };

    const handleAiResponse = (data: unknown) => {
      const d = data as { sessionId: string; response: string; contextSources: string[] };
      if (d.sessionId !== sessionId) return;
      setMessages(prev => [...prev, {
        type: 'ai',
        content: d.response,
        contextSources: d.contextSources,
        ts: new Date().toISOString(),
      }]);
      setIsSending(false);
    };

    const handleArtifact = (data: unknown) => {
      const d = data as { sessionId: string; dtuId: string; title: string; domain: string };
      if (d.sessionId !== sessionId) return;
      setMessages(prev => [...prev, { type: 'artifact', ...d }]);
    };

    const handleDtuShared = (data: unknown) => {
      const d = data as { sessionId: string; userName: string; dtuTitle: string; dtuDomain: string };
      if (d.sessionId !== sessionId) return;
      setMessages(prev => [...prev, { type: 'dtu_shared', ...d }]);
    };

    const handleJoined = (data: unknown) => {
      const d = data as { sessionId: string; userId: string; userName: string; participantCount: number };
      if (d.sessionId !== sessionId) return;
      setMessages(prev => [...prev, {
        type: 'system',
        content: `${d.userName} joined the session`,
        ts: new Date().toISOString(),
      }]);
    };

    const handleEnded = (data: unknown) => {
      const d = data as { sessionId: string };
      if (d.sessionId !== sessionId) return;
      setSessionStatus('ended');
      setMessages(prev => [...prev, {
        type: 'system',
        content: 'Session ended. Shared context dissolved.',
        ts: new Date().toISOString(),
      }]);
    };

    on('shared-session:message', handleMessage);
    on('shared-session:ai-response', handleAiResponse);
    on('shared-session:artifact-produced', handleArtifact);
    on('shared-session:dtu-shared', handleDtuShared);
    on('shared-session:joined', handleJoined);
    on('shared-session:ended', handleEnded);

    return () => {
      off('shared-session:message', handleMessage);
      off('shared-session:ai-response', handleAiResponse);
      off('shared-session:artifact-produced', handleArtifact);
      off('shared-session:dtu-shared', handleDtuShared);
      off('shared-session:joined', handleJoined);
      off('shared-session:ended', handleEnded);
    };
  }, [sessionId, currentUserId, on, off]);

  // Send message
  const sendMessage = useCallback(async () => {
    if (!input.trim() || isSending || sessionStatus !== 'active') return;
    const content = input.trim();
    setInput('');
    setIsSending(true);

    // Optimistic add
    setMessages(prev => [...prev, {
      type: 'user',
      userId: currentUserId,
      userName: 'You',
      content,
      ts: new Date().toISOString(),
    }]);

    try {
      await sharedSessionChat(sessionId, content);
    } catch (e) {
      console.error('[SharedSession] Failed to send message:', e);
      useUIStore.getState().addToast({ type: 'error', message: 'Failed to send message' });
      setIsSending(false);
    }
  }, [input, isSending, sessionId, currentUserId, sessionStatus]);

  // Save artifact
  const handleSaveArtifact = async (dtuId: string) => {
    try {
      await saveSharedArtifact(sessionId, dtuId);
      setMessages(prev => [...prev, {
        type: 'system',
        content: 'Artifact saved to your substrate.',
        ts: new Date().toISOString(),
      }]);
    } catch (e) { console.error('[SharedSession] Failed to save artifact:', e); useUIStore.getState().addToast({ type: 'error', message: 'Failed to save artifact' }); }
  };

  // Share a DTU into the session
  const handleShareDTU = async (dtuId: string) => {
    try {
      await shareSessionDTU(sessionId, dtuId);
    } catch (e) { console.error('[SharedSession] Failed to share DTU:', e); useUIStore.getState().addToast({ type: 'error', message: 'Failed to share DTU' }); }
  };

  // Run a lens action in the shared session
  const handleRunAction = async (lens: string, action: string, primarySubstrate?: string) => {
    try {
      await sharedSessionRunAction(sessionId, lens, action, primarySubstrate);
    } catch (e) { console.error('[SharedSession] Failed to run action:', e); useUIStore.getState().addToast({ type: 'error', message: 'Failed to run action' }); }
  };

  // End session
  const handleEndSession = async () => {
    try {
      await endSharedSession(sessionId);
      onEnd?.();
    } catch (e) { console.error('[SharedSession] Failed to end session:', e); useUIStore.getState().addToast({ type: 'error', message: 'Failed to end session' }); }
  };

  return (
    <div className="flex h-full bg-zinc-900">
      {/* Participant sidebar */}
      <div className="w-56 border-r border-zinc-800 p-4 flex flex-col">
        <h3 className="text-sm font-medium text-zinc-400 mb-3 flex items-center gap-2">
          <Users className="w-4 h-4" />
          In this session
        </h3>
        <div className="flex-1 space-y-2">
          {participants.map(p => (
            <div key={p.userId} className="flex items-center gap-2">
              <div className={cn(
                'w-2 h-2 rounded-full',
                sessionStatus === 'active' ? 'bg-green-400' : 'bg-zinc-600',
              )} />
              <span className="text-sm text-zinc-200 truncate">
                {p.userId === currentUserId ? `${p.name} (you)` : p.name}
              </span>
              <span className="text-[10px] text-zinc-600 ml-auto">
                {p.sharingLevel === 'full' ? 'Full' : p.sharingLevel === 'query' ? 'AI' : 'Chat'}
              </span>
            </div>
          ))}
        </div>

        {sessionStatus === 'active' && (
          <button
            onClick={handleEndSession}
            className="mt-4 py-2 text-xs rounded-lg bg-red-500/10 border
              border-red-500/30 text-red-400 hover:bg-red-500/20 transition-colors"
          >
            End Session
          </button>
        )}
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col">
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.map((msg, i) => (
            <div key={i}>
              {msg.type === 'user' && (
                <div className="flex gap-2">
                  <span className={cn(
                    'text-xs font-medium shrink-0',
                    msg.userId === currentUserId ? 'text-cyan-400' : 'text-blue-400',
                  )}>
                    {msg.userId === currentUserId ? 'You' : msg.userName}
                  </span>
                  <p className="text-sm text-zinc-200">{msg.content}</p>
                </div>
              )}

              {msg.type === 'ai' && (
                <div className="bg-zinc-800/50 rounded-lg p-3 ml-4">
                  <p className="text-sm text-zinc-200 whitespace-pre-wrap">{msg.content}</p>
                  {msg.contextSources && msg.contextSources.length > 0 && (
                    <p className="text-[10px] text-zinc-600 mt-2 flex items-center gap-1">
                      <Zap className="w-2.5 h-2.5" />
                      Drawing from: {msg.contextSources.join(', ')}
                    </p>
                  )}
                </div>
              )}

              {msg.type === 'artifact' && (
                <div className="bg-cyan-500/5 border border-cyan-500/20
                  rounded-lg p-3 ml-4 flex items-center justify-between">
                  <div>
                    <p className="text-sm text-zinc-200">{msg.title}</p>
                    <p className="text-xs text-zinc-500">{msg.domain}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => msg.dtuId && handleSaveArtifact(msg.dtuId)}
                      className="text-xs px-2 py-1 rounded bg-cyan-500/10
                        text-cyan-400 border border-cyan-500/30 flex items-center gap-1
                        hover:bg-cyan-500/20 transition-colors"
                    >
                      <Save className="w-3 h-3" />
                      Save
                    </button>
                    <button className="text-xs px-2 py-1 rounded bg-zinc-800
                      text-zinc-400 border border-zinc-700 flex items-center gap-1
                      hover:bg-zinc-700 transition-colors"
                    >
                      <Download className="w-3 h-3" />
                      Download
                    </button>
                  </div>
                </div>
              )}

              {msg.type === 'dtu_shared' && (
                <div className="flex items-center gap-2 text-xs text-zinc-500 ml-4">
                  <Share2 className="w-3 h-3" />
                  {msg.userName} shared &ldquo;{msg.dtuTitle}&rdquo; from {msg.dtuDomain}
                </div>
              )}

              {msg.type === 'system' && (
                <div className="text-center text-xs text-zinc-600 py-1">
                  {msg.content}
                </div>
              )}
            </div>
          ))}

          {isSending && (
            <div className="flex items-center gap-2 text-xs text-zinc-500 ml-4">
              <Loader className="w-3 h-3 animate-spin" />
              Thinking across substrates...
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        {sessionStatus === 'active' ? (
          <div className="border-t border-zinc-800 p-4 space-y-2">
            {/* Share DTU inline form */}
            {showShareInput && (
              <div className="flex gap-2">
                <input
                  value={shareDtuId}
                  onChange={e => setShareDtuId(e.target.value)}
                  className="flex-1 bg-zinc-800 rounded-lg px-3 py-1.5 text-xs
                    text-zinc-200 border border-zinc-700
                    focus:border-cyan-500/50 outline-none placeholder-zinc-600"
                  placeholder="Enter DTU ID to share..."
                />
                <button
                  onClick={() => {
                    if (shareDtuId.trim()) {
                      handleShareDTU(shareDtuId.trim());
                      setShareDtuId('');
                      setShowShareInput(false);
                    }
                  }}
                  disabled={!shareDtuId.trim()}
                  className="px-3 py-1.5 rounded-lg bg-cyan-500/10 text-cyan-400
                    border border-cyan-500/30 text-xs disabled:opacity-30
                    hover:bg-cyan-500/20 transition-colors"
                >
                  Share
                </button>
              </div>
            )}

            {/* Run Action inline form */}
            {showActionMenu && (
              <div className="flex gap-2">
                <input
                  value={actionLens}
                  onChange={e => setActionLens(e.target.value)}
                  className="flex-1 bg-zinc-800 rounded-lg px-3 py-1.5 text-xs
                    text-zinc-200 border border-zinc-700
                    focus:border-cyan-500/50 outline-none placeholder-zinc-600"
                  placeholder="Lens (e.g. health)"
                />
                <input
                  value={actionName}
                  onChange={e => setActionName(e.target.value)}
                  className="flex-1 bg-zinc-800 rounded-lg px-3 py-1.5 text-xs
                    text-zinc-200 border border-zinc-700
                    focus:border-cyan-500/50 outline-none placeholder-zinc-600"
                  placeholder="Action name"
                />
                <button
                  onClick={() => {
                    if (actionLens.trim() && actionName.trim()) {
                      handleRunAction(actionLens.trim(), actionName.trim());
                      setActionLens('');
                      setActionName('');
                      setShowActionMenu(false);
                    }
                  }}
                  disabled={!actionLens.trim() || !actionName.trim()}
                  className="px-3 py-1.5 rounded-lg bg-purple-500/10 text-purple-400
                    border border-purple-500/30 text-xs disabled:opacity-30
                    hover:bg-purple-500/20 transition-colors"
                >
                  Run
                </button>
              </div>
            )}

            <div className="flex gap-2">
              <input
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                className="flex-1 bg-zinc-800 rounded-lg px-4 py-2 text-sm
                  text-zinc-200 border border-zinc-700
                  focus:border-cyan-500/50 outline-none placeholder-zinc-600"
                placeholder="Message the group..."
                disabled={isSending}
              />
              <button
                onClick={() => setShowShareInput(prev => !prev)}
                className={cn(
                  'px-3 py-2 rounded-lg border text-sm transition-colors',
                  showShareInput
                    ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/50'
                    : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-cyan-400 hover:border-cyan-500/30'
                )}
                title="Share DTU"
              >
                <Share2 className="w-4 h-4" />
              </button>
              <button
                onClick={() => setShowActionMenu(prev => !prev)}
                className={cn(
                  'px-3 py-2 rounded-lg border text-sm transition-colors',
                  showActionMenu
                    ? 'bg-purple-500/20 text-purple-400 border-purple-500/50'
                    : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-purple-400 hover:border-purple-500/30'
                )}
                title="Run Action"
              >
                <Zap className="w-4 h-4" />
              </button>
              <button
                onClick={sendMessage}
                disabled={isSending || !input.trim()}
                className="px-4 py-2 rounded-lg bg-cyan-500/20 text-cyan-400
                  border border-cyan-500/50 text-sm disabled:opacity-30
                  hover:bg-cyan-500/30 transition-colors"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        ) : (
          <div className="border-t border-zinc-800 p-4 text-center text-sm text-zinc-600">
            Session ended. Shared context dissolved.
          </div>
        )}
      </div>
    </div>
  );
}
