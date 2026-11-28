// The Reading Room: the catalogue lists published courses from the public
// read; a course page enrolls (free) or asks before buying (paid); a lesson
// sends the learner's answers to the server and shows only what it grades;
// a lesson without a check is marked done through rr-complete; the address
// carries where you are; certificates verify from their code.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRun = vi.fn();
const apiGet = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a), api: { get: (...a: unknown[]) => apiGet(...a), post: vi.fn() } }));
vi.mock('@/components/lens/LensShell', () => ({ LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));

import ReadingRoom, { searchFromWhere, whereFromSearch } from '@/components/education/reading/ReadingRoom';

const ok = (result: unknown) => Promise.resolve({ data: { ok: true, result } });
const calls = (a: string) => lensRun.mock.calls.filter((c) => c[1] === a).map((c) => c[2]);
const CARD = (over: Record<string, unknown> = {}) => ({
  id: 'c1', title: 'Statics for everyone', summary: 'Why bridges stand up.', category: 'engineering', level: 'beginner', priceCC: 0, lessons: 2, minutes: 20,
  status: 'published', creator: { name: 'ada', isMe: false }, publishedAt: '2026-11-20', enrolled: false, cover: null, reviews: 1, rating: 4, learners: 3, ...over,
});
const COURSE = (over: Record<string, unknown> = {}, enrolled = false) => ({
  course: { ...CARD({ enrolled, ...over }), description: '', outcomes: ['Take moments about a point'] },
  outline: [
    { id: 'l1', n: 1, title: 'Forces', kind: 'reading', durationMin: 8, preview: true, hasVideo: false, hasReading: true, checkQuestions: 0, done: enrolled, opened: enrolled, bestScore: null, readable: true },
    { id: 'l2', n: 2, title: 'Moments', kind: 'reading', durationMin: 12, preview: false, hasVideo: false, hasReading: true, checkQuestions: 2, done: false, opened: false, bestScore: null, readable: enrolled },
  ],
  reviews: [{ name: 'ben', stars: 4, text: 'Clear.', at: 0, mine: false }], isCreator: false,
  progress: { done: enrolled ? 1 : 0, total: 2, next: enrolled ? 'l2' : 'l1' }, certificate: null,
});
const LESSON = (check = true) => ({
  lesson: {
    id: 'l2', n: 2, of: 2, title: 'Moments', durationMin: 12, preview: false, prevId: 'l1', nextId: null, locked: false, body: '# Moments\nForce times distance.', video: null,
    check: check ? { passMark: 0.67, questions: [{ id: 'q1', type: 'choice', prompt: 'Moment of 10 N at 2 m?', options: ['5', '12', '20'] }, { id: 'q2', type: 'numeric', prompt: 'Net moment in equilibrium?' }] } : null,
  },
  progress: { opened: true, done: false, bestScore: null }, lastAttempt: null, enrolled: true, isCreator: false,
});

function publicReads(map: Record<string, unknown>) {
  apiGet.mockImplementation((url: string) => {
    const path = url.replace('/api/education/public', '').split('?')[0]!;
    const hit = Object.entries(map).find(([k]) => path === k);
    if (!hit) return Promise.reject({ response: { data: { ok: false, error: 'course not found' } } });
    return Promise.resolve({ data: { ok: true, ...(hit[1] as object) } });
  });
}
beforeEach(() => { lensRun.mockReset(); apiGet.mockReset(); window.history.replaceState(null, '', '/lenses/education'); lensRun.mockImplementation(() => ok({})); });

describe('where you are lives in the address', () => {
  it('round-trips every room', () => {
    for (const w of [{ room: 'catalogue' }, { room: 'course', id: 'c1' }, { room: 'lesson', id: 'c1', lesson: 'l2' }, { room: 'carrel' }, { room: 'teaching' }, { room: 'studio', id: 'c9' }, { room: 'verify' }, { room: 'certificate', code: 'RR-ABCD-EFGH-JKLM-NPQR' }] as const) {
      expect(whereFromSearch(searchFromWhere(w))).toEqual(w);
    }
  });
});

describe('the catalogue', () => {
  it('shows each published course as a card, from the public read', async () => {
    publicReads({ '/catalog': { courses: [CARD(), CARD({ id: 'c2', title: 'Paid course', priceCC: 6 })], total: 2, categories: ['engineering'] } });
    render(<ReadingRoom />);
    expect(await screen.findByTestId('rr-card-c1')).toHaveTextContent('Statics for everyone');
    expect(screen.getByTestId('rr-card-c1')).toHaveTextContent('FREE');
    expect(screen.getByTestId('rr-card-c2')).toHaveTextContent('6 CC');
    expect(await screen.findByTestId('rr-drawer-engineering')).toHaveTextContent('2 cards');
  });
  it('says so honestly when nothing is published', async () => {
    publicReads({ '/catalog': { courses: [], total: 0, categories: [] } });
    render(<ReadingRoom />);
    expect(await screen.findByTestId('rr-catalogue-empty')).toHaveTextContent('The catalogue is empty.');
  });
});

describe('a course page', () => {
  it('enrolls in a free course through rr-enroll', async () => {
    window.history.replaceState(null, '', '/lenses/education?course=c1');
    publicReads({ '/courses/c1': COURSE() });
    lensRun.mockImplementation((_d: string, a: string) => (a === 'rr-enroll' ? ok({ enrolled: true, paid: 0, firstLessonId: 'l1' }) : ok({})));
    render(<ReadingRoom />);
    fireEvent.click(await screen.findByTestId('rr-enroll'));
    await waitFor(() => expect(calls('rr-enroll')[0]).toEqual({ courseId: 'c1' }));
    expect(await screen.findByTestId('rr-toast')).toHaveTextContent('Enrolled');
  });
  it('asks before taking Concord Coin for a paid course, and shows a refusal in words', async () => {
    window.history.replaceState(null, '', '/lenses/education?course=c1');
    publicReads({ '/courses/c1': COURSE({ priceCC: 6 }) });
    lensRun.mockImplementation((_d: string, a: string) => (a === 'rr-enroll' ? Promise.resolve({ data: { ok: false, error: 'not enough Concord Coin: this course is 6 CC and you have 2 CC' } }) : ok({})));
    render(<ReadingRoom />);
    fireEvent.click(await screen.findByTestId('rr-enroll'));
    expect(calls('rr-enroll')).toHaveLength(0);
    expect(screen.getByTestId('rr-confirm-buy')).toHaveTextContent('This takes 6 CC from your wallet');
    fireEvent.click(screen.getByRole('button', { name: 'Buy for 6 CC' }));
    expect(await screen.findByTestId('rr-toast')).toHaveTextContent('not enough Concord Coin: this course is 6 CC and you have 2 CC');
  });
  it('shows progress and keeps the certificate closed until every lesson is done', async () => {
    window.history.replaceState(null, '', '/lenses/education?course=c1');
    publicReads({ '/courses/c1': COURSE({}, true) });
    render(<ReadingRoom />);
    expect(await screen.findByTestId('rr-continue')).toHaveTextContent('Continue: Moments');
    expect(screen.getByTestId('rr-claim-cert')).toBeDisabled();
  });
});

describe('a lesson', () => {
  it('sends the answers to the server and shows only what it graded', async () => {
    window.history.replaceState(null, '', '/lenses/education?course=c1&lesson=l2');
    publicReads({ '/courses/c1/lessons/l2': LESSON(), '/courses/c1': COURSE({}, true) });
    lensRun.mockImplementation((_d: string, a: string) => {
      if (a === 'rr-check') return ok({ score: 0.5, right: 1, total: 2, passed: false, passMark: 0.67, attempts: 1, results: [{ id: 'q1', correct: true, explain: 'Moment = force × distance.' }, { id: 'q2', correct: false, explain: 'They balance.' }] });
      if (a === 'notes-list') return ok({ notes: [] });
      return ok({});
    });
    render(<ReadingRoom />);
    expect(await screen.findByTestId('rr-lesson-title')).toHaveTextContent('Moments');
    fireEvent.click(screen.getByLabelText('20'));
    fireEvent.change(screen.getByLabelText('Answer to: Net moment in equilibrium?'), { target: { value: '5' } });
    fireEvent.click(screen.getByTestId('rr-submit-check'));
    await waitFor(() => expect(calls('rr-check')[0]).toEqual({ courseId: 'c1', lessonId: 'l2', answers: { q1: 2, q2: '5' } }));
    expect(await screen.findByTestId('rr-check-result')).toHaveTextContent('1 of 2 right (50%). You need 67% to pass.');
    expect(screen.getByText('They balance.')).toBeInTheDocument();
    expect(screen.queryByText(/right answer/)).toBeNull();
  });
  it('a lesson without a check is marked done through rr-complete', async () => {
    window.history.replaceState(null, '', '/lenses/education?course=c1&lesson=l2');
    publicReads({ '/courses/c1/lessons/l2': LESSON(false), '/courses/c1': COURSE({}, true) });
    lensRun.mockImplementation((_d: string, a: string) => (a === 'rr-complete' ? ok({ ok: true, done: 2, total: 2 }) : ok({})));
    render(<ReadingRoom />);
    fireEvent.click(await screen.findByTestId('rr-mark-done'));
    await waitFor(() => expect(calls('rr-complete')[0]).toEqual({ courseId: 'c1', lessonId: 'l2' }));
    expect(await screen.findByTestId('rr-toast')).toHaveTextContent('2 of 2 lessons');
  });
  it('a locked lesson says why and offers the course page', async () => {
    window.history.replaceState(null, '', '/lenses/education?course=c1&lesson=l2');
    publicReads({ '/courses/c1/lessons/l2': { lesson: { id: 'l2', n: 2, of: 2, title: 'Moments', durationMin: 12, preview: false, prevId: 'l1', nextId: null, locked: true }, reason: 'This lesson is part of the course (6 CC).' }, '/courses/c1': COURSE() });
    render(<ReadingRoom />);
    expect(await screen.findByTestId('rr-locked')).toHaveTextContent('This lesson is part of the course (6 CC).');
    expect(screen.queryByTestId('rr-margin')).toBeNull();
  });
});

describe('certificates', () => {
  it('a verification link shows who earned it, from whom', async () => {
    window.history.replaceState(null, '', '/lenses/education?verify=RR-ABCD-EFGH-JKLM-NPQR');
    publicReads({ '/certificates/RR-ABCD-EFGH-JKLM-NPQR': { certificate: { code: 'RR-ABCD-EFGH-JKLM-NPQR', learner: 'ben', course: 'Statics for everyone', courseId: 'c1', creator: 'ada', lessons: 2, averageScore: 83, issuedAt: '2026-11-25T10:00:00Z' } } });
    render(<ReadingRoom />);
    expect(await screen.findByTestId('rr-cert-learner')).toHaveTextContent('ben');
    expect(screen.getByTestId('rr-certificate')).toHaveTextContent('a course by ada · 2 lessons · checks averaged 83%');
  });
  it('the verify desk only accepts a well-formed code, and says when none matches', async () => {
    window.history.replaceState(null, '', '/lenses/education?room=verify');
    publicReads({});
    render(<ReadingRoom />);
    const input = await screen.findByTestId('rr-verify-input');
    fireEvent.change(input, { target: { value: 'nonsense' } });
    expect(screen.getByTestId('rr-verify-go')).toBeDisabled();
    fireEvent.change(input, { target: { value: 'rr-zzzz-zzzz-zzzz-zzzz' } });
    fireEvent.click(screen.getByTestId('rr-verify-go'));
    expect(await screen.findByRole('alert')).toHaveTextContent('course not found');
  });
});

describe('teaching', () => {
  it('a new course is created as a draft through rr-course-save and opens its desk', async () => {
    window.history.replaceState(null, '', '/lenses/education?room=teaching');
    publicReads({});
    lensRun.mockImplementation((_d: string, a: string) => {
      if (a === 'rr-my-learning') return ok({ courses: [], certificates: [], teaching: [] });
      if (a === 'rr-course-save') return ok({ course: CARD({ id: 'c9', status: 'draft', title: 'Knots' }) });
      if (a === 'rr-studio') return ok({ course: { ...CARD({ id: 'c9', status: 'draft', title: 'Knots', lessons: 0 }), description: '', outcomes: [] }, lessons: [] });
      return ok({});
    });
    render(<ReadingRoom />);
    fireEvent.change(await screen.findByTestId('rr-new-course'), { target: { value: 'Knots' } });
    fireEvent.click(screen.getByRole('button', { name: /Start writing/ }));
    await waitFor(() => expect(calls('rr-course-save')[0]).toEqual({ title: 'Knots' }));
    expect(await screen.findByTestId('rr-studio')).toHaveTextContent('DRAFT');
    expect(window.location.search).toBe('?studio=c9');
  });
  it('a slow save never pulls the author out of the new lesson they moved on to', async () => {
    window.history.replaceState(null, '', '/lenses/education?studio=c9');
    publicReads({});
    let finishSave: (v: unknown) => void = () => {};
    const saved = { id: 'l1', title: 'Forces', body: 'A force is a push.', video: null, check: null, durationMin: 8, kind: 'reading', preview: false };
    let lessons: unknown[] = [];
    lensRun.mockImplementation((_d: string, a: string) => {
      if (a === 'rr-studio') return ok({ course: { ...CARD({ id: 'c9', status: 'draft' }), description: '', outcomes: [] }, lessons });
      if (a === 'rr-lesson-save') return new Promise((res) => { finishSave = (v) => { lessons = [saved]; res(v); }; });
      return ok({});
    });
    render(<ReadingRoom />);
    fireEvent.click(await screen.findByTestId('rr-add-lesson'));
    fireEvent.change(screen.getByTestId('rr-lesson-title-input'), { target: { value: 'Forces' } });
    fireEvent.change(screen.getByTestId('rr-lesson-body'), { target: { value: 'A force is a push.' } });
    fireEvent.click(screen.getByTestId('rr-save-lesson'));
    // moves on before the save lands
    fireEvent.click(screen.getByTestId('rr-add-lesson'));
    expect(screen.getByTestId('rr-lesson-title-input')).toHaveValue('');
    fireEvent.change(screen.getByTestId('rr-lesson-title-input'), { target: { value: 'Moments' } });
    finishSave({ data: { ok: true, result: { lesson: saved, lessons: 1 } } });
    await screen.findByTestId('rr-edit-lesson-1');
    expect(screen.getByTestId('rr-lesson-title-input')).toHaveValue('Moments');
  });
});
