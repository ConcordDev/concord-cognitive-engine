'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check as CheckIcon, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ago, cc, house, type Commission, type Criteria, type MyDtu, type OpenDtu, type Submission } from './houseApi';

type View = { kind: 'board' } | { kind: 'post' } | { kind: 'one'; id: string };

/** The pay board: requests with their reward held in escrow, and the work offered against them. */
export function CommissionsRoom({ signedIn, balance, onBalance, onReader }: { signedIn: boolean; balance: number | null; onBalance: () => void; onReader: (d: OpenDtu) => void }) {
  const [view, setView] = useState<View>({ kind: 'board' });
  const [tab, setTab] = useState<'open' | 'mine'>('open');
  const [list, setList] = useState<{ commissions: Commission[]; escrowTotal: number } | null>(null);
  const [mine, setMine] = useState<{ posted: Commission[]; submitted: Submission[] } | null>(null);
  const [sort, setSort] = useState('reward');
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(0);

  useEffect(() => {
    if (view.kind !== 'board') return;
    let live = true;
    if (tab === 'open') void house<{ commissions: Commission[]; escrowTotal: number }>('board-list', { sort, q }).then((r) => { if (!live) return; if (r.ok) { setList(r.result); setError(null); } else setError(r.message); });
    else void house<{ posted: Commission[]; submitted: Submission[] }>('board-mine').then((r) => { if (!live) return; if (r.ok) { setMine(r.result); setError(null); } else setError(r.message); });
    return () => { live = false; };
  }, [view.kind, tab, sort, q, key]);

  if (view.kind === 'post') return <PostForm balance={balance} onCancel={() => setView({ kind: 'board' })} onPosted={(id) => { onBalance(); setView({ kind: 'one', id }); }} />;
  if (view.kind === 'one') return <CommissionView id={view.id} signedIn={signedIn} onBack={() => { setKey((k) => k + 1); setView({ kind: 'board' }); }} onBalance={onBalance} onReader={onReader} />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="ah-label">The pay board</p>
          <h2 className="ah-display text-[30px] italic">Commissions</h2>
          <p className="max-w-[62ch] text-[13.5px] ah-muted">Ask for a DTU to be made. The reward is held in escrow when you post. Makers submit; the house checks each submission against what you asked for; you accept one that passes and the maker is paid.</p>
        </div>
        {signedIn ? <button type="button" className="ah-btn ah-btn-house" onClick={() => setView({ kind: 'post' })} data-testid="ah-post-open"><Plus className="h-4 w-4" />Post a commission</button>
          : <a className="ah-btn ah-btn-house" href={`/login?next=${encodeURIComponent('/lenses/market')}`}>Sign in to post</a>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1" role="tablist" aria-label="Board">
          <button type="button" role="tab" aria-selected={tab === 'open'} className="ah-chip h-8 px-3 text-[13px]" onClick={() => setTab('open')}>Open requests</button>
          {signedIn && <button type="button" role="tab" aria-selected={tab === 'mine'} className="ah-chip h-8 px-3 text-[13px]" onClick={() => setTab('mine')} data-testid="ah-board-mine">Mine</button>}
        </div>
        {tab === 'open' && (
          <>
            <input className="ah-input max-w-[260px]" placeholder="Search requests" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search requests" />
            <select className="ah-select w-auto" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort requests">
              <option value="reward">Highest reward</option><option value="deadline">Closing soonest</option><option value="newest">Newest</option>
            </select>
          </>
        )}
      </div>

      {error && <p className="ah-error" role="alert">{error}</p>}
      {tab === 'open' && !list && !error && <div className="space-y-3" role="status" aria-label="Loading the board">{Array.from({ length: 3 }, (_, i) => <div key={i} className="ah-skeleton h-28" />)}</div>}
      {tab === 'open' && list && (
        list.commissions.length === 0 ? (
          <div className="ah-panel px-6 py-12 text-center" data-testid="ah-board-empty"><p className="ah-title text-[22px]">The board is clear.</p><p className="mt-1 text-[13.5px] ah-muted">No open requests. Post the first one.</p></div>
        ) : (
          <>
            <p className="text-[13px] ah-muted"><span className="ah-num ah-ink-2 font-semibold">{cc(list.escrowTotal)}</span> held in escrow across {list.commissions.length} open {list.commissions.length === 1 ? 'request' : 'requests'}.</p>
            <ul className="grid gap-3 md:grid-cols-2" data-testid="ah-board">
              {list.commissions.map((c) => <li key={c.id}><CommissionCard c={c} onOpen={() => setView({ kind: 'one', id: c.id })} /></li>)}
            </ul>
          </>
        )
      )}

      {tab === 'mine' && mine && (
        <div className="grid gap-6 lg:grid-cols-2">
          <section><p className="ah-label mb-2">Requests you posted</p>
            {mine.posted.length ? <ul className="space-y-3">{mine.posted.map((c) => <li key={c.id}><CommissionCard c={c} onOpen={() => setView({ kind: 'one', id: c.id })} /></li>)}</ul> : <p className="text-[13.5px] ah-muted">None yet.</p>}
          </section>
          <section><p className="ah-label mb-2">Work you submitted</p>
            {mine.submitted.length ? (
              <ul className="ah-panel divide-y divide-[var(--ah-rule)]">
                {mine.submitted.map((s) => (
                  <li key={s.id}><button type="button" className="flex w-full items-baseline justify-between gap-3 px-3 py-2.5 text-left hover:bg-[var(--ah-paper)]" onClick={() => s.commission && setView({ kind: 'one', id: s.commission.id })}>
                    <span className="min-w-0"><span className="ah-title block truncate text-[16px]">{s.dtu.title}</span><span className="block truncate text-[12px] ah-muted">for “{s.commission?.title}” · {cc(s.commission?.reward)}</span></span>
                    <StatusWord s={s} />
                  </button></li>
                ))}
              </ul>
            ) : <p className="text-[13.5px] ah-muted">None yet.</p>}
          </section>
        </div>
      )}
    </div>
  );
}

function StatusWord({ s }: { s: Submission }) {
  const map = { submitted: s.passed ? ['passes · waiting', 'ah-good'] : ['fails a check', 'ah-bad'], accepted: ['accepted · paid', 'ah-good'], declined: ['declined', 'ah-muted'], withdrawn: ['withdrawn', 'ah-faint'] } as const;
  const [w, c] = map[s.status];
  return <span className={cn('shrink-0 text-[12px]', c)}>{w}</span>;
}

function criteriaWords(c: Criteria): string[] {
  const out: string[] = [];
  if (c.kind) out.push(`${c.kind} DTU`);
  if (c.domain) out.push(`in ${c.domain}`);
  if (c.tags?.length) out.push(`tagged ${c.tags.map((t) => `#${t}`).join(' ')}`);
  if (c.minClaims) out.push(`${c.minClaims}+ claims`);
  if (c.minWords) out.push(`${c.minWords}+ words`);
  if (c.mustCite) out.push('cites a named DTU');
  if (c.hasFile) out.push('carries a file');
  if (c.madeAfterPost) out.push('made after posting');
  return out;
}

function CommissionCard({ c, onOpen }: { c: Commission; onOpen: () => void }) {
  const closed = c.status !== 'open';
  return (
    <button type="button" onClick={onOpen} className="ah-plate w-full p-4" data-testid="ah-commission">
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="ah-title block text-[20px]">{c.title}</span>
          <span className="block text-[12.5px] ah-muted">asked by {c.poster.name || 'a member'} · {ago(c.createdAt)}</span>
        </span>
        <span className="shrink-0 text-right">
          <span className="ah-num ah-display block text-[24px] font-semibold ah-oxblood">{cc(c.reward)}</span>
          <span className="block text-[11px] ah-faint">{closed ? c.status : 'in escrow'}</span>
        </span>
      </div>
      <p className="mt-2 line-clamp-2 text-[13.5px] ah-ink-2">{c.brief}</p>
      <div className="mt-3 flex flex-wrap gap-1.5">{criteriaWords(c.criteria).map((w) => <span key={w} className="ah-chip">{w}</span>)}</div>
      <p className="mt-3 text-[12px] ah-muted">{c.submissionsOpen ? `Closes ${ago(c.deadline)}` : closed ? (c.status === 'awarded' ? 'Awarded' : c.status === 'cancelled' ? 'Cancelled, reward returned' : 'Expired, reward returned') : `Submissions closed · accept by ${new Date(c.acceptBy).toLocaleDateString()}`} · {c.submissions} {c.submissions === 1 ? 'submission' : 'submissions'}, {c.passing} passing</p>
    </button>
  );
}

function PostForm({ balance, onCancel, onPosted }: { balance: number | null; onCancel: () => void; onPosted: (id: string) => void }) {
  const [title, setTitle] = useState('');
  const [brief, setBrief] = useState('');
  const [reward, setReward] = useState('25');
  const [days, setDays] = useState('7');
  const [kind, setKind] = useState('');
  const [domain, setDomain] = useState('');
  const [tags, setTags] = useState('');
  const [minClaims, setMinClaims] = useState('');
  const [minWords, setMinWords] = useState('');
  const [mustCite, setMustCite] = useState('');
  const [hasFile, setHasFile] = useState(false);
  const [madeAfter, setMadeAfter] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const r = Number(reward);
  const short = balance != null && Number.isFinite(r) && r > balance;

  const post = async () => {
    setBusy(true); setErr(null);
    const res = await house<{ commission: Commission }>('board-post', {
      title, brief, reward: r, deadline: new Date(Date.now() + Number(days) * 86_400_000).toISOString(),
      criteria: { kind: kind || undefined, domain: domain || undefined, tags: tags || undefined, minClaims: minClaims || undefined, minWords: minWords || undefined, mustCite: mustCite || undefined, hasFile, madeAfterPost: madeAfter },
    });
    setBusy(false);
    if (res.ok) onPosted(res.result.commission.id); else setErr(res.message);
  };

  return (
    <div className="mx-auto max-w-[760px] space-y-5">
      <button type="button" className="ah-btn ah-btn-ghost px-2" onClick={onCancel}><ArrowLeft className="h-4 w-4" />The board</button>
      <div><p className="ah-label">Post a commission</p><h2 className="ah-display text-[30px] italic">Ask for a DTU to be made</h2></div>
      <section className="ah-panel space-y-4 p-5" data-testid="ah-post-form">
        <label className="block"><span className="ah-label">What you want</span><input className="ah-input mt-1" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Seismic retrofit checklist for unreinforced masonry" data-testid="ah-post-title" /></label>
        <label className="block"><span className="ah-label">The brief</span><textarea className="ah-textarea mt-1" rows={5} maxLength={4000} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="What it should cover, who it is for, what a great one looks like." data-testid="ah-post-brief" /></label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block"><span className="ah-label">Reward (CC)</span><input className="ah-input ah-num mt-1" inputMode="decimal" value={reward} onChange={(e) => setReward(e.target.value.replace(/[^0-9.]/g, ''))} data-testid="ah-post-reward" /></label>
          <label className="block"><span className="ah-label">Submissions close in</span>
            <select className="ah-select mt-1" value={days} onChange={(e) => setDays(e.target.value)}><option value="1">1 day</option><option value="3">3 days</option><option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option></select>
          </label>
        </div>
        <fieldset className="space-y-3 border-t pt-4 ah-rule">
          <legend className="ah-label">The checks a submission must pass</legend>
          <p className="text-[12.5px] ah-muted">The house runs these on the DTU itself. You can only accept a submission that passes all of them; then you read it in full.</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block text-[13px]">Kind<select className="ah-select mt-1" value={kind} onChange={(e) => setKind(e.target.value)}><option value="">any</option><option value="regular">regular</option><option value="mega">mega</option><option value="hyper">hyper</option></select></label>
            <label className="block text-[13px]">Field<input className="ah-input mt-1" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="any" /></label>
            <label className="block text-[13px]">Tags (comma separated)<input className="ah-input mt-1" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="none" data-testid="ah-post-tags" /></label>
            <label className="block text-[13px]">At least claims<input className="ah-input ah-num mt-1" inputMode="numeric" value={minClaims} onChange={(e) => setMinClaims(e.target.value.replace(/\D/g, ''))} placeholder="0" /></label>
            <label className="block text-[13px]">At least words<input className="ah-input ah-num mt-1" inputMode="numeric" value={minWords} onChange={(e) => setMinWords(e.target.value.replace(/\D/g, ''))} placeholder="0" /></label>
            <label className="block text-[13px]">Must cite DTU id<input className="ah-input mt-1" value={mustCite} onChange={(e) => setMustCite(e.target.value.trim())} placeholder="none" /></label>
          </div>
          <div className="flex flex-wrap gap-5 text-[13px]">
            <label className="flex items-center gap-2"><input type="checkbox" checked={madeAfter} onChange={(e) => setMadeAfter(e.target.checked)} />Made after I post (new work only)</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={hasFile} onChange={(e) => setHasFile(e.target.checked)} />Carries a file</label>
          </div>
        </fieldset>
        {err && <p className="ah-error" role="alert" data-testid="ah-post-error">{err}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4 ah-rule">
          <p className="text-[13px] ah-muted">Posting holds <span className="ah-num ah-ink-2 font-semibold">{cc(Number.isFinite(r) ? r : 0)}</span> in escrow{balance != null ? ` (your balance: ${cc(balance)})` : ''}. Cancel before accepting and it all comes back. The maker is paid the reward less the house fee.</p>
          <button type="button" className="ah-btn ah-btn-house" onClick={post} disabled={busy || short || title.trim().length < 3 || brief.trim().length < 10 || !(r >= 1)} data-testid="ah-post">{busy ? 'Posting…' : short ? 'Balance too low' : 'Post and hold the reward'}</button>
        </div>
      </section>
    </div>
  );
}

function CommissionView({ id, signedIn, onBack, onBalance, onReader }: { id: string; signedIn: boolean; onBack: () => void; onBalance: () => void; onReader: (d: OpenDtu) => void }) {
  const [d, setD] = useState<{ commission: Commission; submissions: Submission[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [mineDtus, setMineDtus] = useState<MyDtu[] | null>(null);
  const [pickOpen, setPickOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await house<{ commission: Commission; submissions: Submission[] }>('board-get', { id });
    if (r.ok) { setD(r.result); setErr(null); } else setErr(r.message);
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const c = d?.commission;
  const isPoster = !!c?.mine;
  const act = async (name: string, input: Record<string, unknown>, ok: (r: Record<string, unknown>) => string) => {
    setBusy(name); setMsg(null);
    const r = await house<Record<string, unknown>>(name, input);
    setBusy(null);
    if (r.ok) { setMsg({ ok: true, text: ok(r.result) }); onBalance(); await load(); } else setMsg({ ok: false, text: r.message });
  };
  const openPicker = async () => {
    setPickOpen(true);
    if (!mineDtus) { const r = await house<{ dtus: MyDtu[] }>('house-my-dtus'); if (r.ok) setMineDtus(r.result.dtus); else setMsg({ ok: false, text: r.message }); }
  };
  const read = async (sid: string) => { const r = await house<{ dtu: OpenDtu }>('house-open', { submissionId: sid }); if (r.ok) onReader(r.result.dtu); else setMsg({ ok: false, text: r.message }); };
  const submitted = useMemo(() => new Set((d?.submissions || []).map((s) => s.dtu.id)), [d]);

  return (
    <div className="mx-auto max-w-[860px] space-y-5" data-testid="ah-commission-view">
      <button type="button" className="ah-btn ah-btn-ghost px-2" onClick={onBack}><ArrowLeft className="h-4 w-4" />The board</button>
      {err && <p className="ah-error" role="alert">{err}</p>}
      {!d && !err && <div className="ah-skeleton h-48" role="status" aria-label="Loading the request" />}
      {c && (
        <>
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="ah-label">Commission · asked by {c.poster.name || 'a member'} · {ago(c.createdAt)}</p>
              <h2 className="ah-title mt-1 text-[32px]">{c.title}</h2>
            </div>
            <div className="text-right">
              <p className="ah-num ah-display text-[34px] font-semibold ah-oxblood" data-testid="ah-reward">{cc(c.reward)}</p>
              <p className="text-[12px] ah-muted">{c.status === 'open' ? `in escrow · maker receives ${cc(c.creatorNet)}` : c.status === 'awarded' ? `paid ${cc(c.releasedNet)} to the maker` : `returned ${cc(c.refunded)} to the poster`}</p>
            </div>
          </header>
          <p className="whitespace-pre-line text-[14.5px] ah-ink-2">{c.brief}</p>
          <div className="flex flex-wrap gap-1.5">{criteriaWords(c.criteria).map((w) => <span key={w} className="ah-chip">{w}</span>)}</div>
          <p className="text-[13px] ah-muted">{c.submissionsOpen ? `Submissions close ${ago(c.deadline)} (${new Date(c.deadline).toLocaleString()}).` : c.status === 'open' ? `Submissions are closed. The poster can accept until ${new Date(c.acceptBy).toLocaleString()}; then the reward returns.` : ''}</p>

          {msg && <p className={msg.ok ? 'ah-okay' : 'ah-error'} role="status" data-testid="ah-commission-msg">{msg.text}</p>}

          <div className="flex flex-wrap gap-2">
            {isPoster && c.status === 'open' && <button type="button" className="ah-btn" disabled={!!busy} onClick={() => void act('board-cancel', { id: c.id }, (r) => `Cancelled. ${cc(r.refunded as number)} returned to you.`)} data-testid="ah-cancel">Cancel and take the reward back</button>}
            {!isPoster && signedIn && c.submissionsOpen && <button type="button" className="ah-btn ah-btn-house" onClick={openPicker} data-testid="ah-submit-open">Submit a DTU you made</button>}
            {!signedIn && c.submissionsOpen && <a className="ah-btn ah-btn-house" href={`/login?next=${encodeURIComponent('/lenses/market')}`}>Sign in to submit</a>}
          </div>

          {pickOpen && !isPoster && (
            <section className="ah-panel p-4" data-testid="ah-submit-picker">
              <div className="mb-2 flex items-center justify-between"><p className="ah-label">Choose one of your DTUs</p><button type="button" className="ah-btn ah-btn-ghost h-7 px-2" onClick={() => setPickOpen(false)} aria-label="Close"><X className="h-4 w-4" /></button></div>
              {!mineDtus ? <div className="ah-skeleton h-20" /> : mineDtus.length === 0 ? <p className="text-[13px] ah-muted">You have no DTUs of your own yet. Make one, then come back.</p> : (
                <ul className="ah-scroll max-h-[300px] overflow-y-auto">
                  {mineDtus.map((m) => (
                    <li key={m.id}><button type="button" disabled={submitted.has(m.id) || !!busy} className="flex w-full items-baseline justify-between gap-3 border-b px-2 py-2 text-left ah-rule hover:bg-[var(--ah-paper)] disabled:opacity-50"
                      onClick={() => void act('board-submit', { commissionId: c.id, dtuId: m.id }, (r) => ((r.submission as Submission)?.passed ? 'Submitted. It passes every check.' : 'Submitted, but it fails a check. See below; fix the DTU and re-check.')).then(() => setPickOpen(false))}>
                      <span className="min-w-0"><span className="ah-title block truncate text-[16px]">{m.title}</span><span className="block truncate text-[12px] ah-muted">{m.domain || m.tier} · {m.claims} claims · {m.words} words · {m.tags.map((t) => `#${t}`).join(' ')}</span></span>
                      <span className="shrink-0 text-[12px] ah-faint">{submitted.has(m.id) ? 'submitted' : 'submit'}</span>
                    </button></li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <section>
            <p className="ah-label mb-2">{isPoster ? `Submissions (${d!.submissions.length})` : 'Your submissions'}</p>
            {d!.submissions.length === 0 ? <p className="text-[13.5px] ah-muted">{isPoster ? 'Nothing submitted yet.' : 'You have not submitted anything here.'}</p> : (
              <ul className="space-y-3" data-testid="ah-submissions">
                {d!.submissions.map((s) => (
                  <li key={s.id} className="ah-panel p-4" data-testid="ah-submission">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="ah-title text-[19px]">{s.dtu.title || '(missing DTU)'}</p>
                        <p className="text-[12.5px] ah-muted">by {s.creator.name || 'a maker'} · {ago(s.createdAt)} · {s.dtu.claims ?? 0} claims · {s.dtu.words ?? 0} words</p>
                      </div>
                      <StatusWord s={s} />
                    </div>
                    {s.dtu.excerpt && <p className="ah-display mt-2 line-clamp-3 border-l-2 border-[var(--ah-rule-2)] pl-3 text-[16px] italic ah-ink-2">{s.dtu.excerpt}</p>}
                    <ul className="mt-3 space-y-1">
                      {s.checks.map((k) => (
                        <li key={k.key} className="ah-check" data-pass={k.pass}>
                          <span className="ah-check-mark">{k.pass ? <CheckIcon className="inline h-3.5 w-3.5" /> : <X className="inline h-3.5 w-3.5" />}</span>
                          <span>{k.label}</span><span className="ah-check-leader" /><span className="text-[12px] ah-muted">{k.detail}</span>
                        </li>
                      ))}
                    </ul>
                    {s.note && <p className="mt-2 text-[12.5px] ah-muted">Note: {s.note}</p>}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {isPoster && s.status === 'submitted' && c.status === 'open' && (
                        <>
                          <button type="button" className="ah-btn ah-btn-house" disabled={!s.passed || !!busy} onClick={() => void act('board-accept', { submissionId: s.id }, (r) => `Accepted. ${cc(r.paid as number)} paid to the maker; it is yours to read.`)} data-testid="ah-accept" title={s.passed ? undefined : 'Only a submission that passes every check can be accepted'}>Accept and pay</button>
                          <button type="button" className="ah-btn" disabled={!!busy} onClick={() => { const note = window.prompt('A note to the maker (optional)') ?? ''; void act('board-decline', { submissionId: s.id, note }, () => 'Declined.'); }}>Decline</button>
                        </>
                      )}
                      {(isPoster ? s.status === 'accepted' : true) && (s.status === 'accepted' || !isPoster) && <button type="button" className="ah-btn" onClick={() => void read(s.id)} data-testid="ah-read-sub">Read in full</button>}
                      {!isPoster && s.status === 'submitted' && (
                        <>
                          <button type="button" className="ah-btn" disabled={!!busy} onClick={() => void act('board-recheck', { submissionId: s.id }, (r) => ((r.submission as Submission)?.passed ? 'It passes every check now.' : 'It still fails a check.'))}>Re-check</button>
                          <button type="button" className="ah-btn ah-btn-ghost" disabled={!!busy} onClick={() => void act('board-withdraw', { submissionId: s.id }, () => 'Withdrawn.')}>Withdraw</button>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
