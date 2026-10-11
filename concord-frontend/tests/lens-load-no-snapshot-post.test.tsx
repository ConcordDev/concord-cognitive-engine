/**
 * Opening a lens must not POST a stored artifact.
 *
 * useLensBridge used to mirror live domain reads into POST /api/lens/:domain
 * from a mount effect. inference / metacognition / affect always sent
 * type "snapshot", which the server rejects (422 validation_failed) and
 * which surfaced as an uncaught ConcordError. attention ("thread") and
 * commonsense ("fact") miss their domain type lists too, so they 422 once
 * the user has rows. metalearning ("strategy") is a valid type, so a cold
 * load with strategies would insert a duplicate record. Nothing in these
 * screens reads the artifact back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const LENS_CREATE = /\/api\/lens\/(inference|metacognition|affect|attention|metalearning|commonsense)(?:\?|$|\/)/;

const { apiPost } = vi.hoisted(() => ({
  apiPost: vi.fn(() => Promise.resolve({ data: { ok: true, artifact: { id: 'should-not-be-created' } } })),
}));

vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({
    latestData: null,
    alerts: [],
    insights: [],
    isLive: false,
    isConnected: false,
    hasReceivedData: false,
    lastUpdated: null,
    clearAlerts: () => {},
  }),
}));

vi.mock('@/hooks/useLensCommand', () => ({
  useLensCommand: () => {},
}));

vi.mock('@/lib/api/client', () => ({
  api: {
    get: vi.fn(() => Promise.resolve({ data: { ok: true, artifacts: [], total: 0 } })),
    post: (...args: unknown[]) => apiPost(...args),
    put: vi.fn(() => Promise.resolve({ data: {} })),
    delete: vi.fn(() => Promise.resolve({ data: {} })),
  },
  lensRun: vi.fn((_domain: string, name: string) => {
    if (name === 'factList') {
      return Promise.resolve({
        data: {
          ok: true,
          result: {
            facts: [{ id: 'f1', subject: 'bird', relation: 'is_a', object: 'animal', confidence: 0.9 }],
          },
        },
      });
    }
    if (name === 'inferChain') {
      return Promise.resolve({ data: { ok: true, result: { count: 2 } } });
    }
    return Promise.resolve({ data: { ok: true, result: {} } });
  }),
  apiHelpers: {
    affect: {
      state: () => Promise.resolve({
        data: { ok: true, state: { v: 0.5, a: 0.4, s: 0.6, c: 0.7, g: 0.5, t: 0.5, f: 0.2 } },
      }),
      policy: () => Promise.resolve({ data: { policy: { name: 'steady' } } }),
      health: () => Promise.resolve({ data: { healthy: true, score: 0.8 } }),
      events: () => Promise.resolve({ data: { events: [] } }),
      emit: () => Promise.resolve({ data: { ok: true } }),
      reset: () => Promise.resolve({ data: { ok: true } }),
    },
    metacognition: {
      status: () => Promise.resolve({ data: { status: { ok: true, monitored: 3 } } }),
      blindspots: () => Promise.resolve({ data: { blindSpots: [] } }),
      calibration: () => Promise.resolve({ data: { report: { samples: 4 } } }),
      introspection: () => Promise.resolve({ data: { introspection: { recentPatterns: [] } } }),
      predictions: () => Promise.resolve({ data: { predictions: [] } }),
      assessments: () => Promise.resolve({ data: { assessments: [] } }),
    },
    inference: {
      status: () => Promise.resolve({
        data: { ok: true, facts: 0, rules: 0, derived: 0, stats: { forward: 0 } },
      }),
    },
    attention: {
      status: () => Promise.resolve({ data: { activeThreads: [], stats: {} } }),
      threads: () => Promise.resolve({
        data: {
          threads: [{
            id: 't1',
            type: 'reasoning',
            priority: 0.8,
            status: 'active',
            description: 'plan the day',
            createdAt: '2026-10-11T00:00:00Z',
          }],
        },
      }),
      queue: () => Promise.resolve({ data: { queue: [], completed: [] } }),
    },
    metalearning: {
      status: () => Promise.resolve({ data: { status: { adaptations: 0, curricula: 0, performance: 0 } } }),
      strategies: () => Promise.resolve({
        data: { strategies: [{ id: 's1', name: 'Spaced retrieval', domain: 'general', avgPerformance: 0.7, uses: 3 }] },
      }),
      bestStrategy: () => Promise.resolve({
        data: { strategy: { id: 's1', name: 'Spaced retrieval', domain: 'general' } },
      }),
      adaptations: () => Promise.resolve({ data: { adaptations: [] } }),
    },
    commonsense: {
      query: () => Promise.resolve({ data: { ok: true, results: [] } }),
    },
  },
}));

import { AffectSessionProvider } from '@/components/affect/AffectSessionContext';
import { AffectStateStrip } from '@/components/affect/AffectStateStrip';
import { DimensionsPanel } from '@/components/affect/DimensionsPanel';
import { AwarenessPanel } from '@/components/metacognition/AwarenessPanel';
import { InferenceDeskPanel } from '@/components/inference/InferenceDeskPanel';
import { ThreadsDeskPanel } from '@/components/attention/ThreadsDeskPanel';
import { StrategiesDeskPanel } from '@/components/metalearning/StrategiesDeskPanel';
import { FactsPanel } from '@/components/commonsense/FactsPanel';

function renderLens(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function lensCreates() {
  return apiPost.mock.calls.filter((call) => LENS_CREATE.test(String(call[0] ?? '')));
}

const rejections: unknown[] = [];
function onRejection(reason: unknown) {
  rejections.push(reason);
}

beforeEach(() => {
  rejections.length = 0;
  process.on('unhandledRejection', onRejection);
});

afterEach(() => {
  process.off('unhandledRejection', onRejection);
  cleanup();
});

async function settled(text: string | RegExp) {
  const nodes = await screen.findAllByText(text);
  expect(nodes.length).toBeGreaterThan(0);
  // The old mirror wrote inside useEffect, and mutateAsync rejected on the
  // next turn. Give that rejection a chance to surface before we assert.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

describe('lens load does not POST an artifact', () => {
  it('inference desk does not save a snapshot when status arrives', async () => {
    renderLens(<InferenceDeskPanel mode="facts" />);
    await settled('Inference desk');
    expect(lensCreates()).toEqual([]);
    expect(rejections).toEqual([]);
  });

  it('affect strip and default dimensions view do not save a snapshot', async () => {
    renderLens(
      <AffectSessionProvider>
        <AffectStateStrip />
        <DimensionsPanel />
      </AffectSessionProvider>,
    );
    await settled('Valence');
    expect(lensCreates()).toEqual([]);
    expect(rejections).toEqual([]);
  });

  it('metacognition awareness does not save a snapshot when status arrives', async () => {
    renderLens(<AwarenessPanel />);
    await settled('Knowledge Confidence Map');
    expect(lensCreates()).toEqual([]);
    expect(rejections).toEqual([]);
  });

  it('attention threads do not mirror into a lens artifact', async () => {
    renderLens(<ThreadsDeskPanel />);
    await settled('plan the day');
    expect(lensCreates()).toEqual([]);
    expect(rejections).toEqual([]);
  });

  it('metalearning strategies do not mirror into a lens artifact', async () => {
    renderLens(<StrategiesDeskPanel />);
    await settled('Spaced retrieval');
    expect(lensCreates()).toEqual([]);
    expect(rejections).toEqual([]);
  });

  it('commonsense facts do not mirror into a lens artifact', async () => {
    renderLens(<FactsPanel />);
    await settled('bird');
    expect(lensCreates()).toEqual([]);
    expect(rejections).toEqual([]);
  });
});
