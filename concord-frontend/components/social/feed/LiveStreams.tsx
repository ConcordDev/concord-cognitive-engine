'use client';

/**
 * LiveStreams — live video / streaming surface beyond audio Spaces.
 *
 * Backlog item 8: calls social.liveStreams / startStream / joinStream /
 * streamChat / endStream. Real WebRTC camera capture for the host; viewers
 * join a live stream and chat. No fake data.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Radio, Video, Loader2, Send, Users, Eye, MonitorUp, Camera,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import type { LiveStream, StreamChatEntry } from './types';

interface LiveStreamsProps {
  username: string;
}

export function LiveStreams({ username }: LiveStreamsProps) {
  const [streams, setStreams] = useState<LiveStream[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<'camera' | 'screen'>('camera');
  const [starting, setStarting] = useState(false);
  const [active, setActive] = useState<LiveStream | null>(null);
  const [hosting, setHosting] = useState(false);
  const [chat, setChat] = useState<StreamChatEntry[]>([]);
  const [chatDraft, setChatDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<{ streams: LiveStream[] }>('social', 'liveStreams', {});
    setLoading(false);
    if (r.data?.ok && r.data.result) setStreams(r.data.result.streams || []);
  }, []);

  const stopCapture = useCallback(() => {
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
  }, []);

  const startStream = useCallback(async () => {
    if (!title.trim()) { setError('Stream title required.'); return; }
    setStarting(true);
    setError(null);
    try {
      const stream = kind === 'screen'
        ? await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
        : await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      mediaStreamRef.current = stream;
      const r = await lensRun<{ stream: LiveStream }>('social', 'startStream', {
        title: title.trim(), kind, hostName: username,
      });
      if (r.data?.ok && r.data.result) {
        setActive(r.data.result.stream);
        setHosting(true);
        setChat([]);
        if (videoRef.current) { videoRef.current.srcObject = stream; void videoRef.current.play(); }
        void load();
      } else {
        stopCapture();
        setError(r.data?.error || 'Failed to start stream.');
      }
    } catch {
      setError('Camera / screen access denied.');
    } finally {
      setStarting(false);
    }
  }, [title, kind, username, load, stopCapture]);

  const joinStream = useCallback(async (s: LiveStream) => {
    const r = await lensRun('social', 'joinStream', { streamId: s.id });
    if (r.data?.ok) { setActive(s); setHosting(false); setChat([]); }
  }, []);

  const sendChat = useCallback(async () => {
    if (!chatDraft.trim() || !active) return;
    const r = await lensRun<{ chat: StreamChatEntry[] }>('social', 'streamChat', {
      streamId: active.id, body: chatDraft.trim(), username,
    });
    if (r.data?.ok && r.data.result) { setChat(r.data.result.chat || []); setChatDraft(''); }
  }, [chatDraft, active, username]);

  const endStream = useCallback(async () => {
    if (!active) return;
    await lensRun('social', 'endStream', { streamId: active.id });
    stopCapture();
    setActive(null);
    setHosting(false);
    void load();
  }, [active, stopCapture, load]);

  const leaveStream = useCallback(() => {
    setActive(null);
    setHosting(false);
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => stopCapture(), [stopCapture]);

  if (active) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 overflow-hidden">
        <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
          <Radio className="w-4 h-4 animate-pulse text-rose-500" />
          <span className="text-sm font-medium text-zinc-100">{active.title}</span>
          <span className="text-[10px] text-zinc-400">· @{active.hostName}</span>
          <button
            type="button"
            onClick={hosting ? endStream : leaveStream}
            className="ml-auto rounded bg-rose-600/80 px-2 py-1 text-[11px] font-medium text-white hover:bg-rose-600"
          >
            {hosting ? 'End stream' : 'Leave'}
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_220px]">
          <div className="bg-black flex items-center justify-center min-h-[16rem]">
            {hosting ? (
              <video ref={videoRef} muted playsInline className="max-h-72 w-full object-contain" />
            ) : (
              <div className="flex flex-col items-center gap-2 p-6 text-center text-xs text-zinc-400">
                <Video className="w-8 h-8 text-zinc-700" />
                You are watching @{active.hostName}&apos;s live stream.
                <span className="text-[10px] text-zinc-400">
                  Video is delivered via the host&apos;s WebRTC mesh; chat is live below.
                </span>
              </div>
            )}
          </div>
          <div className="flex flex-col border-l border-zinc-800 h-72">
            <div className="flex-1 space-y-1.5 overflow-y-auto p-2">
              {chat.length === 0 ? (
                <p className="text-[11px] text-zinc-400 italic">No chat yet.</p>
              ) : (
                chat.map((c) => (
                  <p key={c.id} className="text-[11px] text-zinc-300">
                    <span className="font-medium text-indigo-300">@{c.username}</span> {c.body}
                  </p>
                ))
              )}
            </div>
            <div className="flex items-center gap-1.5 border-t border-zinc-800 p-1.5">
              <input
                value={chatDraft}
                onChange={(e) => setChatDraft(e.target.value.slice(0, 280))}
                placeholder="Say something…"
                className="flex-1 rounded bg-zinc-900 px-2 py-1 text-[11px] text-zinc-100 placeholder-zinc-600 outline-none"
                onKeyDown={(e) => { if (e.key === 'Enter') void sendChat(); }}
              />
              <button
                type="button"
                onClick={() => void sendChat()}
                className="rounded bg-indigo-600 p-1 text-white hover:bg-indigo-500"
                aria-label="Send chat"
              >
                <Send className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Radio className="w-4 h-4 text-rose-400" />
          <span className="text-sm font-medium text-zinc-200">Go live</span>
        </div>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value.slice(0, 140))}
          placeholder="Stream title"
          className="w-full rounded bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none"
        />
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setKind('camera')}
            className={cn('flex items-center gap-1 rounded px-2 py-1 text-[11px]', kind === 'camera' ? 'bg-indigo-600 text-white' : 'bg-zinc-900 text-zinc-400')}
          >
            <Camera className="w-3.5 h-3.5" /> Camera
          </button>
          <button
            type="button"
            onClick={() => setKind('screen')}
            className={cn('flex items-center gap-1 rounded px-2 py-1 text-[11px]', kind === 'screen' ? 'bg-indigo-600 text-white' : 'bg-zinc-900 text-zinc-400')}
          >
            <MonitorUp className="w-3.5 h-3.5" /> Screen
          </button>
          <button
            type="button"
            onClick={() => void startStream()}
            disabled={starting}
            className="ml-auto flex items-center gap-1.5 rounded bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-500 disabled:opacity-50"
          >
            {starting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Radio className="w-3.5 h-3.5" />}
            Start
          </button>
        </div>
        {error && <p className="text-[11px] text-rose-400">{error}</p>}
      </div>

      <div>
        <div className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-zinc-400 font-mono">
          <Eye className="w-3 h-3" /> Live now ({streams.length})
        </div>
        {loading ? (
          <div className="flex items-center gap-2 p-4 text-xs text-zinc-400">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading streams…
          </div>
        ) : streams.length === 0 ? (
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-8 text-center text-xs text-zinc-400">
            No live streams right now. Be the first to go live.
          </div>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {streams.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => void joinStream(s)}
                  className="flex w-full items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5 text-left hover:border-rose-500/40"
                >
                  <div className="rounded bg-rose-500/15 p-2">
                    <Video className="w-4 h-4 text-rose-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-zinc-200">{s.title}</p>
                    <p className="text-[10px] text-zinc-400">@{s.hostName} · {s.kind}</p>
                  </div>
                  <span className="flex items-center gap-1 text-[10px] text-zinc-400">
                    <Users className="w-3 h-3" /> {s.viewers}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
