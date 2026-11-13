/**
 * GB-1521 slice B6 — silent smalls, batch 1: bounds and refusals that used
 * to happen in silence now speak.
 *
 * FIX-genesis-005 the saved-search label stopped growing at 40 chars with
 *   no counter — the cap is now named with a live count.
 * FIX-lfg-004 the request note truncated at 240 chars silently — counter.
 * FIX-saved-003 a blank collection name submitted into silence — the
 *   missing precondition is named while it is missing.
 * FIX-creatures-012 the Lineage View with empty input was a silent no-op —
 *   it now says a creature id is needed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const FE = join(__dirname, '..');
const read = (p: string) => readFileSync(join(FE, p), 'utf8');

describe('genesis-005 — the label cap is named', () => {
  const src = read('components/genesis/SavedSearchesPanel.tsx');
  it('renders a live character counter for the 40-char label', () => {
    expect(src).toContain('{label.length}/40');
    expect(src).toContain('saved-search-label-count');
  });
});

describe('lfg-004 — the note cap is named', () => {
  const src = read('app/lenses/lfg/page.tsx');
  it('renders a live character counter for the 240-char note', () => {
    expect(src).toContain('{postForm.note.length}/240');
  });
});

describe('saved-003 — a blank collection name speaks', () => {
  const src = read('components/saved/FoldersSidebar.tsx');
  it('shows the missing-precondition hint while the name is blank', () => {
    expect(src).toContain('Name the collection to create it.');
    expect(src).toContain('creating && !newName.trim()');
  });
});

describe('creatures-012 — an empty lineage lookup speaks', () => {
  const src = read('components/creatures/LineagePanel.tsx');
  it('sets a worded error instead of returning silently', () => {
    expect(src).toContain("setLineageError('Enter a creature id first.')");
  });
});

describe('batch 2 — outcomes that used to vanish', () => {
  it('chat-012: a rejected clipboard write toasts instead of failing silently', () => {
    const src = read('components/chat/ChatWorkspacePanel.tsx');
    expect(src).toContain('Copy failed — the browser refused clipboard access');
  });
  it('dreams-004: tag save confirms by default and words failure', () => {
    const src = read('components/dreams/DreamReader.tsx');
    expect(src).toContain("'Tags saved.'");
    expect(src).toContain("'Tags could not be saved.'");
  });
  it('eco-007: the AQI card names its updated-at time', () => {
    const src = read('components/eco/AQIPanel.tsx');
    expect(src).toContain('lastFetchedAt');
    expect(src).toContain('Updated {new Date(lastFetchedAt).toLocaleTimeString()}');
  });
  it('home-improvement-012: a tracked seasonal suggestion shows its state', () => {
    const src = read('components/home-improvement/MaintenanceReminders.tsx');
    expect(src).toContain('reminders.some((r) => r.task === t)');
    expect(src).toContain('tracked</span>');
  });
});

describe('batch 3 — validation and honesty in place', () => {
  it('ingest-002: the page-URL queue field validates inline and gates the button', () => {
    const src = read('components/ingest/LatticeSeedPanel.tsx');
    expect(src).toContain('function isQueueableUrl');
    expect(src).toContain('That doesn&rsquo;t read as a web address');
    expect(src).toContain('disabled={busy || !sourceId || !isQueueableUrl(pageUrl)}');
  });
  it('research-003: the Daily tab reads create:false first and creates only on Start', () => {
    const src = read('components/research/ResearchWorkbench.tsx');
    expect(src).toContain('create: false');
    expect(src).toContain('Start today&rsquo;s note');
    const server = read('../server/domains/research.js');
    expect(server).toContain('params.create === false');
  });
  it('research-004: blank note title names its precondition; the view bar takes arrow keys', () => {
    const src = read('components/research/ResearchWorkbench.tsx');
    expect(src).toContain('Give the note a title to save it.');
    expect(src).toContain("'ArrowRight', 'ArrowLeft', 'Home', 'End'");
    expect(src).toContain('data-research-tab={t.id}');
  });
  it('daily-009: the quote panel applies an ignored tag filter to the fallback batch', () => {
    const src = read('components/daily/QuotablePanel.tsx');
    expect(src).toContain('applyTagFilter');
    expect(src).toContain('Tag filter applied to the fallback quotes');
    expect(src).toContain('no quote they returned carries the requested tag');
  });
  it('manufacturing-011: the Gantt horizon is pinned per tab; Mark done confirms in words', () => {
    const src = read('components/manufacturing/ShopFloorSuite.tsx');
    expect(src).toContain('const [horizonStart] = useState(() => new Date().toISOString())');
    expect(src).toContain("run('schedule-gantt', { horizonStart })");
    expect(src).toContain('setDoneNote(');
    expect(src).toContain('next due date has been rescheduled below');
  });
  it('physics-007: sharing takes a confirmation and offers revoke', () => {
    const src = read('components/physics/PhysicsLab.tsx');
    expect(src).toContain('Create a share code for this scene?');
    expect(src).toContain('Revoke share code');
    expect(src).toContain("'scene-unshare'");
    const server = read('../server/domains/physics.js');
    expect(server).toContain('"scene-unshare"');
  });
});

describe('batch 4 — server contracts the panels actually speak', () => {
  it('cri-004: the Crisis panel sends its payload as the run input, not double-wrapped', () => {
    const src = read('components/cri/CrisisActionPanel.tsx');
    expect(src).toContain("runDomain('cri', action, input)");
    expect(src).not.toContain("runDomain('cri', action, { input })");
    const server = read('../server/domains/cri.js');
    expect(server).toContain('standard-5-phase');
    expect(server).toContain('params?.stakeholders');
    expect(server).toContain('sh.name || sh.group');
  });
  it('law-003: clause-extract recognises Title Case section headings', () => {
    const server = read('../server/domains/law.js');
    expect(server).toContain('titleCaseHeading');
  });
  it('lock-001: deadlockDetect derives wait-for rows from the recorded trace', () => {
    const server = read('../server/domains/lock.js');
    expect(server).toContain('tracesFor(ctx)');
    expect(server).toContain('acquiredLater');
  });
});

describe('batch 5 — reports, fields, routes and corpora', () => {
  it('sentinel-002: a submitted report opens the reporter a triage case and says so', () => {
    const src = read('components/sentinel/SentinelShield.tsx');
    expect(src).toContain('A triage case was opened for it');
    expect(src).toContain('triageCaseId');
  });
  it('sentinel-007 + entity-012: no form field in the sentinel/entity components lacks id and name', () => {
    for (const dir of ['components/sentinel', 'components/entity']) {
      for (const f of readdirSync(join(FE, dir))) {
        if (!f.endsWith('.tsx') || f.endsWith('.test.tsx')) continue;
        const src = read(`${dir}/${f}`);
        const tags = src.match(/<(input|select|textarea)\b[^>]*>/g) || [];
        for (const tag of tags) {
          expect(tag.includes('id=') || tag.includes('name='), `${f}: ${tag.slice(0, 60)}`).toBe(true);
        }
      }
    }
  });
  it('dx-platform-012: the API keys page exists and uses the real key endpoints', () => {
    const src = read('app/api-keys/page.tsx');
    expect(src).toContain('apiHelpers.auth.apiKeys');
    expect(src).toContain('cannot be retrieved again');
  });
  it('strategic-adds-003: flow counts agree — active in the header and the branches, paused marked, loading is not "no tree"', () => {
    const src = read('components/privacy/DataControlsPanel.tsx');
    expect(src).toContain('Loading your data flows…');
    expect(src).toContain('shared across lenses');
  });
  it('tools-007: the verify banner has a neutral pending state', () => {
    const src = read('components/tools/ESignatureTool.tsx');
    expect(src).toContain('Pending signatures — nothing to verify yet');
    const server = read('../server/domains/tools.js');
    expect(server).toContain('event: "routed"');
    expect(server).toContain('"pending"');
  });
  it('message-008: the search tab can index existing history', () => {
    const src = read('components/message/MessageWorkbench.tsx');
    expect(src).toContain('Index my messages');
    expect(src).toContain("'index-backfill'");
    const server = read('../server/domains/message.js');
    expect(server).toContain('"index-backfill"');
  });
});

describe('batch 6 — dead ends get paths', () => {
  it('nonprofit-012: a Gmail-blocked send links to the connect surface and the draft persists', () => {
    const src = read('components/nonprofit/NonprofitWorkbench.tsx');
    expect(src).toContain('Connect Gmail in the Integrations lens');
    expect(src).toContain('COMM_DRAFT_KEY');
  });
  it('careers-003: a started shift can be clocked out and the state is stated', () => {
    const src = read('app/lenses/careers/page.tsx');
    expect(src).toContain('Clock out');
    expect(src).toContain('You are clocked in.');
    expect(src).toContain('onClockOut');
  });
  it('society-011 + fitness-017: recipients are picked from user search, not typed as raw ids', () => {
    const picker = read('components/social/UserPicker.tsx');
    expect(picker).toContain('/api/social/mention-search');
    expect(read('components/society/SocietyActionPanel.tsx')).toContain('UserPicker');
    expect(read('components/society/SocietyActionPanel.tsx')).toContain('dmNote');
    expect(read('components/fitness/WorkoutFinishPanel.tsx')).toContain('UserPicker');
  });
});

describe('batch 7 — external fetches and long runs settle honestly', () => {
  it('research-006: the arXiv leg retries once and names the outage; the panel offers Retry', () => {
    const server = read('../server/domains/research.js');
    expect(server).toContain('arxiv_unreachable');
    expect(server).toContain('for (let attempt = 0; attempt < 2; attempt++)');
    expect(read('components/research/AcademicSearchPanel.tsx')).toContain('Retry');
  });
  it('pharmacy-004: FDA failures read as words with a retry, and the badge stops claiming REAL data', () => {
    const src = read('components/pharmacy/FdaLivePanel.tsx');
    expect(src).toContain('could not be reached — this is a connection problem, not an empty result');
    expect(src).not.toContain('FDA unreachable ({error})');
    expect(src).toContain('unavailable');
  });
  it('resonance-003: arXiv failures surface after one retry and an empty filter names itself', () => {
    expect(read('hooks/useArxivFeed.ts')).toContain('retry: 1');
    expect(read('components/resonance/ResonanceArxiv.tsx')).toContain('every word of the filter must match');
  });
  it('sim-005: a rejected simulation run settles — the button cannot stick on Stepping agents', () => {
    const src = read('components/sim/AgentBasedRunner.tsx');
    expect(src).toContain('The simulation did not finish');
    expect(src).toContain('finally');
  });
});

describe('batch 8 — scopes, queues, rosters and refusals', () => {
  it('productivity-006: captures have a home tab with delete', () => {
    const panel = read('components/productivity/ProductivityCapturesPanel.tsx');
    expect(panel).toContain("type: 'capture'");
    expect(panel).toContain('apiHelpers.lens.delete');
    expect(read('components/productivity/ProductivityTaskSection.tsx')).toContain("'captures'");
  });
  it('queue-002: the enqueue form can create a personal queue and states the isolation', () => {
    const src = read('components/queue/EnqueueForm.tsx');
    expect(src).toContain('New queue…');
    expect(src).toContain('Queues are yours alone');
  });
  it('integrations-008: FE refuses blank versions in words; the server counts them invalid, never compatible', () => {
    expect(read('components/integrations/AnalysisPanel.tsx')).toContain('the greyed values are placeholders, not entries');
    const server = read('../server/domains/integrations.js');
    expect(server).toContain('versionsValid: false');
    expect(server).toContain('invalidVersions');
  });
  it('federation-001: no fake sync trigger remains, key book + metrics are scoped in words, peering names its gate', () => {
    const sync = read('components/federation/SyncPanel.tsx');
    expect(sync).not.toContain("fetch('/api/federation/sync'");
    expect(sync).toContain("not a\n        member action");
    expect(read('components/federation/ActorKeysPanel.tsx')).toContain('Your own key book');
    expect(read('components/federation/TrustGraphView.tsx')).toContain('admin-only');
    expect(read('components/federation/MetricsDashboardPanel.tsx')).toContain('a personal');
  });
  it('federation-008: the trust graph does not poll in a hidden tab', () => {
    expect(read('components/federation/TrustGraphView.tsx')).toContain("document.visibilityState === 'visible'");
  });
  it('classroom-006: scope can be cleared from where it binds, a cohort detail strip exists, the FAB hides where its form already is', () => {
    const src = read('app/lenses/classroom/page.tsx');
    expect(src).toContain('Clear scope');
    expect(src).toContain('clear the scope');
    expect(src).toContain("view !== 'cohorts'");
  });
  it('ops-003: analytics and status tabs render a refusal instead of loading forever', () => {
    const src = read('components/ops/IncidentConsole.tsx');
    expect(src).toContain('needs operator access');
    expect(src).toContain('analyticsError');
    expect(src).toContain('statusError');
  });
  it('veterinary-010: reminders fold scheduled appointments into both lists', () => {
    const server = read('../server/domains/veterinary.js');
    expect(server).toContain('kind: "appointment"');
  });
});

describe('batch 9 — deprecated lenses say so; background polls respect the tab', () => {
  it('commonsense-002 + grounding-007 + inference-010: the shell renders the taxonomy deprecation notice', () => {
    const src = read('components/lens/LensShell.tsx');
    expect(src).toContain("statusEntry?.status === 'deprecated'");
    expect(src).toContain('getLensStatus');
    expect(src).toContain('scheduled to merge into the');
  });
  it('foundry-006 (poll leg): BuilderStudio presence pings pause in a hidden tab', () => {
    expect(read('components/foundry/BuilderStudio.tsx')).toContain("document.visibilityState !== 'visible'");
  });
});
