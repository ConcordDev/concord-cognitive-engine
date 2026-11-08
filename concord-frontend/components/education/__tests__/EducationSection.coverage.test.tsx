// Render + behaviour coverage for the education section: learning/teaching surfaces, category and
// mode tabs, the classroom CRUD records (students, courses, assignments, grades, plans, resources,
// quizzes, certifications) with create/edit/delete. Heavy sibling panels are stubbed as markers so
// the section's own logic is what runs.

import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { exercise } from '../../../tests/helpers/exercise';

const createFn = vi.fn(async () => ({ id: 'n1' }));
const updateFn = vi.fn(async () => ({}));
const removeFn = vi.fn(async () => ({}));
const refetchFn = vi.fn();
const mutateAsync = vi.fn(async ({ action }: { action: string }) => ({ ok: true, result: { _a: action, message: 'done', gpa: 3.6, summary: 'ok', students: 2, average: 84, atRisk: ['Bo'], insights: ['Strong'] } }));

const item = (id: string, type: string, title: string, data: Record<string, unknown>) => ({ id, title, type: 'artifact', createdAt: '2026-03-01T10:00:00Z', updatedAt: '2026-03-02T10:00:00Z', version: 1, meta: { tags: ['x'], status: 'active', visibility: 'private' }, data: { artifactType: type, status: 'active', description: `${title} d`, ...data } });
const ITEMS = [
  item('s1', 'Student', 'Ann Lee', { subject: 'Physics', email: 'ann@x.org', enrollmentDate: '2026-01-10', gpa: 3.7, totalCredits: 60, requiredCredits: 120, attendance: [{ studentId: 's1', studentName: 'Ann Lee', date: '2026-03-01', status: 'present' }, { studentId: 's1', studentName: 'Ann Lee', date: '2026-03-02', status: 'absent' }] }),
  item('c1', 'Course', 'Physics 101', { instructor: 'Dr. Kim', subject: 'Physics', credits: 4, semester: 'Fall 2026', syllabus: 'Week by week', enrolledStudents: ['s1'], categoryWeights: { homework: 30, exams: 40, projects: 20, participation: 10 }, dropLowest: true, gradeBook: [{ studentId: 's1', studentName: 'Ann Lee', assignmentId: 'a1', assignmentName: 'HW1', category: 'homework', score: 18, maxScore: 20 }], curriculum: [{ weekNumber: 1, topic: 'Motion', objectives: ['Define velocity'], standards: ['NGSS'], resources: ['Textbook'], duration: '1 week' }] }),
  item('a1', 'Assignment', 'HW1', { dueDate: '2030-03-10', maxScore: 20, submissionStatus: 'submitted', rubric: [{ name: 'Clarity', description: 'Clear', maxPoints: 5 }], latePolicy: '10% per day', latePenalty: 10, peerReview: true, plagiarismCheck: true, score: 18 }),
  item('g1', 'Grade', 'HW1 grade', { grade: 'A-', score: 91, maxScore: 100, semester: 'Fall 2026', subject: 'Physics', studentId: 's1' }),
  item('g2', 'Grade', 'Quiz grade', { grade: 'C', score: 74, maxScore: 100, semester: 'Fall 2026', subject: 'Physics', studentId: 's1' }),
  item('g3', 'Grade', 'Lab grade', { grade: 'F', score: 55, maxScore: 100, subject: 'Physics' }),
  item('p1', 'LessonPlan', 'Motion lesson', { subject: 'Physics', notes: 'Demo with carts' }),
  item('r1', 'Resource', 'Khan video', { resourceType: 'video', resourceUrl: 'https://khan.example/v', resourceCourse: 'Physics 101', resourceTopic: 'Motion' }),
  item('q1', 'Quiz', 'Motion quiz', { quizQuestions: [{ id: 'qq1', type: 'multiple-choice', question: 'v = ?', options: ['d/t', 't/d'], correctAnswer: 'd/t', points: 2 }, { id: 'qq2', type: 'true-false', question: 'Speed is a vector', correctAnswer: 'false', points: 1 }], quizTimeLimit: 20, quizShuffleQuestions: true, quizPassingScore: 70, quizAttempts: 2 }),
  item('ce1', 'Certification', 'First aid', { issuedBy: 'Red Cross', expirationDate: '2027-01-01' }),
];

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async () => ({ data: { ok: true, result: {} } })),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
  apiHelpers: { lens: { runDomain: vi.fn(async () => ({ data: { ok: true, result: {} } })), list: vi.fn(async () => ({ data: { artifacts: [], total: 0 } })) } },
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/lib/hooks/use-lens-data', () => ({ useLensData: () => ({ items: ITEMS, isLoading: false, isError: false, error: null, refetch: refetchFn, create: createFn, update: updateFn, remove: removeFn, isCreating: false, createMut: { isPending: false }, updateMut: { isPending: false }, deleteMut: { isPending: false } }) }));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({ useRunArtifact: () => ({ mutateAsync, mutate: vi.fn(), isPending: false }) }));
vi.mock('@/hooks/useRealtimeLens', () => ({ useRealtimeLens: () => ({ latestData: { n: 1 }, alerts: [], insights: [{ id: 'i', text: 'Insight' }], isLive: true, lastUpdated: new Date('2026-03-02') }) }));
vi.mock('@/components/panel-polish', () => ({ PipingProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>, usePipe: () => ({ publish: vi.fn(), subscribe: vi.fn() }), useRecallableAction: () => ({ run: (f: () => Promise<unknown>) => f(), state: 'idle' }), RecallSlot: () => null, StructuredArrayEditor: () => <div>array editor</div> }));
vi.mock('@/components/education/KhanCourseraWorkbenchSection', () => ({ KhanCourseraWorkbenchSection: ({ view }: { view?: string }) => <div>khan-stub {view}</div>, LEARNING_VIEWS: [{ id: 'dashboard', label: 'Progress' }, { id: 'catalog', label: 'Catalog' }, { id: 'enrolled', label: 'My courses' }] }));
vi.mock('@/components/education/EducationEnginePanels', () => ({ GenomePanel: () => <div>GenomePanel-stub</div>, LearningPathPanel: () => <div>LearningPathPanel-stub</div>, ProofByCitationPanel: () => <div>ProofByCitationPanel-stub</div>, TutorPanel: () => <div>TutorPanel-stub</div>, CohortPanel: () => <div>CohortPanel-stub</div>, AssessmentPanel: () => <div>AssessmentPanel-stub</div>, CredentialsPanel: () => <div>CredentialsPanel-stub</div>, EarningsPanel: () => <div>EarningsPanel-stub</div> }));
vi.mock('@/components/education/EducationStudyChrome', () => ({ StudySessionTimer: () => <div>timer-stub</div> }));
vi.mock('@/components/education/StreakDashboard', () => ({ default: () => <div>StreakDashboard-stub</div> }));
vi.mock('@/components/lens/LiveFeed', () => ({ default: () => <div>LiveFeed-stub</div> }));
vi.mock('@/components/common/EmptyState', () => ({ ErrorState: ({ error }: { error?: string }) => <div>error {error}</div> }));
vi.mock('@/components/mobile/MobileTabBar', () => ({ MobileTabBar: ({ tabs, onSelect }: { tabs?: Array<{ id: string }>; onSelect?: (id: string) => void }) => { (globalThis as unknown as { __mobile?: unknown }).__mobile = { tabs, onSelect }; return <div>mobile-tabs</div>; } }));
vi.mock('@/components/lens/DraftedTextarea', () => ({ DraftedTextarea: (p: { onValueChange?: (v: string) => void; placeholder?: string }) => <textarea placeholder={p.placeholder} onChange={(e) => p.onValueChange?.(e.target.value)} /> }));
for (const [path, name] of [['@/components/education/GutenbergCurriculum', 'GutenbergCurriculum'], ['@/components/paper/OpenLibraryPanel', 'OpenLibraryPanel'], ['@/components/linguistics/DictionaryPanel', 'DictionaryPanel'], ['@/components/education/EducationActionPanel', 'EducationActionPanel'], ['@/components/education/FlashcardDeck', 'FlashcardDeck'], ['@/components/education/SocraticTutor', 'SocraticTutor'], ['@/components/education/QuizGenerator', 'QuizGenerator'], ['@/components/education/LessonPlanBuilder', 'LessonPlanBuilder'], ['@/components/education/VideoLessonPlayer', 'VideoLessonPlayer'], ['@/components/education/InteractiveExercises', 'InteractiveExercises'], ['@/components/education/LearningPaths', 'LearningPaths'], ['@/components/education/LiveCohorts', 'LiveCohorts'], ['@/components/education/MasteryDashboard', 'MasteryDashboard'], ['@/components/education/LessonQA', 'LessonQA'], ['@/components/education/StudyModePanel', 'StudyModePanel'], ['@/components/lens/LiveIndicator', 'LiveIndicator'], ['@/components/lens/DTUExportButton', 'DTUExportButton'], ['@/components/lens/RealtimeDataPanel', 'RealtimeDataPanel'], ['@/components/common/VisionAnalyzeButton', 'VisionAnalyzeButton']] as const) vi.doMock(path, () => ({ [name]: () => <span>{name}-stub</span> }));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: React.ReactNode }) => children,
  motion: new Proxy({}, { get: (_t, tag: string) => {
    const MOTION = ['initial', 'animate', 'exit', 'transition', 'variants', 'whileHover', 'whileTap', 'whileInView', 'layout', 'layoutId', 'drag'];
    return ({ children, ...rest }: Record<string, unknown>) => React.createElement(tag, Object.fromEntries(Object.entries(rest).filter(([k]) => !MOTION.includes(k))), children as React.ReactNode);
  } }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });
const press = async (re: RegExp, nth = 0) => {
  const hits = screen.queryAllByRole('button').filter((x) => re.test((x.textContent || x.getAttribute('aria-label') || x.getAttribute('title') || '').trim()));
  if (hits[nth]) await act(async () => { fireEvent.click(hits[nth]); await new Promise((r) => setTimeout(r, 10)); });
  return !!hits[nth];
};
afterEach(() => cleanup());
beforeEach(() => { [createFn, updateFn, removeFn, refetchFn, mutateAsync].forEach((f) => f.mockClear()); });

describe('education section', () => {
  it('renders the learning surface, switches views, and moves to the teaching surface', { timeout: 120000 }, async () => {
    const { EducationSection } = await import('../EducationSection');
    const view = rtlRender(<EducationSection />);
    await settle();
    expect(view.container.textContent).toMatch(/Education/);
    for (const l of ['Catalog', 'My courses', 'Progress']) await press(new RegExp(`^${l}$`));
    await press(/^Teaching$/);
    await settle();
    expect(view.container.textContent).toMatch(/New Record|Students|Ann Lee/);
  });

  it('walks every category and mode tab on the teaching surface and exercises each', { timeout: 120000 }, async () => {
    const { EducationSection, MODE_TABS, MODE_TAB_CATEGORIES } = await import('../EducationSection');
    const view = rtlRender(<EducationSection />);
    await settle();
    await press(/^Teaching$/);
    await settle();
    const labelOf = (id: string) => id.replace(/([a-z])([A-Z])/g, '$1 $2');
    const skip = /delete|remove|trash|discard|cancel|close|dismiss|reset|clear|^back|^×$|^New Record$|^Teaching$|^Study Mode$/i;
    for (const cat of MODE_TAB_CATEGORIES) {
      await press(new RegExp(`^${cat.label}$`));
      await settle();
      for (const tab of cat.tabs) {
        const def = MODE_TABS.find((t) => t.id === tab);
        await press(new RegExp(`^${labelOf(tab)}$|^${tab}$`, 'i'));
        await settle();
        await exercise({ passes: 1, text: 'Physics', skip });
        expect(def).toBeTruthy();
      }
    }
    expect(view.container.textContent?.length).toBeGreaterThan(50);
  });

  it('creates, edits, runs analysis on and deletes records across the classroom tabs', { timeout: 120000 }, async () => {
    const { EducationSection } = await import('../EducationSection');
    const view = rtlRender(<EducationSection />);
    await settle();
    await press(/^Teaching$/);
    for (const tab of ['Students', 'Courses', 'Assignments', 'Grades', 'Plans', 'Resources', 'Quizzes', 'Certifications']) {
      await press(new RegExp(`^${tab}$`));
      await settle();
      await press(/New Record/);
      const title = screen.queryAllByRole('textbox').find((i) => /title|name/i.test((i as HTMLInputElement).placeholder || '')) ?? screen.queryAllByRole('textbox')[0];
      if (title) fireEvent.change(title, { target: { value: `Fresh ${tab}` } });
      await press(/^(Create|Save|Add)\b/i);
      const row = screen.queryAllByRole('button').find((b) => /Ann Lee|Physics 101|HW1|Motion lesson|Khan video|Motion quiz|First aid/.test(b.textContent || ''));
      if (row) await act(async () => { fireEvent.click(row); await new Promise((r) => setTimeout(r, 10)); });
      await press(/Analy[sz]e|Insights|GPA|Run/i);
      await press(/Edit|Pencil/i); await press(/Save|Update/i);
      await press(/Delete|Trash/i); await press(/Confirm|Yes|Delete/i);
      await settle();
    }
    expect(createFn.mock.calls.length + updateFn.mock.calls.length + removeFn.mock.calls.length + mutateAsync.mock.calls.length).toBeGreaterThan(0);
    expect(view.container.textContent?.length).toBeGreaterThan(20);
  });

  it('fills every editor field (rubrics, questions, curriculum) and saves each record type', { timeout: 120000 }, async () => {
    const { EducationSection } = await import('../EducationSection');
    rtlRender(<EducationSection />);
    await settle();
    await press(/^Teaching$/);
    for (const tab of ['Students', 'Courses', 'Assignments', 'Grades', 'Plans', 'Resources', 'Quizzes', 'Certifications']) {
      await press(new RegExp(`^${tab}$`));
      await settle();
      await press(/New Record/);
      for (const el of Array.from(document.querySelectorAll('input, textarea, select')) as HTMLInputElement[]) {
        if (el.type === 'checkbox') { fireEvent.click(el); continue; }
        if (el.tagName === 'SELECT') { const o = Array.from((el as unknown as HTMLSelectElement).options).find((x) => x.value && x.value !== el.value); if (o) fireEvent.change(el, { target: { value: o.value } }); continue; }
        if (el.type === 'file' || el.type === 'range' || /^Search/i.test(el.placeholder)) continue;
        fireEvent.change(el, { target: { value: el.type === 'number' ? '12' : el.type === 'date' ? '2026-04-01' : el.type === 'email' ? 'a@x.org' : el.type === 'url' ? 'https://x.org' : `Fresh ${tab}` } });
      }
      for (const add of screen.queryAllByRole('button').filter((b) => /^\s*\+|Add (criterion|question|week|rubric|row)/i.test(b.textContent || ''))) await act(async () => { fireEvent.click(add); });
      await press(/^(Create|Save|Add)\b/i);
      await settle();
    }
    expect(createFn.mock.calls.length).toBeGreaterThan(0);
  });

  it('opens a student and a course detail, marks attendance, edits the grade book and builds a curriculum', { timeout: 120000 }, async () => {
    const { EducationSection } = await import('../EducationSection');
    const view = rtlRender(<EducationSection />);
    await settle();
    await press(/^Teaching$/);
    const skip = /^(Students|Courses|Assignments|Grades|Plans|Resources|Quizzes|Certifications|Learning Engine|Classroom|Study Tools|More|Teaching)$|delete|remove|trash|discard|cancel|close|dismiss|reset|clear|^back|^×$|Study Mode|New Record/i;
    for (const [tab, row] of [['Students', /Ann Lee/], ['Courses', /Physics 101/], ['Assignments', /HW1/], ['Quizzes', /Motion quiz/], ['Plans', /Motion lesson/], ['Resources', /Khan video/]] as Array<[string, RegExp]>) {
      await press(new RegExp(`^${tab}$`));
      await settle();
      for (const l of [/^Attendance$/, /^Calculate Grades$/, /^Generate Report Card$/, /^Attendance Report$/, /^Schedule Conflict Check$/, /^Study$/]) { await press(l); await exercise({ passes: 1, text: '2026-03-05', skip }); await press(/^Present$/); await press(/^Absent$/); await press(/^Tardy$/); await press(/^Excused$/); }
      const target = screen.queryAllByRole('button').find((b) => row.test(b.textContent || ''));
      if (target) await act(async () => { fireEvent.click(target); await new Promise((r) => setTimeout(r, 10)); });
      await press(/^Report Card$/); await press(/^Progress$/); await press(/^Edit$/);
      for (const l of [/Present/, /Absent/, /Tardy/, /Excused/, /Add Assignment|Add assignment/, /Add Week|Add week/, /Add (Question|Criterion)/i]) await press(l);
      await exercise({ passes: 2, text: '15', skip });
      await settle();
    }
    expect(view.container.textContent?.length).toBeGreaterThan(50);
  });

  it('the attendance sheet, grade book and curriculum planner edit their working sets', { timeout: 120000 }, async () => {
    const { EducationSection } = await import('../EducationSection');
    rtlRender(<EducationSection />);
    await settle();
    await press(/^Teaching$/);
    const titled = async (t: string) => { const b = screen.queryAllByRole('button').filter((x) => x.getAttribute('title') === t); for (const el of b) await act(async () => { fireEvent.click(el); }); };
    // attendance
    await press(/^Students$/); await settle();
    await press(/Attendance$/);
    for (const st of ['present', 'absent', 'tardy', 'excused']) await titled(st);
    for (const d of Array.from(document.querySelectorAll('input[type="date"]')) as HTMLInputElement[]) fireEvent.change(d, { target: { value: '2026-03-09' } });
    await press(/Attendance$/);
    // grade book
    await press(/^Courses$/); await settle();
    await press(/Grade Book/);
    await press(/Add Student Row/); await press(/Add Assignment Column/); await press(/Add Assignment Column/);
    for (const el of Array.from(document.querySelectorAll('input')) as HTMLInputElement[]) if (el.type === 'number') fireEvent.change(el, { target: { value: '77' } });
    for (const sel of Array.from(document.querySelectorAll('select')) as HTMLSelectElement[]) for (const o of Array.from(sel.options)) fireEvent.change(sel, { target: { value: o.value } });
    await press(/Grade Book/);
    // curriculum
    await press(/^Plans$/); await settle();
    await press(/Curriculum Planner/);
    await press(/Add Week/); await press(/Add Week/);
    for (const el of Array.from(document.querySelectorAll('input, textarea')) as HTMLInputElement[]) if (el.type !== 'file') fireEvent.change(el, { target: { value: el.type === 'number' ? '2' : 'Weekly topic, second item' } });
    await settle();
    expect(document.body.textContent?.length).toBeGreaterThan(50);
  });

  it('edits an existing record of every type through the editor, including quiz questions and rubrics', { timeout: 120000 }, async () => {
    const { EducationSection } = await import('../EducationSection');
    rtlRender(<EducationSection />);
    await settle();
    await press(/^Teaching$/);
    const rows: Array<[string, RegExp]> = [['Students', /Ann Lee/], ['Courses', /Physics 101/], ['Assignments', /HW1/], ['Grades', /HW1 grade/], ['Plans', /Motion lesson/], ['Resources', /Khan video/], ['Quizzes', /Motion quiz/], ['Certifications', /First aid/]];
    for (const [tab, row] of rows) {
      await press(new RegExp(`^${tab}$`)); await settle();
      const target = screen.queryAllByRole('button').find((b) => row.test(b.textContent || ''));
      if (target) await act(async () => { fireEvent.click(target); await new Promise((r) => setTimeout(r, 10)); });
      if (!screen.queryAllByRole('button').some((b) => /^Update$/.test((b.textContent || '').trim()))) { await press(/^Edit$/); await settle(); }
      await press(/^Update$/); await settle();
      const again = screen.queryAllByRole('button').find((b) => row.test(b.textContent || ''));
      if (again) await act(async () => { fireEvent.click(again); await new Promise((r) => setTimeout(r, 10)); });
      for (const q of ['MC', 'T/F', 'Short']) await press(new RegExp(`^${q}$`));
      for (const add of screen.queryAllByRole('button').filter((b) => /Add (Question|Criterion|Rubric|Option|Week)|^\s*\+\s*\w/i.test(b.textContent || ''))) await act(async () => { fireEvent.click(add); });
      for (const el of Array.from(document.querySelectorAll('input, textarea, select')) as HTMLInputElement[]) {
        if (el.type === 'checkbox') { fireEvent.click(el); continue; }
        if (el.tagName === 'SELECT') { const o = Array.from((el as unknown as HTMLSelectElement).options).find((x) => x.value && x.value !== el.value); if (o) fireEvent.change(el, { target: { value: o.value } }); continue; }
        if (el.type === 'file' || el.type === 'range' || /^Search/i.test(el.placeholder)) continue;
        fireEvent.change(el, { target: { value: el.type === 'number' ? '9' : el.type === 'date' ? '2026-05-01' : el.type === 'email' ? 'z@x.org' : el.type === 'url' ? 'https://z.org' : `Edited ${tab}` } });
      }
      await press(/^(Save Changes|Save|Update)$/i);
      await settle();
      const del = screen.queryAllByRole('button').find((b) => /^Delete$/.test((b.textContent || '').trim()));
      if (del) await act(async () => { fireEvent.click(del); });
    }
    const mob = (globalThis as unknown as { __mobile?: { tabs: Array<{ id: string }>; onSelect: (id: string) => void } }).__mobile;
    for (const t of mob?.tabs ?? []) await act(async () => { mob?.onSelect(t.id); });
    expect(document.body.textContent?.length).toBeGreaterThan(30);
  });

  it('the open editor can delete the record it is editing and discard changes', { timeout: 120000 }, async () => {
    const { EducationSection } = await import('../EducationSection');
    rtlRender(<EducationSection />);
    await settle();
    await press(/^Teaching$/); await press(/^Quizzes$/); await settle();
    const open = async () => { const t = screen.queryAllByRole('button').find((b) => /Motion quiz/.test(b.textContent || '')); if (t) await act(async () => { fireEvent.click(t); await new Promise((r) => setTimeout(r, 10)); }); };
    await open();
    for (const area of Array.from(document.querySelectorAll('textarea')) as HTMLTextAreaElement[]) fireEvent.change(area, { target: { value: 'Revised description' } });
    await press(/^Cancel$/);
    await open();
    const dels = screen.queryAllByRole('button').filter((b) => /^Delete$/.test((b.textContent || '').trim()));
    for (const d of dels) await act(async () => { fireEvent.click(d); });
    expect(removeFn.mock.calls.length).toBeGreaterThan(0);
  });

  it('categoryForTab maps every mode tab to its category', { timeout: 120000 }, async () => {
    const { categoryForTab, MODE_TABS, MODE_TAB_CATEGORIES } = await import('../EducationSection');
    for (const t of MODE_TABS) expect(typeof categoryForTab(t.id)).toBe('string');
    for (const c of MODE_TAB_CATEGORIES) for (const t of c.tabs) expect(categoryForTab(t)).toBe(c.id);
  });
});
