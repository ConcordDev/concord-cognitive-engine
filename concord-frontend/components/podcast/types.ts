/** Shared podcast creator-desk types (extracted from former page.tsx). */

export interface PodcastEpisode {
  id: string;
  showId: string;
  title: string;
  description: string | null;
  episodeNumber: number | null;
  seasonNumber: number | null;
  coverArtUrl: string | null;
  mediaId: string | null;
  audioUrl: string | null;
  durationSec: number;
  publishDate: string;
  status: 'draft' | 'published' | 'scheduled';
  playCount: number;
  tags: string[];
}

export function formatDuration(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
