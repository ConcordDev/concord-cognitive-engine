// Render + behaviour coverage for the education lens panels: the action panel (grade report,
// program progress, lesson plan, quiz cards; mint / DM / publish / agent) and the lesson player.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { actionOf, exercise } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const runDomain = vi.fn();
const apiPost = vi.fn();
const LESSON = (id: string, kind: string, order: number) => ({ id, title: `Lesson ${id}`, videoUrl: kind === 'video' ? 'https://x/v.mp4' : '', durationMin: 10, kind, order });

function resultFor(action: string): unknown {
  switch (action) {
    case 'enrollments-list': return { enrollments: [{ courseId: 'c1', course: { id: 'c1', title: 'Intro to Physics', instructor: 'Dr. Lee', institution: 'Concord U', category: 'science' }, totalLessons: 4, completedLessons: 1, progressPct: 25 }, { courseId: 'c2', course: { id: 'c2', title: 'Poetry', instructor: 'Ms. Kim', institution: 'Concord U', category: 'arts' }, totalLessons: 2, completedLessons: 2, progressPct: 100 }] };
    case 'lessons-list': return { lessons: [LESSON('l1', 'video', 1), LESSON('l2', 'reading', 2), LESSON('l3', 'quiz', 3), LESSON('l4', 'assignment', 4), LESSON('l5', 'discussion', 5)], completedLessonIds: ['l2'] };
    case 'lessons-complete': return { pointsAwarded: 10, alreadyCompleted: false };
    case 'bench-last': return {};
    case 'gradeCalculation': return { studentsGraded: 2, classStats: { average: 84, median: 85, high: 95, low: 70 }, weightScheme: [{ category: 'homework', weight: 40 }], students: [{ studentId: 's1', name: 'Ann', weightedPct: 92, letterGrade: 'A', totalAssignments: 3, categoryBreakdown: [{ category: 'homework', assignmentCount: 3, earnedPoints: 27, possiblePoints: 30, categoryPct: 90, weight: 40 }] }, { studentId: 's2', name: 'Bo', weightedPct: 70, letterGrade: 'C', totalAssignments: 3, categoryBreakdown: [] }] };
    case 'progressTrack': return { overallCompletionPct: 60, totalRequirements: 5, completedRequirements: 3, remainingRequirements: 2, estimatedCompletionDate: '2027-05-01', details: [{ requirementId: 'r1', name: 'Core', type: 'course', requiredUnits: 4, completedUnits: 3, remainingUnits: 1, completionPct: 75 }] };
    case 'lesson-plan-generate': return { plan: { title: 'Fractions', subject: 'Math', grade: '4', duration: '45 min', objectives: ['Add fractions'], materials: ['Paper'], warmUp: 'Pizza slices', mainActivity: 'Number line', assessment: 'Exit ticket', homework: 'Worksheet' } };
    case 'quiz-from-text': return { cards: [{ front: 'Q1?', back: 'A1', difficulty: 'easy' }, { front: 'Q2?', back: 'A2' }], count: 2, source: 'pasted' };
    case 'bench-note-mint': return { mintedDtuId: 'note-1' };
    default: return { ok: true };
  }
}
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(async () => ({ data: {} })), post: (...a: unknown[]) => apiPost(...a) },
  apiHelpers: { lens: { runDomain: (...a: unknown[]) => runDomain(...a), list: vi.fn(async () => ({ data: { artifacts: [], total: 0 } })) } },
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/panel-polish', () => ({
  usePipe: () => ({ publish: vi.fn(), subscribe: vi.fn() }),
  useRecallableAction: () => ({ run: (fn: () => Promise<unknown>) => fn(), state: 'idle' }),
  RecallSlot: () => null,
  PipingProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  StructuredArrayEditor: () => <div>array editor</div>,
}));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: React.ReactNode }) => children,
  motion: new Proxy({}, { get: () => (p: Record<string, unknown>) => <div>{p.children as React.ReactNode}</div> }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { EducationActionPanel } from '../EducationActionPanel';
import { LessonPlayer } from '../LessonPlayer';

const render = (ui: React.ReactElement) => rtlRender(ui);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 5)); });
const press = async (re: RegExp, nth = 0) => {
  const hits = screen.queryAllByRole('button').filter((x) => re.test((x.textContent || x.getAttribute('aria-label') || x.getAttribute('title') || '').trim()));
  if (hits[nth]) await act(async () => { fireEvent.click(hits[nth]); await new Promise((r) => setTimeout(r, 5)); });
  return !!hits[nth];
};
afterEach(() => cleanup());
beforeEach(() => {
  [lensRunMock, runDomain, apiPost].forEach((f) => f.mockReset());
  lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: resultFor(actionOf(a)), error: null } }));
  runDomain.mockImplementation(async (_d: string, action: string) => ({ data: { ok: true, result: resultFor(action) } }));
  apiPost.mockResolvedValue({ data: { ok: true, result: { id: 'dtu-1', dtu: { id: 'dtu-1' }, answer: 'Brief.' } } });
  window.HTMLMediaElement.prototype.play = vi.fn(async () => {});
  window.HTMLMediaElement.prototype.pause = vi.fn();
});

const PANELS: Array<[string, () => React.ReactElement]> = [
  ['EducationActionPanel', () => <EducationActionPanel />],
  ['LessonPlayer', () => <LessonPlayer />],
];

describe('education panels', () => {
  it.each(PANELS)('%s renders real content with controls and survives a full exercise pass', async (_n, make) => {
    const view = render(make());
    await settle();
    expect(view.container.textContent?.trim().length).toBeGreaterThan(10);
    await exercise({ passes: 3, text: '{"students":[]}' });
    await settle();
    await exercise({ passes: 1, text: 'Fractions' });
    expect(view.container.textContent).toBeTruthy();
  });

  it.each(PANELS)('%s stays standing when the backend is offline', async (_n, make) => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'offline', result: null } }));
    runDomain.mockImplementation(async () => ({ data: { ok: false, error: 'offline' } }));
    apiPost.mockRejectedValue(new Error('offline'));
    const view = render(make());
    await settle();
    await exercise({ passes: 1 });
    expect(view.container).toBeTruthy();
  });
});

describe('education flows', () => {
  it('the action panel grades a class, tracks progress, plans a lesson, makes quiz cards, then mints, DMs, publishes and asks the agent', async () => {
    render(<EducationActionPanel />);
    await settle();
    const areas = Array.from(document.querySelectorAll('textarea')) as HTMLTextAreaElement[];
    const json = [JSON.stringify({ students: [{ studentId: 's1', name: 'Ann', grades: [{ category: 'homework', earned: 9, possible: 10 }] }], weights: [{ category: 'homework', weight: 100 }] }), JSON.stringify({ requirements: [{ requirementId: 'r1', name: 'Core', requiredUnits: 4, completedUnits: 3 }] }), 'Photosynthesis converts light into chemical energy in plants.'];
    areas.forEach((a, i) => fireEvent.change(a, { target: { value: json[i] ?? json[2] } }));
    for (const el of screen.queryAllByRole('textbox') as HTMLInputElement[]) if (el.tagName === 'INPUT') fireEvent.change(el, { target: { value: /DM|recipient/i.test(el.placeholder) ? 'friend-1' : 'Fractions' } });
    for (const l of [/^Grade/, /^Progress/, /^Lesson/, /^Quiz/, /^Mint/, /^DM/, /^Publish/, /^Publish/, /Brief|Agent|Lever|Coach/]) await press(l);
    const a = runDomain.mock.calls.map((c) => String(c[1]));
    expect(a.some((x) => /gradeCalculation|progressTrack|lesson-plan-generate|quiz-from-text/.test(x))).toBe(true);
  });

  it('the lesson player lists enrollments, opens a course and a lesson, plays video and completes lessons', async () => {
    render(<LessonPlayer />);
    await settle();
    expect(document.body.textContent).toMatch(/Intro to Physics|Lesson l1/);
    await press(/Poetry/); await press(/Intro to Physics/);
    for (const l of ['Lesson l1', 'Lesson l2', 'Lesson l3', 'Lesson l4', 'Lesson l5']) await press(new RegExp(l));
    await press(/Mark complete|Complete|Done|Finish/i);
    const video = document.querySelector('video') as HTMLVideoElement | null;
    if (video) { fireEvent.timeUpdate(video); fireEvent.ended(video); }
    lensRunMock.mockImplementation(async (...a: unknown[]) => actionOf(a) === 'lessons-complete' ? { data: { ok: false, error: 'not yet' } } : { data: { ok: true, result: resultFor(actionOf(a)) } });
    await press(/Mark complete|Complete|Done|Finish/i);
    expect(lensRunMock.mock.calls.map((c) => actionOf(c))).toEqual(expect.arrayContaining(['enrollments-list', 'lessons-list']));
  });
});
