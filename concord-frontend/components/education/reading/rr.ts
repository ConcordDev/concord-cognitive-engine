'use client';

/**
 * Calls and shapes for the Reading Room (education.rr-* lens actions, plus
 * the public reads under /api/education/public for visitors who aren't
 * signed in). The server grades every check and decides what counts as
 * done; nothing here keeps score.
 */
import { api, lensRun } from '@/lib/api/client';

export interface Res<T> { ok: boolean; result: T | null; error: string | null }

/** A lens action. Errors come back as words, never thrown. */
export async function rx<T>(action: string, input: Record<string, unknown> = {}): Promise<Res<T>> {
  try {
    const r = await lensRun<T>('education', action, input);
    const d = r.data as ({ ok?: boolean; result?: T; error?: string; message?: string } & Record<string, unknown>) | undefined;
    if (!d) return { ok: false, result: null, error: 'No answer from the server.' };
    if (d.ok === false) return { ok: false, result: null, error: d.error || d.message || 'That did not work.' };
    const payload = (d.result && typeof d.result === 'object' ? d.result : d) as T & { ok?: boolean; error?: string };
    if (payload.ok === false) return { ok: false, result: null, error: payload.error || 'That did not work.' };
    return { ok: true, result: payload, error: null };
  } catch (e) {
    return { ok: false, result: null, error: e instanceof Error ? e.message : 'That did not work.' };
  }
}

/** A public read: works signed out, and gives a signed-in reader their own view. */
export async function pub<T>(path: string): Promise<Res<T>> {
  try {
    const r = await api.get(`/api/education/public${path}`, { withCredentials: true });
    const d = r.data as { ok?: boolean; error?: string } & T;
    if (d?.ok === false) return { ok: false, result: null, error: d.error || 'That did not work.' };
    return { ok: true, result: d as T, error: null };
  } catch (e) {
    const data = (e as { response?: { data?: { error?: string } } })?.response?.data;
    return { ok: false, result: null, error: data?.error || (e instanceof Error ? e.message : 'That did not work.') };
  }
}

export const isSignedOutError = (e: string | null | undefined) => /sign in|sign up to|unauthori[sz]ed|login required|auth_required|status code 401/i.test(e || '');

export type Level = 'beginner' | 'intermediate' | 'advanced';
export const LEVELS: Level[] = ['beginner', 'intermediate', 'advanced'];

export interface CourseCard {
  id: string; title: string; summary: string; category: string; level: Level; priceCC: number; lessons: number; minutes: number;
  status: string; creator: { name: string; isMe: boolean }; publishedAt: string | null; enrolled: boolean; cover: string | null;
  reviews: number; rating: number | null; learners: number;
}
export interface OutlineItem {
  id: string; n: number; title: string; kind: 'reading' | 'video' | 'check'; durationMin: number; preview: boolean;
  hasVideo: boolean; hasReading: boolean; checkQuestions: number; done: boolean; opened: boolean; bestScore: number | null; readable: boolean;
}
export interface Review { name: string; stars: number; text: string; at: number; mine: boolean }
export interface CourseView {
  course: CourseCard & { description: string; outcomes: string[] };
  outline: OutlineItem[]; reviews: Review[]; isCreator: boolean;
  progress: { done: number; total: number; next: string | null }; certificate: string | null;
}
export interface Question { id: string; type: 'choice' | 'multi' | 'numeric' | 'text'; prompt: string; options?: string[] }
export interface LessonView {
  lesson: {
    id: string; n: number; of: number; title: string; durationMin: number; preview: boolean; prevId: string | null; nextId: string | null;
    locked: boolean; body?: string; video?: { src: string; kind: 'file' | 'link' } | null; check?: { passMark: number; questions: Question[] } | null;
  };
  reason?: string;
  progress?: { opened: boolean; done: boolean; bestScore: number | null };
  lastAttempt?: { score: number; passed: boolean; at: number } | null;
  enrolled?: boolean; isCreator?: boolean;
}
export interface CheckResult {
  score: number; right: number; total: number; passed: boolean; passMark: number; attempts: number;
  results: { id: string; correct: boolean; explain: string | null; answer?: number | number[] | string[] }[];
}
export interface Certificate { code: string; learner: string; course: string; courseId: string; creator: string; lessons: number; averageScore: number | null; issuedAt: string }
export interface MyLearning {
  courses: (CourseCard & { done: number; total: number; nextLessonId: string | null; nextLessonTitle: string | null; certificate: string | null; enrolledAt: number })[];
  certificates: { code: string; course: string; issuedAt: string }[];
  teaching: CourseCard[];
}

/** An author's own lesson, answers included (only rr-studio returns these). */
export interface AuthorQuestion { id: string; type: Question['type']; prompt: string; options?: string[]; answer?: number | number[] | string[] | number; tolerance?: number; explain?: string }
export interface AuthorLesson {
  id: string; title: string; body: string; video: { mediaId?: string; url?: string } | null;
  check: { questions: AuthorQuestion[]; passMark: number } | null; durationMin: number; kind: string; preview: boolean;
}
export interface Studio { course: CourseCard & { description: string; outcomes: string[] }; lessons: AuthorLesson[] }
export interface Learners {
  learners: number; revenueCC: number; certificates: number; reviews: number; rating: number | null;
  lessons: { id: string; title: string; opened: number; done: number; check: { attempts: number; passRate: number | null; avgScore: number | null } | null }[];
  people: { name: string; done: number; total: number; enrolledAt: number }[];
}

export interface Post {
  id: string; courseId: string; text: string; replyTo: string | null; lessonId: string | null; timestampSec: number | null; acceptedId: string | null;
  upvotes: number; createdAt: string; mine: boolean; upvotedByMe: boolean; author: { displayName?: string; label?: string; isMine?: boolean };
}
export interface Note { id: string; lessonId: string; text: string; videoTimestampSec: number | null; createdAt: string }
export interface FlashCard { id: string; deckId: string; front: string; back: string; dueAt: string; interval: number; repetitions: number }
export interface Deck { id: string; title: string; count: number; due: number; createdAt: string }

export const cc = (n: number) => `${n.toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })} CC`;
export const minutes = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`);
export const clock = (s: number | null | undefined) => {
  const t = Math.max(0, Math.floor(Number(s) || 0));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
export const pct = (x: number | null | undefined) => (x == null ? '—' : `${Math.round(x * 100)}%`);
export const authorName = (p: Post) => p.author?.displayName || p.author?.label || 'A learner';

/** A catalogue "call number": category initials, level and size, like the spine label of a book. */
export const callNumber = (c: Pick<CourseCard, 'category' | 'level' | 'lessons'>) =>
  `${c.category.slice(0, 3).toUpperCase()} · ${c.level.slice(0, 3).toUpperCase()} · ${String(c.lessons).padStart(2, '0')}`;

/** Where a video link plays: YouTube and Vimeo as their own players, anything else as a file. */
export function videoEmbed(src: string): { kind: 'iframe' | 'file'; src: string } {
  try {
    const u = new URL(src);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      const id = u.searchParams.get('v') || (u.pathname.startsWith('/embed/') ? u.pathname.split('/')[2] : '');
      if (id) return { kind: 'iframe', src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}` };
    }
    if (host === 'youtu.be') return { kind: 'iframe', src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(u.pathname.slice(1))}` };
    if (host === 'vimeo.com' && /^\/\d+/.test(u.pathname)) return { kind: 'iframe', src: `https://player.vimeo.com/video/${u.pathname.split('/')[1]}` };
  } catch { /* not a URL; play as given */ }
  return { kind: 'file', src };
}

function csrf(): Record<string, string> {
  const m = typeof document !== 'undefined' ? document.cookie.match(/csrf_token=([^;]+)/) : null;
  return m ? { 'X-CSRF-Token': decodeURIComponent(m[1]) } : {};
}

/** A lesson video goes up as the request body; it stays private until the course is published. */
export async function uploadVideo(file: File, title: string): Promise<{ ok: true; mediaId: string } | { ok: false; error: string }> {
  if (!file.type.startsWith('video/')) return { ok: false, error: 'Choose a video file (MP4, WebM or MOV).' };
  const duration = await new Promise<number>((resolve) => {
    try {
      const el = document.createElement('video');
      const url = URL.createObjectURL(file);
      const done = (v: number) => { URL.revokeObjectURL(url); resolve(Number.isFinite(v) && v > 0 ? v : 0); };
      el.preload = 'metadata'; el.onloadedmetadata = () => done(el.duration); el.onerror = () => done(0); el.src = url;
    } catch { resolve(0); }
  });
  const q = new URLSearchParams({ title, filename: file.name, mediaType: 'video', privacy: 'private', tier: 'regular', tags: 'course' });
  if (duration > 0) q.set('duration', String(Math.round(duration * 1000) / 1000));
  try {
    const res = await fetch(`/api/media/upload-raw?${q.toString()}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': file.type || 'application/octet-stream', ...csrf() }, body: file });
    const body = (await res.json().catch(() => ({}))) as { mediaDTU?: { id?: string }; id?: string; error?: string; message?: string };
    const id = body.mediaDTU?.id || body.id;
    if (!res.ok || !id) return { ok: false, error: res.status === 413 ? 'That video is too large for one upload.' : body.message || body.error || `The upload failed (${res.status}).` };
    return { ok: true, mediaId: String(id) };
  } catch {
    return { ok: false, error: 'The upload was interrupted. Check your connection and try again.' };
  }
}
