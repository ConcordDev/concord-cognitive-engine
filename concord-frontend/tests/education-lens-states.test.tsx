/**
 * /lenses/education — four-UX-state contract for the Education lens.
 *
 * Pins that the lens renders genuine loading / error (with a WORKING Try-again) /
 * empty (CTA) / populated states against its real backend channel: the artifact
 * list (useLensData('education','artifact') → GET /api/lens/education), and that
 * the compute-action runner is constructed on the 'education' domain (a
 * regression to any other id resolves to NO backend receiver — the dead
 * Domain-Actions bar that drives gradeCalculation / generateReportCard /
 * scheduleConflict).
 *
 * The ERROR state closes the swallowed-fetch → silent-empty defect: a failed
 * education feed must surface the ErrorState ("Something went wrong" + the real
 * error message + a Try-again that RE-FETCHES), NOT a blank "No students found"
 * page. No fabricated data: every state is driven by a mocked useLensData
 * standing in for the real backend in the exact shape it returns.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── main list channel: useLensData (controls loading/error/empty/populated) ──
const lensDataState: {
  items: unknown[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
} = { items: [], isLoading: false, isError: false, error: null };
const refetch = vi.fn();

// ── compute-action channel: useRunArtifact mutate (the Domain-Actions bar) ──
const runMutate = vi.fn(() => Promise.resolve({ ok: true, result: {} }));
const useRunArtifactSpy = vi.fn();

vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({
    items: lensDataState.items,
    total: lensDataState.items.length,
    isLoading: lensDataState.isLoading,
    isError: lensDataState.isError,
    error: lensDataState.error,
    isSeeding: false,
    refetch,
    create: vi.fn(() => Promise.resolve({})),
    update: vi.fn(() => Promise.resolve({})),
    remove: vi.fn(() => Promise.resolve({})),
    createMut: { isPending: false },
    updateMut: { isPending: false },
    deleteMut: { isPending: false },
  }),
}));

vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useRunArtifact: (domain: string) => {
    useRunArtifactSpy(domain);
    return { mutateAsync: (...a: unknown[]) => runMutate(...a), isPending: false };
  },
}));

vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, isLive: false, lastUpdated: null, insights: [] }),
}));

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(() => Promise.resolve({ data: null })), post: vi.fn(() => Promise.resolve({ data: {} })), delete: vi.fn(() => Promise.resolve({ data: {} })) },
  apiHelpers: { lens: { runDomain: vi.fn(() => Promise.resolve({ data: { ok: true, result: {} } })) } },
  lensRun: vi.fn(() => Promise.resolve({ data: { ok: true, result: {} } })),
}));

// ── headless chrome + heavy side panels: render-only / inert stubs ──────────
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/components/lens/LensFeedButton', () => ({ LensFeedButton: () => null }));
vi.mock('@/components/lens/DraftedTextarea', () => ({ DraftedTextarea: (p: Record<string, unknown>) => React.createElement('textarea', p) }));
vi.mock('@/components/mobile/MobileTabBar', () => ({ MobileTabBar: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/UniversalActions', () => ({ UniversalActions: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/lens/LensFeaturePanel', () => ({ LensFeaturePanel: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/ShellPreview', () => ({ ShellPreview: () => null }));
vi.mock('@/components/lens/LiveFeed', () => ({ default: () => null }));
vi.mock('@/components/common/VisionAnalyzeButton', () => ({ VisionAnalyzeButton: () => null }));
vi.mock('@/components/panel-polish', () => ({ PipingProvider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children) }));
// heavy education children (their own backend macros are covered by the
// education server tests / sub-panel tests) → inert here.
vi.mock('@/components/education/EducationActionPanel', () => ({ EducationActionPanel: () => null }));
vi.mock('@/components/education/GutenbergCurriculum', () => ({ GutenbergCurriculum: () => null }));
vi.mock('@/components/paper/OpenLibraryPanel', () => ({ OpenLibraryPanel: () => null }));
vi.mock('@/components/linguistics/DictionaryPanel', () => ({ DictionaryPanel: () => null }));
vi.mock('@/components/education/CoursesCatalog', () => ({ default: () => null }));
vi.mock('@/components/education/EnrollmentsPanel', () => ({ default: () => null }));
vi.mock('@/components/education/LessonPlayer', () => ({ default: () => null }));
vi.mock('@/components/education/SkillTree', () => ({ default: () => null }));
vi.mock('@/components/education/StreakDashboard', () => ({ default: () => null }));
vi.mock('@/components/education/CertificatesPanel', () => ({ default: () => null }));
vi.mock('@/components/education/AssignmentsBoard', () => ({ default: () => null }));
vi.mock('@/components/education/LessonNotes', () => ({ default: () => null }));
vi.mock('@/components/education/CourseDiscussions', () => ({ default: () => null }));
vi.mock('@/components/education/GenomeGraph', () => ({ GenomeGraph: () => null }));
vi.mock('@/components/education/PathStepCard', () => ({ PathStepCard: () => null }));
vi.mock('@/components/education/FlashcardDeck', () => ({ FlashcardDeck: () => null }));
vi.mock('@/components/education/SocraticTutor', () => ({ SocraticTutor: () => null }));
vi.mock('@/components/education/QuizGenerator', () => ({ QuizGenerator: () => null }));
vi.mock('@/components/education/LessonPlanBuilder', () => ({ LessonPlanBuilder: () => null }));
vi.mock('@/components/education/VideoLessonPlayer', () => ({ VideoLessonPlayer: () => null }));
vi.mock('@/components/education/InteractiveExercises', () => ({ InteractiveExercises: () => null }));
vi.mock('@/components/education/LearningPaths', () => ({ LearningPaths: () => null }));
vi.mock('@/components/education/LiveCohorts', () => ({ LiveCohorts: () => null }));
vi.mock('@/components/education/MasteryDashboard', () => ({ MasteryDashboard: () => null }));
vi.mock('@/components/education/LessonQA', () => ({ LessonQA: () => null }));
// framer-motion: render plain elements so animated nodes mount synchronously.
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => (props: Record<string, unknown>) => React.createElement('div', props, props.children as React.ReactNode) }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));
vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props }));
    Icon.displayName = name;
    return Icon;
  };
  return new Proxy(actual, {
    get: (target, prop: string) => (prop in target ? make(prop) : (target as Record<string, unknown>)[prop]),
  });
});

import EducationLensPage from '@/app/lenses/education/page';

const STUDENT = {
  id: 'art_1',
  title: 'Ada Lovelace',
  data: { artifactType: 'Student', status: 'active', description: 'Calc II honor track', subject: 'Mathematics', gpa: 3.9 },
  meta: { tags: ['Student'], status: 'active', visibility: 'private' },
  createdAt: '2026-06-27', updatedAt: '2026-06-27', version: 1,
};

beforeEach(() => {
  lensDataState.items = [];
  lensDataState.isLoading = false;
  lensDataState.isError = false;
  lensDataState.error = null;
  refetch.mockReset();
  runMutate.mockClear();
  useRunArtifactSpy.mockClear();
  window.localStorage.clear();
});

describe('education lens — four UX states', () => {
  it('WIRING: the action runner is constructed on the education domain', () => {
    render(<EducationLensPage />);
    expect(useRunArtifactSpy).toHaveBeenCalledWith('education');
  });

  it('LOADING: an in-flight feed shows a loading indicator (not a blank page)', async () => {
    lensDataState.isLoading = true;
    const { getByText } = render(<EducationLensPage />);
    await waitFor(() => expect(getByText(/Loading/i)).toBeInTheDocument());
  });

  it('EMPTY: an empty feed shows the honest "No students found" CTA', async () => {
    lensDataState.items = [];
    const { getByText } = render(<EducationLensPage />);
    await waitFor(() => expect(getByText(/No students found/i)).toBeInTheDocument());
  });

  it('ERROR: a failed feed shows the error message + a working Try-again that re-fetches (not a silent empty page)', async () => {
    lensDataState.isError = true;
    lensDataState.error = new Error('education store offline');
    const { getByText } = render(<EducationLensPage />);

    await waitFor(() => expect(getByText(/Something went wrong/i)).toBeInTheDocument());
    expect(getByText(/education store offline/i)).toBeInTheDocument();
    // a silent-empty page would show the "No students found" CTA instead — it must NOT.
    expect(() => getByText(/No students found/i)).toThrow();

    // Try-again must re-invoke the backend fetch (refetch), not be a dead button.
    await act(async () => { fireEvent.click(getByText(/Try again/i)); });
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });

  it('POPULATED: a real student artifact renders with its title + subject', async () => {
    lensDataState.items = [STUDENT];
    const { getByText } = render(<EducationLensPage />);
    await waitFor(() => expect(getByText('Ada Lovelace')).toBeInTheDocument());
    expect(getByText(/Mathematics/i)).toBeInTheDocument();
  });
});
