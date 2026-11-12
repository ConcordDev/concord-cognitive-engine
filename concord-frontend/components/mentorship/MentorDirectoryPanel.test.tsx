/// <reference types="@testing-library/jest-dom/vitest" />
// MentorDirectoryPanel — pins FIX-mentorship-008's label: a mentor
// profile the server flags as a QA-harness sample renders a
// "Sample profile" chip in the directory; a real mentor does not.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'me', username: 'me' }, isLoading: false, isAuthenticated: true }),
}));

import { MentorDirectoryPanel } from './MentorDirectoryPanel';

const base = {
  headline: 'Systems mentor', bio: '', skills: ['rust'], experienceYears: 5,
  availability: 'flexible', capacity: 3, hourlyFocus: 'career', rating: 0,
  reviewCount: 0, menteeCount: 0, listed: true, hasAccount: true,
};

describe('MentorDirectoryPanel sample labelling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRunMock.mockImplementation((_domain: string, action: string) => {
      if (action === 'mentor-directory') {
        return Promise.resolve({
          data: {
            ok: true,
            result: {
              mentors: [
                { ...base, id: 'm-qa', name: 'QA mentor smtmv820475', sample: true },
                { ...base, id: 'm-ada', name: 'Ada', sample: false },
              ],
              count: 2, skills: ['rust'], sort: 'rating',
            },
            error: null,
          },
        });
      }
      return Promise.resolve({ data: { ok: true, result: {}, error: null } });
    });
  });

  it('labels only the harness sample mentor', async () => {
    render(<MentorDirectoryPanel />);
    expect(await screen.findByText('QA mentor smtmv820475')).toBeInTheDocument();
    expect(await screen.findByText('Ada')).toBeInTheDocument();
    expect(screen.getAllByText('Sample profile')).toHaveLength(1);
  });
});
