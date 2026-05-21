// Shared types for the timeline lens — mirror the shapes returned by the
// `timeline` domain macros (server/domains/timeline.js).

export type Privacy = 'public' | 'friends' | 'private';
export type ReactionKind = 'like' | 'love' | 'haha' | 'sad' | 'angry';
export type MediaKind = 'photo' | 'video';

export interface MediaItem {
  id?: string;
  kind: MediaKind;
  url: string;
  caption?: string;
}

export interface SharedFrom {
  postId: string;
  authorId: string;
  content: string;
  media: MediaItem[];
  createdAt: string;
}

export interface FeedPost {
  id: string;
  authorId: string;
  content: string;
  media: MediaItem[];
  privacy: Privacy;
  taggedUserIds: string[];
  sharedFrom: SharedFrom | null;
  createdAt: string;
  reactionCounts: Record<ReactionKind, number>;
  reactionTotal: number;
  userReaction: ReactionKind | null;
  commentCount: number;
}

export interface Comment {
  id: string;
  postId: string;
  parentId: string | null;
  authorId: string;
  text: string;
  createdAt: string;
  replies: Comment[];
}

export interface Album {
  id: string;
  ownerId: string;
  name: string;
  description: string;
  coverUrl: string | null;
  media: MediaItem[];
  createdAt: string;
}

export interface Profile {
  userId: string;
  coverUrl: string | null;
  avatarUrl: string | null;
  bio: string;
  about: {
    work: string;
    education: string;
    location: string;
    relationship: string;
    website: string;
  };
  updatedAt: string | null;
}

export interface Notification {
  id: string;
  type: 'reaction' | 'comment' | 'reply' | 'tag' | 'share';
  actorId: string;
  postId?: string;
  kind?: ReactionKind;
  preview?: string;
  read: boolean;
  at: string;
}

export interface Memory extends FeedPost {
  yearsAgo: number;
}
