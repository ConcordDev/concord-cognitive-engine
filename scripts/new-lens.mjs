#!/usr/bin/env node
// scripts/new-lens.mjs — start a lens redesign from the lens kit, not a blank page.
//
//   node scripts/new-lens.mjs <lens> --identity "The Stall" [--slug stall]
//        [--list <action>] [--page] [--force] [--root <repo dir>]
//
// Writes (never over an existing file unless --force):
//   concord-frontend/components/<lens>/<slug>/<Name>App.tsx    the lens app: rooms, honest states, lensCall
//   concord-frontend/components/<lens>/<slug>/<slug>.css       the identity's tokens on the --lk contract
//   concord-frontend/tests/<lens>-<slug>.test.tsx              states + contrast, ready to extend
//   specs/<lens>/CS-<lens>-fits-390.json                       check spec: nothing wider than a phone
//   specs/<lens>/CS-<lens>-loads-clean.json                    check spec: opens with no console errors
//   docs/lens-specs/<lens>-capability-map.md                   only if the lens has none
//   concord-frontend/app/lenses/<lens>/page.tsx                only with --page (a thin mount)
//
// --list names the backend action the first room lists (e.g. --list list_products).
// Without it the room says, in words, that it is not wired yet. Nothing is invented.
// The tokens start as the kit's neutral defaults so they pass the contrast check; the
// playbook's rule is that you replace every one with the lens's own identity.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function arg(name, dflt) { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; }
const flag = (n) => process.argv.includes(n);
const pascal = (s) => s.replace(/(^|[-_ ]+)([a-z0-9])/gi, (_, __, c) => c.toUpperCase()).replace(/[^A-Za-z0-9]/g, "");

export function plan({ lens, identity, slug, list, page }) {
  if (!/^[a-z][a-z0-9-]*$/.test(lens || "")) throw new Error("lens: lower-case letters, digits and dashes (the app/lenses/<lens> directory name)");
  if (!identity || identity.trim().length < 3) throw new Error('--identity "<Name>" is required: the identity the owner approved (playbook step 2)');
  const s = slug || identity.toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!/^[a-z][a-z0-9-]*$/.test(s)) throw new Error("slug: lower-case letters, digits and dashes");
  if (list !== undefined && !/^[A-Za-z0-9_.-]+$/.test(list)) throw new Error("--list: a backend action name");
  const Name = pascal(identity.replace(/^the\s+/i, "")) || pascal(lens);
  const cls = `lk-${s}`;
  const files = {};
  const dir = `concord-frontend/components/${lens}/${s}`;

  files[`${dir}/${Name}App.tsx`] = `'use client';

/**
 * ${identity} — the ${lens} lens.
 *
 * Started from the lens kit (scripts/new-lens.mjs). Rules it inherits:
 *   - every number on screen goes through <SourcedNumber> / sourced() (tests/lens-kit-number-rule.test.ts);
 *   - every request shows loading, error (the server's own words), empty (why, and what to do) or ready;
 *   - the body holds at 390px (LensBody / LensColumns / LensTabStrip);
 *   - the tokens in ${s}.css meet the contrast contract in every mode.
 * Replace this note with what the lens is for, once its identity is built.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LensAsync, LensBody, LensTabStrip, SourcedNumber, counted, lensCall, statusOf, type LensTab } from '@/components/lens-kit';
import './${s}.css';

const DOMAIN = '${lens}';
/** The backend action the first room lists. ${list ? '' : 'Not named yet: set it to a registered ' + lens + '.* action. '}*/
const LIST_ACTION: string | null = ${list ? `'${list}'` : 'null'};

type Row = { id?: string; title?: string; name?: string };

const ROOMS: LensTab[] = [{ id: 'home', label: 'Home' }];

export function ${Name}App() {
  const [room, setRoom] = useState('home');
  const q = useQuery({
    queryKey: [DOMAIN, LIST_ACTION],
    enabled: LIST_ACTION !== null,
    queryFn: async () => {
      const r = await lensCall<Row[] | { items?: Row[] }>(DOMAIN, LIST_ACTION as string);
      if (!r.ok) throw new Error(r.error || 'refused');
      return Array.isArray(r.result) ? r.result : r.result?.items ?? [];
    },
  });
  const rows = q.data ?? [];
  return (
    <div className="${cls} min-h-full">
      <LensBody label="${identity}">
        <header className="mb-3 flex min-w-0 flex-wrap items-baseline justify-between gap-2">
          <h1 className="min-w-0 break-words text-xl font-semibold">${identity}</h1>
          {LIST_ACTION && q.data ? <span className="text-sm text-[color:var(--lk-text-muted)]"><SourcedNumber n={counted(rows.length, 'records')} /> records</span> : null}
        </header>
        <LensTabStrip label="${identity} rooms" tabs={ROOMS} active={room} onSelect={setRoom} />
        <main className="mt-3 min-w-0">
          {LIST_ACTION === null ? (
            <LensAsync status="empty" empty={{ title: 'Not wired yet', why: 'This room does not list anything until LIST_ACTION names a registered ${lens} action (docs/LENS_KIT.md).' }} />
          ) : (
            <LensAsync status={statusOf(q, (d) => !Array.isArray(d) || d.length === 0)} error={q.error} onRetry={() => q.refetch()}
              empty={{ title: 'Nothing here yet', why: 'The server returned no records for you.' }}>
              <ul className="min-w-0 divide-y divide-[color:var(--lk-line)]">
                {rows.map((r, i) => <li key={r.id ?? i} className="min-w-0 break-words py-2">{r.title ?? r.name ?? r.id}</li>)}
              </ul>
            </LensAsync>
          )}
        </main>
      </LensBody>
    </div>
  );
}
`;

  files[`${dir}/${s}.css`] = `/*
 * ${identity} — tokens on the lens-kit contract (lib/lens-kit/contrast.ts).
 *
 * TODO (playbook step 2 + the Identity registry): these start as the kit's neutral
 * defaults so the lens is legible and passes the contrast check. Replace EVERY value
 * with ${identity}'s own palette; no two lenses share a palette family. The check in
 * tests/lens-kit-number-rule.test.ts runs on this file in every mode it defines.
 * Dark is the app's default; light follows [data-theme="light"] / .light.
 */
.${cls} {
  background: var(--lk-surface);
  color: var(--lk-text);
  --lk-surface: #111113;
  --lk-surface-raised: #1b1b1f;
  --lk-text: #ededef;
  --lk-text-muted: #a1a1aa;
  --lk-accent: #5b8def;
  --lk-on-accent: #0a0a0b;
  --lk-line: #2e2e33;
  --lk-ok: #4ade80;
  --lk-warn: #fbbf24;
  --lk-danger: #f87171;
}
[data-theme="light"] .${cls}, .light .${cls} {
  --lk-surface: #fafafa;
  --lk-surface-raised: #ffffff;
  --lk-text: #171717;
  --lk-text-muted: #525252;
  --lk-accent: #1d4ed8;
  --lk-on-accent: #ffffff;
  --lk-line: #d4d4d4;
  --lk-ok: #067647;
  --lk-warn: #93370d;
  --lk-danger: #b42318;
}
@media (prefers-reduced-motion: reduce) {
  .${cls} *, .${cls} *::before, .${cls} *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
`;

  files[`concord-frontend/tests/${lens}-${s}.test.tsx`] = `import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import fs from 'node:fs';
import path from 'node:path';
import { checkLensTokens } from '@/lib/lens-kit/contrast';

const lensCall = vi.fn();
vi.mock('@/lib/lens-kit/api', () => ({ lensCall: (...a: unknown[]) => lensCall(...a), unwrapLensResponse: vi.fn() }));
import { ${Name}App } from '@/components/${lens}/${s}/${Name}App';

const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

describe('${identity}', () => {
  beforeEach(() => lensCall.mockReset());

  it('${list ? 'lists what the server returns, and says why when there is nothing' : 'says plainly that the room is not wired yet'}', async () => {
${list ? `    lensCall.mockResolvedValueOnce({ ok: true, result: [] });
    wrap(<${Name}App />);
    expect(await screen.findByTestId('lens-empty')).toBeTruthy();
    expect(lensCall).toHaveBeenCalledWith('${lens}', '${list}');` : `    wrap(<${Name}App />);
    expect(screen.getByTestId('lens-empty').textContent).toMatch(/Not wired yet/);
    expect(lensCall).not.toHaveBeenCalled();`}
  });
${list ? `
  it('shows the server\\'s own reason when it refuses', async () => {
    lensCall.mockResolvedValueOnce({ ok: false, error: 'That shop is closed.' });
    wrap(<${Name}App />);
    expect((await screen.findByTestId('lens-error')).textContent).toMatch(/That shop is closed/);
  });
` : ''}
  it('its tokens meet the contrast contract in every mode', () => {
    const css = fs.readFileSync(path.join(__dirname, '../components/${lens}/${s}/${s}.css'), 'utf8');
    expect(checkLensTokens(css).failures).toEqual([]);
  });
});
`;

  const spec = (id, why, viewport, expect) => JSON.stringify({ id, lens, why, path: `/lenses/${lens}`, account: "member", viewport, steps: [], expect }, null, 2) + "\n";
  files[`specs/${lens}/CS-${lens}-fits-390.json`] = spec(`CS-${lens}-fits-390`, `${identity} fits a 390px phone: nothing wider than the screen`, "mobile", [{ noHorizontalScroll: {} }]);
  files[`specs/${lens}/CS-${lens}-loads-clean.json`] = spec(`CS-${lens}-loads-clean`, `${identity} opens with no console errors and its rooms visible`, "desktop", [{ visible: { target: { role: "tablist", name: `${identity} rooms` } } }, { noConsoleErrors: {} }]);

  files[`docs/lens-specs/${lens}-capability-map.md`] = `# ${lens} — Capability Map

## ${new Date().toISOString().slice(0, 10)} — ${identity} (started from the lens kit)

Playbook: docs/LENS_REDESIGN_PLAYBOOK.md. Kit: docs/LENS_KIT.md.

- Job:
- Reference product:
- Identity (owner-approved):
- Backend actions (every one, and where each is homed in the design):
- Gaps closed (backend first), with their behavioural and adversarial tests:
- Browser drive (numbers cross-checked):

### Genuinely missing
(each with its triage class: data sourcing, engineering, or curation)
`;
  if (page) files[`concord-frontend/app/lenses/${lens}/page.tsx`] = `'use client';

/** /lenses/${lens} — ${identity}. A thin mount: the lens owns everything below the shared bars. */

import { LensShell } from '@/components/lens/LensShell';
import { useLensNav } from '@/hooks/useLensNav';
import { ${Name}App } from '@/components/${lens}/${s}/${Name}App';

export default function ${pascal(lens)}LensPage() {
  useLensNav('${lens}');
  return (
    <LensShell lensId="${lens}" asMain={false} className="h-full">
      <${Name}App />
    </LensShell>
  );
}
`;
  return { slug: s, Name, files };
}

export function write({ root, files, force }) {
  const written = [], kept = [];
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(root, rel);
    const isMap = rel.startsWith("docs/lens-specs/");
    if (fs.existsSync(p) && (!force || isMap)) { kept.push(rel); continue; }
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
    written.push(rel);
  }
  return { written, kept };
}

function main() {
  const lens = process.argv[2];
  if (!lens || lens.startsWith("--")) { console.error('usage: new-lens.mjs <lens> --identity "<Name>" [--slug s] [--list action] [--page] [--force] [--root dir]'); process.exit(2); }
  const root = path.resolve(arg("--root", path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")));
  try {
    const p = plan({ lens, identity: arg("--identity"), slug: arg("--slug"), list: arg("--list"), page: flag("--page") });
    const r = write({ root, files: p.files, force: flag("--force") });
    for (const f of r.written) console.log(`wrote  ${f}`);
    for (const f of r.kept) console.log(`kept   ${f} (exists${f.startsWith("docs/") ? "; a capability map is never overwritten" : "; --force to replace"})`);
    console.log(`\nNext (docs/LENS_REDESIGN_PLAYBOOK.md):\n  1. replace the tokens in ${p.slug}.css with ${arg("--identity")}'s palette; add the Identity registry row\n  2. ${flag("--page") ? "" : `mount it: app/lenses/${lens}/page.tsx renders <${p.Name}App /> (re-run with --page for a thin mount)\n  3. `}build the rooms on real ${lens}.* actions; run: npx vitest run tests/${lens}-${p.slug}.test.tsx\n  then: node scripts/walk/run-check.mjs specs/${lens} --base http://localhost:3000`);
  } catch (e) { console.error(String(e.message || e)); process.exit(2); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
