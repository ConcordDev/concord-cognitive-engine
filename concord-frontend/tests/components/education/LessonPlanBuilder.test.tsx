import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { LessonPlanBuilder } from '@/components/education/LessonPlanBuilder';

const PLAN = {
  title: 'Linear Equations 101',
  subject: 'Algebra I', grade: '8th', duration: '45 min',
  standards: ['CCSS.MATH.8.EE.C.7'],
  objectives: ['Solve one-variable equations'],
  materials: ['Whiteboard', 'Worksheet'],
  warmUp: 'Quick recap', mainActivity: 'Guided practice',
  practice: 'Solo problems', closure: 'Exit ticket',
  differentiation: { struggling: 'extra scaffolds', grade_level: 'standard set', advanced: 'challenge problems' },
  assessment: 'Quiz on Friday',
};

describe('LessonPlanBuilder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: { plan: PLAN } } });
  });

  it('renders the form with defaults', () => {
    render(<LessonPlanBuilder />);
    expect(screen.getByDisplayValue('Algebra I')).toBeInTheDocument();
    expect(screen.getByDisplayValue('8th')).toBeInTheDocument();
    expect(screen.getByText('Generate plan')).toBeInTheDocument();
  });

  it('shows an error when the topic is cleared', () => {
    render(<LessonPlanBuilder />);
    const topic = screen.getByDisplayValue(/Solving linear equations/);
    fireEvent.change(topic, { target: { value: '   ' } });
    fireEvent.click(screen.getByText('Generate plan'));
    expect(screen.getByText('Topic is required.')).toBeInTheDocument();
  });

  it('generates a plan and renders its sections', async () => {
    render(<LessonPlanBuilder />);
    fireEvent.click(screen.getByText('Generate plan'));
    expect(await screen.findByText('Linear Equations 101')).toBeInTheDocument();
    expect(screen.getByText('Solve one-variable equations')).toBeInTheDocument();
    expect(screen.getByText('Quick recap')).toBeInTheDocument();
    expect(screen.getByText('extra scaffolds')).toBeInTheDocument();
    expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'lesson-plan-generate' }));
  });

  it('renders a plan without differentiation', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { plan: { ...PLAN, differentiation: undefined } } } });
    render(<LessonPlanBuilder />);
    fireEvent.click(screen.getByText('Generate plan'));
    await screen.findByText('Linear Equations 101');
    expect(screen.queryByText('Differentiation')).not.toBeInTheDocument();
  });

  it('copies the plan markdown to the clipboard', async () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    render(<LessonPlanBuilder />);
    fireEvent.click(screen.getByText('Generate plan'));
    await screen.findByText('Linear Equations 101');
    fireEvent.click(screen.getByText('Copy MD'));
    expect(writeText).toHaveBeenCalled();
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('downloads the plan as markdown', async () => {
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<LessonPlanBuilder />);
    fireEvent.click(screen.getByText('Generate plan'));
    await screen.findByText('Linear Equations 101');
    fireEvent.click(screen.getByText('.md'));
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
    URL.createObjectURL = origCreate;
    URL.revokeObjectURL = origRevoke;
  });

  it('shows an error message when generation rejects', async () => {
    lensRun.mockRejectedValue(new Error('llm offline'));
    render(<LessonPlanBuilder />);
    fireEvent.click(screen.getByText('Generate plan'));
    expect(await screen.findByText('llm offline')).toBeInTheDocument();
  });

  it('handles a null plan result without rendering a plan', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: {} } });
    render(<LessonPlanBuilder />);
    fireEvent.click(screen.getByText('Generate plan'));
    await waitFor(() => expect(lensRun).toHaveBeenCalled());
    expect(screen.queryByText('Linear Equations 101')).not.toBeInTheDocument();
  });
});
