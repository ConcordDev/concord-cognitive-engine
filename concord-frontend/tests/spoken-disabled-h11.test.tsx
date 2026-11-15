/**
 * H11 — a disabled/empty submit names what is missing instead of failing
 * silently (role="note" beside the control, gone once the field is valid).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('@/components/metacognition/useMetacognitionDesk', () => ({
  useMetacognitionDesk: () => ({
    knowledgeDomains: [], learningInsights: [], patterns: [], latestAssessment: null,
    runAssessment: { mutate: vi.fn(), isPending: false },
    isLoading: false, isError: false, errorMessage: '', refetchAll: vi.fn(),
  }),
}));

import { QuickCapture } from '@/components/common/QuickCapture';
import { LearningPanel } from '@/components/metacognition/LearningPanel';

afterEach(cleanup);

describe('H11 spoken empty submits', () => {
  it('Quick capture says what is missing and clears the note once there is text', () => {
    render(<QueryClientProvider client={new QueryClient()}><QuickCapture domain="docs" /></QueryClientProvider>);
    fireEvent.keyDown(document.body, { key: 'n', ctrlKey: true });
    expect(screen.getByRole('note').textContent).toBe('Write something to capture.');
    fireEvent.change(document.querySelector('textarea')!, { target: { value: 'hello' } });
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('Assess with an empty domain answers in words, then clears when typing', () => {
    render(<LearningPanel />);
    fireEvent.click(screen.getByRole('button', { name: /^Assess$/ }));
    expect(screen.getByRole('note').textContent).toBe('Enter a domain to assess.');
    fireEvent.change(screen.getByLabelText('Domain to assess'), { target: { value: 'logic' } });
    expect(screen.queryByRole('note')).toBeNull();
  });

  const src = (f: string) => readFileSync(resolve(__dirname, `../components/${f}`), 'utf8');
  it.each([
    ['affect/MoodTracker.tsx', 'Pick a mood to check in.'],
    ['home-improvement/ProjectsPanel.tsx', 'Project name is required.'],
    ['home-improvement/ProjectsPanel.tsx', 'Describe the task to add it.'],
    ['home-improvement/ProjectsPanel.tsx', 'Expense label is required.'],
    ['transfer/EtlWorkbench.tsx', 'Connector name is required.'],
    ['transfer/EtlWorkbench.tsx', 'Pipeline name is required.'],
    ['transfer/EtlWorkbench.tsx', 'Pick a source connector.'],
    ['math/FormulaNotebookPanel.tsx', 'Formula name is required.'],
  ])('%s carries the note "%s" beside its disabled control', (file, text) => {
    expect(src(file)).toMatch(new RegExp(`role="note"[^>]*>${text.replace(/[.]/g, '\\.')}</span>`));
  });
});
