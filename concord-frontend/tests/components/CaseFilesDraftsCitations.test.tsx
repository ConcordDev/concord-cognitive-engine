import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

/**
 * Pins the Wave 4 gap-closure item from
 * docs/lens-specs/law-capability-map.md ("Draft + citation logging per
 * contract/matter"): `law.draft` / `law.cite` must be called ID-SCOPED
 * against the specific case-file artifact the user has expanded — via
 * `POST /api/lens/law/:id/run` — never via a generic/unscoped macro call
 * that would land on a throwaway artifact and be discarded.
 */

vi.mock('@/lib/api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('framer-motion', () => ({
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
  put: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

function renderWithQuery(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

const MOCK_CASE = {
  id: 'case-42',
  title: 'Doe v. Acme Corp',
  data: {
    jurisdiction: 'US',
    caseType: 'litigation',
    deadline: null,
    outcome: 'pending',
    judge: null,
    closedAt: null,
    timeline: [],
  },
  meta: { status: 'open' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  version: 1,
};

describe('CaseFiles — id-scoped Drafts & Citations (law.draft / law.cite)', () => {
  beforeEach(() => {
    mockedApi.get.mockReset();
    mockedApi.post.mockReset();
    mockedApi.get.mockResolvedValue({ data: { ok: true, artifacts: [MOCK_CASE], total: 1 } });
  });

  async function expandCase() {
    renderWithQuery(<CaseFiles />);
    await waitFor(() => expect(screen.getByText('Doe v. Acme Corp')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Doe v. Acme Corp'));
    await waitFor(() => expect(screen.getByPlaceholderText('Draft title…')).toBeInTheDocument());
  }

  it('calls law.draft id-scoped against THIS case artifact — not a generic unscoped call', async () => {
    mockedApi.post.mockResolvedValue({ data: { ok: true, draft: { id: 'draft-1', caseId: 'case-42', title: 'Motion to Dismiss', body: 'Draft body', version: 1, status: 'draft', createdAt: '2026-01-02T00:00:00.000Z' } } });
    await expandCase();

    fireEvent.change(screen.getByPlaceholderText('Draft title…'), { target: { value: 'Motion to Dismiss' } });
    fireEvent.change(screen.getByPlaceholderText('Body (optional)…'), { target: { value: 'Draft body' } });
    fireEvent.click(screen.getByLabelText('Add draft'));

    await waitFor(() => expect(mockedApi.post).toHaveBeenCalled());
    const [url, body] = mockedApi.post.mock.calls.find(([u]: [string]) => u.includes('/run'))!;
    // ID-scoped route: /api/lens/law/<real case artifact id>/run — NOT a
    // generic /api/lens/law/run call with no id.
    expect(url).toBe('/api/lens/law/case-42/run');
    expect(body).toEqual({
      action: 'draft',
      params: { title: 'Motion to Dismiss', body: 'Draft body' },
    });
  });

  it('calls law.cite id-scoped against THIS case artifact with the real macro param shape', async () => {
    mockedApi.post.mockResolvedValue({ data: { ok: true, citation: { id: 'cite-1', source: '347 U.S. 483', text: 'separate but equal', relevance: 0.8, addedAt: '2026-01-02T00:00:00.000Z' } } });
    await expandCase();

    fireEvent.change(screen.getByPlaceholderText('Source (e.g. 347 U.S. 483)…'), { target: { value: '347 U.S. 483' } });
    fireEvent.change(screen.getByPlaceholderText('Citation text…'), { target: { value: 'separate but equal' } });
    fireEvent.click(screen.getByLabelText('Add citation'));

    await waitFor(() => expect(mockedApi.post).toHaveBeenCalled());
    const [url, body] = mockedApi.post.mock.calls.find(([u]: [string]) => u.includes('/run'))!;
    expect(url).toBe('/api/lens/law/case-42/run');
    expect(body).toEqual({
      action: 'cite',
      params: { source: '347 U.S. 483', text: 'separate but equal', relevance: 0.8 },
    });
  });

  it('renders previously-logged drafts and citations from the real per-case artifact data', async () => {
    mockedApi.get.mockResolvedValue({
      data: {
        ok: true,
        artifacts: [{
          ...MOCK_CASE,
          data: {
            ...MOCK_CASE.data,
            drafts: [{ id: 'd1', caseId: 'case-42', title: 'Complaint v1', body: '', version: 1, status: 'draft', createdAt: '2026-01-01T00:00:00.000Z' }],
            citations: [{ id: 'c1', source: '410 U.S. 113', text: 'right to privacy', relevance: 0.9, addedAt: '2026-01-01T00:00:00.000Z' }],
          },
        }],
        total: 1,
      },
    });
    renderWithQuery(<CaseFiles />);
    await waitFor(() => expect(screen.getByText('Doe v. Acme Corp')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Doe v. Acme Corp'));

    await waitFor(() => expect(screen.getByText('Complaint v1')).toBeInTheDocument());
    expect(screen.getByText('410 U.S. 113')).toBeInTheDocument();
    expect(screen.getByText(/right to privacy/)).toBeInTheDocument();
  });

  it('does not submit an empty draft (no title)', async () => {
    await expandCase();
    expect(screen.getByLabelText('Add draft')).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Add draft'));
    expect(mockedApi.post).not.toHaveBeenCalled();
  });
});
