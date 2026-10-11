'use client';

/**
 * CreateEpisodePanel — new episode form + mic recording + media upload.
 * Extracted from former podcast/page.tsx Create tab. Recording uploads
 * through POST /api/media/upload (real media id — no fake local-recording-*).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Play, Pause, Plus, Check, X, Trash2, Square, CircleDot,
} from 'lucide-react';
import { api } from '@/lib/api/client';
import { showToast } from '@/components/common/Toasts';
import { DraftedTextarea } from '@/components/lens/DraftedTextarea';
import { MediaUpload } from '@/components/media/MediaUpload';
import { useLensCommand } from '@/hooks/useLensCommand';
import { probeAudioFileDuration } from '@/lib/podcast/probe-audio-duration';
import { useMyPodcastShow } from './useMyPodcastShow';
import { formatDuration } from './types';

const UPLOAD_AUDIO_FIRST = 'Upload the audio first';

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

async function uploadAudioBlob(blob: Blob, opts: { title: string; filename: string; durationHint: number }) {
  const probed = opts.durationHint > 0 ? opts.durationHint : await probeAudioFileDuration(blob);
  const mimeType = (blob.type || 'audio/webm').split(';')[0] || 'audio/webm';
  const r = await api.post('/api/media/upload', {
    title: opts.title,
    mediaType: 'audio',
    mimeType,
    fileSize: blob.size,
    originalFilename: opts.filename,
    duration: probed > 0 ? probed : undefined,
    tags: ['podcast'],
    privacy: 'private',
    tier: 'regular',
    data: await blobToBase64(blob),
  });
  const body = r.data as { mediaDTU?: { id?: string; duration?: number }; id?: string; error?: string } | undefined;
  const mediaDTU = body?.mediaDTU;
  const mediaId = mediaDTU?.id ?? body?.id;
  const serverDur = Number(mediaDTU?.duration);
  const duration = serverDur > 0 ? Math.round(serverDur) : probed;
  if (!mediaId) {
    throw new Error(body?.error || UPLOAD_AUDIO_FIRST);
  }
  return { mediaId: String(mediaId), duration };
}

export function CreateEpisodePanel({ onCreated }: { onCreated?: () => void }) {
  const { createEpisode, episodes } = useMyPodcastShow();

  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formEpisodeNum, setFormEpisodeNum] = useState(1);
  const [formSeasonNum, setFormSeasonNum] = useState(1);
  const [formCoverArt, setFormCoverArt] = useState<string | null>(null);
  const [formMediaId, setFormMediaId] = useState<string | null>(null);
  const [formDuration, setFormDuration] = useState(0);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const pendingFileRef = useRef<File | null>(null);
  const episodeNumDirty = useRef(false);

  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [uploadingRecording, setUploadingRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    return () => {
      if (recordedUrl) URL.revokeObjectURL(recordedUrl);
      if (timerRef.current) clearInterval(timerRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (episodeNumDirty.current) return;
    const max = episodes.reduce((m, e) => {
      if ((e.seasonNumber || 1) !== formSeasonNum) return m;
      return Math.max(m, Number(e.episodeNumber) || 0);
    }, 0);
    setFormEpisodeNum(max + 1);
  }, [episodes, formSeasonNum]);

  const handleStartRecording = useCallback(async () => {
    setMicError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        const url = URL.createObjectURL(blob);
        if (recordedUrl) URL.revokeObjectURL(recordedUrl);
        setRecordedBlob(blob);
        setRecordedUrl(url);
        setIsRecording(false);
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      };

      recorder.start(250);
      setIsRecording(true);
      setRecordingTime(0);
      setRecordedBlob(null);
      if (recordedUrl) { URL.revokeObjectURL(recordedUrl); setRecordedUrl(null); }

      const start = Date.now();
      timerRef.current = setInterval(() => {
        setRecordingTime(Math.floor((Date.now() - start) / 1000));
      }, 200);
    } catch (err) {
      const msg = err instanceof DOMException && err.name === 'NotAllowedError'
        ? 'Microphone access denied. Please allow microphone permissions.'
        : 'Could not access microphone. Check your device settings.';
      setMicError(msg);
      console.error('[Podcast] getUserMedia failed:', err);
    }
  }, [recordedUrl]);

  const handleStopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const handlePlayPreview = useCallback(() => {
    if (!recordedUrl) return;
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current = null;
      setIsPlayingPreview(false);
      return;
    }
    const audio = new Audio(recordedUrl);
    previewAudioRef.current = audio;
    setIsPlayingPreview(true);
    audio.onended = () => { previewAudioRef.current = null; setIsPlayingPreview(false); };
    audio.play().catch(() => { setIsPlayingPreview(false); });
  }, [recordedUrl]);

  const handleUseRecording = useCallback(async () => {
    if (!recordedBlob) return;
    setUploadingRecording(true);
    try {
      const uploaded = await uploadAudioBlob(recordedBlob, {
        title: formTitle.trim() || `Recording ${new Date().toLocaleString()}`,
        filename: `recording-${Date.now()}.webm`,
        durationHint: recordingTime,
      });
      setFormDuration(uploaded.duration > 0 ? uploaded.duration : recordingTime);
      setFormMediaId(uploaded.mediaId);
      showToast('success', `Recording uploaded (${formatDuration(uploaded.duration || recordingTime)})`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Recording upload failed';
      showToast('error', message);
    } finally {
      setUploadingRecording(false);
    }
  }, [recordedBlob, recordingTime, formTitle]);

  const handleDiscardRecording = useCallback(() => {
    if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    setRecordedBlob(null);
    setRecordedUrl(null);
    setRecordingTime(0);
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current = null;
    }
    setIsPlayingPreview(false);
  }, [recordedUrl]);

  useLensCommand(
    [{ id: 'preview-toggle', keys: 'space', description: 'Play / pause preview', category: 'actions', action: handlePlayPreview }],
    { lensId: 'podcast' },
  );

  const handlePendingFile = useCallback((file: File | null) => {
    pendingFileRef.current = file;
    if (!file) return;
    probeAudioFileDuration(file).then((sec) => {
      if (sec > 0 && pendingFileRef.current === file) setFormDuration(sec);
    });
  }, []);

  const handleCreateEpisode = useCallback(async () => {
    if (creating) return;
    if (!formTitle.trim()) {
      setCreateError('Episode title is required');
      showToast('error', 'Episode title is required');
      return;
    }
    setCreating(true);
    setCreateError(null);
    let mediaId = formMediaId;
    let durationSec = formDuration;
    const pending = pendingFileRef.current;
    try {
      if (!mediaId && (pending || recordedBlob)) {
        try {
          const uploaded = pending
            ? await uploadAudioBlob(pending, {
              title: formTitle.trim(),
              filename: pending.name || 'episode-audio',
              durationHint: durationSec,
            })
            : await uploadAudioBlob(recordedBlob as Blob, {
              title: formTitle.trim() || `Recording ${new Date().toLocaleString()}`,
              filename: `recording-${Date.now()}.webm`,
              durationHint: recordingTime || durationSec,
            });
          mediaId = uploaded.mediaId;
          if (uploaded.duration > 0) durationSec = uploaded.duration;
          setFormMediaId(mediaId);
          setFormDuration(durationSec);
          pendingFileRef.current = null;
        } catch (err) {
          const detail = err instanceof Error ? err.message : '';
          const message = !detail || detail === UPLOAD_AUDIO_FIRST
            ? UPLOAD_AUDIO_FIRST
            : `${UPLOAD_AUDIO_FIRST} — ${detail}`;
          setCreateError(message);
          showToast('error', message);
          return;
        }
      }
      if ((pending || recordedBlob) && !mediaId) {
        setCreateError(UPLOAD_AUDIO_FIRST);
        showToast('error', UPLOAD_AUDIO_FIRST);
        return;
      }
      const created = await createEpisode({
        title: formTitle,
        description: formDescription,
        episodeNumber: formEpisodeNum,
        seasonNumber: formSeasonNum,
        coverArtUrl: formCoverArt,
        mediaId,
        audioUrl: mediaId ? `/api/media/${mediaId}/stream` : null,
        durationSec,
        status: 'draft',
        tags: [],
      });
      episodeNumDirty.current = false;
      setFormTitle('');
      setFormDescription('');
      setFormEpisodeNum((created.episodeNumber && created.episodeNumber > 0 ? created.episodeNumber : formEpisodeNum) + 1);
      setFormCoverArt(null);
      setFormMediaId(null);
      setFormDuration(0);
      pendingFileRef.current = null;
      if (recordedUrl) URL.revokeObjectURL(recordedUrl);
      setRecordedBlob(null);
      setRecordedUrl(null);
      setRecordingTime(0);
      onCreated?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not create episode';
      setCreateError(message);
      showToast('error', message);
    } finally {
      setCreating(false);
    }
  }, [creating, formTitle, formDescription, formEpisodeNum, formSeasonNum, formCoverArt, formMediaId, formDuration, recordedBlob, recordedUrl, recordingTime, createEpisode, onCreated]);

  const handleAudioUpload = useCallback((_data: unknown, _file: File) => {
    const uploadData = _data as Record<string, unknown>;
    const mediaDTU = uploadData?.mediaDTU as Record<string, unknown> | undefined;
    const mediaId = (mediaDTU?.id || uploadData?.mediaId || uploadData?.id) as string | undefined;
    if (mediaId) setFormMediaId(mediaId);
    const dur = (mediaDTU?.duration || uploadData?.duration) as number | undefined;
    if (dur) setFormDuration(dur);
  }, []);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h2 className="text-lg font-semibold flex items-center gap-2"><Plus className="w-4 h-4" /> Create New Episode</h2>

      <div>
        <label className="text-xs text-gray-400 mb-1 block">Title</label>
        <input
          type="text"
          value={formTitle}
          onChange={(e) => setFormTitle(e.target.value)}
          placeholder="Episode title"
          className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder:text-gray-400 focus:outline-none focus:border-purple-400/50"
        />
      </div>

      <div>
        <label className="text-xs text-gray-400 mb-1 block">Description</label>
        <DraftedTextarea
          lensId="podcast"
          draftKey="episodeDescription"
          initial=""
          onValueChange={setFormDescription}
          placeholder="Episode description..."
          rows={4}
          className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder:text-gray-400 focus:outline-none focus:border-purple-400/50 resize-none"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Episode Number</label>
          <input
            type="number"
            aria-label="Episode Number"
            value={formEpisodeNum}
            onChange={(e) => { episodeNumDirty.current = true; setFormEpisodeNum(parseInt(e.target.value) || 1); }}
            min={1}
            className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white focus:outline-none focus:border-purple-400/50"
          />
        </div>
        <div>
          <label className="text-xs text-gray-400 mb-1 block">Season Number</label>
          <input
            type="number"
            value={formSeasonNum}
            onChange={(e) => setFormSeasonNum(parseInt(e.target.value) || 1)}
            min={1}
            className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white focus:outline-none focus:border-purple-400/50"
          />
        </div>
      </div>

      <div>
        <label className="text-xs text-gray-400 mb-1 block">Episode Audio</label>
        {formMediaId ? (
          <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/20 rounded-xl">
            <Check className="w-4 h-4 text-green-400" />
            <span className="text-sm text-green-400">Audio uploaded (ID: {formMediaId.slice(0, 8)}...)</span>
            <button onClick={() => setFormMediaId(null)} className="ml-auto text-gray-400 hover:text-white" aria-label="Close">
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <MediaUpload
            defaultMediaType="audio"
            onPendingFileChange={handlePendingFile}
            onUploadComplete={(media) => handleAudioUpload(media, new File([], 'audio'))}
          />
        )}
      </div>

      <div>
        <label className="text-xs text-gray-400 mb-1 block">Record Episode</label>
        <div className="p-4 bg-white/5 border border-white/10 rounded-xl space-y-3">
          {micError && (
            <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-2">
              {micError}
            </div>
          )}

          {isRecording ? (
            <>
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
                <span className="text-sm font-medium text-red-400">Recording</span>
                <span className="text-sm font-mono text-gray-300 ml-auto">
                  {formatDuration(recordingTime)}
                </span>
              </div>
              <div className="flex items-end gap-0.5 h-8 justify-center">
                {Array.from({ length: 24 }).map((_, i) => (
                  <div
                    key={i}
                    className="w-1 bg-purple-400 rounded-full"
                    style={{
                      height: `${20 + Math.random() * 80}%`,
                      animation: `pulse ${0.3 + Math.random() * 0.5}s ease-in-out infinite alternate`,
                      animationDelay: `${i * 0.05}s`,
                    }}
                  />
                ))}
              </div>
              <button
                onClick={handleStopRecording}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-red-500/20 text-red-400 font-medium hover:bg-red-500/30 transition-colors"
              >
                <Square className="w-4 h-4" />
                Stop Recording
              </button>
            </>
          ) : recordedBlob ? (
            <>
              <div className="flex items-center gap-3">
                <Check className="w-4 h-4 text-green-400" />
                <span className="text-sm text-green-400">
                  Recording complete ({formatDuration(recordingTime)})
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handlePlayPreview}
                  className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg bg-white/5 text-gray-300 hover:bg-white/10 transition-colors text-sm"
                >
                  {isPlayingPreview ? (
                    <><Pause className="w-3.5 h-3.5" /> Pause</>
                  ) : (
                    <><Play className="w-3.5 h-3.5" /> Preview</>
                  )}
                </button>
                <button
                  onClick={handleUseRecording}
                  disabled={uploadingRecording}
                  className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg bg-purple-400/20 text-purple-400 hover:bg-purple-400/30 disabled:opacity-40 transition-colors text-sm"
                >
                  <Check className="w-3.5 h-3.5" /> {uploadingRecording ? 'Uploading…' : 'Use Recording'}
                </button>
                <button
                  onClick={handleDiscardRecording}
                  className="flex items-center justify-center px-3 py-2 rounded-lg bg-white/5 text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-colors text-sm"
                  title="Discard recording"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </>
          ) : (
            <>
              <button
                onClick={handleStartRecording}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-purple-400/10 text-purple-400 font-medium hover:bg-purple-400/20 transition-colors"
              >
                <CircleDot className="w-4 h-4" />
                Start Recording
              </button>
              <p className="text-[11px] text-gray-400 text-center">
                Record directly from your microphone
              </p>
            </>
          )}
        </div>
      </div>

      <div>
        <label className="text-xs text-gray-400 mb-1 block">Cover Art URL (optional)</label>
        <input
          type="text"
          value={formCoverArt || ''}
          onChange={(e) => setFormCoverArt(e.target.value || null)}
          placeholder="https://example.com/cover.jpg"
          className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder:text-gray-400 focus:outline-none focus:border-purple-400/50"
        />
      </div>

      {createError && (
        <p role="alert" className="text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2">
          {createError}
        </p>
      )}

      <button
        onClick={handleCreateEpisode}
        disabled={!formTitle.trim() || creating}
        className="w-full py-3 rounded-xl bg-purple-400/20 text-purple-400 font-medium hover:bg-purple-400/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {creating ? 'Creating…' : 'Create Episode'}
      </button>
    </div>
  );
}

export default CreateEpisodePanel;
