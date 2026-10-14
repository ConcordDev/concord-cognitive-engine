/// <reference types="@testing-library/jest-dom/vitest" />
/**
 * INC-SWEEP law F1 — CaseFiles form statuses must match the law artifact
 * enum; create keeps the title on failure and surfaces the server error.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { CASE_STATUSES, normalizeCaseStatus } from '@/components/law/case-types';

vi.mock('@/lib/api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: import('react').ReactNode }) => children,
  motion: new Proxy({}, {
    get: (_, tag: string) => (props: Record<string, unknown> & { children?: React.ReactNode }) => {
      const { initial: _i, animate: _a, exit: _e, transition: _t, layout: _l, ...rest } = props as Record<string, unknown>;
      void _i; void _a; void _e; void _t; void _l;
      return React.createElement(tag, rest, props.children);
    },
  }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props })
    );
    Icon.displayName = name;
    return Icon;
  };
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(actual)) {
    if (k[0] >= 'A' && k[0] <= 'Z' && k !== 'createLucideIcon' && k !== 'default') o[k] = make(k);
  }
  return { ...actual, ...o };
});

import { CaseFiles } from '@/components/law/CaseFiles';
import { api } from '@/lib/api/client';

const mockedApi = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
};

function renderWithQuery(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

describe('CaseFiles law artifact statuses (F1)', () => {
  it('exports the server artifact enum the form must send', () => {
    expect([...CASE_STATUSES]).toEqual([
      'draft', 'review', 'filed', 'active', 'closed', 'archived',
    ]);
  });

  it('does not include the old vocabulary that 422ed', () => {
    for (const s of ['open', 'in-review', 'hearing']) {
      expect(CASE_STATUSES).not.toContain(s);
    }
  });

  it('normalizeCaseStatus maps legacy open → active and defaults to draft', () => {
    expect(normalizeCaseStatus('open')).toBe('active');
    expect(normalizeCaseStatus('in-review')).toBe('review');
    expect(normalizeCaseStatus('bogus')).toBe('draft');
    expect(normalizeCaseStatus('filed')).toBe('filed');
  });
});

describe('CaseFiles create error handling (F1)', () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.post.mockReset();
    mockedApi.get.mockResolvedValue({ data: { ok: true, artifacts: [], total: 0 } });
  });

  it('posts meta.status draft (never open) and clears title only on success', async () => {
    mockedApi.post.mockResolvedValue({
      data: {
        ok: true,
        artifact: {
          id: 'case-new',
          title: 'Case alpha',
          type: 'case',
          data: {},
          meta: { status: 'draft' },
          createdAt: '2026-10-14T00:00:00.000Z',
          updatedAt: '2026-10-14T00:00:00.000Z',
          version: 1,
        },
      },
    });
    renderWithQuery(<CaseFiles />);
    await waitFor(() => expect(screen.getByPlaceholderText(/Case title/)).toBeInTheDocument());

    const input = screen.getByPlaceholderText(/Case title/);
    fireEvent.change(input, { target: { value: 'Case alpha' } });
    fireEvent.click(screen.getByLabelText('Add case'));

    await waitFor(() => expect(mockedApi.post).toHaveBeenCalled());
    const createCall = mockedApi.post.mock.calls.find(([u]: [string]) => u === '/api/lens/law');
    expect(createCall).toBeTruthy();
    expect(createCall![1]).toEqual(expect.objectContaining({
      type: 'case',
      title: 'Case alpha',
      meta: { status: 'draft' },
    }));
    await waitFor(() => expect(screen.getByPlaceholderText(/Case title/)).toHaveValue(''));
  });

  it('keeps the title and shows the server error when create fails', async () => {
    mockedApi.post.mockRejectedValue(new Error('Invalid status "open" for domain "law". Valid statuses: draft, review, filed, active, closed, archived'));
    renderWithQuery(<CaseFiles />);
    await waitFor(() => expect(screen.getByPlaceholderText(/Case title/)).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText(/Case title/), { target: { value: 'Case beta keep me' } });
    fireEvent.click(screen.getByLabelText('Add case'));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('alert').textContent).toMatch(/Invalid status|Valid statuses/);
    expect(screen.getByPlaceholderText(/Case title/)).toHaveValue('Case beta keep me');
  });
});
