export type SocialPlaceId = 'home' | 'explore' | 'inbox' | 'you';

const VIEW_ALIASES: Record<string, SocialPlaceId> = {
  home: 'home',
  feed: 'home',
  following: 'home',
  explore: 'explore',
  discover: 'explore',
  reels: 'explore',
  clips: 'explore',
  spaces: 'explore',
  rooms: 'explore',
  inbox: 'inbox',
  notifications: 'inbox',
  messages: 'inbox',
  you: 'you',
  saved: 'you',
  analytics: 'you',
  moderation: 'you',
};

export function parseSocialPlace(raw: string | null | undefined): SocialPlaceId {
  if (!raw) return 'home';
  return VIEW_ALIASES[String(raw).toLowerCase()] || 'home';
}
