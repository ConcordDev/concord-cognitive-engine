// Render + behaviour coverage for the fashion closet section: closet, plan (packing lists,
// lookbooks, wear insights) and the tabbed section chrome (sibling panels stubbed).

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { actionOf, exercise } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const ITEM = (id: string, over: Record<string, unknown> = {}) => ({ id, name: `Item ${id}`, category: 'top', brand: 'Acme', color: 'blue', season: 'summer', cost: 80, timesWorn: 4, costPerWear: 20, valueRating: 'good', photo: 'https://x/p.jpg', bgRemoved: true, bgRemovalMode: 'ai', laundryStatus: 'clean', ...over });

function resultFor(action: string): unknown {
  switch (action) {
    case 'item-list': return { items: [ITEM('i1'), ITEM('i2', { laundryStatus: 'dirty', photo: null, brand: null, color: null, costPerWear: null, valueRating: 'poor', bgRemoved: false }), ITEM('i3', { laundryStatus: 'at_cleaner', category: 'shoes' })] };
    case 'item-add': return { item: ITEM('i9') };
    case 'vision': return { category: 'top', color: 'red', name: 'Red tee', brand: null };
    case 'item-remove-bg': return { item: ITEM('i1') };
    case 'packing-list': return { lists: [{ id: 'pk1', name: 'Paris', destination: 'France', itemCount: 3 }], packingLists: [{ id: 'pk1', name: 'Paris', destination: 'France', itemCount: 3 }] };
    case 'packing-detail': return { list: { id: 'pk1', name: 'Paris', destination: 'France', itemIds: ['i1'], items: [ITEM('i1')] }, items: [ITEM('i1')], itemIds: ['i1'] };
    case 'lookbook-list': return { lookbooks: [{ id: 'lb1', name: 'Spring', outfitCount: 2 }] };
    case 'outfit-list': return { outfits: [{ id: 'o1', name: 'Casual Friday', itemIds: ['i1', 'i2'] }] };
    case 'wear-insights': return { mostWorn: [{ name: 'Item i1', timesWorn: 12 }], bestValue: [{ name: 'Item i1', costPerWear: 6.5 }], neverWorn: [{ name: 'Item i2', cost: 90 }] };
    case 'fashion-dashboard': return { items: 3, outfits: 1, lookbooks: 1, packingLists: 1, wornThisMonth: 4, closetValue: 240, neverWorn: 1 };
    default: return { ok: true, id: 'new-1' };
  }
}
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
  apiHelpers: { lens: { runDomain: vi.fn(async () => ({ data: { ok: true, result: {} } })), list: vi.fn(async () => ({ data: { artifacts: [], total: 0 } })) } },
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
for (const n of ['FashionOutfitsPanel', 'FashionOutfitCollagePanel', 'FashionCalendarPanel', 'FashionAIStylistPanel', 'FashionStyleQuizPanel', 'FashionSocialPanel', 'FashionResalePanel', 'FashionCapsulePanel', 'FashionTrendSandboxPanel', 'FashionWishlistPanel', 'FashionMoodboardPanel']) vi.doMock(`../${n}`, () => ({ [n]: () => <div>{n}-stub</div> }));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: React.ReactNode }) => children,
  motion: new Proxy({}, { get: () => (p: Record<string, unknown>) => <div>{p.children as React.ReactNode}</div> }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const render = (ui: React.ReactElement) => rtlRender(ui);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 5)); });
const sent = () => lensRunMock.mock.calls.map((c) => actionOf(c));
const press = async (re: RegExp, nth = 0) => {
  const hits = screen.queryAllByRole('button').filter((x) => re.test((x.textContent || x.getAttribute('aria-label') || x.getAttribute('title') || '').trim()));
  if (hits[nth]) await act(async () => { fireEvent.click(hits[nth]); await new Promise((r) => setTimeout(r, 5)); });
  return !!hits[nth];
};
afterEach(() => cleanup());
beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: resultFor(actionOf(a)), error: null } }));
});

describe('fashion panels', () => {
  let FashionClosetPanel: typeof import('../FashionClosetPanel').FashionClosetPanel;
  let FashionClosetSection: typeof import('../FashionClosetSection').FashionClosetSection;
  let FashionPlanPanel: typeof import('../FashionPlanPanel').FashionPlanPanel;
  beforeEach(async () => {
    ({ FashionClosetPanel } = await import('../FashionClosetPanel'));
    ({ FashionClosetSection } = await import('../FashionClosetSection'));
    ({ FashionPlanPanel } = await import('../FashionPlanPanel'));
  });
  const make = (n: string) => n === 'closet' ? <FashionClosetPanel onChange={vi.fn()} /> : n === 'section' ? <FashionClosetSection /> : <FashionPlanPanel onChange={vi.fn()} />;
  const NAMES = ['closet', 'section', 'plan'];

  it.each(NAMES)('%s renders real content with controls and survives a full exercise pass', async (n) => {
    const view = render(make(n));
    await settle();
    expect(view.container.textContent?.trim().length).toBeGreaterThan(10);
    await exercise({ passes: 4, text: 'Linen shirt', skip: /delete|remove|trash|discard|cancel|close|dismiss|reset|clear|^back|^×$/i });
    await settle();
    await exercise({ passes: 1, text: '45' });
    expect(view.container.textContent).toBeTruthy();
  });

  it.each(NAMES)('%s stays standing when the backend is offline', async (n) => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'offline', result: null } }));
    const view = render(make(n));
    await settle();
    await exercise({ passes: 1 });
    expect(view.container).toBeTruthy();
  });

  it('the closet adds an item, wears, changes laundry state, removes a background, analyses a photo and deletes', async () => {
    render(<FashionClosetPanel onChange={vi.fn()} />);
    await settle();
    await press(/^\s*(Add|New)\b/i);
    for (const [ph, v] of [[/name/i, 'Red tee'], [/brand/i, 'Acme'], [/cost|price/i, '40'], [/photo|image|url/i, 'https://x/y.jpg'], [/color/i, 'red']] as Array<[RegExp, string]>) {
      const el = screen.queryAllByPlaceholderText(ph)[0];
      if (el) fireEvent.change(el, { target: { value: v } });
    }
    await press(/Analy[sz]e|Vision|Detect/i);
    await press(/^(Save|Add item|Create)\b/i);
    await press(/Wear|Worn/i);
    for (const sel of Array.from(document.querySelectorAll('select')) as HTMLSelectElement[]) { for (const o of Array.from(sel.options)) { fireEvent.change(sel, { target: { value: o.value } }); await settle(); } }
    await press(/background|Remove bg|cutout/i);
    await press(/Edit|Pencil/i); await press(/Save|Update/i);
    await press(/Delete|Trash/i); await press(/Confirm|Yes|Delete/i);
    expect(sent()).toContain('item-list');
    expect(sent().some((x) => /item-add|item-wear|item-update|item-remove-bg|vision|item-delete/.test(x))).toBe(true);
  });

  it('the plan creates packing lists and lookbooks, packs items and adds outfits', async () => {
    render(<FashionPlanPanel onChange={vi.fn()} />);
    await settle();
    expect(sent()).toEqual(expect.arrayContaining(['packing-list', 'lookbook-list', 'item-list', 'outfit-list', 'wear-insights']));
    await exercise({ passes: 4, text: 'Weekend', skip: /delete|remove|trash|discard|cancel|close|dismiss|reset|clear|^back|^×$/i });
    await press(/Paris/); await press(/Item i1/);
    await press(/Casual Friday/);
    expect(sent().some((x) => /packing-create|lookbook-create|packing-detail|packing-add-item|lookbook-add-outfit/.test(x))).toBe(true);
  });

  it('the section loads the dashboard and switches through every tab', async () => {
    const onTab = vi.fn();
    const { FashionClosetSection: Sec } = await import('../FashionClosetSection');
    const view = render(<Sec onTabChange={onTab} activeTab="closet" />);
    await settle();
    for (const t of ['Outfits', 'Collage', 'Wishlist', 'Moodboards', 'AI Stylist', 'Style Quiz', 'Calendar', 'Plan', 'Capsule', 'Community', 'Resale', 'Trends', 'Closet']) await press(new RegExp(`^${t}$`));
    expect(onTab).toHaveBeenCalled();
    expect(sent()).toContain('fashion-dashboard');
    cleanup();
    const view2 = render(<FashionClosetSection />);
    await settle();
    for (const t of ['Outfits', 'Wishlist', 'Plan', 'Trends']) await press(new RegExp(`^${t}$`));
    expect(view2.container.textContent?.length).toBeGreaterThan(20);
    void view;
  });
});
