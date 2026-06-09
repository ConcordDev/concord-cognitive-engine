'use client';

/**
 * FeedComposer — purpose-built composer for the social-domain feed.
 *
 * Backlog items 6 (media attachment upload) and 9 (polls + quote-posts).
 * Calls social.createPost / social.registerMedia. No fake data — every
 * field is real user input.
 */

import { useCallback, useRef, useState } from 'react';
import {
  Send, Image as ImageIcon, BarChart3, X, Loader2, AlertTriangle, Quote,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import type { MediaAttachment, SocialPost } from './types';

interface FeedComposerProps {
  username: string;
  quotePost?: SocialPost | null;
  onClearQuote?: () => void;
  onPosted: () => void;
}

const MAX_LEN = 2000;

export function FeedComposer({ username, quotePost, onClearQuote, onPosted }: FeedComposerProps) {
  const [body, setBody] = useState('');
  const [media, setMedia] = useState<MediaAttachment[]>([]);
  const [pollMode, setPollMode] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState<string[]>(['', '']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    const next: MediaAttachment[] = [];
    for (const file of Array.from(files).slice(0, 4 - media.length)) {
      const isImage = file.type.startsWith('image/');
      const isVideo = file.type.startsWith('video/');
      if (!isImage && !isVideo) { setError('Only image or video files are supported.'); continue; }
      if (file.size > 8 * 1024 * 1024) { setError(`${file.name} exceeds the 8 MB limit.`); continue; }
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('read failed'));
        reader.readAsDataURL(file);
      });
      const r = await lensRun<{ attachment: MediaAttachment }>('social', 'registerMedia', {
        kind: isImage ? 'image' : 'video',
        url: dataUrl,
        alt: file.name,
        mime: file.type,
      });
      if (r.data?.ok && r.data.result?.attachment) next.push(r.data.result.attachment);
      else setError(r.data?.error || 'Attachment rejected.');
    }
    if (next.length) setMedia((m) => [...m, ...next].slice(0, 4));
  }, [media.length]);

  const setOption = (i: number, v: string) =>
    setPollOptions((opts) => opts.map((o, idx) => (idx === i ? v : o)));

  const submit = useCallback(async () => {
    setError(null);
    const trimmed = body.trim();
    const cleanOptions = pollOptions.map((o) => o.trim()).filter(Boolean);
    if (pollMode && cleanOptions.length < 2) { setError('A poll needs at least 2 options.'); return; }
    if (!trimmed && media.length === 0 && !pollMode && !quotePost) {
      setError('Write something, attach media, add a poll, or quote a post.');
      return;
    }
    setBusy(true);
    const r = await lensRun<{ post: SocialPost }>('social', 'createPost', {
      body: trimmed,
      username,
      media,
      quoteOf: quotePost?.id,
      poll: pollMode
        ? { question: pollQuestion.trim(), options: cleanOptions }
        : undefined,
    });
    setBusy(false);
    if (r.data?.ok) {
      setBody(''); setMedia([]); setPollMode(false);
      setPollQuestion(''); setPollOptions(['', '']);
      onClearQuote?.();
      onPosted();
    } else {
      setError(r.data?.error || 'Failed to publish post.');
    }
  }, [body, media, pollMode, pollOptions, pollQuestion, quotePost, username, onClearQuote, onPosted]);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 space-y-2">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value.slice(0, MAX_LEN))}
        placeholder={quotePost ? 'Add a comment to your quote…' : "What's happening? Use #hashtags."}
        rows={3}
        className="w-full resize-none bg-transparent text-sm text-zinc-100 placeholder-zinc-600 outline-none"
      />

      {quotePost && (
        <div className="rounded border border-zinc-800 bg-zinc-900/50 p-2 text-xs">
          <div className="flex items-center gap-1.5 text-zinc-400">
            <Quote className="w-3 h-3" />
            <span className="font-medium text-zinc-300">@{quotePost.username}</span>
            <button aria-label="Clear" type="button" onClick={onClearQuote} className="ml-auto text-zinc-400 hover:text-zinc-300">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="mt-1 text-zinc-400 line-clamp-2">{quotePost.body || '(media post)'}</p>
        </div>
      )}

      {media.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {media.map((m, i) => (
            <div key={`${m.url.slice(0, 24)}-${i}`} className="relative rounded overflow-hidden border border-zinc-800">
              {m.kind === 'image' ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.url} alt={m.alt || 'attachment'} className="h-16 w-full object-cover" />
              ) : (
                <video src={m.url} className="h-16 w-full object-cover" muted />
              )}
              <button
                type="button"
                onClick={() => setMedia((arr) => arr.filter((_, idx) => idx !== i))}
                className="absolute top-0.5 right-0.5 rounded bg-black/70 p-0.5 text-zinc-200 hover:text-white"
                aria-label="Remove attachment"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {pollMode && (
        <div className="space-y-1.5 rounded border border-indigo-500/30 bg-indigo-500/5 p-2">
          <input
            value={pollQuestion}
            onChange={(e) => setPollQuestion(e.target.value.slice(0, 200))}
            placeholder="Poll question (optional)"
            className="w-full rounded bg-zinc-900 px-2 py-1 text-xs text-zinc-100 placeholder-zinc-600 outline-none"
          />
          {pollOptions.map((opt, i) => (
            <div key={`opt-${i}`} className="flex items-center gap-1.5">
              <input
                value={opt}
                onChange={(e) => setOption(i, e.target.value.slice(0, 80))}
                placeholder={`Option ${i + 1}`}
                className="flex-1 rounded bg-zinc-900 px-2 py-1 text-xs text-zinc-100 placeholder-zinc-600 outline-none"
              />
              {pollOptions.length > 2 && (
                <button
                  type="button"
                  onClick={() => setPollOptions((o) => o.filter((_, idx) => idx !== i))}
                  className="text-zinc-400 hover:text-zinc-300"
                  aria-label="Remove option"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
          {pollOptions.length < 6 && (
            <button
              type="button"
              onClick={() => setPollOptions((o) => [...o, ''])}
              className="text-[11px] text-indigo-300 hover:text-indigo-200"
            >
              + Add option
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-1.5 text-xs text-rose-400">
          <AlertTriangle className="w-3.5 h-3.5" /> {error}
        </div>
      )}

      <div className="flex items-center gap-1">
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*"
          multiple
          className="hidden"
          onChange={(e) => { void onFiles(e.target.files); e.target.value = ''; }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={media.length >= 4}
          className="rounded p-1.5 text-zinc-400 hover:bg-zinc-900 hover:text-indigo-300 disabled:opacity-40"
          aria-label="Attach media"
        >
          <ImageIcon className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => setPollMode((p) => !p)}
          className={cn(
            'rounded p-1.5 hover:bg-zinc-900',
            pollMode ? 'text-indigo-300' : 'text-zinc-400 hover:text-indigo-300',
          )}
          aria-label="Toggle poll"
        >
          <BarChart3 className="w-4 h-4" />
        </button>
        <span className="ml-auto text-[10px] font-mono text-zinc-400">{body.length}/{MAX_LEN}</span>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy}
          className="ml-1 flex items-center gap-1.5 rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          Post
        </button>
      </div>
    </div>
  );
}
