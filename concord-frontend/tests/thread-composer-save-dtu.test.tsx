import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...args: unknown[]) => lensRun(...args) }));

import { ThreadComposer } from '@/components/thread/ThreadComposer';

const BODY = 'Harbor lights at dusk, kept private.';

interface SavedDtu {
  id: string;
  input: Record<string, unknown> | null;
}

function specOf(args: unknown[]): { domain: string; action: string; input: Record<string, unknown> } {
  const first = args[0];
  if (typeof first === 'string') {
    return {
      domain: first,
      action: String(args[1] || ''),
      input: (args[2] as Record<string, unknown>) || {},
    };
  }
  const spec = (first || {}) as { domain?: string; action?: string; name?: string; input?: Record<string, unknown> };
  return {
    domain: spec.domain || '',
    action: spec.action || spec.name || '',
    input: spec.input || {},
  };
}

function wire(saved: SavedDtu) {
  lensRun.mockImplementation((...args: unknown[]) => {
    const { domain, action, input } = specOf(args);
    if (domain === 'thread' && action === 'draft-list') {
      return Promise.resolve({
        data: {
          ok: true,
          result: {
            drafts: [{ id: 'th_1', title: 'Harbor', platform: 'x', status: 'draft', postCount: 1, scheduledAt: null }],
          },
        },
      });
    }
    if (domain === 'thread' && action === 'thread-dashboard') {
      return Promise.resolve({ data: { ok: true, result: { drafts: 1, scheduled: 0, published: 0, total: 1 } } });
    }
    if (domain === 'thread' && action === 'best-time') {
      return Promise.resolve({ data: { ok: true, result: { slots: [] } } });
    }
    if (domain === 'thread' && action === 'draft-detail') {
      return Promise.resolve({
        data: {
          ok: true,
          result: { draft: { id: 'th_1', title: 'Harbor', content: BODY, platform: 'x', status: 'draft', posts: [] } },
        },
      });
    }
    if (domain === 'thread' && action === 'split-preview') {
      return Promise.resolve({ data: { ok: true, result: { posts: [{ index: 1, text: String(input.content || ''), chars: String(input.content || '').length }] } } });
    }
    if (domain === 'thread' && action === 'thread-draft') {
      return Promise.resolve({ data: { ok: true, result: { draft: { id: 'th_new', title: 'New', content: input.content, platform: 'x', status: 'draft', posts: [] } } } });
    }
    if (domain === 'thread' && (action === 'draft-update' || action === 'draft-schedule' || action === 'draft-publish')) {
      return Promise.resolve({
        data: {
          ok: true,
          result: {
            delivered: false,
            draft: { id: 'th_1', title: 'Harbor', content: BODY, platform: 'x', status: action === 'draft-publish' ? 'published' : 'draft', postedManually: action === 'draft-publish', posts: [] },
          },
        },
      });
    }
    if (domain === 'timeline' && action === 'post-create') {
      return Promise.resolve({ data: { ok: true, result: { post: { id: 'pst_1', privacy: 'private', citedDtuId: input.citedDtuId } } } });
    }
    if (domain === 'dtu' && action === 'create') {
      saved.id = 'dtu_harbor';
      saved.input = input;
      return Promise.resolve({
        data: { ok: true, result: { dtu: { id: saved.id, visibility: input.visibility, human: input.human } } },
      });
    }
    if (domain === 'dtu' && action === 'get') {
      return Promise.resolve({
        data: {
          ok: true,
          result: { dtu: { id: saved.id, visibility: saved.input?.visibility, human: saved.input?.human } },
        },
      });
    }
    return Promise.resolve({ data: { ok: false, error: `unhandled ${domain}.${action}` } });
  });
}

describe('Thread Composer Save as DTU', () => {
  beforeEach(() => { lensRun.mockReset(); });

  it('creates a private DTU whose body is the draft', async () => {
    const saved: SavedDtu = { id: '', input: null };
    wire(saved);
    render(<ThreadComposer />);
    fireEvent.click(await screen.findByText('Harbor'));
    fireEvent.click(await screen.findByRole('button', { name: 'Save as DTU' }));
    expect(await screen.findByText('Saved as DTU dtu_harbor.')).toBeInTheDocument();

    expect(saved.id).toBe('dtu_harbor');
    expect(saved.input?.visibility).toBe('private');
    expect((saved.input?.meta as { visibility?: string }).visibility).toBe('private');
    expect((saved.input?.scopes as string[])).toContain('private');
    const summary = String((saved.input?.human as { summary?: string }).summary || '');
    expect(summary).toContain(BODY);
    expect(summary).toContain('th_1');

    const createCall = lensRun.mock.calls.map((call) => specOf(call)).find((call) => call.domain === 'dtu' && call.action === 'create');
    expect(createCall?.input.visibility).toBe('private');
    expect(String((createCall?.input.human as { summary?: string }).summary)).toContain(BODY);

    fireEvent.click(screen.getByRole('button', { name: 'Send this DTU to Timeline' }));
    expect(await screen.findByText(/private post pst_1/)).toBeInTheDocument();
  });

  it('creates a draft, queues it, and records a manual post', async () => {
    const saved: SavedDtu = { id: '', input: null };
    wire(saved);
    render(<ThreadComposer />);
    await screen.findByText('Harbor');
    fireEvent.click(screen.getByRole('button', { name: /New thread/ }));
    fireEvent.change(screen.getByPlaceholderText(/Write your thread/), { target: { value: 'A second private draft body.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create draft' }));
    await waitFor(() => {
      expect(lensRun.mock.calls.map((call) => specOf(call)).some((call) => call.action === 'thread-draft' && String(call.input.content).includes('second private'))).toBe(true);
    });
    expect(await screen.findByText('A second private draft body.')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Harbor'));
    await screen.findByRole('button', { name: 'Save as DTU' });
    fireEvent.change(screen.getByDisplayValue(''), { target: { value: '2026-10-12T09:30' } });
    const queue = screen.getByRole('button', { name: /Queue/ });
    fireEvent.click(queue);
    await waitFor(() => {
      expect(lensRun.mock.calls.map((call) => specOf(call)).some((call) => call.action === 'draft-schedule')).toBe(true);
    });
    fireEvent.click(screen.getByRole('button', { name: /I posted this/ }));
    expect(await screen.findByText(/Marked as posted by you/)).toBeInTheDocument();
  });
});