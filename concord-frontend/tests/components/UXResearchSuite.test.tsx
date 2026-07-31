/**
 * UXResearchSuite (Click/Heatmap tab) — pins the useState-as-ref -> real
 * useRef fix.
 *
 * `startRef` used to be `useState(() => ({ t: Date.now() }))[0]` - a
 * `useState` initializer abused purely to get a stable mutable object,
 * with no setter ever called (so it never triggered a render on its own,
 * making it functionally a ref anyway, just via the wrong hook). Replaced
 * with a real `useRef({ t: Date.now() })`. `onCanvasClick` reads/writes
 * `startRef.current.t` to measure decision time between clicks; this pins
 * that path still works end-to-end after the hook swap.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { UXResearchSuite } from '@/components/experience/UXResearchSuite';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

// One broad mock, shared by every panel's test below — each panel calls
// `run(action, params)` -> `lensRun('experience', action, params)`, so a
// single switch covers the whole suite instead of one mock per test.
function mockAction(action: string): { ok: boolean; result?: unknown } {
  switch (action) {
    case 'createHeatmapStudy':
      return { ok: true, result: { study: { id: 'study-1', name: 'Nav test', question: 'Where?', target: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 } } } };
    case 'recordClick':
      return { ok: true, result: { recorded: true } };
    case 'heatmapResults':
      return { ok: true, result: { totalClicks: 1, grid: [[1]], gridMax: 1, firstClickSuccessRate: 100, avgDecisionMs: 500, name: 'Nav test' } };
    case 'listTests':
      return { ok: true, result: { tests: [] } };
    case 'listRuns':
      return { ok: true, result: { runs: [] } };
    case 'createTest':
      return { ok: true, result: { test: { id: 'test-1' } } };
    case 'createCardSort':
      return { ok: true, result: { study: { id: 'cardsort-1', cards: ['Settings', 'Profile'] } } };
    case 'surveyTemplates':
      return { ok: true, result: { templates: [{ id: 'nps', label: 'NPS', questionCount: 1 }] } };
    case 'listSurveys':
      return { ok: true, result: { surveys: [{ id: 'survey-1', name: 'CSAT check-in', template: 'nps', questions: [{ id: 'q1', kind: 'nps', prompt: 'How likely...', options: [] }], responseCount: 0 }] } };
    case 'createSurvey':
      return { ok: true, result: { survey: { id: 'survey-1' } } };
    case 'surveyResults':
      return { ok: true, result: { name: 'CSAT check-in', responseCount: 1, perQuestion: [{ questionId: 'q1', prompt: 'How likely...', kind: 'nps', answered: 1, nps: 50 }] } };
    case 'surveyNext':
      return { ok: true, result: { done: true } };
    case 'submitSurveyResponse':
      return { ok: true, result: { recorded: true } };
    case 'listPanel':
      return { ok: true, result: { panel: [{ id: 'p-1', name: 'Alex Doe', email: 'alex@example.com', attributes: { role: 'designer' } }] } };
    case 'addParticipant':
      return { ok: true, result: { participant: { id: 'p-2' } } };
    case 'screenPanel':
      return { ok: true, result: { matched: [{ id: 'p-1', name: 'Alex Doe' }], qualifyRate: 1 } };
    case 'inviteParticipants':
      return { ok: true, result: { invited: 1 } };
    case 'listClips':
      return { ok: true, result: { clips: [{ id: 'clip-1', runId: 'uxr_1', label: 'Confused', note: '', sentiment: 'negative', durationMs: 5000, shareToken: 'tok1' }], bySentiment: { negative: 1 } } };
    case 'createClip':
      return { ok: true, result: { clip: { id: 'clip-2' } } };
    case 'buildReel':
      return { ok: true, result: { shareUrl: '/share/reel/abc' } };
    case 'listPrototypes':
      return { ok: true, result: { prototypes: [{ id: 'proto-1', name: 'Onboarding', frames: [{ id: 'f1', name: 'Welcome' }], interactionCount: 3 }] } };
    case 'createPrototype':
      return { ok: true, result: { prototype: { id: 'proto-2' } } };
    case 'prototypeAnalytics':
      return { ok: true, result: { funnel: [{ frameId: 'f1', interactions: 3 }], hotspots: [] } };
    case 'recordInteraction':
      return { ok: true, result: { recorded: true } };
    default:
      return { ok: false };
  }
}

describe('UXResearchSuite', () => {
  beforeEach(() => {
    lensRun.mockReset();
    lensRun.mockImplementation((_domain: string, action: string) =>
      Promise.resolve({ data: mockAction(action) }),
    );
  });

  it('creates a study, clicks the test surface, and records via startRef.current.t (real useRef, not the useState hack)', async () => {
    render(<UXResearchSuite />);
    fireEvent.click(screen.getByText('Click / Heatmap'));

    const nameInput = await screen.findByPlaceholderText('Nav first-click');
    fireEvent.change(nameInput, { target: { value: 'Nav test' } });
    fireEvent.click(screen.getByText('Create study'));

    const canvas = await screen.findByText(/Click anywhere/);
    fireEvent.click(canvas.closest('[role="button"]')!, { clientX: 50, clientY: 50 });

    await waitFor(() => {
      expect(lensRun).toHaveBeenCalledWith('experience', 'recordClick', expect.objectContaining({ studyId: 'study-1', durationMs: expect.any(Number) }));
    });
    await waitFor(() => {
      expect(screen.getByText('Total clicks')).toBeInTheDocument();
    });
  });

  it('Usability Tests (default tab) creates a test', async () => {
    render(<UXResearchSuite />);
    const nameInput = await screen.findByPlaceholderText('Checkout flow');
    fireEvent.change(nameInput, { target: { value: 'Checkout flow' } });
    fireEvent.change(screen.getByPlaceholderText(/Find the shopping cart/), { target: { value: 'Find the cart' } });
    fireEvent.click(screen.getByText('Create test'));

    await waitFor(() => {
      expect(lensRun).toHaveBeenCalledWith('experience', 'createTest', expect.objectContaining({ name: 'Checkout flow' }));
    });
  });

  it('Card Sort creates a study', async () => {
    render(<UXResearchSuite />);
    fireEvent.click(screen.getByText('Card Sort'));

    fireEvent.change(await screen.findByPlaceholderText('IA validation'), { target: { value: 'IA validation' } });
    fireEvent.change(screen.getByPlaceholderText(/Settings/), { target: { value: 'Settings\nProfile' } });
    fireEvent.click(screen.getByText('Create study'));

    await waitFor(() => {
      expect(lensRun).toHaveBeenCalledWith('experience', 'createCardSort', expect.objectContaining({ name: 'IA validation', cards: ['Settings', 'Profile'] }));
    });
  });

  it('Surveys creates a template-based survey', async () => {
    render(<UXResearchSuite />);
    fireEvent.click(screen.getByText('Surveys'));

    const nameInput = await screen.findByPlaceholderText('Post-task feedback');
    fireEvent.change(nameInput, { target: { value: 'CSAT check-in' } });
    fireEvent.click(screen.getByText('Create survey'));

    await waitFor(() => {
      expect(lensRun).toHaveBeenCalledWith('experience', 'createSurvey', expect.objectContaining({ name: 'CSAT check-in' }));
    });
  });

  it('Panel adds a participant and runs a screener', async () => {
    render(<UXResearchSuite />);
    fireEvent.click(screen.getByText('Panel'));

    fireEvent.change(await screen.findByPlaceholderText('Alex Doe'), { target: { value: 'Alex Doe' } });
    fireEvent.click(screen.getByText('Add to panel'));
    await waitFor(() => {
      expect(lensRun).toHaveBeenCalledWith('experience', 'addParticipant', expect.objectContaining({ name: 'Alex Doe' }));
    });

    fireEvent.click(screen.getByText('Screen'));
  });

  it('Highlight Reels creates a clip', async () => {
    render(<UXResearchSuite />);
    fireEvent.click(screen.getByText('Highlight Reels'));

    fireEvent.change(await screen.findByPlaceholderText('uxr_...'), { target: { value: 'uxr_123' } });
    fireEvent.change(screen.getByPlaceholderText('User confusion'), { target: { value: 'Confused by nav' } });
    fireEvent.click(screen.getByText('Create clip'));

    await waitFor(() => {
      expect(lensRun).toHaveBeenCalledWith('experience', 'createClip', expect.objectContaining({ runId: 'uxr_123', label: 'Confused by nav' }));
    });
  });

  it('Prototype tab creates a prototype', async () => {
    render(<UXResearchSuite />);
    fireEvent.click(screen.getByText('Prototype'));

    fireEvent.change(await screen.findByPlaceholderText('Onboarding flow'), { target: { value: 'Onboarding flow' } });
    fireEvent.change(screen.getByPlaceholderText('https://figma.com/proto/...'), { target: { value: 'https://figma.com/proto/abc' } });
    fireEvent.change(screen.getByPlaceholderText(/Welcome/), { target: { value: 'Welcome\nSign up' } });
    fireEvent.click(screen.getByText('Add prototype'));

    await waitFor(() => {
      expect(lensRun).toHaveBeenCalledWith('experience', 'createPrototype', expect.objectContaining({ name: 'Onboarding flow', embedUrl: 'https://figma.com/proto/abc' }));
    });
  });

  it('Surveys: opens an existing survey, answers its NPS question, and completes the take-flow', async () => {
    render(<UXResearchSuite />);
    fireEvent.click(screen.getByText('Surveys'));

    fireEvent.click(await screen.findByText('CSAT check-in'));
    await waitFor(() => {
      expect(lensRun).toHaveBeenCalledWith('experience', 'surveyResults', { surveyId: 'survey-1' });
    });

    // NPS renders 11 number buttons (0-10); answer with 9.
    const nine = await screen.findByText('9');
    fireEvent.click(nine);

    await waitFor(() => {
      expect(lensRun).toHaveBeenCalledWith('experience', 'surveyNext', expect.objectContaining({ surveyId: 'survey-1', questionId: 'q1', answer: '9' }));
    });
    // surveyNext returned done:true, so the response is submitted and marked complete.
    await waitFor(() => {
      expect(lensRun).toHaveBeenCalledWith('experience', 'submitSurveyResponse', expect.objectContaining({ surveyId: 'survey-1' }));
    });
    expect(await screen.findByText('Complete')).toBeInTheDocument();
  });

  it('Panel: screens the panel and invites a matched participant', async () => {
    render(<UXResearchSuite />);
    fireEvent.click(screen.getByText('Panel'));

    // Existing panel member renders from listPanel.
    expect(await screen.findByText('Alex Doe')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('device'), { target: { value: 'role' } });
    fireEvent.click(screen.getByText('Screen'));

    await waitFor(() => {
      expect(lensRun).toHaveBeenCalledWith('experience', 'screenPanel', expect.objectContaining({ rules: [expect.objectContaining({ attribute: 'role' })] }));
    });
  });

  it('Highlight Reels: an existing clip can be selected and built into a reel', async () => {
    render(<UXResearchSuite />);
    fireEvent.click(screen.getByText('Highlight Reels'));

    // Existing clip renders from listClips.
    const checkbox = await screen.findByRole('checkbox');
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByText(/Build reel/i));

    await waitFor(() => {
      expect(lensRun).toHaveBeenCalledWith('experience', 'buildReel', expect.objectContaining({ clipIds: ['clip-1'] }));
    });
  });

  it('Prototype: opens an existing prototype and records a frame interaction', async () => {
    render(<UXResearchSuite />);
    fireEvent.click(screen.getByText('Prototype'));

    fireEvent.click(await screen.findByText(/Onboarding/));
    await waitFor(() => {
      expect(lensRun).toHaveBeenCalledWith('experience', 'prototypeAnalytics', { prototypeId: 'proto-1' });
    });
  });
});
