'use client';

/**
 * ReelRecorder — record a vertical short via MediaRecorder, preview it,
 * then post it as a reel.
 *
 * Phase 12 — closes the "no record path" gap in the Reels feature. The
 * substrate (artifact-upload + social.createPost + reels.create_from_post
 * macros + reels table) already existed; this component is the missing
 * capture surface.
 *
 * Flow:
 *   1. Camera + mic enumerate; user picks defaults.
 *   2. Click Record → MediaRecorder spins up with a codecs-supported
 *      WebM (vp9+opus preferred; falls back to vp8+opus then video/webm).
 *   3. Live progress bar runs to a hard 60s cap; auto-stops at cap.
 *   4. On stop → blob preview with retake / post controls.
 *   5. Post → POST /api/artifact/upload (raw body) → /api/social/post →
 *      `reels.create_from_post` macro. Each step's error envelope is
 *      shown verbatim; no silent failures.
 *
 * No fake data: the camera/mic come from the user's real hardware via
 * getUserMedia. If MediaRecorder isn't supported by the browser
 * (Safari < 14.1, some old Android) we tell the user explicitly
 * instead of a half-working recording UI.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Camera, Mic, MicOff, Square, X, Send, RotateCcw, Loader2, AlertTriangle, Circle } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

const MAX_DURATION_S = 60;

interface DeviceOption { deviceId: string; label: string; }

interface SocialPostResponse { ok: boolean; post?: { id: string }; error?: string; }
interface UploadResponse { ok: boolean; dtuId?: string; thumbnailUrl?: string | null; error?: string; }
interface CreateReelResponse { ok: boolean; reel?: { id: string }; error?: string; reason?: string; }

function pickMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4',
  ];
  for (const m of candidates) {
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch { /* ignore */ }
  }
  return null;
}

async function uploadReelBlob(blob: Blob, contentType: string): Promise<UploadResponse> {
  const filename = `reel_${Date.now()}.${contentType.includes('webm') ? 'webm' : 'mp4'}`;
  const r = await fetch('/api/artifact/upload', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': contentType,
      'X-Filename': filename,
      'X-Domain': 'social',
      'X-Title': filename,
    },
    body: blob,
  });
  return (await r.json()) as UploadResponse;
}

async function createSocialPost(input: { mediaUrl: string; caption: string }): Promise<SocialPostResponse> {
  const r = await api.post('/api/social/post', {
    content: input.caption,
    mediaType: 'video',
    mediaUrl: input.mediaUrl,
  });
  return (r?.data ?? {}) as SocialPostResponse;
}

async function createReel(input: {
  reelId: string; postId: string; videoUrl: string;
  durationSeconds: number; width?: number; height?: number; caption?: string;
  thumbnailUrl?: string | null;
}): Promise<CreateReelResponse> {
  const r = await api.post('/api/lens/run', {
    domain: 'reels', name: 'create_from_post', input,
  });
  return (r?.data ?? {}) as CreateReelResponse;
}

export interface ReelRecorderProps {
  onClose: () => void;
  /** Optional — called with the new reel id after a successful post. */
  onPosted?: (reelId: string) => void;
}

export function ReelRecorder({ onClose, onPosted }: ReelRecorderProps) {
  const qc = useQueryClient();
  const [permError, setPermError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [recordedMime, setRecordedMime] = useState<string>('video/webm');
  const [caption, setCaption] = useState('');
  const [muted, setMuted] = useState(false);
  const [cameras, setCameras] = useState<DeviceOption[]>([]);
  const [cameraId, setCameraId] = useState<string | null>(null);
  const [posting, setPosting] = useState<null | 'upload' | 'post' | 'reel'>(null);
  const [postError, setPostError] = useState<string | null>(null);

  const videoLiveRef = useRef<HTMLVideoElement | null>(null);
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const supportedMime = pickMimeType();

  const stopAllTracks = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  }, []);

  // Enumerate cameras after first permission grant.
  const refreshDevices = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      const vids = list.filter(d => d.kind === 'videoinput').map(d => ({ deviceId: d.deviceId, label: d.label || 'Camera' }));
      setCameras(vids);
      if (!cameraId && vids[0]) setCameraId(vids[0].deviceId);
    } catch { /* enumerate without permission returns empty labels — acceptable */ }
  }, [cameraId]);

  // Acquire camera + mic on mount (or when cameraId changes).
  const acquireStream = useCallback(async () => {
    setPermError(null);
    stopAllTracks();
    try {
      const constraints: MediaStreamConstraints = {
        audio: { echoCancellation: true, noiseSuppression: true },
        video: cameraId
          ? { deviceId: { exact: cameraId }, width: { ideal: 720 }, height: { ideal: 1280 }, frameRate: { ideal: 30 } }
          : { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 1280 }, frameRate: { ideal: 30 } },
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoLiveRef.current) {
        videoLiveRef.current.srcObject = stream;
        await videoLiveRef.current.play().catch(() => { /* autoplay blocked */ });
      }
      await refreshDevices();
    } catch (e) {
      setPermError(e instanceof Error ? e.message : 'Camera/microphone permission denied');
    }
  }, [cameraId, refreshDevices, stopAllTracks]);

  useEffect(() => {
    if (!supportedMime) return;
    acquireStream();
    return () => {
      stopAllTracks();
      if (timerRef.current) clearInterval(timerRef.current);
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        try { recorderRef.current.stop(); } catch { /* ignore */ }
      }
      if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraId, supportedMime]);

  const startRecording = useCallback(() => {
    if (!streamRef.current || !supportedMime) return;
    chunksRef.current = [];
    setRecordedBlob(null);
    if (recordedUrl) { URL.revokeObjectURL(recordedUrl); setRecordedUrl(null); }
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(streamRef.current, { mimeType: supportedMime, videoBitsPerSecond: 2_500_000 });
    } catch (e) {
      setPermError(e instanceof Error ? e.message : 'Could not start MediaRecorder');
      return;
    }
    recorderRef.current = rec;
    rec.ondataavailable = (ev) => { if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data); };
    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: supportedMime });
      const url = URL.createObjectURL(blob);
      setRecordedBlob(blob);
      setRecordedUrl(url);
      setRecordedMime(supportedMime);
      setRecording(false);
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    };
    rec.start(250); // emit chunks every 250ms so a stop captures recent data
    setRecording(true);
    setElapsedMs(0);
    const t0 = Date.now();
    timerRef.current = setInterval(() => {
      const dt = Date.now() - t0;
      setElapsedMs(dt);
      if (dt >= MAX_DURATION_S * 1000) {
        try { rec.stop(); } catch { /* ignore */ }
      }
    }, 100);
  }, [recordedUrl, supportedMime]);

  const stopRecording = useCallback(() => {
    if (!recorderRef.current || recorderRef.current.state === 'inactive') return;
    try { recorderRef.current.stop(); } catch { /* ignore */ }
  }, []);

  const retake = useCallback(() => {
    if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    setRecordedBlob(null);
    setRecordedUrl(null);
    setElapsedMs(0);
    setPostError(null);
  }, [recordedUrl]);

  // Toggle outbound mic during recording (post-recording it's baked in).
  const toggleMicLive = useCallback(() => {
    if (!streamRef.current) return;
    const next = !muted;
    streamRef.current.getAudioTracks().forEach(t => { t.enabled = !next; });
    setMuted(next);
  }, [muted]);

  const post = useMutation<CreateReelResponse, Error>({
    mutationFn: async (): Promise<CreateReelResponse> => {
      if (!recordedBlob) throw new Error('no recording');
      setPostError(null);

      // 1. Upload blob to artifact store.
      setPosting('upload');
      const up = await uploadReelBlob(recordedBlob, recordedMime);
      if (!up.ok || !up.dtuId) throw new Error(up.error || 'artifact_upload_failed');
      const videoUrl = `/api/artifact/${up.dtuId}/stream`;

      // 2. Create the social post that anchors the reel in feeds.
      setPosting('post');
      const sp = await createSocialPost({ mediaUrl: videoUrl, caption });
      if (!sp.ok || !sp.post?.id) throw new Error(sp.error || 'social_post_failed');

      // 3. Register the reel against that post.
      setPosting('reel');
      const reelId = `reel_${up.dtuId}`;
      const durationSeconds = Math.max(1, Math.min(MAX_DURATION_S, Math.round(elapsedMs / 1000)));
      const videoEl = videoPreviewRef.current;
      const width  = videoEl?.videoWidth  || undefined;
      const height = videoEl?.videoHeight || undefined;
      const cr = await createReel({
        reelId, postId: sp.post.id, videoUrl, durationSeconds, width, height,
        caption: caption || undefined,
        thumbnailUrl: up.thumbnailUrl || null,
      });
      if (!cr.ok) throw new Error(cr.error || cr.reason || 'create_reel_failed');
      return cr;
    },
    onSuccess: (cr) => {
      setPosting(null);
      qc.invalidateQueries({ queryKey: ['reels-for-you'] });
      if (cr.reel?.id && onPosted) onPosted(cr.reel.id);
      onClose();
    },
    onError: (err) => {
      setPosting(null);
      setPostError(err.message || 'Posting failed');
    },
  });

  const remainingS = Math.max(0, MAX_DURATION_S - Math.floor(elapsedMs / 1000));
  const progressPct = Math.min(100, (elapsedMs / (MAX_DURATION_S * 1000)) * 100);

  return (
    <div className="fixed inset-0 z-[70] flex items-stretch sm:items-center justify-center p-0 sm:p-4 bg-black/85 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Record a reel">
      <div className="relative w-full sm:max-w-md bg-zinc-950 sm:rounded-2xl border border-zinc-800 overflow-hidden flex flex-col">
        <header className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-zinc-900/60">
          <Camera className="w-4 h-4 text-rose-300" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-zinc-100 flex-1">Record a reel</h2>
          <span className="text-[10px] text-zinc-500 font-mono">max {MAX_DURATION_S}s</span>
          <button type="button" onClick={onClose} className="p-1 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </header>

        {!supportedMime && (
          <div className="m-4 px-3 py-2 rounded border border-amber-500/40 bg-amber-500/10 text-xs text-amber-100 flex gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div>
              Your browser doesn&apos;t support video recording (MediaRecorder).
              Try Chrome, Firefox, or Edge — or post a reel from the mobile app.
            </div>
          </div>
        )}

        {supportedMime && permError && (
          <div className="m-4 px-3 py-2 rounded border border-rose-500/40 bg-rose-500/10 text-xs text-rose-200 flex gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div className="flex-1">{permError}</div>
            <button type="button" onClick={acquireStream} className="text-rose-200 hover:text-rose-100 text-xs underline">Retry</button>
          </div>
        )}

        {supportedMime && (
          <div className="relative bg-black aspect-[9/16] flex items-center justify-center">
            {!recordedBlob ? (
              <video
                ref={videoLiveRef}
                autoPlay
                muted
                playsInline
                className="w-full h-full object-cover"
              />
            ) : (
              <video
                ref={videoPreviewRef}
                src={recordedUrl || undefined}
                controls
                playsInline
                className="w-full h-full object-contain"
              />
            )}

            {/* Live progress bar while recording */}
            {recording && (
              <div className="absolute top-0 left-0 right-0 h-1 bg-white/10">
                <div className="h-full bg-rose-500" style={{ width: `${progressPct}%` }} />
              </div>
            )}

            {/* REC indicator */}
            {recording && (
              <div className="absolute top-3 left-3 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-black/60 text-white text-[10px] font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                REC · {remainingS}s
              </div>
            )}

            {/* Camera selector (only between recordings) */}
            {!recording && !recordedBlob && cameras.length > 1 && (
              <select
                value={cameraId || ''}
                onChange={(e) => setCameraId(e.target.value)}
                className="absolute top-3 right-3 text-[10px] bg-black/70 text-zinc-100 border border-zinc-700 rounded px-1.5 py-0.5"
              >
                {cameras.map(c => <option key={c.deviceId} value={c.deviceId}>{c.label}</option>)}
              </select>
            )}
          </div>
        )}

        {/* Controls */}
        {supportedMime && (
          <div className="px-4 py-3 border-t border-zinc-800 bg-zinc-900/40 space-y-3">
            {!recordedBlob ? (
              <div className="flex items-center gap-3 justify-center">
                <button
                  type="button"
                  onClick={toggleMicLive}
                  disabled={!streamRef.current}
                  className={cn(
                    'p-2 rounded-full border',
                    muted ? 'border-rose-500/60 text-rose-200 bg-rose-500/10' : 'border-zinc-700 text-zinc-300',
                    'disabled:opacity-40',
                  )}
                  title={muted ? 'Unmute mic' : 'Mute mic'}
                >
                  {muted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </button>

                {!recording ? (
                  <button
                    type="button"
                    onClick={startRecording}
                    disabled={!streamRef.current}
                    className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-rose-600 hover:bg-rose-500 disabled:opacity-40 ring-4 ring-rose-500/30"
                    aria-label="Start recording"
                  >
                    <Circle className="w-6 h-6 text-white fill-white" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={stopRecording}
                    className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-zinc-200 hover:bg-white text-zinc-900 ring-4 ring-zinc-500/30"
                    aria-label="Stop recording"
                  >
                    <Square className="w-6 h-6 fill-current" />
                  </button>
                )}

                <span className="w-9 text-center text-[11px] font-mono text-zinc-500">{Math.floor(elapsedMs / 1000)}s</span>
              </div>
            ) : (
              <div className="space-y-3">
                <textarea
                  value={caption}
                  onChange={(e) => setCaption(e.target.value.slice(0, 300))}
                  rows={2}
                  placeholder="Caption (optional)…"
                  className="w-full text-sm bg-zinc-900 border border-zinc-700 rounded p-2 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-rose-500/40 resize-none"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={retake}
                    disabled={posting !== null}
                    className="inline-flex items-center gap-1 px-3 py-2 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800 text-xs disabled:opacity-40"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Retake
                  </button>
                  <button
                    type="button"
                    onClick={() => post.mutate()}
                    disabled={posting !== null || !recordedBlob}
                    className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-2 rounded bg-rose-600 hover:bg-rose-500 text-white text-sm font-medium disabled:opacity-40"
                  >
                    {posting === null ? (<><Send className="w-4 h-4" /> Post reel</>) : (
                      <><Loader2 className="w-4 h-4 animate-spin" /> {posting === 'upload' ? 'Uploading…' : posting === 'post' ? 'Posting…' : 'Finalizing…'}</>
                    )}
                  </button>
                </div>
                {postError && (
                  <div className="px-2 py-1 rounded border border-rose-500/40 bg-rose-500/10 text-[11px] text-rose-200">
                    {postError}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default ReelRecorder;
