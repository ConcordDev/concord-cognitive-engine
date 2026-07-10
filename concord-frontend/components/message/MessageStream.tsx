'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Send, Loader2, MessageSquare, Sparkles, Calendar, Smile, Edit3, Trash2, Pin, ListChecks, Mic, Square } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ChannelIcon } from './SlackShell';
import { ChannelExtrasBar } from './ChannelExtrasBar';
import { RichComposer } from './RichComposer';
import { mediaRecorderSupported } from '@/lib/voice/mediarecorder-stt';

export interface Message {
  id: string;
  number: string;
  channelId: string;
  senderId: string;
  senderName: string;
  body: string;
  ts: string;
  edited: boolean;
  threadCount: number;
  mentions?: string[];
}

interface Channel { id: string; name: string; kind: 'channel' | 'dm' | 'group_dm'; topic?: string; isPrivate?: boolean }

export function MessageStream({
  channel,
  onOpenThread,
  onMessageActivity,
}: {
  channel: Channel | null;
  onOpenThread: (rootId: string) => void;
  onMessageActivity?: () => void;
}) {
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [summary, setSummary] = useState<{ summary: string; source: string; messageCount: number } | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [actionItems, setActionItems] = useState<Array<{ id: string; text: string; owner: string | null; due: string | null }> | null>(null);
  const [extractingActions, setExtractingActions] = useState(false);
  const [smartReplies, setSmartReplies] = useState<string[]>([]);
  const [scheduleAt, setScheduleAt] = useState<string>('');
  const [showSchedule, setShowSchedule] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');
  const [pinNonce, setPinNonce] = useState(0);
  // Realtime: who is typing + a live-delivery cursor that polls
  // channel-live-state so new messages land without a manual refresh.
  const [typers, setTypers] = useState<string[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  const lastTsRef = useRef<string | null>(null);
  const typingSentRef = useRef(false);

  // Voice notes: record → transcribe via the existing /api/voice/transcribe-raw
  // route (the same one lib/voice/mediarecorder-stt.ts uses for ConKay dictation)
  // → send as a normal message → register real duration/transcript metadata via
  // message.voice-register. Degrades honestly: if Whisper isn't configured or
  // no speech is detected, the message still sends with a plain placeholder
  // body and a 0-length transcript is never fabricated.
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [voiceDurations, setVoiceDurations] = useState<Record<string, number>>({});
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const recordStreamRef = useRef<MediaStream | null>(null);
  const recordStartRef = useRef<number>(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setActionItems(null); if (channel) { refresh(); markRead(); void loadVoiceDurations(); } else { setMsgs([]); setSummary(null); setSmartReplies([]); setTypers([]); } }, [channel?.id]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs.length]);

  // Live-delivery poll — every 4s ask the server for typing handles +
  // any messages newer than our last-seen timestamp. Far cheaper than a
  // full messages-list each tick and keeps the stream live.
  const pollLive = useCallback(async () => {
    if (!channel) return;
    try {
      const r = await lensRun('message', 'channel-live-state', {
        channelId: channel.id,
        sinceTs: lastTsRef.current ?? undefined,
      });
      if (!r.data?.ok) return;
      const res = r.data.result as { typing?: string[]; newMessages?: Message[]; latestTs?: string | null };
      setTypers(res.typing ?? []);
      if (res.newMessages && res.newMessages.length > 0) {
        setMsgs((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          const fresh = (res.newMessages ?? []).filter((m) => !seen.has(m.id));
          return fresh.length > 0 ? [...prev, ...fresh] : prev;
        });
      }
      if (res.latestTs) lastTsRef.current = res.latestTs;
    } catch { /* poll best-effort */ }
  }, [channel]);

  useEffect(() => {
    if (!channel) return;
    const t = setInterval(() => { void pollLive(); }, 4000);
    return () => clearInterval(t);
  }, [channel, pollLive]);

  // Emit typing-start (debounced via a sent-flag) and typing-stop on idle.
  function signalTyping() {
    if (!channel || typingSentRef.current) return;
    typingSentRef.current = true;
    void lensRun('message', 'typing-start', { channelId: channel.id });
    setTimeout(() => {
      typingSentRef.current = false;
      if (channel) void lensRun('message', 'typing-stop', { channelId: channel.id });
    }, 5000);
  }

  async function refresh() {
    if (!channel) return;
    setLoading(true);
    try {
      const r = await lensRun({ domain: 'message', action: 'messages-list', input: { channelId: channel.id, limit: 100 } });
      const list = (r.data?.result?.messages || []) as Message[];
      setMsgs(list);
      // Compute smart replies for the last message + arm the live cursor.
      const last = list[list.length - 1];
      lastTsRef.current = last?.ts ?? null;
      if (last) loadSmartReplies(last.body);
    } catch (e) { console.error('[Stream] failed', e); }
    finally { setLoading(false); }
  }

  async function markRead() {
    if (!channel) return;
    try {
      await lensRun({ domain: 'message', action: 'messages-mark-read', input: { channelId: channel.id } });
      onMessageActivity?.();
    } catch {}
  }

  async function loadSmartReplies(text: string) {
    if (!text || text.length < 4) { setSmartReplies([]); return; }
    try {
      const r = await lensRun({ domain: 'message', action: 'ai-smart-reply', input: { lastMessage: text } });
      setSmartReplies((r.data?.result?.suggestions || []) as string[]);
    } catch { setSmartReplies([]); }
  }

  async function send() {
    if (!channel || !body.trim() || sending) return;
    setSending(true);
    try {
      await lensRun({ domain: 'message', action: 'messages-send', input: { channelId: channel.id, body: body.trim() } });
      setBody('');
      await refresh();
      onMessageActivity?.();
    } catch (e) { console.error('[Stream] send', e); }
    finally { setSending(false); }
  }

  async function loadVoiceDurations() {
    try {
      const r = await lensRun({ domain: 'message', action: 'voice-list', input: {} });
      const voices = (r.data?.result?.voices || []) as Array<{ messageId: string; durationMs: number }>;
      const map: Record<string, number> = {};
      for (const v of voices) map[v.messageId] = v.durationMs;
      setVoiceDurations(map);
    } catch { /* best-effort */ }
  }

  async function startRecording() {
    if (!channel || recording || !mediaRecorderSupported()) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordStreamRef.current = stream;
      recordChunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => { if (e.data.size > 0) recordChunksRef.current.push(e.data); };
      recorder.start();
      recorderRef.current = recorder;
      recordStartRef.current = Date.now();
      setRecording(true);
    } catch (e) { console.error('[Stream] mic access failed', e); }
  }

  async function stopRecording() {
    const recorder = recorderRef.current;
    if (!recorder || !channel) return;
    setRecording(false);
    setTranscribing(true);
    const durationMs = Date.now() - recordStartRef.current;
    const stopped = new Promise<Blob>((resolve) => {
      recorder.onstop = () => resolve(new Blob(recordChunksRef.current, { type: recorder.mimeType || 'audio/webm' }));
    });
    recorder.stop();
    recordStreamRef.current?.getTracks().forEach((t) => t.stop());
    recordStreamRef.current = null;
    recorderRef.current = null;
    try {
      const blob = await stopped;
      let transcript = '';
      if (blob.size > 1024) {
        try {
          const apiBase = process.env.NEXT_PUBLIC_API_URL || '';
          const res = await fetch(`${apiBase}/api/voice/transcribe-raw`, {
            method: 'POST', headers: { 'Content-Type': blob.type || 'audio/webm' }, body: blob, credentials: 'include',
          });
          const json = await res.json().catch(() => null);
          if (json?.ok) transcript = String(json.transcript || '').trim();
        } catch { /* transcription unavailable — honest fallback below */ }
      }
      const sendResult = await lensRun({
        domain: 'message', action: 'messages-send',
        input: { channelId: channel.id, body: transcript || '🎤 Voice message (transcription unavailable)' },
      });
      const messageId = sendResult.data?.result?.message?.id;
      if (messageId) {
        await lensRun({ domain: 'message', action: 'voice-register', input: { messageId, durationMs, transcript } });
      }
      await refresh();
      await loadVoiceDurations();
      onMessageActivity?.();
    } catch (e) { console.error('[Stream] voice note failed', e); }
    finally { setTranscribing(false); }
  }

  async function scheduleSend() {
    if (!channel || !body.trim() || !scheduleAt) return;
    try {
      const r = await lensRun({ domain: 'message', action: 'schedule-send', input: { channelId: channel.id, body: body.trim(), sendAt: new Date(scheduleAt).toISOString() } });
      if (r.data?.ok === false) { alert(r.data?.error); return; }
      setBody('');
      setShowSchedule(false);
      setScheduleAt('');
      alert(`Scheduled for ${new Date(scheduleAt).toLocaleString()}.`);
      onMessageActivity?.();
    } catch (e) { console.error('[Stream] schedule', e); }
  }

  async function summarize() {
    if (!channel) return;
    setSummarizing(true);
    try {
      const r = await lensRun({ domain: 'message', action: 'ai-summarize-channel', input: { channelId: channel.id, limit: 50 } });
      setSummary(r.data?.result || null);
    } catch (e) { console.error('[Stream] summarize', e); }
    finally { setSummarizing(false); }
  }

  async function extractActionItems() {
    if (!channel || msgs.length === 0) return;
    setExtractingActions(true);
    try {
      // ai-action-items takes raw transcript text (channel-agnostic) — build
      // the same "Sender: body" transcript ai-summarize-channel composes
      // server-side, over the messages already loaded in this stream.
      const text = msgs.slice(-50).map((m) => `${m.senderName}: ${m.body}`).join('\n');
      const r = await lensRun({ domain: 'message', action: 'ai-action-items', input: { text } });
      if (r.data?.ok === false) { setActionItems([]); return; }
      setActionItems((r.data?.result?.actionItems || []) as Array<{ id: string; text: string; owner: string | null; due: string | null }>);
    } catch (e) { console.error('[Stream] action-items', e); }
    finally { setExtractingActions(false); }
  }

  async function saveEdit(m: Message) {
    if (!channel || !editBody.trim()) return;
    try {
      await lensRun({ domain: 'message', action: 'messages-edit', input: { channelId: channel.id, id: m.id, body: editBody.trim() } });
      setEditingId(null); setEditBody('');
      await refresh();
    } catch (e) { console.error('[Stream] edit', e); }
  }

  async function deleteMsg(m: Message) {
    if (!channel) return;
    if (!confirm('Delete this message?')) return;
    try {
      await lensRun({ domain: 'message', action: 'messages-delete', input: { channelId: channel.id, id: m.id } });
      await refresh();
    } catch (e) { console.error('[Stream] delete', e); }
  }

  async function saveMessage(m: Message) {
    try {
      await lensRun({ domain: 'message', action: 'save-message', input: { messageId: m.id, threadId: m.channelId, sender: m.senderName, body: m.body } });
      alert('Saved.');
    } catch (e) { console.error('[Stream] save', e); }
  }

  async function pinMsg(m: Message) {
    if (!channel) return;
    try {
      await lensRun({ domain: 'message', action: 'pin-message', input: { channelId: channel.id, messageId: m.id } });
      setPinNonce(n => n + 1);
    } catch (e) { console.error('[Stream] pin', e); }
  }

  if (!channel) {
    return <div className="flex-1 flex items-center justify-center text-xs text-gray-400">Pick a channel or DM from the list.</div>;
  }

  return (
    <>
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <ChannelIcon kind={channel.kind} isPrivate={channel.isPrivate} className="w-4 h-4 text-violet-400" />
        <span className="text-sm font-semibold text-gray-200">{channel.name}</span>
        {channel.topic && <span className="text-[10px] text-gray-400">· {channel.topic}</span>}
        <button onClick={extractActionItems} disabled={extractingActions || msgs.length === 0} className="ml-auto px-2 py-1 text-xs rounded border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-40 inline-flex items-center gap-1">
          {extractingActions ? <Loader2 className="w-3 h-3 animate-spin" /> : <ListChecks className="w-3 h-3" />}Action items
        </button>
        <button onClick={summarize} disabled={summarizing} className="px-2 py-1 text-xs rounded border border-violet-500/30 text-violet-300 hover:bg-violet-500/10 disabled:opacity-40 inline-flex items-center gap-1">
          {summarizing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}Summarize
        </button>
      </header>

      <ChannelExtrasBar channelId={channel.id} pinNonce={pinNonce} />

      {summary && (
        <div className="px-4 py-2 bg-violet-500/[0.06] border-b border-violet-500/20 text-xs text-violet-100 flex items-start gap-2">
          <Sparkles className="w-3 h-3 text-violet-300 mt-0.5" />
          <div className="flex-1">
            <div>{summary.summary}</div>
            <div className="text-[10px] text-violet-400/70 mt-0.5">{summary.messageCount} messages · {summary.source}</div>
          </div>
          <button onClick={() => setSummary(null)} className="text-violet-300 text-lg">×</button>
        </div>
      )}

      {actionItems && (
        <div className="px-4 py-2 bg-emerald-500/[0.06] border-b border-emerald-500/20 text-xs text-emerald-100">
          <div className="flex items-start gap-2">
            <ListChecks className="w-3 h-3 text-emerald-300 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              {actionItems.length === 0 ? (
                <div className="text-emerald-300/70 italic">No action items found in the recent conversation.</div>
              ) : (
                <ul className="space-y-1">
                  {actionItems.map((item) => (
                    <li key={item.id} className="flex items-start gap-1.5">
                      <span className="flex-1">{item.text}</span>
                      {item.owner && <span className="text-emerald-300 whitespace-nowrap">@{item.owner}</span>}
                      {item.due && <span className="text-[10px] text-emerald-400/70 whitespace-nowrap">due {item.due}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button onClick={() => setActionItems(null)} className="text-emerald-300 text-lg">×</button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-xs text-gray-400"><Loader2 className="w-3 h-3 animate-spin mr-1" />Loading…</div>
        ) : msgs.length === 0 ? (
          <div className="text-center text-xs text-gray-400 py-8">No messages yet. Be the first to say hi.</div>
        ) : msgs.map(m => (
          <div key={m.id} className="group flex items-start gap-2 hover:bg-white/[0.02] -mx-2 px-2 py-1 rounded">
            <div className={cn(
              'w-8 h-8 rounded flex items-center justify-center text-xs font-bold flex-shrink-0',
              hashColour(m.senderName),
            )}>
              {m.senderName.slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-[11px]">
                <span className="font-semibold text-white">{m.senderName}</span>
                <span className="text-gray-400 font-mono">{new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                {m.edited && <span className="text-gray-400 italic">(edited)</span>}
                {voiceDurations[m.id] != null && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/10 border border-rose-500/25 text-rose-300 inline-flex items-center gap-1" title="Voice message">
                    <Mic className="w-2.5 h-2.5" />{(voiceDurations[m.id] / 1000).toFixed(1)}s
                  </span>
                )}
                <div className="ml-auto opacity-0 group-hover:opacity-100 flex items-center gap-1">
                  <button onClick={() => onOpenThread(m.id)} className="p-1 text-gray-400 hover:text-white" title="Reply in thread"><MessageSquare className="w-3 h-3" /></button>
                  <button onClick={() => pinMsg(m)} className="p-1 text-gray-400 hover:text-amber-300" title="Pin to channel"><Pin className="w-3 h-3" /></button>
                  <button onClick={() => saveMessage(m)} className="p-1 text-gray-400 hover:text-white" title="Save"><Smile className="w-3 h-3" /></button>
                  <button onClick={() => { setEditingId(m.id); setEditBody(m.body); }} className="p-1 text-gray-400 hover:text-white" title="Edit"><Edit3 className="w-3 h-3" /></button>
                  <button onClick={() => deleteMsg(m)} className="p-1 text-gray-400 hover:text-rose-300" title="Delete"><Trash2 className="w-3 h-3" /></button>
                </div>
              </div>
              {editingId === m.id ? (
                <div className="flex items-center gap-1 mt-1">
                  <input value={editBody} onChange={e => setEditBody(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveEdit(m); if (e.key === 'Escape') setEditingId(null); }} autoFocus className="flex-1 px-2 py-1 text-xs bg-lattice-deep border border-violet-500/30 rounded text-white" />
                  <button onClick={() => saveEdit(m)} className="px-2 py-1 text-[10px] rounded bg-violet-500 text-white">save</button>
                  <button onClick={() => setEditingId(null)} className="text-gray-400 text-[10px]">esc</button>
                </div>
              ) : (
                <div className="text-sm text-white whitespace-pre-wrap">{renderMentions(m.body)}</div>
              )}
              {m.threadCount > 0 && (
                <button onClick={() => onOpenThread(m.id)} className="mt-1 text-[10px] text-violet-300 hover:text-violet-200 inline-flex items-center gap-1">
                  <MessageSquare className="w-3 h-3" />{m.threadCount} {m.threadCount === 1 ? 'reply' : 'replies'}
                </button>
              )}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {/* Typing indicator — live realtime cue from channel-live-state poll */}
      {typers.length > 0 && (
        <div className="px-4 py-1 text-[10px] text-violet-300 italic flex items-center gap-1">
          <span className="flex gap-0.5">
            <span className="w-1 h-1 rounded-full bg-violet-400 animate-bounce" />
            <span className="w-1 h-1 rounded-full bg-violet-400 animate-bounce [animation-delay:0.15s]" />
            <span className="w-1 h-1 rounded-full bg-violet-400 animate-bounce [animation-delay:0.3s]" />
          </span>
          {typers.length === 1 ? `${typers[0]} is typing…` : `${typers.length} people are typing…`}
        </div>
      )}

      {/* Smart replies */}
      {smartReplies.length > 0 && (
        <div className="px-4 py-1.5 border-t border-white/5 flex items-center gap-1 overflow-x-auto bg-violet-500/[0.03]">
          <Sparkles className="w-3 h-3 text-violet-400 flex-shrink-0" />
          <span className="text-[10px] text-gray-400 mr-1">Smart reply:</span>
          {smartReplies.map((s, i) => (
            <button key={i} onClick={() => setBody(s)} className="px-2 py-0.5 text-[11px] rounded border border-white/10 text-gray-300 hover:text-white hover:border-violet-500/30 whitespace-nowrap">{s}</button>
          ))}
        </div>
      )}

      {/* Composer */}
      <div className="border-t border-white/10 p-2">
        {showSchedule && (
          <div className="mb-2 flex items-center gap-2 bg-amber-500/[0.06] border border-amber-500/30 rounded px-2 py-1.5">
            <Calendar className="w-3 h-3 text-amber-400" />
            <input type="datetime-local" value={scheduleAt} onChange={e => setScheduleAt(e.target.value)} className="flex-1 px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
            <button onClick={scheduleSend} disabled={!body.trim() || !scheduleAt} className="px-2 py-1 text-[10px] rounded bg-amber-500 text-black font-bold hover:bg-amber-400 disabled:opacity-40">Schedule</button>
            <button onClick={() => setShowSchedule(false)} className="text-amber-300 text-[10px]">cancel</button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <RichComposer
              value={body}
              onChange={(v) => { setBody(v); signalTyping(); }}
              onSubmit={send}
              placeholder={`Message #${channel.name}`}
              disabled={sending}
            />
          </div>
          {mediaRecorderSupported() && (
            <button
              onClick={recording ? stopRecording : startRecording}
              disabled={transcribing}
              className={cn('p-2 rounded inline-flex items-center gap-1', recording ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse' : 'text-gray-400 hover:text-white')}
              title={recording ? 'Stop recording' : 'Record a voice message'}
            >
              {transcribing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : recording ? <Square className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
            </button>
          )}
          <button onClick={() => setShowSchedule(v => !v)} className={cn('p-2 rounded', showSchedule ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30' : 'text-gray-400 hover:text-white')} title="Schedule send">
            <Calendar className="w-3.5 h-3.5" />
          </button>
          <button onClick={send} disabled={!body.trim() || sending} className="px-3 py-1.5 text-xs rounded bg-violet-500 text-white font-bold hover:bg-violet-400 disabled:opacity-40 inline-flex items-center gap-1">
            {sending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}Send
          </button>
        </div>
      </div>
    </>
  );
}

function hashColour(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  const palette = ['bg-rose-500/20 text-rose-300', 'bg-amber-500/20 text-amber-300', 'bg-emerald-500/20 text-emerald-300', 'bg-cyan-500/20 text-cyan-300', 'bg-violet-500/20 text-violet-300', 'bg-pink-500/20 text-pink-300'];
  return palette[Math.abs(h) % palette.length];
}

function renderMentions(text: string) {
  const parts = text.split(/(@[\w-]+)/g);
  return parts.map((p, i) =>
    p.startsWith('@')
      ? <span key={i} className="bg-violet-500/15 text-violet-200 px-1 rounded font-semibold">{p}</span>
      : <span key={i}>{p}</span>
  );
}

export default MessageStream;
