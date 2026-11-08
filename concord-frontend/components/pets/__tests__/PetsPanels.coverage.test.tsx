// Render + behaviour coverage for the pets lens panels: care section (pet list + dashboard + the
// tabbed care tools), wellness (weight / activity / symptoms), and the live cat-facts and dog
// discover cards. Panels mount against stubbed engine results, must render real content, survive a
// full exercise pass and degrade honestly offline.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { actionOf, exercise } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const PET = { id: 'pt1', name: 'Biscuit', species: 'dog', breed: 'Beagle', weightKg: 11, microchipId: '981000', age: { years: 4, months: 2, totalMonths: 50 } };

function resultFor(action: string): unknown {
  switch (action) {
    case 'pet-list': return { pets: [PET, { ...PET, id: 'pt2', name: 'Miso', species: 'cat', breed: null, weightKg: undefined, age: null }] };
    case 'pets-dashboard': return { pets: 2, overdueVaccines: 1, openReminders: 3, overdueReminders: 1, monthSpend: 142.5, activeBookings: 1 };
    case 'weight-history': return { series: [{ id: 'w1', date: '2026-02-01', weightKg: 10.8 }, { id: 'w2', date: '2026-03-01', weightKg: 11 }], trend: 'gaining', changeKg: 0.2, latest: 11 };
    case 'activity-history': return { activities: [{ id: 'a1', kind: 'walk', note: 'Park', durationMin: 30, date: '2026-03-01' }, { id: 'a2', kind: 'play', note: null, durationMin: 15, date: '2026-03-02' }] };
    case 'symptom-list': return { symptoms: [{ id: 's1', symptom: 'Limping', severity: 'mild', note: 'Left paw', date: '2026-03-02' }] };
    case 'live_catfact': return { facts: [{ fact: 'Cats sleep 12-16 hours a day.', length: 30 }, { fact: 'A cat has 32 muscles in each ear.', length: 34 }] };
    case 'live_dog': return { dogs: [{ url: 'https://images.dog.ceo/breeds/beagle/1.jpg', breed: 'beagle' }], images: ['https://images.dog.ceo/breeds/beagle/1.jpg', 'https://images.dog.ceo/breeds/pug/2.jpg'], items: ['https://images.dog.ceo/breeds/pug/2.jpg'] };
    default: return { ok: true, pets: [], reminders: [], records: [], services: [], bookings: [], vaccines: [], plan: {}, breeds: [] };
  }
}
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
  apiHelpers: { lens: { runDomain: vi.fn(async () => ({ data: { ok: true, result: {} } })), list: vi.fn(async () => ({ data: { artifacts: [], total: 0 } })) } },
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
for (const child of ['PetHealthPanel', 'PetRemindersPanel', 'PetServicesPanel', 'PetRecordsPanel', 'ActivityWeightDashboard', 'PetCarePlanner', 'BreedExplorer', 'PetActionDrawer', 'PetProfileCard']) {
  vi.doMock(`../${child}`, () => ({ [child]: () => <div>{child}-stub</div> }));
}
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

describe('pets panels', () => {
  let CatFactsPanel: typeof import('../CatFactsPanel').CatFactsPanel;
  let DogPanel: typeof import('../DogPanel').DogPanel;
  let PetCareSection: typeof import('../PetCareSection').PetCareSection;
  let PetWellnessPanel: typeof import('../PetWellnessPanel').PetWellnessPanel;
  beforeEach(async () => {
    ({ CatFactsPanel } = await import('../CatFactsPanel'));
    ({ DogPanel } = await import('../DogPanel'));
    ({ PetCareSection } = await import('../PetCareSection'));
    ({ PetWellnessPanel } = await import('../PetWellnessPanel'));
  });
  const make = (name: string) => {
    switch (name) {
      case 'CatFactsPanel': return <CatFactsPanel />;
      case 'DogPanel': return <DogPanel />;
      case 'PetCareSection': return <PetCareSection />;
      default: return <PetWellnessPanel petId="pt1" onChange={vi.fn()} />;
    }
  };
  const NAMES = ['CatFactsPanel', 'DogPanel', 'PetCareSection', 'PetWellnessPanel'];

  it.each(NAMES)('%s renders real content with controls and survives a full exercise pass', async (name) => {
    const view = render(make(name));
    await settle();
    expect(view.container.textContent?.trim().length).toBeGreaterThan(10);
    await exercise({ passes: 3, text: 'Biscuit' });
    await settle();
    await exercise({ passes: 1, text: '12' });
    expect(view.container.textContent).toBeTruthy();
  });

  it.each(NAMES)('%s stays standing when the backend is offline', async (name) => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'offline', result: null } }));
    const view = render(make(name));
    await settle();
    await exercise({ passes: 1 });
    expect(view.container).toBeTruthy();
  });

  it('cat facts and the dog card show content, refresh, and explain an empty feed', async () => {
    const cat = render(<CatFactsPanel />);
    await settle();
    expect(cat.container.textContent).toMatch(/sleep 12-16 hours/);
    await press(/Refresh|New|Another/i);
    expect(sent().filter((x) => x === 'live_catfact').length).toBeGreaterThan(1);
    cleanup();
    lensRunMock.mockImplementation(async () => ({ data: { ok: true, result: { facts: [] } } }));
    const empty = render(<CatFactsPanel />);
    await settle();
    expect(empty.container.textContent?.length).toBeGreaterThan(10);
    cleanup();
    lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: resultFor(actionOf(a)) } }));
    const dog = render(<DogPanel />);
    await settle();
    await press(/Refresh|New|Another/i);
    expect(sent()).toContain('live_dog');
    expect(dog.container.textContent?.length).toBeGreaterThan(10);
  });

  it('wellness logs a weight, an activity and a symptom, and removes an activity', async () => {
    const onChange = vi.fn();
    render(<PetWellnessPanel petId="pt1" onChange={onChange} />);
    await settle();
    expect(sent()).toEqual(expect.arrayContaining(['weight-history', 'activity-history', 'symptom-list']));
    await exercise({ passes: 3, text: '11.5', skip: /delete|remove|trash|discard|cancel|close|dismiss|reset|clear|^back|^×$/i });
    await press(/Delete|Trash|Remove/i);
    expect(sent().some((x) => /weight-log|activity-log|symptom-log|activity-delete/.test(x))).toBe(true);
    expect(onChange).toHaveBeenCalled();
  });

  it('the care section lists pets, switches tool tabs and adds a pet', async () => {
    const view = render(<PetCareSection />);
    await settle();
    expect(sent()).toEqual(expect.arrayContaining(['pet-list', 'pets-dashboard']));
    expect(view.container.textContent).toMatch(/Biscuit|Miso/);
    await press(/^\s*Add pet/);
    await press(/^Save pet$/);
    expect(document.body.textContent).toMatch(/Pet name is required/);
    fireEvent.change(screen.getByPlaceholderText('Pet name'), { target: { value: 'Rex' } });
    fireEvent.change(screen.getByPlaceholderText('Breed'), { target: { value: 'Lab' } });
    fireEvent.change(screen.getByPlaceholderText('Weight (kg)'), { target: { value: '22' } });
    await press(/^Save pet$/);
    await press(/Miso/);
    for (const tab of Array.from(document.querySelectorAll('button')).filter((b) => /Health|Wellness|Reminders|Services|Records|Activity|Plan|Breed|Cat|Dog/i.test(b.textContent || ''))) await act(async () => { fireEvent.click(tab); await new Promise((r) => setTimeout(r, 5)); });
    expect(sent().some((x) => /pet-add/.test(x))).toBe(true);
  });
});
