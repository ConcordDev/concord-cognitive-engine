'use client';

// Cross-creator direct-message thread panel — inbox list on the left,
// an open conversation on the right. Structurally cloned from alliance's
// DmPanel (concord-frontend/components/alliance/AllianceWorkspace.tsx),
// simplified to match this lens's own backend shape: no reactions/
// attachments/parentId-threading (server/domains/artistry.js's dm-send/
// dm-list/dm-inbox macros deliberately mirror this lens's plain
// `commentAdd` message shape, not alliance's richer channel-message shape).
// See the long comment above those macros for the exact rationale.

import { MessageCircle, ArrowLeft, Send, Loader2 } from 'lucide-react';

export interface DmMessage {
  id: string; threadKey: string; fromId: string; toId: string; fromName: string;
  body: string; createdAt: string;
}
export interface DmThread {
  partnerId: string; partnerName: string; threadKey: string;
  lastMessage: string; lastFrom: string; lastAt: string; messageCount: number;
}

export function ArtistryDmPanel({
  threads, selPartner, onSelectPartner, messages, draft, setDraft, onSend, busy, currentUserId,
}: {
  threads: DmThread[];
  selPartner: string | null;
  onSelectPartner: (id: string | null) => void;
  messages: DmMessage[];
  draft: string;
  setDraft: (v: string) => void;
  onSend: () => void;
  busy: boolean;
  currentUserId: string | null;
}) {
  const activeThread = threads.find((t) => t.partnerId === selPartner) || null;

  return (
    <div className="bg-white/5 border border-white/10 rounded-lg overflow-hidden">
      <div className="grid grid-cols-1 sm:grid-cols-3">
        {/* ── Inbox rail ── */}
        <div className="sm:col-span-1 border-b sm:border-b-0 sm:border-r border-white/10 max-h-80 overflow-auto">
          {threads.length === 0 && (
            <p className="text-xs text-gray-400 p-4">No conversations yet. Use the Message action on a follower or a creator you follow.</p>
          )}
          {threads.map((t) => (
            <button
              key={t.threadKey}
              onClick={() => onSelectPartner(t.partnerId)}
              className={`w-full text-left p-3 border-b border-white/5 transition-colors ${selPartner === t.partnerId ? 'bg-neon-pink/10' : 'hover:bg-white/5'}`}
            >
              <div className="text-sm font-medium text-white truncate">{t.partnerName}</div>
              <p className="text-[11px] text-gray-400 truncate mt-0.5">
                {t.lastFrom === currentUserId ? 'You: ' : ''}{t.lastMessage}
              </p>
            </button>
          ))}
        </div>

        {/* ── Open thread ── */}
        <div className="sm:col-span-2 p-3 flex flex-col">
          {!selPartner ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center text-gray-400 py-10">
              <MessageCircle className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-sm">Select a conversation, or message a creator directly from your network below.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-2">
                <button
                  onClick={() => onSelectPartner(null)}
                  className="text-gray-400 hover:text-white sm:hidden"
                  aria-label="back to conversations"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <span className="font-medium text-white text-sm">{activeThread?.partnerName || selPartner}</span>
              </div>

              <div className="flex-1 space-y-2 max-h-64 overflow-auto pr-1">
                {messages.length === 0 && (
                  <p className="text-sm text-gray-400 py-8 text-center">No messages yet — say hello</p>
                )}
                {messages.map((m) => (
                  <div key={m.id} className="bg-white/5 p-2 rounded">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-medium text-neon-pink">{m.fromId === currentUserId ? 'You' : m.fromName}</span>
                      <span className="text-[10px] text-gray-500">{new Date(m.createdAt).toLocaleTimeString()}</span>
                    </div>
                    <p className="text-sm text-gray-200 whitespace-pre-wrap">{m.body}</p>
                  </div>
                ))}
              </div>

              <div className="flex gap-2 mt-2">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); } }}
                  placeholder="Message…"
                  className="flex-1 px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-sm"
                />
                <button
                  onClick={onSend}
                  disabled={busy || !draft.trim()}
                  className="px-3 py-1.5 bg-neon-pink/20 rounded-lg text-xs hover:bg-neon-pink/30 disabled:opacity-50 flex items-center gap-1"
                  aria-label="send direct message"
                >
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
