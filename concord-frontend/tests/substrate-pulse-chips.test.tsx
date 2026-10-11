/**
 * INC-42 — Substrate Pulse domain chips must not link to /lenses/<class>
 * when that class is a DTU classification rather than a lens id.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { getLensById } from '@/lib/lens-registry';
import { domainChipHref, domainChipLabel, UNCLASSIFIED_CHIP_LABEL } from '@/lib/substrate-pulse-chips';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

import { SubstratePulsePanel } from '@/components/all/SubstratePulsePanel';

describe('substrate pulse chip link mapping', () => {
  it('links a classification only when it is a registered lens id', () => {
    const code = getLensById('code');
    const music = getLensById('music');
    expect(code?.path).toBe('/lenses/code');
    expect(music?.path).toBe('/lenses/music');
    expect(domainChipHref('code')).toBe(code!.path);
    expect(domainChipHref('music')).toBe(music!.path);
    expect(domainChipLabel('code')).toBe(code!.name);
    expect(domainChipLabel('music')).toBe(music!.name);
  });

  it('does not link unknown, unclassified, or an unmapped domain', () => {
    for (const domain of ['unknown', 'unclassified', 'general.note', 'combat', 'document', 'historical.world', '']) {
      expect({ domain, href: domainChipHref(domain) }).toEqual({ domain, href: null });
    }
    expect(getLensById('combat')).toBeUndefined();
    expect(getLensById('document')).toBeUndefined();
    expect(getLensById('unknown')).toBeUndefined();
    expect(domainChipLabel('unknown')).toBe(UNCLASSIFIED_CHIP_LABEL);
    expect(domainChipLabel('unclassified')).toBe(UNCLASSIFIED_CHIP_LABEL);
    expect(domainChipLabel('general.note')).toBe(UNCLASSIFIED_CHIP_LABEL);
    expect(domainChipLabel('combat')).toBe('combat');
    expect(domainChipLabel('document')).toBe('document');
    expect(domainChipLabel('historical.world')).toBe('historical.world');
  });

  it('never synthesizes a /lenses/<domain> path for a non-lens class', () => {
    const hrefs = ['unknown', 'combat', 'document', 'historical.world', 'formal.math'].map(domainChipHref);
    expect(hrefs.every((href) => href == null)).toBe(true);
  });
});

describe('SubstratePulsePanel domain chips', () => {
  beforeEach(() => {
    lensRun.mockReset();
  });

  it('renders mapped chips as lens links and unmapped chips as text', async () => {
    lensRun.mockImplementation(async (_domain: string, name: string) => {
      if (name === 'domainStats') {
        return {
          data: {
            ok: true,
            result: {
              totalDtus: 5055,
              domains: 4,
              topDomains: [
                { domain: 'unknown', count: 5051 },
                { domain: 'historical.world', count: 844 },
                { domain: 'combat', count: 3 },
                { domain: 'code', count: 2 },
                { domain: 'document', count: 1 },
              ],
            },
          },
        };
      }
      return {
        data: {
          ok: true,
          result: {
            feed: [{ dtuId: 'dtu_1', title: 'A thought', domain: 'formal.math', createdAt: new Date().toISOString() }],
          },
        },
      };
    });

    render(<SubstratePulsePanel />);

    const codeLink = await waitFor(() => screen.getByRole('link', { name: /Code/ }));
    expect(codeLink).toHaveAttribute('href', '/lenses/code');

    for (const label of [UNCLASSIFIED_CHIP_LABEL, 'combat', 'document', 'historical.world']) {
      expect({ label, link: screen.getByText(label).closest('a') }).toEqual({ label, link: null });
    }

    const links = screen.getAllByRole('link').map((el) => el.getAttribute('href') || '');
    expect(links.some((href) => href.startsWith('/lenses/unknown'))).toBe(false);
    expect(links.some((href) => href.startsWith('/lenses/combat'))).toBe(false);
    expect(links.some((href) => href.startsWith('/lenses/document'))).toBe(false);
    expect(links.some((href) => href.startsWith('/lenses/historical.world'))).toBe(false);
    expect(links.some((href) => href.startsWith('/lenses/formal.math'))).toBe(false);
    // Activity row for an unmapped class still opens the DTU browser, a real route.
    expect(links).toContain('/lenses/dtus?id=dtu_1');
  });
});
