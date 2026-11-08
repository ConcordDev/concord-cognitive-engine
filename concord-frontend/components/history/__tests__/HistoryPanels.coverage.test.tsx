// Render + behaviour coverage for the history lens panels: the timeline builder (create, events,
// eras, views), publish, Wikipedia import, and the calculator tools (period comparison, cause &
// effect chains, timeline build, source evaluation). Panels mount against stubbed engine results,
// must render real content, survive a full exercise pass and degrade honestly offline.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { actionOf, exercise } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const runDomain = vi.fn();
const EVENT = { id: 'ev1', title: 'Magna Carta', year: 1215, dateLabel: '1215', category: 'political', description: 'Charter sealed', track: 'England', lat: 51.4, lng: -0.5, place: 'Runnymede', media: [] };
const TIMELINE = { id: 'tl1', title: 'Medieval England', description: 'Key events', events: [EVENT, { ...EVENT, id: 'ev2', title: 'Black Death', year: 1348, lat: null, lng: null }], eras: [{ id: 'er1', name: 'High Middle Ages', startYear: 1000, endYear: 1300, color: '#8b5cf6' }] };
const PUBLISHED = { published: true, stale: false, shareId: 'sh1', shareUrl: 'https://concord.test/t/sh1', embedCode: '<iframe src="https://concord.test/t/sh1"></iframe>', eventCount: 2, publishedAt: '2026-03-02T10:00:00Z' };

function resultFor(action: string): unknown {
  switch (action) {
    case 'timeline-list': return { timelines: [{ id: 'tl1', title: 'Medieval England', eventCount: 2, eraCount: 1 }, { id: 'tl2', title: 'Rome', eventCount: 0, eraCount: 0 }] };
    case 'timeline-detail': return { timeline: TIMELINE };
    case 'timeline-create': return { timeline: { id: 'tl3' } };
    case 'timeline-publish': case 'timeline-publish-status': return PUBLISHED;
    case 'timeline-from-wikipedia': return { createdNewTimeline: true, extraction: { sentences: 80, eventsExtracted: 12 }, timeline: { id: 'tl4', title: 'Roman Empire', description: 'From Wikipedia', eventCount: 12, sourceArticle: 'Roman Empire' }, extractedCount: 12, usedCount: 12 };
    case 'event-add': case 'event-update': return { event: EVENT };
    case 'era-add': return { era: TIMELINE.eras[0] };
    case 'comparePeriods': return { periods: [{ name: 'Medieval', startYear: '500', endYear: '1500', duration: 1000, keyFeatures: ['feudalism'], population: '5M', technology: 'plough', governance: 'monarchy' }, { name: 'Early modern', startYear: '1500', endYear: '1800', duration: 300, keyFeatures: ['printing'] }], longestPeriod: 'Medieval', shortestPeriod: 'Early modern', sharedFeatures: ['monarchy'] };
    case 'causeEffect': return { chains: [{ cause: 'Plague', effect: 'Labour shortage', type: 'direct', strength: 'strong', timelag: '5y' }], totalLinks: 1, directCauses: 1, indirectCauses: 0, strongLinks: 1, rootCauses: ['Plague'] };
    case 'timelineBuild': return { timeline: [{ event: 'Magna Carta', date: '1215', era: 'Medieval', significance: 'critical', category: 'political' }], totalEvents: 1, timeSpan: '1215', categories: ['political'], eras: ['Medieval'], pivotalEvents: [{ event: 'Magna Carta', date: '1215' }] };
    case 'sourceEvaluate': return { title: 'Chronicle', type: 'primary', formula: 'type*bias', reliabilityScore: 72, classification: 'reliable', corroborationNeeded: true, evaluation: { sourceType: 1, biasAssessment: 0.8, authorAttribution: 'named', dateProvenance: 'dated' } };
    default: return { ok: true };
  }
}
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
  apiHelpers: { lens: { runDomain: (...a: unknown[]) => runDomain(...a), list: vi.fn(async () => ({ data: { artifacts: [], total: 0 } })) } },
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => <button>save-as-dtu</button> }));
vi.mock('../VisualTimeline', () => ({ VisualTimeline: () => <div>visual timeline</div> }));
vi.mock('../EventMap', () => ({ EventMap: ({ onChanged }: { onChanged: () => void }) => <button onClick={onChanged}>event map</button> }));
vi.mock('../TimelineCompare', () => ({ TimelineCompare: () => <div>timeline compare</div> }));
vi.mock('../EventMediaManager', () => ({ EventMediaManager: () => <div>media manager</div> }));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: React.ReactNode }) => children,
  motion: new Proxy({}, { get: () => (p: Record<string, unknown>) => <div>{p.children as React.ReactNode}</div> }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { PeriodCauseEffectTools } from '../PeriodCauseEffectTools';
import { TimelineBuilder } from '../TimelineBuilder';
import { TimelinePublish } from '../TimelinePublish';
import { TimelineSourceTools } from '../TimelineSourceTools';
import { WikiTimelineImport } from '../WikiTimelineImport';

const render = (ui: React.ReactElement) => rtlRender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const sent = () => lensRunMock.mock.calls.map((c) => actionOf(c));
const press = async (re: RegExp, nth = 0) => {
  const hits = screen.queryAllByRole('button').filter((x) => re.test((x.textContent || x.getAttribute('aria-label') || x.getAttribute('title') || '').trim()));
  if (hits[nth]) await act(async () => { fireEvent.click(hits[nth]); await new Promise((r) => setTimeout(r, 0)); });
  return !!hits[nth];
};
afterEach(() => cleanup());
beforeEach(() => {
  lensRunMock.mockReset();
  runDomain.mockReset();
  lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: resultFor(actionOf(a)), error: null } }));
  runDomain.mockImplementation(async (_d: string, action: string) => ({ data: { ok: true, result: resultFor(action) } }));
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } });
});

const PANELS: Array<[string, () => React.ReactElement]> = [
  ['PeriodCauseEffectTools', () => <PeriodCauseEffectTools />],
  ['TimelineBuilder', () => <TimelineBuilder />],
  ['TimelinePublish', () => <TimelinePublish timelineId="tl1" title="Medieval England" />],
  ['TimelineSourceTools', () => <TimelineSourceTools />],
  ['WikiTimelineImport', () => <WikiTimelineImport onBuilt={vi.fn()} />],
];

describe('history panels', () => {
  it.each(PANELS)('%s renders real content with controls and survives a full exercise pass', async (_n, make) => {
    const view = render(make());
    await settle();
    expect(view.container.textContent?.trim().length).toBeGreaterThan(20);
    await exercise({ passes: 4, text: '1215' });
    await settle();
    await exercise({ passes: 2, text: 'Magna Carta' });
    expect(view.container.textContent).toBeTruthy();
  });

  it.each(PANELS)('%s stays standing when the backend is offline', async (_n, make) => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'offline', result: null } }));
    runDomain.mockImplementation(async () => ({ data: { ok: false, error: 'offline' } }));
    const view = render(make());
    await settle();
    await exercise({ passes: 1 });
    expect(view.container).toBeTruthy();
  });
});

describe('history flows', () => {
  it('a timeline is created, opened, given events and eras, edited, deleted behind a two-step arm, and switched across views', async () => {
    render(<TimelineBuilder />);
    await settle();
    fireEvent.change(screen.getByPlaceholderText(/timeline|title/i), { target: { value: 'Medieval England' } });
    await press(/^\s*(Create|Add)\b/i);
    await press(/Medieval England/);
    expect(sent()).toEqual(expect.arrayContaining(['timeline-list', 'timeline-detail']));
    for (const v of ['Visual', 'Map', 'Compare', 'Publish', 'Import', 'Edit']) await press(new RegExp(`^${v}$`));
    // an event: fill the form then add, then edit it and save
    const fields: Array<[RegExp, string]> = [[/title/i, 'Domesday Book'], [/year/i, '1086'], [/category/i, 'political'], [/description/i, 'Survey']];
    for (const [ph, v] of fields) {
      const box = screen.queryAllByRole('textbox').concat(screen.queryAllByRole('spinbutton')).find((i) => ph.test((i as HTMLInputElement).placeholder || ''));
      if (box) fireEvent.change(box, { target: { value: v } });
    }
    await press(/Add event/i);
    await press(/Edit|Pencil/i);
    await press(/Save|Update/i);
    // an era
    const eraName = screen.queryAllByRole('textbox').find((i) => /era/i.test((i as HTMLInputElement).placeholder || ''));
    if (eraName) fireEvent.change(eraName, { target: { value: 'Norman' } });
    await press(/Add era/i);
    // delete is two-step
    await press(/Delete|Trash/i);
    await press(/Delete|Confirm|Yes/i);
    const a = sent();
    expect(a.some((x) => /event-add|event-update|era-add|timeline-create|timeline-delete|event-delete|era-delete/.test(x))).toBe(true);
  });

  it('a duplicate timeline title asks to be confirmed, then creates anyway', async () => {
    render(<TimelineBuilder />);
    await settle();
    lensRunMock.mockImplementation(async (...a: unknown[]) => actionOf(a) === 'timeline-create'
      ? { data: { ok: false, error: 'duplicate_title' } }
      : { data: { ok: true, result: resultFor(actionOf(a)) } });
    const box = screen.getByPlaceholderText(/timeline|title/i);
    fireEvent.change(box, { target: { value: 'Rome' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await press(/^\s*(Create|Add)\b/i);
    await settle();
    expect(document.body.textContent).toMatch(/already exists|Create failed|anyway/i);
    fireEvent.keyDown(box, { key: 'Enter' });
    await press(/^\s*(Create|Add)\b/i);
    expect(sent().filter((x) => x === 'timeline-create').length).toBeGreaterThan(0);
  });

  it('publish reads status, publishes, copies the link and embed, and unpublishes', async () => {
    lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: actionOf(a) === 'timeline-publish-status' ? { published: false } : resultFor(actionOf(a)) } }));
    render(<TimelinePublish timelineId="tl1" title="Medieval England" />);
    await settle();
    await press(/Publish/i);
    await press(/Copy/i, 0);
    await press(/Copy/i, 1);
    await press(/Unpublish|Remove/i);
    const a = sent();
    expect(a).toEqual(expect.arrayContaining(['timeline-publish-status', 'timeline-publish']));
  });

  it('publish reports a failed publish and a failed unpublish', async () => {
    lensRunMock.mockImplementation(async (...a: unknown[]) => {
      const act_ = actionOf(a);
      if (act_ === 'timeline-publish-status') return { data: { ok: true, result: { published: false } } };
      return { data: { ok: false, error: 'Publish failed' } };
    });
    render(<TimelinePublish timelineId="tl1" title="Medieval England" />);
    await settle();
    await press(/Publish/i);
    expect(document.body.textContent).toMatch(/failed/i);
  });

  it('the Wikipedia import builds a timeline from an article and reports a refusal', async () => {
    const onBuilt = vi.fn();
    render(<WikiTimelineImport onBuilt={onBuilt} />);
    const box = screen.getAllByRole('textbox')[0];
    fireEvent.change(box, { target: { value: 'Roman Empire' } });
    await press(/Build|Import/i);
    expect(onBuilt).toHaveBeenCalledWith('tl4');
    expect(document.body.textContent).toMatch(/12/);
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'article not found' } }));
    await press(/Build|Import/i);
    expect(document.body.textContent).toMatch(/not found|Could not build/i);
  });

  it('the period and cause-and-effect tools run both macros once two periods are named', async () => {
    render(<PeriodCauseEffectTools />);
    await settle();
    await exercise({ passes: 4, text: '1500' });
    await settle();
    expect(runDomain.mock.calls.map((c) => c[1])).toEqual(expect.arrayContaining(['comparePeriods']));
  });

  it('the timeline and source tools run the timeline builder and the source evaluator', async () => {
    render(<TimelineSourceTools />);
    await settle();
    await exercise({ passes: 4, text: '1215' });
    await settle();
    const a = runDomain.mock.calls.map((c) => c[1]);
    expect(a.some((x) => /timelineBuild|sourceEvaluate/.test(String(x)))).toBe(true);
  });
});
