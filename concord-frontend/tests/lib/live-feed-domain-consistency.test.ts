import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

// Pins the bug class this fixed: healthcare/page.tsx and food/page.tsx both
// passed <LiveFeed domain="legal" .../> — a copy-paste leftover from a
// legal-lens-based template. The article DATA was correct (each page's own
// useRealtimeLens(<its own domain>)), but LiveFeed's `domain` prop drives its
// label/accent/empty-state copy via DOMAIN_META (components/lens/LiveFeed.tsx),
// so the mistake rendered "Court Wire" in amber with a CourtListener/Federal
// Register empty-state message on pages that are actually WHO health alerts /
// food safety alerts. Static, not a render test — cheap and catches every
// lens, not just the two found by hand.

const LENSES_DIR = path.resolve(__dirname, '../../app/lenses');

// A handful of lenses deliberately share ONE LiveFeed identity rather than
// each getting its own (bio/chem/paper/physics/science all surface the same
// arXiv-sourced "Research Wire" feed) — an intentional design choice, not a
// copy-paste bug. Anything NOT in this allowlist must pass its own lens name.
const ALLOWED_SHARED_DOMAIN: Record<string, string> = {
  bio: 'research',
  chem: 'research',
  paper: 'research',
  physics: 'research',
  science: 'research',
};

function findLiveFeedDomainUsages(): Array<{ lens: string; domain: string; file: string }> {
  const usages: Array<{ lens: string; domain: string; file: string }> = [];
  for (const lens of readdirSync(LENSES_DIR)) {
    const pagePath = path.join(LENSES_DIR, lens, 'page.tsx');
    try {
      if (!statSync(pagePath).isFile()) continue;
    } catch {
      continue;
    }
    const src = readFileSync(pagePath, 'utf8');
    if (!/<LiveFeed\b/.test(src)) continue;
    // Find each <LiveFeed ...> block and pull its domain="..." prop.
    const blockRe = /<LiveFeed\b[\s\S]*?\/>/g;
    let m: RegExpExecArray | null;
    while ((m = blockRe.exec(src))) {
      const domainMatch = m[0].match(/domain=["']([a-z-]+)["']/);
      if (domainMatch) usages.push({ lens, domain: domainMatch[1], file: pagePath });
    }
  }
  return usages;
}

function domainMetaKeys(): string[] {
  const src = readFileSync(path.resolve(__dirname, '../../components/lens/LiveFeed.tsx'), 'utf8');
  const block = src.match(/const DOMAIN_META[^{]*\{([\s\S]*?)\n\};/);
  if (!block) return [];
  return Array.from(block[1].matchAll(/^\s*([a-z-]+):\s*\{/gm)).map((m) => m[1]);
}

describe('LiveFeed domain prop — every lens page passes its own domain (or a documented shared one)', () => {
  const usages = findLiveFeedDomainUsages();

  it('found at least the lenses known to mount LiveFeed (sanity check the scan itself works)', () => {
    const lensesFound = new Set(usages.map((u) => u.lens));
    expect(lensesFound.has('healthcare')).toBe(true);
    expect(lensesFound.has('food')).toBe(true);
  });

  it('every LiveFeed domain= usage matches its own lens or a documented shared domain', () => {
    const mismatches = usages.filter((u) => u.domain !== u.lens && ALLOWED_SHARED_DOMAIN[u.lens] !== u.domain);
    expect(mismatches, `Unexplained LiveFeed domain mismatches (real content, wrong label/accent/empty-copy): ${JSON.stringify(mismatches)}`).toEqual([]);
  });

  it('every domain= value actually used has a real DOMAIN_META entry (no silent generic fallback)', () => {
    const metaKeys = new Set(domainMetaKeys());
    const orphaned = usages.map((u) => u.domain).filter((d) => !metaKeys.has(d));
    expect(orphaned, `Domains used by a lens but missing from DOMAIN_META (falls through to generic "Live Wire" styling): ${JSON.stringify([...new Set(orphaned)])}`).toEqual([]);
  });
});
