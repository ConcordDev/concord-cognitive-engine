'use client';

/** Shared calls, types and formatting for the Transcript Page. */
import { createContext, useContext } from 'react';
import { lensRun } from '@/lib/api/client';
import { notifyPodcastChanged } from '../podcast-events';

export interface Show {
  id: string; title: string; author: string | null; category: string; description: string | null;
  feedUrl: string | null; isCreatorShow?: boolean; addedBy: string; coverUrl: string | null;
  episodeCount: number; subscribed: boolean; subscriberCount: number; reviewCount: number; rating: number;
  appleCategory?: string | null; language?: string; explicit?: boolean; coverMediaId?: string | null;
}
export interface Episode {
  id: string; showId: string; showTitle: string; title: string; description: string | null;
  durationSec: number; publishDate: string; episodeNumber: number | null; seasonNumber: number | null;
  mediaId: string | null; audioUrl: string | null; status?: string; chapters?: { startSec: number; title: string }[];
  positionSec: number; played: boolean; progressPct: number; inQueue: boolean; downloaded: boolean; playCount: number;
  access: 'everyone' | 'supporters'; locked: boolean; previewSec: number | null;
  hasTranscript: boolean; feedTranscript: boolean; canEdit: boolean; createdBy?: string; coverUrl?: string | null;
}
export interface Segment { startSec: number | null; endSec: number | null; text: string; speaker?: string }
export interface Transcript {
  episodeId: string; hasTranscript: boolean; timing: 'timed' | 'none' | null; source?: string;
  segments: Segment[]; locked?: boolean; totalSegments?: number; feedTranscript?: boolean;
}
export interface PassStatus {
  showId: string; hasPass: boolean; priceCC: number | null; perks: string | null; supporter: boolean;
  isCreator: boolean; supporterCount: number | null; supportersOnlyEpisodes: number; tipFeeRate: number;
}

export interface Res<T> { ok: boolean; result: T | null; error: string | null }

/** One call shape for every podcast macro: ok, result, and a readable error. */
export async function pc<T>(action: string, input: Record<string, unknown> = {}): Promise<Res<T>> {
  try {
    const r = await lensRun<T>('podcast', action, input);
    const d = r.data as { ok?: boolean; result?: T; error?: string; message?: string } | undefined;
    if (d?.ok) return { ok: true, result: (d.result ?? null) as T | null, error: null };
    return { ok: false, result: null, error: d?.error || d?.message || 'That did not work.' };
  } catch (e) {
    return { ok: false, result: null, error: e instanceof Error ? e.message : 'That did not work.' };
  }
}

/** A write: call, then tell the other rooms something changed. */
export async function pcw<T>(action: string, input: Record<string, unknown> = {}): Promise<Res<T>> {
  const r = await pc<T>(action, input);
  if (r.ok) notifyPodcastChanged();
  return r;
}

export function clock(sec: number | null | undefined): string {
  const t = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
export function length(sec: number): string {
  if (!sec || sec <= 0) return 'length unknown';
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}
export function dateline(iso: string): string {
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00` : iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}
export const cc = (n: number) => `${n.toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })} CC`;

/** The one player: what's loaded, where it is, and how to move it. */
export interface Player {
  episodeId: string | null;
  position: number;
  duration: number;
  playing: boolean;
  /** Load an episode (and optionally start at a time). */
  load: (episodeId: string, opts?: { at?: number; autoplay?: boolean }) => void;
  seek: (sec: number) => void;
  toggle: () => void;
}
export const PlayerContext = createContext<Player | null>(null);
export function usePlayer(): Player {
  const p = useContext(PlayerContext);
  if (!p) throw new Error('usePlayer outside the Transcript Page');
  return p;
}

/** The URL is the address of what you're reading: ?room=&show=&ep=. */
export type Room = 'front' | 'shows' | 'library' | 'studio';
export const ROOMS: { id: Room; label: string; key: string }[] = [
  { id: 'front', label: 'Front page', key: '1' },
  { id: 'shows', label: 'Shows', key: '2' },
  { id: 'library', label: 'Library', key: '3' },
  { id: 'studio', label: 'Your show', key: '4' },
];
const SAFE_ID = /^[\w:-]{1,120}$/;
export function readAddress(): { room: Room; show: string | null; ep: string | null } {
  if (typeof window === 'undefined') return { room: 'front', show: null, ep: null };
  const q = new URLSearchParams(window.location.search);
  const room = (ROOMS.find((r) => r.id === q.get('room'))?.id || 'front') as Room;
  const show = q.get('show'); const ep = q.get('ep');
  return { room, show: show && SAFE_ID.test(show) ? show : null, ep: ep && SAFE_ID.test(ep) ? ep : null };
}
export function writeAddress(next: { room?: Room; show?: string | null; ep?: string | null }, push = true) {
  const u = new URL(window.location.href);
  for (const [k, v] of Object.entries(next)) {
    if (v == null || (k === 'room' && v === 'front')) u.searchParams.delete(k); else u.searchParams.set(k, String(v));
  }
  if (u.toString() !== window.location.href) window.history[push ? 'pushState' : 'replaceState']({}, '', u.toString());
  window.dispatchEvent(new Event('tp:address'));
}
