'use client';

/**
 * Education — the Reading Room. Anyone teaches, anyone learns: the card
 * catalogue of published courses, a course's title page, the carrel where
 * you read a lesson and take its check (graded on the server), your desk of
 * courses and due flashcards, the Teaching room where anyone writes and
 * publishes a course (free or sold in CC), and certificates anyone can
 * verify. Where you are lives in the address, so any page can be linked.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { Catalogue } from './Catalogue';
import { CoursePage } from './CoursePage';
import { LessonReader } from './LessonReader';
import { Carrel } from './Carrel';
import { StudioDesk, Teaching } from './Studio';
import { CertificateView, VerifyDesk } from './Certificate';
import { pub, type CourseView } from './rr';
import { readingFontVars } from './readingFonts';
import './reading.css';

export type Where =
  | { room: 'catalogue' }
  | { room: 'course'; id: string }
  | { room: 'lesson'; id: string; lesson: string }
  | { room: 'carrel' }
  | { room: 'teaching' }
  | { room: 'studio'; id: string }
  | { room: 'verify' }
  | { room: 'certificate'; code: string };

export function whereFromSearch(search: string): Where {
  const q = new URLSearchParams(search);
  const course = q.get('course'); const lesson = q.get('lesson'); const studio = q.get('studio'); const verify = q.get('verify'); const room = q.get('room');
  if (verify) return { room: 'certificate', code: verify.toUpperCase() };
  if (studio) return { room: 'studio', id: studio };
  if (course && lesson) return { room: 'lesson', id: course, lesson };
  if (course) return { room: 'course', id: course };
  if (room === 'carrel' || room === 'teaching' || room === 'verify') return { room };
  return { room: 'catalogue' };
}
export function searchFromWhere(w: Where): string {
  const q = new URLSearchParams();
  if (w.room === 'course') q.set('course', w.id);
  else if (w.room === 'lesson') { q.set('course', w.id); q.set('lesson', w.lesson); }
  else if (w.room === 'studio') q.set('studio', w.id);
  else if (w.room === 'certificate') q.set('verify', w.code);
  else if (w.room !== 'catalogue') q.set('room', w.room);
  const s = q.toString();
  return s ? `?${s}` : '';
}

const ROOMS: { room: 'catalogue' | 'carrel' | 'teaching' | 'verify'; label: string; key: string }[] = [
  { room: 'catalogue', label: 'Catalogue', key: 'c' },
  { room: 'carrel', label: 'My carrel', key: 'm' },
  { room: 'teaching', label: 'Teaching', key: 't' },
  { room: 'verify', label: 'Verify a certificate', key: 'v' },
];
const roomOf = (w: Where) => (w.room === 'course' || w.room === 'lesson' ? 'catalogue' : w.room === 'studio' ? 'teaching' : w.room === 'certificate' ? 'verify' : w.room);

export default function ReadingRoom() {
  useLensNav('education');
  const [where, setWhere] = useState<Where>({ room: 'catalogue' });
  const [toast, setToast] = useState<string | null>(null);
  const [courseTitle, setCourseTitle] = useState<{ id: string; title: string } | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setWhere(whereFromSearch(window.location.search));
    const onPop = () => setWhere(whereFromSearch(window.location.search));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4200); return () => clearTimeout(t); }, [toast]);

  const go = useCallback((w: Where) => {
    setWhere(w);
    const url = `${window.location.pathname}${searchFromWhere(w)}`;
    if (url !== `${window.location.pathname}${window.location.search}`) window.history.pushState(null, '', url);
    mainRef.current?.scrollIntoView({ block: 'start' });
  }, []);

  // The lesson reader shows the course's name; fetch it once per course.
  const lessonCourse = where.room === 'lesson' ? where.id : null;
  useEffect(() => {
    if (!lessonCourse || courseTitle?.id === lessonCourse) return;
    void pub<CourseView>(`/courses/${encodeURIComponent(lessonCourse)}`).then((r) => { if (r.ok) setCourseTitle({ id: lessonCourse, title: r.result!.course.title }); });
  }, [lessonCourse, courseTitle?.id]);

  useLensCommand([
    ...ROOMS.map((r) => ({ id: `rr-room-${r.room}`, keys: r.key, description: r.label, category: 'navigation' as const, action: () => go({ room: r.room }) })),
    { id: 'rr-search', keys: '/', description: 'Search the catalogue', category: 'navigation', action: () => { if (where.room !== 'catalogue') go({ room: 'catalogue' }); setTimeout(() => searchRef.current?.focus(), 30); } },
  ], { lensId: 'education' });

  const active = roomOf(where);
  return (
    <LensShell lensId="education" asMain={false}>
      <main ref={mainRef} className={`rr ${readingFontVars} min-h-[calc(100vh-var(--top-bar-height,56px))]`} data-testid="reading-room">
        <header className="rr-rail rr-noprint">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 md:px-6">
            <button type="button" className="rr-plaque rr-book px-3 py-1 text-[17px] font-bold tracking-wide" onClick={() => go({ room: 'catalogue' })}>The Reading Room</button>
            <nav className="flex flex-wrap gap-1" aria-label="Rooms">
              {ROOMS.map((r) => (
                <button key={r.room} type="button" className="rr-room text-[13.5px]" aria-current={active === r.room ? 'page' : undefined} onClick={() => go({ room: r.room })} data-testid={`rr-nav-${r.room}`}>
                  {r.label} <kbd className="rr-type ml-1 text-[10px] opacity-50">{r.key.toUpperCase()}</kbd>
                </button>
              ))}
            </nav>
          </div>
        </header>

        {where.room === 'catalogue' && <Catalogue searchRef={searchRef} onOpen={(id) => go({ room: 'course', id })} />}
        {where.room === 'course' && <CoursePage key={where.id} id={where.id} onBack={() => go({ room: 'catalogue' })} onLesson={(lesson) => go({ room: 'lesson', id: where.id, lesson })}
          onCertificate={(code) => go({ room: 'certificate', code })} onStudio={(id) => go({ room: 'studio', id })} onToast={setToast} />}
        {where.room === 'lesson' && <LessonReader courseId={where.id} lessonId={where.lesson} courseTitle={courseTitle?.id === where.id ? courseTitle.title : null}
          onCourse={() => go({ room: 'course', id: where.id })} onLesson={(lesson) => go({ room: 'lesson', id: where.id, lesson })} onToast={setToast} />}
        {where.room === 'carrel' && <Carrel onCourse={(id) => go({ room: 'course', id })} onLesson={(id, lesson) => go({ room: 'lesson', id, lesson })} onCertificate={(code) => go({ room: 'certificate', code })} onCatalogue={() => go({ room: 'catalogue' })} onToast={setToast} />}
        {where.room === 'teaching' && <Teaching onStudio={(id) => go({ room: 'studio', id })} onToast={setToast} />}
        {where.room === 'studio' && <StudioDesk key={where.id} id={where.id} onBack={() => go({ room: 'teaching' })} onPreview={(id) => go({ room: 'course', id })} onToast={setToast} />}
        {where.room === 'verify' && <VerifyDesk onShow={(code) => go({ room: 'certificate', code })} />}
        {where.room === 'certificate' && <CertificateView code={where.code} onCourse={(id) => go({ room: 'course', id })} onToast={setToast} />}

        {toast && <div className="rr-toast text-[14px]" role="status" aria-live="polite" data-testid="rr-toast">{toast}</div>}
      </main>
    </LensShell>
  );
}
