'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  MessageSquare, Send, Mic, MicOff, Volume2, VolumeX,
  Radio, Building2, Megaphone, Smile,
  CheckCheck, ChevronDown, Circle,
} from 'lucide-react';

/* ── Types ─────────────────────────────────────────────────────── */

type ChannelType = 'proximity' | 'direct' | 'firm' | 'district' | 'voice';

type EmoteName =
  | 'wave' | 'point' | 'clap' | 'nod' | 'shake-head'
  | 'sit' | 'lean' | 'inspect' | 'celebrate';

type DistrictCategory = 'announcement' | 'request' | 'event';

interface ChatMessage {
  id: string;
  sender: string;
  senderId: string;
  content: string;
  timestamp: string;
  read?: boolean;
  category?: DistrictCategory;
}

interface Conversation {
  id: string;
  participantName: string;
  participantId: string;
  lastMessage: string;
  lastTimestamp: string;
  unreadCount: number;
  online: boolean;
}

interface FirmMember {
  id: string;
  name: string;
  online: boolean;
}

interface ChannelData {
  type: ChannelType;
  unreadCount: number;
}

interface ChatSystemProps {
  worldId?: string;
  districtId?: string;
  channels?: ChannelData[];
  currentChannel?: ChannelType;
  messages?: ChatMessage[];
  conversations?: Conversation[];
  firmMembers?: FirmMember[];
  onSend?: (channel: ChannelType, message: string) => void;
  onEmote?: (emote: EmoteName) => void;
  onVoiceToggle?: (mode: 'proximity' | 'firm' | 'push-to-talk') => void;
}

/* ── Constants ─────────────────────────────────────────────────── */

const panel = 'bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg';

const CHANNEL_META: Record<ChannelType, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
  proximity: { label: 'Proximity', icon: Radio,       color: 'text-green-400' },
  direct:    { label: 'Direct',    icon: MessageSquare, color: 'text-blue-400' },
  firm:      { label: 'Firm',      icon: Building2,   color: 'text-purple-400' },
  district:  { label: 'District',  icon: Megaphone,   color: 'text-yellow-400' },
  voice:     { label: 'Voice',     icon: Volume2,     color: 'text-cyan-400' },
};

const EMOTES: { name: EmoteName; emoji: string }[] = [
  { name: 'wave',       emoji: '👋' },
  { name: 'point',      emoji: '👉' },
  { name: 'clap',       emoji: '👏' },
  { name: 'nod',        emoji: '😊' },
  { name: 'shake-head', emoji: '🙅' },
  { name: 'sit',        emoji: '🪑' },
  { name: 'lean',       emoji: '😎' },
  { name: 'inspect',    emoji: '🔍' },
  { name: 'celebrate',  emoji: '🎉' },
];

const CATEGORY_COLORS: Record<DistrictCategory, string> = {
  announcement: 'bg-yellow-500/20 text-yellow-400',
  request:      'bg-blue-500/20 text-blue-400',
  event:        'bg-purple-500/20 text-purple-400',
};

/* ── Backend → panel adapter ────────────────────────────────────── */

// District ambient chat is the one channel with a real backend
// (GET /api/ambient-chat/list → { id, user_id, body, posted_at }).
function adaptAmbient(m: Record<string, unknown>): ChatMessage {
  const postedSec = Number(m.posted_at ?? m.postedAt ?? 0);
  const ts = postedSec
    ? new Date(postedSec * 1000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : '';
  return {
    id: String(m.id ?? ''),
    sender: String(m.user_id ?? m.userId ?? 'Player'),
    senderId: String(m.user_id ?? m.userId ?? ''),
    content: String(m.body ?? ''),
    timestamp: ts,
  };
}

const DEFAULT_CHANNELS: ChannelData[] = [
  { type: 'proximity', unreadCount: 0 },
  { type: 'direct', unreadCount: 0 },
  { type: 'firm', unreadCount: 0 },
  { type: 'district', unreadCount: 0 },
  { type: 'voice', unreadCount: 0 },
];

/* ── Component ─────────────────────────────────────────────────── */

export default function ChatSystem({
  worldId,
  districtId,
  channels = DEFAULT_CHANNELS,
  currentChannel: initialChannel = 'proximity',
  // Proximity / direct / firm have no world-lens backend surface yet — start
  // EMPTY (honest empty-state), never seed fabricated chatter.
  // TODO: wire proximity/direct/firm channels to backend when an API exists.
  messages: messagesProp,
  conversations: conversationsProp,
  firmMembers: firmMembersProp,
  onSend,
  onEmote,
  onVoiceToggle,
}: ChatSystemProps) {
  const messages = messagesProp ?? [];
  const conversations = conversationsProp ?? [];
  const firmMembers = firmMembersProp ?? [];

  // District channel: real ambient-chat backend.
  const [districtMessages, setDistrictMessages] = useState<ChatMessage[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const wid = worldId || 'concordia-hub';
        const did = districtId || 'plaza';
        const r = await fetch(
          `/api/ambient-chat/list?worldId=${encodeURIComponent(wid)}&districtId=${encodeURIComponent(did)}`,
          { credentials: 'include' },
        ).then((res) => (res.ok ? res.json() : null)).catch(() => null);
        const rows = Array.isArray(r?.messages) ? r.messages : [];
        if (!cancelled) setDistrictMessages(rows.map(adaptAmbient));
      } catch { if (!cancelled) setDistrictMessages([]); }
    })();
    return () => { cancelled = true; };
  }, [worldId, districtId]);

  const [activeChannel, setActiveChannel] = useState<ChannelType>(initialChannel);
  const [input, setInput] = useState('');
  const [showEmotes, setShowEmotes] = useState(false);
  const [selectedConvo, setSelectedConvo] = useState<Conversation | null>(null);
  const [voiceActive, setVoiceActive] = useState(false);
  const [voiceMode, setVoiceMode] = useState<'proximity' | 'firm' | 'push-to-talk'>('proximity');
  const [muted, setMuted] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activeChannel]);

  const handleSend = () => {
    if (!input.trim()) return;
    onSend?.(activeChannel, input.trim());
    setInput('');
  };

  const handleEmote = (emote: EmoteName) => {
    onEmote?.(emote);
    setShowEmotes(false);
  };

  const toggleVoice = () => {
    setVoiceActive(!voiceActive);
    onVoiceToggle?.(voiceMode);
  };

  const channelUnread = (type: ChannelType) =>
    channels.find(c => c.type === type)?.unreadCount ?? 0;

  /* ── Sub-renders ─────────────────────────────────────────────── */

  const renderProximity = () => (
    <div className="flex flex-col gap-2 p-3 max-h-80 overflow-y-auto">
      <div className="flex items-center gap-2 text-xs text-white/40 mb-1">
        <Radio size={12} />
        <span>~15 tile radius</span>
      </div>
      {messages.length === 0 && (
        <p className="text-center text-white/30 text-xs py-6">No one is talking nearby</p>
      )}
      {messages.map(msg => (
        <div key={msg.id} className="flex gap-2 items-start">
          <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold text-white/60 shrink-0">
            {msg.sender.charAt(0)}
          </div>
          <div className="bg-white/5 rounded-lg rounded-tl-none px-3 py-2 max-w-[80%]">
            <span className="text-xs font-medium text-cyan-400">{msg.sender}</span>
            <p className="text-sm text-white/80 mt-0.5">{msg.content}</p>
            <span className="text-[10px] text-white/30 mt-1 block">{msg.timestamp}</span>
          </div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );

  const renderDirect = () => (
    <div className="flex flex-col h-full">
      {!selectedConvo ? (
        <div className="divide-y divide-white/5 max-h-80 overflow-y-auto">
          {conversations.length === 0 && (
            <p className="text-center text-white/30 text-xs py-6">No direct conversations</p>
          )}
          {conversations.map(convo => (
            <button
              key={convo.id}
              onClick={() => setSelectedConvo(convo)}
              className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 transition-colors text-left"
            >
              <div className="relative shrink-0">
                <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold text-white/60">
                  {convo.participantName.charAt(0)}
                </div>
                <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-black ${convo.online ? 'bg-green-400' : 'bg-gray-500'}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-white font-medium truncate">{convo.participantName}</span>
                  <span className="text-[10px] text-white/30">{convo.lastTimestamp}</span>
                </div>
                <p className="text-xs text-white/50 truncate">{convo.lastMessage}</p>
              </div>
              {convo.unreadCount > 0 && (
                <span className="w-5 h-5 rounded-full bg-blue-500 text-white text-[10px] flex items-center justify-center font-bold shrink-0">
                  {convo.unreadCount}
                </span>
              )}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2 p-3">
          <button
            onClick={() => setSelectedConvo(null)}
            className="flex items-center gap-2 text-xs text-white/50 hover:text-white/70 transition-colors mb-2"
          >
            <ChevronDown size={12} className="rotate-90" /> Back to conversations
          </button>
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold text-white/60">
              {selectedConvo.participantName.charAt(0)}
            </div>
            <span className="text-sm text-white font-medium">{selectedConvo.participantName}</span>
            {selectedConvo.online && <Circle size={8} className="fill-green-400 text-green-400" />}
          </div>
          <div className="bg-white/5 rounded-lg px-3 py-2">
            <p className="text-sm text-white/80">{selectedConvo.lastMessage}</p>
            <div className="flex items-center gap-1 mt-1">
              <span className="text-[10px] text-white/30">{selectedConvo.lastTimestamp}</span>
              <CheckCheck size={10} className="text-blue-400" />
            </div>
          </div>
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );

  const renderFirm = () => (
    <div className="flex flex-col gap-2 p-3">
      <div className="flex items-center gap-2 text-xs text-white/40 mb-1">
        <Building2 size={12} />
        <span>Firm Channel</span>
        <span className="ml-auto text-green-400">
          {firmMembers.filter(m => m.online).length}/{firmMembers.length} online
        </span>
      </div>
      {firmMembers.length === 0 && messages.length === 0 && (
        <p className="text-center text-white/30 text-xs py-6">No firm activity</p>
      )}
      <div className="flex gap-1 mb-2">
        {firmMembers.map(m => (
          <div key={m.id} className="relative" title={m.name}>
            <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold text-white/60">
              {m.name.charAt(0)}
            </div>
            <span className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-black ${m.online ? 'bg-green-400' : 'bg-gray-500'}`} />
          </div>
        ))}
      </div>
      {messages.slice(0, 3).map(msg => (
        <div key={msg.id} className="flex gap-2 items-start">
          <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold text-white/60 shrink-0">
            {msg.sender.charAt(0)}
          </div>
          <div className="bg-purple-500/10 rounded-lg rounded-tl-none px-3 py-2 max-w-[80%]">
            <span className="text-xs font-medium text-purple-400">{msg.sender}</span>
            <p className="text-sm text-white/80 mt-0.5">{msg.content}</p>
            <span className="text-[10px] text-white/30 mt-1 block">{msg.timestamp}</span>
          </div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );

  const renderDistrict = () => (
    <div className="flex flex-col gap-2 p-3 max-h-80 overflow-y-auto">
      <div className="flex items-center gap-2 text-xs text-white/40 mb-1">
        <Megaphone size={12} />
        <span>District Broadcast</span>
      </div>
      {districtMessages.length === 0 && (
        <p className="text-center text-white/30 text-xs py-6">No district messages yet</p>
      )}
      {districtMessages.map(msg => (
        <div key={msg.id} className="bg-white/5 rounded-lg px-3 py-2.5">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium text-white/80">{msg.sender}</span>
            {msg.category && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${CATEGORY_COLORS[msg.category]}`}>
                {msg.category}
              </span>
            )}
            <span className="text-[10px] text-white/30 ml-auto">{msg.timestamp}</span>
          </div>
          <p className="text-sm text-white/70">{msg.content}</p>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );

  const renderVoice = () => (
    <div className="flex flex-col items-center gap-4 p-6">
      <div className={`w-20 h-20 rounded-full flex items-center justify-center ${voiceActive ? 'bg-cyan-500/20 ring-2 ring-cyan-500/50 animate-pulse' : 'bg-white/10'}`}>
        {muted ? <VolumeX size={32} className="text-red-400" /> : <Volume2 size={32} className={voiceActive ? 'text-cyan-400' : 'text-white/40'} />}
      </div>
      <p className="text-sm text-white/60">{voiceActive ? 'Voice active' : 'Voice inactive'}</p>

      <div className="flex gap-2">
        {(['proximity', 'firm', 'push-to-talk'] as const).map(mode => (
          <button
            key={mode}
            onClick={() => setVoiceMode(mode)}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              voiceMode === mode ? 'bg-cyan-600/80 text-white' : 'bg-white/10 text-white/50 hover:text-white/70'
            }`}
          >
            {mode === 'push-to-talk' ? 'Push-to-Talk' : mode.charAt(0).toUpperCase() + mode.slice(1)}
          </button>
        ))}
      </div>

      <div className="flex gap-3">
        <button onClick={toggleVoice} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${voiceActive ? 'bg-red-600/80 hover:bg-red-500 text-white' : 'bg-cyan-600/80 hover:bg-cyan-500 text-white'}`}>
          {voiceActive ? 'Disconnect' : 'Connect'}
        </button>
        <button onClick={() => setMuted(!muted)} className="px-4 py-2 rounded-lg text-sm font-medium bg-white/10 hover:bg-white/20 text-white/70 transition-colors">
          {muted ? <MicOff size={16} /> : <Mic size={16} />}
        </button>
      </div>
    </div>
  );

  const CHANNEL_RENDER: Record<ChannelType, () => React.ReactNode> = {
    proximity: renderProximity,
    direct:    renderDirect,
    firm:      renderFirm,
    district:  renderDistrict,
    voice:     renderVoice,
  };

  /* ── Main Render ─────────────────────────────────────────────── */
  return (
    <div className="flex flex-col gap-3 w-full max-w-md">
      {/* Tab bar */}
      <div className={`${panel} p-1 flex gap-1`}>
        {(['proximity', 'direct', 'firm', 'district', 'voice'] as ChannelType[]).map(ch => {
          const meta = CHANNEL_META[ch];
          const unread = channelUnread(ch);
          return (
            <button
              key={ch}
              onClick={() => setActiveChannel(ch)}
              className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded text-xs font-medium transition-colors relative ${
                activeChannel === ch ? 'bg-white/15 text-white' : 'text-white/50 hover:text-white/70'
              }`}
            >
              {React.createElement(meta.icon, { className: 'w-3.5 h-3.5' })}
              <span className="hidden sm:inline">{meta.label}</span>
              {unread > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] flex items-center justify-center font-bold">
                  {unread}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Channel content */}
      <div className={`${panel} min-h-[300px] flex flex-col`}>
        <div className="flex-1">
          {CHANNEL_RENDER[activeChannel]()}
        </div>

        {/* Message input (not shown for voice tab) */}
        {activeChannel !== 'voice' && (
          <div className="border-t border-white/10 p-2 flex items-center gap-2 relative">
            {/* Emote picker */}
            {showEmotes && (
              <div className={`${panel} absolute bottom-full left-2 mb-2 p-2 grid grid-cols-3 gap-1 z-20`}>
                {EMOTES.map(e => (
                  <button
                    key={e.name}
                    onClick={() => handleEmote(e.name)}
                    className="flex flex-col items-center gap-0.5 px-2 py-1.5 rounded hover:bg-white/10 transition-colors"
                    title={e.name}
                  >
                    <span className="text-lg">{e.emoji}</span>
                    <span className="text-[9px] text-white/40">{e.name}</span>
                  </button>
                ))}
              </div>
            )}

            <button
              onClick={() => setShowEmotes(!showEmotes)}
              className={`p-1.5 rounded transition-colors ${showEmotes ? 'bg-white/15 text-yellow-400' : 'text-white/40 hover:text-white/60'}`}
            aria-label="Smile">
              <Smile size={18} />
            </button>

            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSend()}
              placeholder={`Message ${CHANNEL_META[activeChannel].label}...`}
              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/25"
            />

            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="p-1.5 rounded bg-blue-600/80 hover:bg-blue-500 disabled:opacity-30 disabled:hover:bg-blue-600/80 text-white transition-colors"
            aria-label="Send">
              <Send size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
