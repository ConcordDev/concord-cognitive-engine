/**
 * Shared wire-shape types for the social-domain feed substrate.
 * Mirrors server/domains/social.js macro return shapes.
 */

export interface PollOption {
  id: string;
  label: string;
  votes: number;
  pct?: number;
}

export interface SocialPoll {
  question: string;
  options: PollOption[];
  voters?: Record<string, string>;
  closesAt?: string | null;
}

export interface MediaAttachment {
  kind: 'image' | 'video';
  url: string;
  alt?: string;
  mime?: string;
}

export interface SocialPost {
  id: string;
  userId: string;
  username: string;
  body: string;
  media: MediaAttachment[];
  poll: SocialPoll | null;
  quoteOf: string | null;
  hashtags: string[];
  createdAt: string;
  replyCount: number;
  reactionCounts: Record<string, number>;
  reactionTotal: number;
  repostCount: number;
  viewerReaction: string | null;
  viewerReposted: boolean;
}

export interface SocialReply {
  id: string;
  postId: string;
  parentId: string | null;
  userId: string;
  username: string;
  body: string;
  createdAt: string;
  children?: SocialReply[];
}

export interface DMThreadSummary {
  threadKey: string;
  with: string;
  lastMessage: { id: string; from: string; body: string; createdAt: string } | null;
  messageCount: number;
  unread: number;
}

export interface DMMessage {
  id: string;
  from: string;
  body: string;
  createdAt: string;
}

export interface LiveStream {
  id: string;
  hostId: string;
  hostName: string;
  title: string;
  kind: string;
  startedAt: string;
  viewers: number;
  peakViewers: number;
}

export interface StreamChatEntry {
  id: string;
  userId: string;
  username: string;
  body: string;
  at: string;
}

export interface TrendingHashtag {
  tag: string;
  posts: number;
}

export interface ModerationReport {
  id: string;
  reporterId: string;
  targetKind: 'post' | 'user';
  targetId: string;
  reason: string;
  detail: string;
  status: string;
  createdAt: string;
}
