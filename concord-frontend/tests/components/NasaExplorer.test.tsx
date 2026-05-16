import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const runDomain = vi.fn();
const addToast = vi.fn();
const create = vi.fn();

vi.mock('@/lib/api/client', () => ({
  apiHelpers: { lens: { runDomain: (...args: unknown[]) => runDomain(...args) }, dtus: { create: (...args: unknown[]) => create(...args) } },
}));
vi.mock('@/store/ui', () => ({ useUIStore: (sel: (s: unknown) => unknown) => sel({ addToast }) }));
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

import { NasaExplorer } from '@/components/astronomy/NasaExplorer';

function renderWithQuery(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

describe('NasaExplorer', () => {
  beforeEach(() => {
    runDomain.mockReset();
    addToast.mockReset();
    create.mockReset();
  });
  afterEach(() => { vi.clearAllTimers(); });

  it('renders the three panels with their headers', async () => {
    // Default to {ok:false} so panels stay in pre-load state and don't crash on empty data
    runDomain.mockResolvedValue({ data: { ok: true, result: { ok: false, error: 'no data' } } });
    renderWithQuery(<NasaExplorer />);
    expect(screen.getByText('NASA Picture of the Day')).toBeInTheDocument();
    expect(screen.getByText(/ISS — real-time position/)).toBeInTheDocument();
    expect(screen.getByText(/Near-Earth Objects/i)).toBeInTheDocument();
  });

  it('calls APOD + ISS + NEO macros on mount', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { ok: false, error: 'no data' } } });
    renderWithQuery(<NasaExplorer />);
    await waitFor(() => {
      const actions = runDomain.mock.calls.map((c) => c[1]);
      expect(actions).toContain('apod');
      expect(actions).toContain('iss-current-location');
      expect(actions).toContain('near-earth-objects');
    });
  });

  it('renders APOD image when an image media-type comes back', async () => {
    runDomain.mockImplementation(async (_d, action) => {
      if (action === 'apod') return { data: { ok: true, result: { ok: true, result: {
        date: '2026-05-16', title: 'Crab Nebula', explanation: 'A famous supernova remnant.',
        mediaType: 'image', url: 'https://apod.nasa.gov/apod/image/crab.jpg', source: 'nasa-apod',
      } } } };
      return { data: { ok: true, result: { ok: false, error: 'n/a' } } };
    });
    renderWithQuery(<NasaExplorer />);
    await waitFor(() => expect(screen.getByText('Crab Nebula')).toBeInTheDocument());
    expect(screen.getByText(/famous supernova remnant/i)).toBeInTheDocument();
  });

  it('renders ISS data row with lat/lng', async () => {
    runDomain.mockImplementation(async (_d, action) => {
      if (action === 'iss-current-location') return { data: { ok: true, result: { ok: true, result: {
        satelliteId: 25544, name: 'iss',
        latitude: 37.7790, longitude: -122.4199,
        altitudeKm: 408.5, velocityKmH: 27600, visibility: 'daylight',
        footprintKm: 4500, timestamp: 1700000000, daynum: 1, source: 'wheretheiss.at',
      } } } };
      return { data: { ok: true, result: { ok: false, error: 'n/a' } } };
    });
    renderWithQuery(<NasaExplorer />);
    await waitFor(() => expect(screen.getByText('Latitude')).toBeInTheDocument());
    expect(screen.getByText('37.7790°')).toBeInTheDocument();
    expect(screen.getByText('-122.4199°')).toBeInTheDocument();
  });

  it('renders NEO rows with PHA badge when potentiallyHazardous', async () => {
    runDomain.mockImplementation(async (_d, action) => {
      if (action === 'near-earth-objects') return { data: { ok: true, result: { ok: true, result: {
        objects: [{
          id: '2099942', name: '(99942) Apophis',
          absoluteMagnitude: 19.7,
          estimatedDiameterMeters: { min: 310, max: 340 },
          potentiallyHazardous: true,
          approach: { date: '2026-05-16', relativeVelocityKmH: 21500, missDistanceKm: 380000, missDistanceLunar: 0.99, orbitingBody: 'Earth' },
          nasaJplUrl: 'https://ssd.jpl.nasa.gov/sbdb.cgi?sstr=99942',
        }],
      } } } };
      return { data: { ok: true, result: { ok: false, error: 'n/a' } } };
    });
    renderWithQuery(<NasaExplorer />);
    await waitFor(() => expect(screen.getByText(/Apophis/)).toBeInTheDocument());
    expect(screen.getByText('PHA')).toBeInTheDocument();
    expect(screen.getByText(/0\.99 LD/)).toBeInTheDocument();
  });

  it('date scrubber prev/next shifts date and re-triggers APOD + NEO fetch', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { ok: false, error: 'n/a' } } });
    renderWithQuery(<NasaExplorer />);
    await waitFor(() => expect(runDomain).toHaveBeenCalled());
    runDomain.mockClear();
    fireEvent.click(screen.getByLabelText('Previous day'));
    await waitFor(() => {
      const apodCall = runDomain.mock.calls.find((c) => c[1] === 'apod');
      expect(apodCall).toBeTruthy();
    });
  });
});
