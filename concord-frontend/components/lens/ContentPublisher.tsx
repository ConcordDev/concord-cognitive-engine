'use client';

/**
 * ContentPublisher — Universal share/publish from any lens
 *
 * When a user creates content in ANY lens (song, video, article, code, etc.),
 * this component lets them choose where it goes:
 *   1. Post to their social Feed
 *   2. Cross-post to another lens
 *   3. Share externally (X/Twitter, LinkedIn, Instagram, Copy Link)
 *   4. Publish to Marketplace
 *
 * Wired into the lens layout so it's available everywhere via a floating
 * share button or as a composable component embedded in lens pages.
 */

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api/client';
import {
  Share2, Send, Store, ExternalLink, X, Check, Copy,
  Link2, Rss, ChevronRight, Loader2, Globe, Lock,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Types ────────────────────────────────────────────────────────────────────

interface ContentPublisherProps {
  /** Current lens domain (e.g., 'music', 'code', 'artistry') */
  domain: string;
  /** Artifact ID to publish */
  artifactId?: string;
  /** Title of the content */
  title?: string;
  /** Description or summary */
  description?: string;
  /** Content type (e.g., 'track', 'script', 'post', 'video') */
  contentType?: string;
  /** Tags for discovery */
  tags?: string[];
  /** Compact mode (small button) */
  compact?: boolean;
  /** Custom class */
  className?: string;
  /** Callback after successful publish */
  onPublished?: (target: string) => void;
}

type PublishTarget = 'feed' | 'external' | 'marketplace' | 'lens';
type ExternalPlatform = 'x' | 'linkedin' | 'instagram' | 'link';

// ── Platform SVG icons ───────────────────────────────────────────────────────

function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

// ── Target Lenses for cross-posting ──────────────────────────────────────────

const CROSS_POST_LENSES = [
  { id: 'feed', label: 'Social Feed', desc: 'Post to your followers' },
  { id: 'artistry', label: 'Artistry', desc: 'Showcase creative work' },
  { id: 'marketplace', label: 'Marketplace', desc: 'List for sale or free' },
  { id: 'forum', label: 'Forum', desc: 'Start a discussion' },
  { id: 'news', label: 'News', desc: 'Publish as announcement' },
  { id: 'music', label: 'Music', desc: 'Share as a release' },
  { id: 'creative', label: 'Creative', desc: 'Add to creative registry' },
  { id: 'code', label: 'Code', desc: 'Share as a snippet' },
];

// ── Main Component ───────────────────────────────────────────────────────────

export function ContentPublisher({
  domain,
  artifactId,
  title = '',
  description = '',
  contentType = 'post',
  tags = [],
  compact = false,
  className,
  onPublished,
}: ContentPublisherProps) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<PublishTarget>('feed');
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState<string | null>(null);
  const [copiedPlatform, setCopiedPlatform] = useState<string | null>(null);
  const [postText, setPostText] = useState(description || title);
  const [selectedLens, setSelectedLens] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<'public' | 'followers'>('public');

  const shareUrl = typeof window !== 'undefined'
    ? artifactId
      ? `${window.location.origin}/lens/${domain}/${artifactId}`
      : `${window.location.origin}/lenses/${domain}`
    : '';

  const reset = useCallback(() => {
    setPublished(null);
    setPublishing(false);
    setCopiedPlatform(null);
    setSelectedLens(null);
  }, []);

  // ── Post to Feed ───────────────────────────────────────────────────────────

  const handlePostToFeed = useCallback(async () => {
    setPublishing(true);
    try {
      await api.post('/api/social/post', {
        content: postText || title,
        title,
        tags: [...tags, domain, contentType].filter(Boolean),
        mediaType: contentType,
        sourceLens: domain,
        sourceArtifactId: artifactId,
        visibility,
      });
      setPublished('feed');
      onPublished?.('feed');
    } catch (e) {
      console.error('[ContentPublisher] Feed post failed:', e);
    } finally {
      setPublishing(false);
    }
  }, [postText, title, tags, domain, contentType, artifactId, visibility, onPublished]);

  // ── Cross-post to another lens ─────────────────────────────────────────────

  const handleCrossPost = useCallback(async (targetLens: string) => {
    setPublishing(true);
    try {
      await api.post(`/api/lens/${targetLens}`, {
        type: contentType,
        title,
        data: {
          description: postText || description,
          sourceLens: domain,
          sourceArtifactId: artifactId,
          crossPosted: true,
          originalDomain: domain,
        },
        meta: {
          tags: [...tags, `from:${domain}`, 'cross-post'],
          visibility,
          crossPost: { sourceLens: domain, sourceArtifactId: artifactId },
        },
      });
      setPublished(targetLens);
      onPublished?.(targetLens);
    } catch (e) {
      console.error(`[ContentPublisher] Cross-post to ${targetLens} failed:`, e);
    } finally {
      setPublishing(false);
    }
  }, [contentType, title, postText, description, domain, artifactId, tags, visibility, onPublished]);

  // ── Publish to Marketplace ─────────────────────────────────────────────────

  const handleMarketplace = useCallback(async () => {
    if (!artifactId) return;
    setPublishing(true);
    try {
      await api.post(`/api/dtus/${artifactId}/publish`, {
        description: postText || description,
        lens: domain,
      });
      setPublished('marketplace');
      onPublished?.('marketplace');
    } catch (e) {
      console.error('[ContentPublisher] Marketplace publish failed:', e);
    } finally {
      setPublishing(false);
    }
  }, [artifactId, postText, description, domain, onPublished]);

  // ── External share ─────────────────────────────────────────────────────────

  const handleExternal = useCallback(async (platform: ExternalPlatform) => {
    const text = `${title}\n\n${postText || description}`;
    const hashtags = tags.slice(0, 3).map(t => `#${t}`).join(' ');

    if (platform === 'link') {
      try {
        await navigator.clipboard.writeText(shareUrl);
        setCopiedPlatform('link');
        setTimeout(() => setCopiedPlatform(null), 2000);
      } catch { /* no-op */ }
      return;
    }

    if (platform === 'x') {
      const tweet = `${title}${hashtags ? `\n\n${hashtags}` : ''}\n\n${shareUrl}`;
      const tweetText = tweet.length > 280 ? `${title.slice(0, 200)}\n\n${shareUrl}` : tweet;
      window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}`, '_blank', 'noopener,noreferrer,width=600,height=500');
    } else if (platform === 'linkedin') {
      window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`, '_blank', 'noopener,noreferrer,width=600,height=500');
    } else if (platform === 'instagram') {
      // Instagram doesn't support URL sharing — copy caption
      const caption = `${title}\n\n${(postText || description).slice(0, 1500)}\n\n${hashtags}`;
      try {
        await navigator.clipboard.writeText(caption);
        setCopiedPlatform('instagram');
        setTimeout(() => setCopiedPlatform(null), 2000);
      } catch { /* no-op */ }
    }
  }, [title, postText, description, tags, shareUrl]);

  // ── Available cross-post targets (exclude current lens) ────────────────────

  const crossPostTargets = CROSS_POST_LENSES.filter(l => l.id !== domain);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className={cn('relative', className)}>
      {/* Trigger button */}
      <button
        onClick={() => { setOpen(!open); reset(); }}
        className={cn(
          'flex items-center gap-1.5 rounded-lg transition-all',
          compact
            ? 'px-2 py-1 text-xs text-gray-400 hover:text-neon-cyan hover:bg-neon-cyan/10'
            : 'px-3 py-1.5 text-sm text-gray-400 hover:text-neon-cyan hover:bg-neon-cyan/10 border border-transparent hover:border-neon-cyan/20'
        )}
        title="Publish or share this content"
      >
        <Share2 className={compact ? 'w-3 h-3' : 'w-4 h-4'} />
        {!compact && 'Share'}
      </button>

      {/* Modal */}
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-50 bg-black/40" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -10 }}
              className="fixed inset-x-4 top-[15%] mx-auto max-w-lg z-50 bg-lattice-surface border border-lattice-border rounded-2xl shadow-2xl overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-3 border-b border-lattice-border">
                <h3 className="text-sm font-semibold">
                  {published ? 'Published!' : 'Share & Publish'}
                </h3>
                <button onClick={() => setOpen(false)} className="text-gray-500 hover:text-white p-1">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Success state */}
              {published ? (
                <div className="p-8 text-center space-y-3">
                  <div className="w-12 h-12 rounded-full bg-green-500/20 text-green-400 flex items-center justify-center mx-auto">
                    <Check className="w-6 h-6" />
                  </div>
                  <p className="text-sm text-gray-300">
                    {published === 'feed' ? 'Posted to your Feed!' :
                     published === 'marketplace' ? 'Published to Marketplace!' :
                     `Cross-posted to ${published}!`}
                  </p>
                  <button
                    onClick={() => { reset(); }}
                    className="text-xs text-neon-cyan hover:underline"
                  >
                    Share somewhere else
                  </button>
                </div>
              ) : (
                <>
                  {/* Tabs */}
                  <div className="flex border-b border-lattice-border">
                    {([
                      { id: 'feed' as PublishTarget, icon: Rss, label: 'Feed' },
                      { id: 'lens' as PublishTarget, icon: ChevronRight, label: 'Lens' },
                      { id: 'external' as PublishTarget, icon: ExternalLink, label: 'External' },
                      { id: 'marketplace' as PublishTarget, icon: Store, label: 'Market' },
                    ]).map(tab => (
                      <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={cn(
                          'flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs transition-colors',
                          activeTab === tab.id
                            ? 'text-neon-cyan border-b-2 border-neon-cyan bg-neon-cyan/5'
                            : 'text-gray-500 hover:text-gray-300'
                        )}
                      >
                        <tab.icon className="w-3.5 h-3.5" />
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  {/* Content area */}
                  <div className="p-4 space-y-3">
                    {/* Caption input (shared across feed/lens tabs) */}
                    {(activeTab === 'feed' || activeTab === 'lens') && (
                      <>
                        <div className="space-y-2">
                          <textarea
                            value={postText}
                            onChange={(e) => setPostText(e.target.value)}
                            placeholder="Add a caption..."
                            rows={3}
                            className="w-full bg-lattice-deep border border-lattice-border rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600 resize-none focus:outline-none focus:border-neon-cyan/40"
                          />
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => setVisibility(visibility === 'public' ? 'followers' : 'public')}
                                className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
                              >
                                {visibility === 'public' ? <Globe className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                                {visibility === 'public' ? 'Public' : 'Followers only'}
                              </button>
                            </div>
                            <span className="text-[10px] text-gray-600">
                              from {domain} lens
                            </span>
                          </div>
                        </div>

                        {/* Source info */}
                        {title && (
                          <div className="flex items-center gap-2 p-2 rounded-lg bg-lattice-deep/60 border border-lattice-border/50">
                            <div className="w-8 h-8 rounded bg-neon-cyan/10 flex items-center justify-center text-neon-cyan">
                              <Share2 className="w-4 h-4" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium truncate">{title}</p>
                              <p className="text-[10px] text-gray-500">{contentType} from {domain}</p>
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    {/* Tab: Post to Feed */}
                    {activeTab === 'feed' && (
                      <button
                        onClick={handlePostToFeed}
                        disabled={publishing || !postText.trim()}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-neon-cyan/20 text-neon-cyan hover:bg-neon-cyan/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-sm font-medium"
                      >
                        {publishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                        Post to Feed
                      </button>
                    )}

                    {/* Tab: Cross-post to another lens */}
                    {activeTab === 'lens' && (
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {crossPostTargets.map(target => (
                          <button
                            key={target.id}
                            onClick={() => {
                              setSelectedLens(target.id);
                              handleCrossPost(target.id);
                            }}
                            disabled={publishing}
                            className={cn(
                              'w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-colors',
                              selectedLens === target.id && publishing
                                ? 'bg-neon-cyan/10 text-neon-cyan'
                                : 'text-gray-400 hover:text-white hover:bg-lattice-elevated'
                            )}
                          >
                            <div className="text-left">
                              <p className="font-medium">{target.label}</p>
                              <p className="text-[10px] text-gray-600">{target.desc}</p>
                            </div>
                            {selectedLens === target.id && publishing ? (
                              <Loader2 className="w-4 h-4 animate-spin text-neon-cyan" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-gray-600" />
                            )}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Tab: External share */}
                    {activeTab === 'external' && (
                      <div className="space-y-1">
                        {([
                          { id: 'x' as ExternalPlatform, name: 'X / Twitter', icon: <XIcon className="w-4 h-4" />, color: 'hover:bg-white/10 hover:text-white' },
                          { id: 'linkedin' as ExternalPlatform, name: 'LinkedIn', icon: <ExternalLink className="w-4 h-4" />, color: 'hover:bg-blue-500/10 hover:text-blue-400' },
                          { id: 'instagram' as ExternalPlatform, name: 'Instagram (copy caption)', icon: <Copy className="w-4 h-4" />, color: 'hover:bg-pink-500/10 hover:text-pink-400' },
                          { id: 'link' as ExternalPlatform, name: 'Copy Link', icon: <Link2 className="w-4 h-4" />, color: 'hover:bg-neon-cyan/10 hover:text-neon-cyan' },
                        ]).map(platform => (
                          <button
                            key={platform.id}
                            onClick={() => handleExternal(platform.id)}
                            className={cn(
                              'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-gray-400 transition-all',
                              platform.color
                            )}
                          >
                            {platform.icon}
                            <span className="flex-1 text-left">{platform.name}</span>
                            {copiedPlatform === platform.id ? (
                              <Check className="w-3.5 h-3.5 text-green-400" />
                            ) : (
                              <ExternalLink className="w-3 h-3 text-gray-600" />
                            )}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Tab: Marketplace */}
                    {activeTab === 'marketplace' && (
                      <div className="space-y-3">
                        <p className="text-xs text-gray-500">
                          Publish this {contentType} to the Marketplace where others can discover, fork, or purchase it.
                        </p>
                        <button
                          onClick={handleMarketplace}
                          disabled={publishing || !artifactId}
                          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-neon-purple/20 text-neon-purple hover:bg-neon-purple/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-sm font-medium"
                        >
                          {publishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Store className="w-4 h-4" />}
                          Publish to Marketplace
                        </button>
                        {!artifactId && (
                          <p className="text-[10px] text-gray-600 text-center">
                            Save your work first to publish to the marketplace
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

export default ContentPublisher;
