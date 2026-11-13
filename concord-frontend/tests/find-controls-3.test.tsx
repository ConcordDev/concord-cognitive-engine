/**
 * Audit sweep CB-0481 (missing find controls, second leg), FE pins 1:
 *   calendar-009   CalendarView event search (props-driven)
 *   forestry-008   StandManager stand search
 *   hr-008         HrPeoplePanel directory search
 *   cooking-002    RecipeBoxSection recipe search + sort
 *   game-design-005 GameDesignSection project search + sort
 *   energy-007     EnergyDevicesPanel device search (meter picker pinned in file 2)
 *   poetry-001     VERIFY-ONLY pin: CollectionPanel search already rides poem-list
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
  api: { get: vi.fn(() => Promise.resolve({ data: {} })), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));

import { CalendarView } from '@/components/calendar/CalendarView';
import { StandManager } from '@/components/forestry/StandManager';
import { HrPeoplePanel } from '@/components/hr/HrPeoplePanel';
import { RecipeBoxSection } from '@/components/cooking/RecipeBoxSection';
import { GameDesignSection } from '@/components/game-design/GameDesignSection';
import { EnergyDevicesPanel } from '@/components/energy/EnergyDevicesPanel';
import { CollectionPanel } from '@/components/poetry/CollectionPanel';

function reply(result: unknown) {
  return Promise.resolve({ data: { ok: true, result, error: null } });
}
function norm(args: unknown[]) {
  const first = args[0] as Record<string, unknown> | string;
  if (typeof first === 'object' && first !== null && 'domain' in first) {
    return { domain: first.domain as string, action: first.action as string, input: (first.input || {}) as Record<string, unknown> };
  }
  return { domain: args[0] as string, action: args[1] as string, input: (args[2] || {}) as Record<string, unknown> };
}

beforeEach(() => { lensRun.mockReset(); });

describe('calendar-009 — event search', () => {
  const events = [
    { id: 'e1', title: 'Dentist appointment', date: '2026-11-20', time: '09:00', type: 'event' as const },
    { id: 'e2', title: 'Team standup', date: '2026-11-21', type: 'task' as const },
  ];
  it('search finds an event by title and selecting it fires onSelectEvent', async () => {
    const onSelectEvent = vi.fn();
    render(<CalendarView events={events} onSelectEvent={onSelectEvent} onSelectDate={() => {}} />);
    fireEvent.change(screen.getByLabelText('Search events'), { target: { value: 'dentist' } });
    const hit = await screen.findByRole('button', { name: 'Open Dentist appointment on 2026-11-20' });
    expect(screen.queryByRole('button', { name: 'Open Team standup on 2026-11-21' })).toBeNull();
    fireEvent.click(hit);
    expect(onSelectEvent).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1' }));
    fireEvent.change(screen.getByLabelText('Search events'), { target: { value: 'zzz' } });
    expect(await screen.findByText(/No events match/)).toBeTruthy();
  });
});

describe('forestry-008 — stand search', () => {
  it('filters stands by name/species with an honest no-match state', async () => {
    const stands = [
      { id: 's1', name: 'North Ridge', species: 'oak', acres: 12, ageYears: 30, treesPerAcre: 90, estimatedTrees: 1080, activities: [], activityCount: 0 },
      { id: 's2', name: 'Cedar Hollow', species: 'spruce', acres: 8, ageYears: 12, treesPerAcre: 120, estimatedTrees: 960, activities: [], activityCount: 0 },
    ];
    lensRun.mockImplementation((...args: unknown[]) => {
      const { action } = norm(args);
      if (action === 'stand-list') return reply({ stands });
      if (action === 'forestry-dashboard') return reply({ stands: 2, totalAcres: 20, activities: 0, bySpecies: { oak: 1, spruce: 1 } });
      return reply({});
    });
    render(<StandManager />);
    await screen.findByText('North Ridge');
    fireEvent.change(screen.getByLabelText('Search stands'), { target: { value: 'spruce' } });
    expect(screen.queryByText('North Ridge')).toBeNull();
    expect(screen.getByText('Cedar Hollow')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search stands'), { target: { value: 'zzz' } });
    expect(await screen.findByText(/No stands match/)).toBeTruthy();
  });
});

describe('hr-008 — directory search', () => {
  it('filters the directory by name and department', async () => {
    const employees = [
      { id: 'e1', name: 'Ada Lovelace', title: 'Engineer', department: 'Engineering', managerId: null, email: null, salary: 100, employmentType: 'full_time', status: 'active' },
      { id: 'e2', name: 'Grace Hopper', title: 'Designer', department: 'Design', managerId: null, email: null, salary: 100, employmentType: 'full_time', status: 'active' },
    ];
    lensRun.mockImplementation((...args: unknown[]) => {
      const { action, input } = norm(args);
      if (action === 'employee-list') return reply({ employees: input.includeInactive ? employees : employees });
      if (action === 'org-chart') return reply({ chart: [] });
      return reply({});
    });
    render(<HrPeoplePanel onChange={() => {}} />);
    await screen.findByText('Ada Lovelace');
    fireEvent.change(screen.getByLabelText('Search directory'), { target: { value: 'design' } });
    expect(screen.queryByText('Ada Lovelace')).toBeNull();
    expect(screen.getByText('Grace Hopper')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search directory'), { target: { value: 'zzz' } });
    expect(await screen.findByText(/No employees match/)).toBeTruthy();
  });
});

describe('cooking-002 — recipe search + sort', () => {
  it('search narrows the grid; sort orders a copy by title', async () => {
    const recipes = [
      { id: 'r1', number: '1', title: 'Zucchini Soup', servings: 2, prepMin: 5, cookMin: 10, ingredients: [], steps: [], tags: ['soup'], cuisine: 'Italian', photoUrl: '', notes: '' },
      { id: 'r2', number: '2', title: 'Apple Pie', servings: 4, prepMin: 15, cookMin: 30, ingredients: [], steps: [], tags: ['dessert'], cuisine: 'American', photoUrl: '', notes: '' },
    ];
    lensRun.mockImplementation((...args: unknown[]) => {
      const { action } = norm(args);
      if (action === 'recipes-list') return reply({ recipes });
      if (action === 'meal-plan-get') return reply({ entries: [] });
      if (action === 'shopping-list-get') return reply({ items: [] });
      if (action === 'pantry-list') return reply({ items: [] });
      if (action === 'pantry-cook-suggestions') return reply({ suggestions: [] });
      if (action === 'collections-list') return reply({ collections: [] });
      return reply({});
    });
    render(<RecipeBoxSection />);
    await screen.findByText('Zucchini Soup');
    fireEvent.change(screen.getByLabelText('Search recipes'), { target: { value: 'apple' } });
    expect(screen.queryByText('Zucchini Soup')).toBeNull();
    expect(screen.getByText('Apple Pie')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search recipes'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Sort recipes'), { target: { value: 'title-az' } });
    await waitFor(() => {
      const titles = screen.getAllByText(/Soup|Pie/).map((n) => n.textContent);
      expect(titles.indexOf('Apple Pie')).toBeLessThan(titles.indexOf('Zucchini Soup'));
    });
  });
});

describe('game-design-005 — project search + sort', () => {
  it('search filters the project chips; sort reorders them', async () => {
    const games = [
      { id: 'g1', title: 'Zephyr Quest', genre: 'RPG', platform: 'PC' },
      { id: 'g2', title: 'Alpha Arena', genre: 'FPS', platform: 'PC' },
    ];
    lensRun.mockImplementation((...args: unknown[]) => {
      const { action } = norm(args);
      if (action === 'game-list') return reply({ games });
      return reply({});
    });
    render(<GameDesignSection />);
    await screen.findByRole('button', { name: 'Zephyr Quest' });
    fireEvent.change(screen.getByLabelText('Search game projects'), { target: { value: 'alpha' } });
    expect(screen.queryByRole('button', { name: 'Zephyr Quest' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Alpha Arena' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search game projects'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Sort game projects'), { target: { value: 'title-az' } });
    await waitFor(() => {
      const chips = screen.getAllByRole('button')
        .map((b) => b.textContent)
        .filter((t) => t === 'Zephyr Quest' || t === 'Alpha Arena');
      expect(chips).toEqual(['Alpha Arena', 'Zephyr Quest']);
    });
  });
});

describe('energy-007 — device search', () => {
  it('filters devices by name/category', async () => {
    lensRun.mockImplementation((...args: unknown[]) => {
      const { action } = norm(args);
      if (action === 'top-consumers') return reply({ devices: [] });
      return reply({});
    });
    const devices = [
      { id: 'd1', name: 'Fridge', category: 'appliance', wattage: 150, alwaysOn: true, totalKwh: 42 },
      { id: 'd2', name: 'Desk Lamp', category: 'lighting', wattage: 12, alwaysOn: false, totalKwh: 3 },
    ];
    render(<EnergyDevicesPanel devices={devices} loading={false} loadError={null} refresh={() => Promise.resolve()} />);
    await screen.findByText('Fridge');
    fireEvent.change(screen.getByLabelText('Search devices'), { target: { value: 'lighting' } });
    expect(screen.queryByText('Fridge')).toBeNull();
    expect(screen.getByText('Desk Lamp')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search devices'), { target: { value: 'zzz' } });
    expect(await screen.findByText(/No devices match/)).toBeTruthy();
  });
});

describe('poetry-001 — VERIFY-ONLY pin (search already shipped)', () => {
  it('typing in the shipped search re-queries poem-list with the query', async () => {
    const poems = [
      { id: 'p1', title: 'Ode to Code', form: 'ode', status: 'draft', lineCount: 12, body: 'x' },
      { id: 'p2', title: 'Silent Fields', form: 'haiku', status: 'draft', lineCount: 3, body: 'y' },
    ];
    lensRun.mockImplementation((...args: unknown[]) => {
      const { action, input } = norm(args);
      if (action === 'poem-list') {
        const q = String(input.query || '').toLowerCase();
        return reply({ poems: q ? poems.filter((p) => p.title.toLowerCase().includes(q)) : poems });
      }
      return reply({});
    });
    render(<CollectionPanel onOpenPoem={() => {}} onNewPoem={() => {}} />);
    await screen.findByText('Ode to Code');
    fireEvent.change(screen.getByPlaceholderText('Search poems...'), { target: { value: 'silent' } });
    await waitFor(() => {
      const withQuery = lensRun.mock.calls.filter((c) => {
        const { action, input } = norm(c);
        return action === 'poem-list' && input.query === 'silent';
      });
      expect(withQuery.length).toBeGreaterThan(0);
    });
    await screen.findByText('Silent Fields');
    expect(screen.queryByText('Ode to Code')).toBeNull();
  });
});
