// useDiegetic — the ?diegetic=1 decision that trims app + lens chrome when a lens
// is opened inside the in-world station frame. Real URL parsing, no mocks.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { readDiegetic, useDiegetic } from '@/hooks/useDiegetic';

function Probe() {
  return <div>{useDiegetic() ? 'diegetic' : 'normal'}</div>;
}

describe('useDiegetic / readDiegetic', () => {
  afterEach(() => { window.history.pushState({}, '', '/'); });

  it('parses the ?diegetic=1 flag (and only that)', () => {
    window.history.pushState({}, '', '/lenses/code?diegetic=1&world=w1&station=b1');
    expect(readDiegetic()).toBe(true);
    window.history.pushState({}, '', '/lenses/code');
    expect(readDiegetic()).toBe(false);
    window.history.pushState({}, '', '/lenses/code?diegetic=0');
    expect(readDiegetic()).toBe(false);
    window.history.pushState({}, '', '/lenses/code?diegetic=true');
    expect(readDiegetic()).toBe(false); // strictly "1"
  });

  it('the hook resolves true under the station frame', async () => {
    window.history.pushState({}, '', '/lenses/code?diegetic=1');
    render(<Probe />);
    await waitFor(() => expect(screen.getByText('diegetic')).toBeTruthy());
  });

  it('the hook is false on a normal lens route', async () => {
    window.history.pushState({}, '', '/lenses/code');
    render(<Probe />);
    await waitFor(() => expect(screen.getByText('normal')).toBeTruthy());
  });
});
