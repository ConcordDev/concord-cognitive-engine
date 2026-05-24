'use client';

// PostComposer — create a post via timeline.post-create with media,
// privacy controls and user tagging.

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Globe, Users, Lock, ImagePlus, Film, X, AtSign, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { lensRun } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import type { Privacy, MediaItem, MediaKind } from './types';

const PRIVACY: { id: Privacy; icon: typeof Globe; label: string }[] = [
  { id: 'public', icon: Globe, label: 'Public' },
  { id: 'friends', icon: Users, label: 'Friends' },
  { id: 'private', icon: Lock, label: 'Only me' },
];

export function PostComposer({ onPosted }: { onPosted?: () => void }) {
  const qc = useQueryClient();
  const [content, setContent] = useState('');
  const [privacy, setPrivacy] = useState<Privacy>('private');
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [mediaDraft, setMediaDraft] = useState('');
  const [mediaKind, setMediaKind] = useState<MediaKind>('photo');
  const [tagDraft, setTagDraft] = useState('');
  const [showMediaInput, setShowMediaInput] = useState(false);
  const [showTagInput, setShowTagInput] = useState(false);

  const createMutation = useMutation({
    mutationFn: () =>
      lensRun('timeline', 'post-create', {
        content,
        privacy,
        media,
        taggedUserIds: tags,
      }),
    onSuccess: (r) => {
      if (r.data.ok) {
        qc.invalidateQueries({ queryKey: ['timeline-feed'] });
        qc.invalidateQueries({ queryKey: ['timeline-profile'] });
        setContent('');
        setMedia([]);
        setTags([]);
        onPosted?.();
      } else {
        useUIStore.getState().addToast({ type: 'error', message: r.data.error || 'Post failed' });
      }
    },
    onError: () => useUIStore.getState().addToast({ type: 'error', message: 'Post failed' }),
  });

  const addMedia = () => {
    if (!mediaDraft.trim()) return;
    setMedia((m) => [...m, { kind: mediaKind, url: mediaDraft.trim() }]);
    setMediaDraft('');
    setShowMediaInput(false);
  };
  const addTag = () => {
    const t = tagDraft.trim();
    if (!t || tags.includes(t)) return;
    setTags((x) => [...x, t]);
    setTagDraft('');
  };

  const canPost = (content.trim().length > 0 || media.length > 0) && !createMutation.isPending;

  return (
    <div className="bg-[#242526] rounded-lg p-4 space-y-3">
      <div className="flex gap-3">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex-shrink-0" />
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="What's on your mind?"
          rows={2}
          className="flex-1 bg-[#3a3b3c] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-400 outline-none resize-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* Attached media chips */}
      {media.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {media.map((m, i) => (
            <div key={`${m.url}-${i}`} className="flex items-center gap-1.5 bg-[#3a3b3c] rounded px-2 py-1 text-xs text-gray-300">
              {m.kind === 'video' ? <Film className="w-3.5 h-3.5" /> : <ImagePlus className="w-3.5 h-3.5" />}
              <span className="max-w-[140px] truncate">{m.url}</span>
              <button onClick={() => setMedia((x) => x.filter((_, j) => j !== i))} aria-label="Remove media">
                <X className="w-3 h-3 hover:text-red-400" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Tagged users chips */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {tags.map((t) => (
            <div key={t} className="flex items-center gap-1 bg-blue-500/15 text-blue-300 rounded-full px-2 py-0.5 text-xs">
              <AtSign className="w-3 h-3" />
              {t}
              <button onClick={() => setTags((x) => x.filter((y) => y !== t))} aria-label="Remove tag">
                <X className="w-3 h-3 hover:text-red-400" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Media input */}
      {showMediaInput && (
        <div className="flex gap-2">
          <select
            value={mediaKind}
            onChange={(e) => setMediaKind(e.target.value as MediaKind)}
            className="bg-[#3a3b3c] text-white text-xs rounded px-2 outline-none"
          >
            <option value="photo">Photo</option>
            <option value="video">Video</option>
          </select>
          <input
            value={mediaDraft}
            onChange={(e) => setMediaDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addMedia()}
            placeholder="Media URL"
            autoFocus
            className="flex-1 bg-[#3a3b3c] rounded px-3 py-1.5 text-sm text-white placeholder-gray-500 outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button onClick={addMedia} className="px-3 py-1.5 rounded bg-blue-600 text-white text-xs">Add</button>
        </div>
      )}

      {/* Tag input */}
      {showTagInput && (
        <div className="flex gap-2">
          <input
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addTag()}
            placeholder="Tag a user by id"
            autoFocus
            className="flex-1 bg-[#3a3b3c] rounded px-3 py-1.5 text-sm text-white placeholder-gray-500 outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button onClick={addTag} className="px-3 py-1.5 rounded bg-blue-600 text-white text-xs">Add</button>
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-2 pt-2 border-t border-gray-700">
        <div className="flex items-center gap-1">
          <button
            onClick={() => { setShowMediaInput((v) => !v); setShowTagInput(false); }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-[#3a3b3c] text-green-500 text-xs"
          >
            <ImagePlus className="w-4 h-4" /> Photo/video
          </button>
          <button
            onClick={() => { setShowTagInput((v) => !v); setShowMediaInput(false); }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-[#3a3b3c] text-blue-400 text-xs"
          >
            <AtSign className="w-4 h-4" /> Tag
          </button>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            {PRIVACY.map((p) => {
              const Icon = p.icon;
              return (
                <button
                  key={p.id}
                  onClick={() => setPrivacy(p.id)}
                  title={p.label}
                  className={cn(
                    'p-1.5 rounded',
                    privacy === p.id ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-[#3a3b3c]',
                  )}
                >
                  <Icon className="w-4 h-4" />
                </button>
              );
            })}
          </div>
          <button
            onClick={() => createMutation.mutate()}
            disabled={!canPost}
            className={cn(
              'px-5 py-1.5 rounded-lg font-medium text-sm transition-colors inline-flex items-center gap-1.5',
              canPost ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-700 text-gray-400 cursor-not-allowed',
            )}
          >
            {createMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            Post
          </button>
        </div>
      </div>
      {privacy === 'public' && (
        <p className="text-[11px] text-amber-400/80">Public posts are visible to everyone and NPCs.</p>
      )}
    </div>
  );
}
