'use client';

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';

export interface LessonOption {
  id: string;
  courseId: string;
  courseTitle: string;
  lessonTitle: string;
  label: string;
}

interface RawLesson { id: string; title: string; order: number }
interface RawCourse { id: string; title: string; lessons?: RawLesson[] }

/**
 * Flattens the visible course catalog (education.courses-list — which embeds
 * each course's `lessons` array directly, no extra round-trip needed) into a
 * pickable lesson list. Since courses-list now returns the shared multi-
 * tenant catalog (every published course from every author, plus the
 * caller's own drafts — see docs/lens-specs/education-capability-map.md),
 * this picker offers lessons from any course the caller can see, not just
 * ones they authored — which is the correct scope for personal-notes /
 * video-progress / lesson-Q&A actions a learner takes against a course they
 * enrolled in but didn't write. This is the missing link for the
 * video-progress / transcript / notes / lesson-Q&A macros: they all key off
 * a real `lessonId`, but nothing in the UI surfaced one — CoursesCatalog's
 * lesson rows never displayed the raw id, so a user had no way to reach
 * those macros short of reading server state directly. Any component that
 * needs a lessonId should offer this picker instead of (or in addition to)
 * a raw text field.
 */
export function useLessonOptions() {
  const [options, setOptions] = useState<LessonOption[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun('education', 'courses-list', {});
      const courses = ((r.data?.result as { courses?: RawCourse[] } | null)?.courses) || [];
      const flat: LessonOption[] = [];
      for (const c of courses) {
        for (const l of (c.lessons || []).slice().sort((a, b) => a.order - b.order)) {
          flat.push({
            id: l.id,
            courseId: c.id,
            courseTitle: c.title,
            lessonTitle: l.title,
            label: `${c.title} — ${l.order}. ${l.title}`,
          });
        }
      }
      setOptions(flat);
    } catch (e) { console.error('[useLessonOptions] refresh failed', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return { options, loading, refresh };
}

export default useLessonOptions;
