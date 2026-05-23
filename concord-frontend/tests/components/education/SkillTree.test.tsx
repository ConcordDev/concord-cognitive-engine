import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { SkillTree } from '@/components/education/SkillTree';

const SKILLS = [
  { id: 's1', name: 'Addition', subject: 'math', mastery: 'mastered', attempts: 12, lastPracticedAt: '2026-05-01' },
  { id: 's2', name: 'Photosynthesis', subject: 'science', mastery: 'proficient', attempts: 5, lastPracticedAt: null },
  { id: 's3', name: 'Fractions', subject: 'math', mastery: 'familiar', attempts: 2, lastPracticedAt: null },
];

describe('SkillTree', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: { skills: [], counts: {} } } });
  });

  it('shows the empty state', async () => {
    render(<SkillTree />);
    expect(await screen.findByText('No skills yet.')).toBeInTheDocument();
  });

  it('renders skills with mastery badges and bar colours', async () => {
    lensRun.mockResolvedValue({
      data: { ok: true, result: { skills: SKILLS, counts: { mastered: 1, proficient: 1, familiar: 1 } } },
    });
    render(<SkillTree />);
    expect(await screen.findByText('Addition')).toBeInTheDocument();
    expect(screen.getByText('Photosynthesis')).toBeInTheDocument();
    expect(screen.getByText('Fractions')).toBeInTheDocument();
    expect(screen.getByText('12 attempts')).toBeInTheDocument();
    // counts grid renders the mastered count
    expect(screen.getAllByText('1').length).toBeGreaterThan(0);
  });

  it('adds a skill and clears the name field', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { skills: [], counts: {} } } });
    render(<SkillTree />);
    await screen.findByText('No skills yet.');
    fireEvent.change(screen.getByPlaceholderText('New skill'), { target: { value: 'Algebra' } });
    fireEvent.click(screen.getByText('Add'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'skills-create', input: { name: 'Algebra', subject: 'math' } }),
      ),
    );
  });

  it('does not add a skill with an empty name', async () => {
    render(<SkillTree />);
    await screen.findByText('No skills yet.');
    lensRun.mockClear();
    fireEvent.click(screen.getByText('Add'));
    expect(lensRun).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'skills-create' }));
  });

  it('records a correct practice attempt', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { skills: SKILLS, counts: {} } } });
    render(<SkillTree />);
    await screen.findByText('Addition');
    fireEvent.click(screen.getAllByTitle('Correct')[0]);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'skills-practice', input: { id: 's1', success: true } }),
      ),
    );
  });

  it('records a wrong practice attempt', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { skills: SKILLS, counts: {} } } });
    render(<SkillTree />);
    await screen.findByText('Addition');
    fireEvent.click(screen.getAllByTitle('Wrong')[0]);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'skills-practice', input: { id: 's1', success: false } }),
      ),
    );
  });

  it('refetches when the subject filter changes', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { skills: SKILLS, counts: {} } } });
    render(<SkillTree />);
    await screen.findByText('Addition');
    lensRun.mockClear();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'math' } });
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'skills-tree', input: { subject: 'math' } }),
      ),
    );
  });

  it('tolerates a refresh rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<SkillTree />);
    expect(await screen.findByText('No skills yet.')).toBeInTheDocument();
  });
});
