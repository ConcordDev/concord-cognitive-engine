'use client';

import { useState, useRef, useEffect } from 'react';
import NextImage from 'next/image';
import {
  Play, Pause, ExternalLink, Music, Image, Video, FileText,
  Code2, Gamepad2, Box, Eye, Clock, User,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ArtistryPost, AudioPreview, ImagePreview, VideoPreview, TextPreview, CodePreview } from '@/lib/artistry/types';

const CONTENT_TYPE_ICONS: Record<string, typeof Music> = {
  audio: Music,
  image: Image,
  video: Video,
  text: FileText,
  code: Code2,
  interactive: Gamepad2,
  '3d': Box,
};

const LENS_COLORS: Record<string, string> = {
  music: 'text-neon-cyan',
  art: 'text-neon-pink',
  code: 'text-neon-green',
  creative: 'text-neon-purple',
  game: 'text-yellow-400',
  video: 'text-red-400',
  writing: 'text-blue-400',
};

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

interface PreviewCardProps {
  post: ArtistryPost;
  onViewInLens: (post: ArtistryPost) => void;
}

export function PreviewCard({ post, onViewInLens }: PreviewCardProps) {
  const ContentIcon = CONTENT_TYPE_ICONS[post.contentType] || Eye;
  const lensColor = LENS_COLORS[post.sourceLens] || 'text-gray-400';

  return (
    <div className="bg-white/[0.03] rounded-xl border border-white/5 hover:border-white/10 transition-all overflow-hidden group">
      {/* Preview content (type-specific) */}
      <PreviewContent post={post} />

      {/* Info section */}
      <div className="p-3 space-y-2">
        {/* Title & creator */}
        <div>
          <h3 className="text-sm font-medium line-clamp-2">{post.title}</h3>
          <div className="flex items-center gap-2 mt-1">
            <div className="relative w-5 h-5 rounded-full bg-white/10 overflow-hidden flex-shrink-0">
              {post.creatorAvatarUrl ? (
                <NextImage src={post.creatorAvatarUrl} alt={post.creatorName || 'Creator avatar'} fill className="object-cover" unoptimized />
              ) : (
                <User className="w-3 h-3 m-1 text-gray-500" />
              )}
            </div>
            <span className="text-xs text-gray-400 truncate">{post.creatorName}</span>
          </div>
        </div>

        {/* Description */}
        {post.description && (
          <p className="text-xs text-gray-500 line-clamp-2">{post.description}</p>
        )}

        {/* Tags */}
        {post.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {post.tags.slice(0, 4).map(tag => (
              <span key={tag} className="px-1.5 py-0.5 rounded-full bg-white/5 text-[9px] text-gray-500">
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Footer: source lens + time + view button */}
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-2 text-[10px] text-gray-500">
            <ContentIcon className={cn('w-3 h-3', lensColor)} />
            <span className={cn('capitalize', lensColor)}>{post.sourceLens}</span>
            <span className="flex items-center gap-0.5">
              <Clock className="w-2.5 h-2.5" /> {formatTimeAgo(post.createdAt)}
            </span>
          </div>

          {/* THE key action: view in source lens. No citation. No download. */}
          <button
            onClick={() => onViewInLens(post)}
            className={cn(
              'flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-medium transition-colors',
              'bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white',
            )}
          >
            <ExternalLink className="w-3 h-3" />
            View in {post.sourceLens}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Type-Specific Preview Renderers ----

function PreviewContent({ post }: { post: ArtistryPost }) {
  switch (post.preview.type) {
    case 'audio': return <AudioPreviewRender preview={post.preview} />;
    case 'image': return <ImagePreviewRender preview={post.preview} />;
    case 'video': return <VideoPreviewRender preview={post.preview} />;
    case 'text': return <TextPreviewRender preview={post.preview} />;
    case 'code': return <CodePreviewRender preview={post.preview} />;
    default: return <GenericPreviewRender post={post} />;
  }
}

function AudioPreviewRender({ preview }: { preview: AudioPreview }) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.src = '';
        audio.load();
      }
    };
  }, []);

  const togglePlay = () => {
    if (!audioRef.current) {
      const audio = new Audio(preview.previewUrl);
      audio.ontimeupdate = () => {
        setProgress(audio.currentTime / (audio.duration || 1));
      };
      audio.onended = () => setPlaying(false);
      audioRef.current = audio;
    }

    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
    } else {
      audioRef.current.play();
      setPlaying(true);
    }
  };

  return (
    <div className="relative aspect-square bg-gradient-to-br from-neon-cyan/10 to-neon-purple/10 overflow-hidden">
      {/* Cover art */}
      {preview.coverArtUrl ? (
        <NextImage src={preview.coverArtUrl} alt="Cover art" fill className="object-cover" unoptimized />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <Music className="w-16 h-16 text-gray-600" />
        </div>
      )}

      {/* Waveform overlay */}
      <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-black/60 to-transparent px-3 py-2">
        <svg viewBox="0 0 200 30" className="w-full h-full" preserveAspectRatio="none">
          {preview.waveformPeaks.slice(0, 200).map((peak, i) => (
            <rect
              key={i}
              x={i}
              y={15 - Math.abs(peak) * 15}
              width={0.8}
              height={Math.abs(peak) * 30}
              fill={i / 200 < progress ? 'var(--neon-cyan)' : 'rgba(255,255,255,0.3)'}
            />
          ))}
        </svg>
      </div>

      {/* Play button */}
      <button
        onClick={togglePlay}
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-14 h-14 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center border border-white/20 hover:bg-black/70 transition-all group-hover:scale-105"
      >
        {playing ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 ml-0.5" />}
      </button>

      {/* Audio meta */}
      <div className="absolute top-2 right-2 flex gap-1">
        {preview.bpm && (
          <span className="px-1.5 py-0.5 rounded bg-black/50 text-[9px] text-white backdrop-blur-sm">
            {preview.bpm} BPM
          </span>
        )}
        {preview.key && (
          <span className="px-1.5 py-0.5 rounded bg-black/50 text-[9px] text-white backdrop-blur-sm">
            {preview.key}
          </span>
        )}
      </div>

      {/* Preview duration badge */}
      <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-black/50 text-[9px] text-gray-300 backdrop-blur-sm">
        {Math.round(preview.previewDuration)}s preview
      </span>
    </div>
  );
}

function ImagePreviewRender({ preview }: { preview: ImagePreview }) {
  const [zoomed, setZoomed] = useState(false);

  return (
    <div
      className={cn('relative overflow-hidden cursor-pointer', zoomed ? 'max-h-[600px]' : 'aspect-square')}
      onClick={() => setZoomed(!zoomed)}
    >
      <NextImage
        src={preview.imageUrl}
        alt="Image preview"
        fill
        className={cn('transition-all', zoomed ? 'object-contain' : 'object-cover')}
        unoptimized
      />
      {preview.medium && (
        <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-black/50 text-[9px] text-gray-300 backdrop-blur-sm capitalize">
          {preview.medium}
        </span>
      )}
    </div>
  );
}

function VideoPreviewRender({ preview }: { preview: VideoPreview }) {
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  return (
    <div className="relative aspect-video bg-black overflow-hidden">
      {playing ? (
        <video
          ref={videoRef}
          src={preview.previewUrl}
          className="w-full h-full object-contain"
          autoPlay
          onEnded={() => setPlaying(false)}
          controls
        />
      ) : (
        <>
          <NextImage src={preview.thumbnailUrl} alt="Video thumbnail" fill className="object-cover" unoptimized />
          <button
            onClick={() => setPlaying(true)}
            className="absolute inset-0 flex items-center justify-center bg-black/20 hover:bg-black/30 transition"
          aria-label="Play">
            <div className="w-14 h-14 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center border border-white/20">
              <Play className="w-6 h-6 ml-0.5" />
            </div>
          </button>
          <span className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/50 text-[9px] text-gray-300 backdrop-blur-sm">
            {Math.round(preview.previewDuration)}s preview
          </span>
        </>
      )}
    </div>
  );
}

function TextPreviewRender({ preview }: { preview: TextPreview }) {
  return (
    <div className="p-4 max-h-64 overflow-hidden relative">
      <div className="prose prose-invert prose-sm max-w-none">
        <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap line-clamp-[10]">
          {preview.excerpt}
        </p>
      </div>
      <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-lattice-void to-transparent" />
      <div className="absolute top-2 right-2 flex gap-1">
        {preview.genre && (
          <span className="px-1.5 py-0.5 rounded bg-white/5 text-[9px] text-gray-400 capitalize">
            {preview.genre}
          </span>
        )}
        <span className="px-1.5 py-0.5 rounded bg-white/5 text-[9px] text-gray-400">
          {preview.wordCount.toLocaleString()} words
        </span>
      </div>
    </div>
  );
}

function CodePreviewRender({ preview }: { preview: CodePreview }) {
  return (
    <div className="relative max-h-56 overflow-hidden">
      <pre className="p-3 text-[11px] font-mono leading-relaxed text-gray-300 overflow-hidden">
        <code>{preview.excerpt}</code>
      </pre>
      <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-lattice-void to-transparent" />
      <div className="absolute top-2 right-2 flex gap-1">
        <span className="px-1.5 py-0.5 rounded bg-white/5 text-[9px] text-neon-green font-mono">
          {preview.language}
        </span>
        <span className="px-1.5 py-0.5 rounded bg-white/5 text-[9px] text-gray-400">
          {preview.totalLines} lines
        </span>
      </div>
    </div>
  );
}

function GenericPreviewRender({ post }: { post: ArtistryPost }) {
  const Icon = CONTENT_TYPE_ICONS[post.contentType] || Eye;
  return (
    <div className="aspect-video bg-gradient-to-br from-white/5 to-white/[0.02] flex items-center justify-center">
      <Icon className="w-16 h-16 text-gray-600" />
    </div>
  );
}
