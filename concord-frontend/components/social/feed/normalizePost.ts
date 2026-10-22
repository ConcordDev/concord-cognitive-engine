import type { MediaAttachment, SocialPoll, SocialPost } from './types';

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

function mediaList(raw: Record<string, unknown>): MediaAttachment[] {
  if (Array.isArray(raw.media)) {
    const out: MediaAttachment[] = [];
    for (const item of raw.media) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      const url = typeof row.url === 'string' ? row.url : '';
      if (!url) continue;
      const kind = row.kind === 'video' || row.kind === 'audio' || row.kind === 'image' ? row.kind : 'image';
      out.push({
        kind,
        url,
        alt: typeof row.alt === 'string' ? row.alt : undefined,
        caption: typeof row.caption === 'string' ? row.caption : undefined,
        mime: typeof row.mime === 'string' ? row.mime : undefined,
      });
    }
    return out;
  }
  if (typeof raw.mediaUrl === 'string' && raw.mediaUrl) {
    const mt = raw.mediaType;
    const kind = mt === 'video' || mt === 'audio' || mt === 'image' ? mt : 'image';
    return [{ kind, url: raw.mediaUrl }];
  }
  return [];
}

function reactionCounts(raw: Record<string, unknown>): Record<string, number> {
  const source = raw.reactionCounts && typeof raw.reactionCounts === 'object'
    ? raw.reactionCounts as Record<string, unknown>
    : (raw.reactions && typeof raw.reactions === 'object' && !Array.isArray(raw.reactions)
      ? raw.reactions as Record<string, unknown>
      : {});
  const counts: Record<string, number> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'number') counts[key] = value;
  }
  return counts;
}

function pollOf(raw: Record<string, unknown>): SocialPoll | null {
  const poll = raw.poll;
  if (!poll || typeof poll !== 'object') return null;
  const row = poll as Record<string, unknown>;
  if (!Array.isArray(row.options)) return null;
  return {
    question: typeof row.question === 'string' ? row.question : '',
    options: row.options.flatMap((option) => {
      if (!option || typeof option !== 'object') return [];
      const opt = option as Record<string, unknown>;
      const id = typeof opt.id === 'string' ? opt.id : '';
      const label = typeof opt.label === 'string' ? opt.label : (typeof opt.text === 'string' ? opt.text : '');
      if (!id && !label) return [];
      return [{
        id: id || label,
        label: label || id,
        votes: typeof opt.votes === 'number' ? opt.votes : (typeof opt.voteCount === 'number' ? opt.voteCount : 0),
      }];
    }),
    closesAt: typeof row.closesAt === 'string' ? row.closesAt : null,
  };
}

/** One shape for every post that enters feed state, including a partial server payload. */
export function normalizePost(raw: unknown): SocialPost | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === 'string' ? row.id : '';
  if (!id) return null;
  const body = typeof row.body === 'string' ? row.body : (typeof row.content === 'string' ? row.content : '');
  const tags = stringList(row.tags);
  const hashtags = stringList(row.hashtags);
  const mentions = stringList(row.mentionedUsers).length ? stringList(row.mentionedUsers) : stringList(row.mentions);
  const comments = Array.isArray(row.comments) ? row.comments : [];
  const counts = reactionCounts(row);
  const reactionTotal = typeof row.reactionTotal === 'number'
    ? row.reactionTotal
    : Object.values(counts).reduce((sum, n) => sum + n, 0);
  const replyCount = typeof row.replyCount === 'number'
    ? row.replyCount
    : (typeof row.commentCount === 'number' ? row.commentCount : comments.length);
  const repostCount = typeof row.repostCount === 'number'
    ? row.repostCount
    : (typeof row.shareCount === 'number' ? row.shareCount : 0);
  return {
    id,
    userId: typeof row.userId === 'string' ? row.userId : '',
    username: typeof row.username === 'string' ? row.username : '',
    displayName: typeof row.displayName === 'string' ? row.displayName : null,
    body,
    content: body,
    media: mediaList(row),
    poll: pollOf(row),
    quoteOf: typeof row.quoteOf === 'string' ? row.quoteOf : null,
    hashtags: hashtags.length ? hashtags : tags,
    tags,
    mentions,
    comments,
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : new Date(0).toISOString(),
    sensitiveHidden: row.sensitiveHidden === true,
    replyCount,
    reactionCounts: counts,
    reactionTotal,
    repostCount,
    viewerReaction: typeof row.viewerReaction === 'string' ? row.viewerReaction : null,
    viewerReposted: row.viewerReposted === true,
    editedAt: typeof row.editedAt === 'string' ? row.editedAt : null,
  };
}

export function normalizePosts(rows: unknown): SocialPost[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(normalizePost).filter((post): post is SocialPost => post !== null);
}
