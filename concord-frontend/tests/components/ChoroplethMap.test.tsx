/**
 * ChoroplethMap — feature-build follow-up pass, `global` lens item.
 * Pins that real World Bank per-country data (from the already-existing
 * `global.choropleth` macro) correctly joins onto real country-boundary
 * polygons (world-atlas, converted via topojson-client) via the real
 * numeric-ISO -> alpha-3 mapping (iso-3166-1) — a wrong join here would
 * silently color the wrong country, which is worse than no map at all.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChoroplethMap, type ChoroplethCountryDatum } from '@/components/global/ChoroplethMap';

const fmt = (v: number) => `${v.toFixed(1)}%`;

describe('ChoroplethMap', () => {
  it('renders an accessible svg labeled with the indicator name', () => {
    render(<ChoroplethMap countries={[]} min={0} max={100} indicatorLabel="GDP growth" fmt={fmt} />);
    expect(screen.getByRole('img', { name: /Choropleth map: GDP growth/i })).toBeInTheDocument();
  });

  it('renders real country boundary paths (world-atlas has 177 countries at 110m resolution)', () => {
    const { container } = render(
      <ChoroplethMap countries={[]} min={0} max={100} indicatorLabel="x" fmt={fmt} />,
    );
    // Every country renders at least one <path> (a ring); 177 countries
    // guarantees at least 177 paths even before counting multi-ring
    // countries (archipelagos etc.).
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBeGreaterThanOrEqual(177);
  });

  it('fills a country with real data differently from a country with no data (never silently blank)', () => {
    const countries: ChoroplethCountryDatum[] = [
      { code: 'USA', name: 'United States', value: 90, intensity: 1 },
    ];
    const { container } = render(
      <ChoroplethMap countries={countries} min={0} max={100} indicatorLabel="x" fmt={fmt} />,
    );
    // Find the USA path via its <title> tooltip content. The title uses
    // the REAL passed-in World Bank country name ("United States") when
    // data exists — not world-atlas's own feature name ("United States of
    // America"), which is reserved for the no-data fallback case.
    const titles = Array.from(container.querySelectorAll('title'));
    const usaTitle = titles.find((t) => t.textContent?.includes('United States') && t.textContent?.includes('90.0%'));
    expect(usaTitle).toBeTruthy();
    const noDataTitle = titles.find((t) => t.textContent?.includes('no data'));
    expect(noDataTitle).toBeTruthy();
  });

  it('joins the real World Bank alpha-3 code onto the real country polygon via ISO-3166 numeric->alpha3 mapping (Canada = 124 = CAN)', () => {
    const countries: ChoroplethCountryDatum[] = [
      { code: 'CAN', name: 'Canada', value: 42, intensity: 0.5 },
    ];
    const { container } = render(
      <ChoroplethMap countries={countries} min={0} max={100} indicatorLabel="x" fmt={fmt} />,
    );
    const titles = Array.from(container.querySelectorAll('title'));
    const canadaTitle = titles.find((t) => t.textContent?.includes('Canada'));
    expect(canadaTitle?.textContent).toContain('42.0%');
    expect(canadaTitle?.textContent).not.toContain('no data');
  });
});
