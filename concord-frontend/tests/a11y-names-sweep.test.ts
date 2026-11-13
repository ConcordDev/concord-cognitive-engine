/**
 * CB-0440 guard: accessible names & form labels across the claimed set.
 * Pins the named surfaces from the section's fixes and scans the four
 * id/name-genus lenses (retail · manufacturing · fitness · dreams) so a
 * form field without an id, name or accessible label cannot regress.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function* walk(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!/test|__tests__/.test(e.name)) yield* walk(p); }
    else if (/\.tsx$/.test(e.name) && !/test/.test(e.name)) yield p;
  }
}

/** Brace/quote-aware tag scanner: yields attribute strings of form tags. */
function* formTags(src: string): Generator<string> {
  const re = /<(input|select|textarea)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let i = m.index + 1 + m[1].length, depth = 0, quote: string | null = null;
    const start = i;
    while (i < src.length) {
      const c = src[i];
      if (quote) { if (c === quote) quote = null; }
      else if ('"\'`'.includes(c)) quote = c;
      else if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
      i++;
    }
    yield src.slice(start, i);
  }
}

describe('accessible names & labels (CB-0440)', () => {
  it('food status filter exposes the name "Recipe status"', () => {
    expect(read('components/food/FoodKitchenWorkbench.tsx')).toContain('aria-label="Recipe status"');
  });

  it('invariant lock banner is an h2 and the panel carries no second h1', () => {
    const src = read('components/invariant/OverviewPanel.tsx');
    expect(src).not.toMatch(/<h1[\s>]/);
    expect(src).toMatch(/<h2[^>]*>\s*<Lock/);
  });

  it('social post actions (react / replies / repost) carry accessible names', () => {
    const src = read('components/social/feed/PostCard.tsx');
    for (const name of ['aria-label="React to post"', 'aria-label="Show replies"', "'Reposted' : 'Repost post'"]) expect(src).toContain(name);
  });

  it('custom builder save button is named', () => {
    expect(read('components/custom/CanvasBuilder.tsx')).toContain('aria-label="Save canvas"');
  });

  it('studio track M/S and transport controls carry names; the time readout sits at the AA step', () => {
    const arrange = read('components/studio/daw/ArrangeView.tsx');
    expect(arrange).toContain('aria-label={`${t.name} mute`}');
    expect(arrange).toContain('aria-label={`${t.name} solo`}');
    const transport = read('components/studio/daw/TransportBar.tsx');
    for (const name of ['aria-label="Undo"', 'aria-label="Redo"', 'aria-label="Loop"', 'aria-label="Metronome"', 'aria-label="Count-in before recording"']) expect(transport).toContain(name);
    expect(transport).toContain('text-zinc-400">0:00.0</span>');
  });

  it('healthcare new-patient DOB and sex fields are named', () => {
    const src = read('components/healthcare/PatientsPanel.tsx');
    expect(src).toContain('aria-label="Date of birth"');
    expect(src).toContain('aria-label="Sex"');
  });

  it('nonprofit campaign row actions are named per campaign, never bare Edit/Delete', () => {
    const src = read('components/nonprofit/CampaignManager.tsx');
    expect(src).toContain('aria-label={`Edit campaign ${c.name}`}');
    expect(src).toContain('aria-label={`Delete campaign ${c.name}`}');
    expect(src).not.toContain('aria-label="Edit"');
    expect(src).not.toContain('aria-label="Delete"');
  });

  it('council chamber selects are named and its proposal title is not a second h1', () => {
    const src = read('components/council/CouncilChamber.tsx');
    for (const name of ['Filter by status', 'Budget scenario', 'Audit category', 'Proposal type', 'Voting method', 'Budget item category', 'Budget item type']) expect(src).toContain(`aria-label="${name}"`);
    expect((src.match(/<h1[\s>]/g) || []).length).toBe(1); // the chamber header owns the page h1
  });

  it('trades quote-line remove names the line', () => {
    expect(read('components/trades/QuotesPanel.tsx')).toContain('aria-label={`Remove line ${i + 1}`}');
  });

  it('shared export button (compact) and lattice repos filter are named', () => {
    expect(read('components/lens/DTUExportButton.tsx')).toContain('aria-label={`Export ${domain} data as .dtu`}');
    expect(read('components/lattice/LatticeRepos.tsx')).toContain('aria-label="Filter by topic"');
  });

  it('energy rate form fields are named', () => {
    const src = read('components/energy/EnergyBillingPanel.tsx');
    expect(src).toContain('aria-label="Your rate in dollars per kWh"');
    expect(src).toContain('aria-label="Utility name"');
  });

  it('fork search field carries id + name', () => {
    expect(read('app/lenses/fork/page.tsx')).toContain('id="fork-search"');
  });

  it('every form field in the four id/name-genus lenses carries an id, a name, or a label', () => {
    const bad: string[] = [];
    for (const lens of ['retail', 'manufacturing', 'fitness', 'dreams']) {
      for (const base of [`components/${lens}`, `app/lenses/${lens}`]) {
        const dir = path.join(ROOT, base);
        if (!fs.existsSync(dir)) continue;
        for (const f of walk(dir)) {
          for (const attrs of formTags(fs.readFileSync(f, 'utf8'))) {
            if (/type="hidden"/.test(attrs)) continue;
            if (!/\b(id|name|aria-label|aria-labelledby)\s*=/.test(attrs)) bad.push(path.relative(ROOT, f) + ' :: ' + attrs.trim().replace(/\s+/g, ' ').slice(0, 60));
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
