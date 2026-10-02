/**
 * Answers, CRI, History, Linguistics, Codex, Philosophy north stars.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { KeyboardProvider } from '@/lib/keyboard';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u1', username: 'ramaj', email: 'r@x', role: 'owner' },
    isLoading: false,
    isAuthenticated: true,
    logout: async () => {},
    refresh: async () => {},
  }),
}));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useLensIdentity', () => ({ useLensIdentity: () => {} }));

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { TheQuestion } from '@/components/answers/TheQuestion';
import { TheIndex } from '@/components/cri/TheIndex';
import { TheRecord } from '@/components/history/TheRecord';
import { TheUtterance } from '@/components/linguistics/TheUtterance';
import { TheCodexPage } from '@/components/codex/TheCodexPage';
import { TheTable } from '@/components/philosophy/TheTable';

function ok(result: unknown) {
  return { data: { ok: true, result, error: null } };
}

function renderInShell(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <KeyboardProvider>{ui}</KeyboardProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => { lensRunMock.mockReset(); });

describe('inquiry north stars', () => {
  it('answers stays empty until a real question is long enough to ask', async () => {
    lensRunMock.mockResolvedValue(ok({ questions: [], count: 0 }));
    renderInShell(<TheQuestion onOpenDesk={() => {}} />);
    expect(await screen.findByText('The thread is empty.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'The question, Ramaj' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect(lensRunMock.mock.calls.some((c) => c[1] === 'question-ask')).toBe(false);
    fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'Short' } });
    fireEvent.change(screen.getByLabelText('Detail'), { target: { value: 'too short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect(lensRunMock.mock.calls.some((c) => c[1] === 'question-ask')).toBe(false);

    lensRunMock.mockImplementation((_d: string, name: string) => {
      if (name === 'question-list') return Promise.resolve(ok({ questions: [], count: 0 }));
      if (name === 'question-ask') {
        return Promise.resolve(ok({ question: { id: 'q1', title: 'Why beams bend', body: 'A beam bends when the moment exceeds the section.' } }));
      }
      return Promise.resolve(ok({}));
    });
    fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'Why beams bend' } });
    fireEvent.change(screen.getByLabelText('Detail'), { target: { value: 'A beam bends when the moment exceeds the section.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect(await screen.findByTestId('answers-open')).toBeTruthy();
    expect(screen.getByText('Why beams bend')).toBeTruthy();
    const call = lensRunMock.mock.calls.find((c) => c[1] === 'question-ask');
    expect(call?.[0]).toBe('answers');
    expect(call?.[2]).toMatchObject({ title: 'Why beams bend' });
  });

  it('cri does not open the index until asked', async () => {
    renderInShell(<TheIndex onOpenDesk={() => {}} />);
    expect(screen.getByText('The index has not answered.')).toBeTruthy();
    expect(lensRunMock).not.toHaveBeenCalled();
    lensRunMock.mockResolvedValue(ok({
      weights: { coherence: 0.2, relevance: 0.2 },
      dimensions: ['coherence', 'relevance'],
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Open the index' }));
    expect(await screen.findByText('coherence')).toBeTruthy();
    expect(screen.getAllByText('0.2').length).toBe(2);
    expect(lensRunMock).toHaveBeenCalledWith('cri', 'scoreRules-get', {});
  });

  it('history lists a returned record and refuses an empty shelf', async () => {
    lensRunMock.mockResolvedValue(ok({ timelines: [], count: 0 }));
    renderInShell(<TheRecord onOpenDesk={() => {}} />);
    expect(screen.getByText('No record open.')).toBeTruthy();
    expect(lensRunMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Open a record' }));
    expect(await screen.findByText('No record to open.')).toBeTruthy();
    expect(lensRunMock).toHaveBeenCalledWith('history', 'timeline-list', {});
  });

  it('history opens the timeline the server returns', async () => {
    lensRunMock.mockImplementation((_d: string, name: string) => {
      if (name === 'timeline-list') {
        return Promise.resolve(ok({ timelines: [{ id: 'tl1', title: 'Founding', eventCount: 1 }], count: 1 }));
      }
      if (name === 'timeline-detail') {
        return Promise.resolve(ok({ timeline: { id: 'tl1', title: 'Founding', events: [{ id: 'e1', year: 12, title: 'The charter' }] } }));
      }
      return Promise.resolve(ok({}));
    });
    renderInShell(<TheRecord onOpenDesk={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open a record' }));
    fireEvent.click(await screen.findByRole('button', { name: /Founding/ }));
    expect(await screen.findByTestId('history-open')).toBeTruthy();
    expect(screen.getByText('The charter')).toBeTruthy();
  });

  it('linguistics analyzes only after an utterance', async () => {
    renderInShell(<TheUtterance onOpenDesk={() => {}} />);
    expect(screen.getByText('No utterance open.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open a text' }));
    expect(lensRunMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Utterance'), { target: { value: 'The beam carries the floor.' } });
    lensRunMock.mockResolvedValue(ok({ content: 'Tokens: 5 words', wordCount: 5, readingLevel: 'elementary' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open a text' }));
    expect(await screen.findByText('Tokens: 5 words')).toBeTruthy();
    expect(lensRunMock).toHaveBeenCalledWith('linguistics', 'analyze', { text: 'The beam carries the floor.' });
  });

  it('codex does not list pages until opened, then shows a returned title', async () => {
    renderInShell(<TheCodexPage onOpenDesk={() => {}} />);
    expect(screen.getByText('No page open.')).toBeTruthy();
    expect(lensRunMock).not.toHaveBeenCalled();
    lensRunMock.mockImplementation((_d: string, name: string) => {
      if (name === 'list') return Promise.resolve(ok({ events: [{ id: 'flower', title: 'Flower Law' }] }));
      if (name === 'get') return Promise.resolve(ok({ event: { id: 'flower', title: 'Flower Law', description: 'The disk holds.' } }));
      return Promise.resolve(ok({}));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Open a page' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Flower Law' }));
    expect(await screen.findByText('The disk holds.')).toBeTruthy();
    expect(lensRunMock).toHaveBeenCalledWith('lore', 'list', { limit: 40 });
  });

  it('philosophy begins a channel only after a title', async () => {
    lensRunMock.mockResolvedValue(ok({ channels: [], count: 0 }));
    renderInShell(<TheTable onOpenDesk={() => {}} />);
    expect(screen.getByText('No question open.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Begin' }));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('philosophy', 'channel-list', {}));
    fireEvent.click(screen.getByRole('button', { name: 'Begin' }));
    expect(lensRunMock.mock.calls.some((c) => c[1] === 'channel-create')).toBe(false);
    lensRunMock.mockImplementation((_d: string, name: string) => {
      if (name === 'channel-list') return Promise.resolve(ok({ channels: [], count: 0 }));
      if (name === 'channel-create') return Promise.resolve(ok({ channel: { id: 'ch1', title: 'What is a refusal' } }));
      return Promise.resolve(ok({}));
    });
    fireEvent.change(await screen.findByLabelText('Question'), { target: { value: 'What is a refusal' } });
    fireEvent.click(screen.getByRole('button', { name: 'Begin' }));
    expect(await screen.findByTestId('philosophy-open')).toBeTruthy();
    expect(screen.getByText('What is a refusal')).toBeTruthy();
  });
});
