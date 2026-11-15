'use client';

/**
 * CareerPortfolio — real UI for the "verifiable portfolio" feature the
 * lens manifest declares for this domain (`concord-frontend/lib/lenses/
 * manifest.ts`, `domain: 'experience'`: `artifacts: ['portfolio', 'skill',
 * 'history', 'insight', 'credential']`, `actions: ['endorse', 'analyze',
 * 'generate_resume', 'compare_versions', 'validate_claims']`).
 *
 * Those 5 actions are real, registered handlers — but at
 * `server/server.js:40710-40763`, NOT in `server/domains/experience.js`
 * (so `scripts/lens-unsurfaced.mjs`, which only scans `server/domains/*.js`,
 * can't see them at all). They operate on a single artifact's
 * `data.{skills,endorsements,experience,education,snapshots}`.
 *
 * The lens previously had a "Creative Portfolio" scaffold with the right
 * shape (a portfolio/skills concept) but the wrong wiring: it fetched
 * generic `useLensData('experience', 'portfolio'|'skill'|'history', {
 * seed: [] })` lists with NO creation form anywhere on the page, and never
 * called any of the 5 real actions above. `useLensData`'s auto-seed only
 * fires in development (`lib/hooks/use-lens-data.ts:88`), so in production
 * those lists were permanently empty and every control was dead. This
 * component replaces that scaffold with a real single-portfolio-artifact
 * flow: explicit create, real skill/experience/education entry forms, and
 * genuine calls to endorse / analyze / generate_resume / compare_versions /
 * validate_claims via `useRunArtifact`.
 *
 * Peer endorsement + directory (closes the "true peer endorsement needs a
 * public-portfolio directory that doesn't exist" gap in
 * docs/lens-specs/experience-capability-map.md). This reuses the generic
 * cross-lens artifact visibility rule already implemented in server.js
 * (`_lensArtifactVisible` + the `lens.list`/`lens.get`/`lens.run` gates
 * around it, ~server.js:38743-39003): once a portfolio's `meta.visibility`
 * is `'published'`, ANY authenticated caller's `useLensData(..., { limit: 50 })`
 * fetch of the `experience`/`portfolio` list already includes it — no new
 * backend visibility plumbing was needed, only a real directory view and a
 * publish toggle on the frontend, plus a peer-only guard on the `endorse`
 * macro itself so visibility can't be mistaken for endorsement consent.
 */

import { useMemo, useState } from 'react';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { useAuth } from '@/hooks/useAuth';
import {
  Loader2, Plus, Trash2, Award, Sparkles, FileText, GitCompare,
  ShieldCheck, Briefcase, GraduationCap, Camera, CheckCircle2, XCircle,
  Globe, Lock, Users,
} from 'lucide-react';
import { Icon as SvgIcon } from '@/components/icons/Icon';
import { StickyDeleteConfirm } from '@/components/common/StickyDeleteConfirm';

const inputCls = 'w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-white focus:border-neon-cyan focus:outline-none';
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block space-y-1"><span className="text-[11px] text-gray-400">{label}</span>{children}</label>;
}

interface Skill { id: string; name: string; category: string; level: string; yearsExperience: number; evidence: string[]; }
interface ExperienceEntry { role: string; company: string; startDate: string; endDate: string; }
interface EducationEntry { institution: string; degree: string; field: string; year: string; }
interface Endorsement { id: string; skillId: string; endorserId: string; comment: string; endorsedAt: string; }
interface PortfolioData {
  skills: Skill[];
  experience: ExperienceEntry[];
  education: EducationEntry[];
  endorsements: Endorsement[];
  snapshots: { version: number; skills: Skill[]; savedAt: string }[];
}

const EMPTY_PORTFOLIO: PortfolioData = { skills: [], experience: [], education: [], endorsements: [], snapshots: [] };

export function CareerPortfolio() {
  const { user, isLoading: authLoading } = useAuth();
  const { items, isLoading, create, update, remove } = useLensData<PortfolioData>('experience', 'portfolio', { noSeed: true, limit: 50 });
  // Directory: a second, higher-limit fetch of the SAME domain/type. The
  // backend's non-social-domain visibility rule (server.js `lens.list`,
  // ~38836-38849) already returns the caller's own artifacts PLUS every
  // OTHER user's `meta.visibility === 'published'|'public'` artifact — so
  // this is a real query against real data the moment someone publishes,
  // not a fabricated list.
  const { items: directoryItems, isLoading: directoryLoading } = useLensData<PortfolioData>('experience', 'portfolio', { noSeed: true, limit: 50 });
  const runAction = useRunArtifact('experience');
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ kind: string; data: Record<string, unknown> } | null>(null);
  const [view, setView] = useState<'mine' | 'directory'>('mine');
  const [peerStatus, setPeerStatus] = useState<Record<string, 'ok' | 'error'>>({});
  const [armDeletePortfolio, setArmDeletePortfolio] = useState(false);
  // Row editing: which experience / education row is open in its form.
  const [editExp, setEditExp] = useState<number | null>(null);
  const [editEdu, setEditEdu] = useState<number | null>(null);

  // Skill draft. FIX-experience-004: skills gain the edit the
  // experience/education rows already had.
  const [editSkill, setEditSkill] = useState<string | null>(null);
  const [skillName, setSkillName] = useState('');
  const [skillCategory, setSkillCategory] = useState('technical');
  const [skillLevel, setSkillLevel] = useState('intermediate');
  const [skillYears, setSkillYears] = useState('1');
  const [skillEvidence, setSkillEvidence] = useState('');

  // Experience / education drafts
  const [role, setRole] = useState(''); const [company, setCompany] = useState('');
  const [startDate, setStartDate] = useState(''); const [endDate, setEndDate] = useState('');
  const [institution, setInstitution] = useState(''); const [degree, setDegree] = useState('');
  const [field, setField] = useState(''); const [year, setYear] = useState('');

  // My Portfolio is the caller's OWN artifact — selected by owner, never
  // items.at(0). The lens list serves own + published + ownerless artifacts
  // to any caller, so adopting the first row served one account another
  // account's record as its own, and wrote new contents into whichever
  // artifact happened to head the list (F1/F2). The directory fetch below
  // is the same list; peers are everything that is not this artifact.
  const portfolio = useMemo(
    () => items.find(p => !!user?.id && p.ownerId === user.id),
    [items, user]
  );
  const data: PortfolioData = useMemo(() => ({ ...EMPTY_PORTFOLIO, ...(portfolio?.data || {}) }), [portfolio]);

  const doCreate = async () => {
    setCreating(true);
    // FIX-experience-005: title the portfolio for its OWNER. The old
    // constant 'My Portfolio' is a first-person label — correct on the
    // owner's own tab, wrong on every peer's Directory, where the
    // entry then appeared to be the viewer's own unnamed portfolio.
    await create({ title: user?.username ? `${user.username}'s Portfolio` : 'My Portfolio', data: EMPTY_PORTFOLIO });
    setCreating(false);
  };

  const saveData = async (patch: Partial<PortfolioData>) => {
    if (!portfolio) return;
    await update(portfolio.id, { data: { ...data, ...patch } });
  };

  const clearSkillDraft = () => {
    setEditSkill(null);
    setSkillName(''); setSkillCategory('technical'); setSkillLevel('intermediate');
    setSkillYears('1'); setSkillEvidence('');
  };
  const startEditSkill = (s: Skill) => {
    setEditSkill(s.id);
    setSkillName(s.name); setSkillCategory(s.category); setSkillLevel(s.level);
    setSkillYears(String(s.yearsExperience));
    setSkillEvidence(s.evidence.join('\n'));
  };
  const addSkill = async () => {
    if (!skillName.trim()) return;
    const skill: Skill = {
      // An edit keeps the skill's id — endorsements key on it.
      id: editSkill ?? skillName.trim().toLowerCase().replace(/\s+/g, '-'),
      name: skillName.trim(), category: skillCategory, level: skillLevel,
      yearsExperience: Number(skillYears) || 0,
      evidence: skillEvidence.split('\n').map(s => s.trim()).filter(Boolean),
    };
    if (editSkill) {
      await saveData({ skills: data.skills.map(s => (s.id === editSkill ? skill : s)) });
    } else {
      await saveData({ skills: [...data.skills.filter(s => s.id !== skill.id), skill] });
    }
    clearSkillDraft();
  };
  const removeSkill = async (id: string) => saveData({ skills: data.skills.filter(s => s.id !== id) });

  const addExperience = async () => {
    if (!role.trim() || !company.trim()) return;
    const entry: ExperienceEntry = { role: role.trim(), company: company.trim(), startDate, endDate };
    if (editExp !== null) {
      await saveData({ experience: data.experience.map((e, i) => (i === editExp ? entry : e)) });
      setEditExp(null);
    } else {
      await saveData({ experience: [...data.experience, entry] });
    }
    setRole(''); setCompany(''); setStartDate(''); setEndDate('');
  };
  const startEditExperience = (i: number) => {
    const e = data.experience[i];
    if (!e) return;
    setEditExp(i);
    setRole(e.role); setCompany(e.company); setStartDate(e.startDate || ''); setEndDate(e.endDate || '');
  };
  const removeExperience = async (i: number) => {
    if (editExp === i) { setEditExp(null); setRole(''); setCompany(''); setStartDate(''); setEndDate(''); }
    await saveData({ experience: data.experience.filter((_, x) => x !== i) });
  };
  const addEducation = async () => {
    if (!institution.trim()) return;
    const entry: EducationEntry = { institution: institution.trim(), degree, field, year };
    if (editEdu !== null) {
      await saveData({ education: data.education.map((e, i) => (i === editEdu ? entry : e)) });
      setEditEdu(null);
    } else {
      await saveData({ education: [...data.education, entry] });
    }
    setInstitution(''); setDegree(''); setField(''); setYear('');
  };
  const startEditEducation = (i: number) => {
    const e = data.education[i];
    if (!e) return;
    setEditEdu(i);
    setInstitution(e.institution); setDegree(e.degree || ''); setField(e.field || ''); setYear(e.year || '');
  };
  const removeEducation = async (i: number) => {
    if (editEdu === i) { setEditEdu(null); setInstitution(''); setDegree(''); setField(''); setYear(''); }
    await saveData({ education: data.education.filter((_, x) => x !== i) });
  };

  const deletePortfolio = async () => {
    if (!portfolio) return;
    setBusy('delete-portfolio');
    await remove(portfolio.id);
    setArmDeletePortfolio(false);
    setBusy(null);
  };

  const exportPortfolioJson = () => {
    if (!portfolio) return;
    const payload = {
      exportedAt: new Date().toISOString(),
      title: portfolio.title,
      visibility: portfolio.meta?.visibility || 'private',
      data,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `experience-portfolio-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const saveSnapshot = async () => {
    if (!portfolio) return;
    setBusy('snapshot');
    await saveData({ snapshots: [...data.snapshots, { version: portfolio.version, skills: data.skills, savedAt: new Date().toISOString() }] });
    setBusy(null);
  };

  const callAction = async (action: string) => {
    if (!portfolio) return;
    setBusy(action);
    setResult(null);
    const res = await runAction.mutateAsync({ id: portfolio.id, action });
    if (res.ok !== false) setResult({ kind: action, data: res.result as Record<string, unknown> });
    setBusy(null);
  };

  const isPublished = portfolio?.meta?.visibility === 'published' || portfolio?.meta?.visibility === 'public';
  const togglePublish = async () => {
    if (!portfolio) return;
    setBusy('publish');
    await update(portfolio.id, { meta: { visibility: isPublished ? 'private' : 'published' } });
    setBusy(null);
  };

  // Other users' published portfolios only — the backend already excludes
  // private ones (see the header comment above), this just drops our own
  // entry from the list we endorse *others* from.
  // FIX-experience-005: while auth is still resolving, user.id is
  // unknown and this filter counts the viewer's OWN portfolio as a
  // peer (ownerId !== '') — the Directory tab flashed (2) during load
  // and settled to (1) once /api/auth/me landed. The count (and the
  // directory's loading state) therefore wait for auth + fetch to
  // settle; the filter itself is unchanged.
  const otherPortfolios = useMemo(
    () => directoryItems.filter(p => p.ownerId !== (user?.id || '') && p.id !== portfolio?.id),
    [directoryItems, user, portfolio]
  );

  // Genuine peer endorsement: acts on SOMEONE ELSE's portfolio id, distinct
  // from the legacy self-only `callAction('endorse', ...)` path this
  // component used to expose on the user's own skill rows (removed — the
  // server now rejects self-endorsement outright, see server.js's
  // `experience.endorse` guard).
  const endorsePeerSkill = async (portfolioId: string, skillId: string) => {
    const key = `${portfolioId}:${skillId}`;
    setBusy(`peer-endorse:${key}`);
    const res = await runAction.mutateAsync({ id: portfolioId, action: 'endorse', params: { skillId, comment: '' } });
    // `lens.run` double-wraps: the outer `res.ok` is only about macro
    // dispatch succeeding (artifact found + visible + handler invoked) —
    // a business-rule rejection from the handler itself (e.g. the
    // self-endorsement guard, or a since-unpublished portfolio) comes back
    // as `res.ok === true` with `res.result.ok === false`. Checking only
    // the outer flag would render a rejected endorsement as a fabricated
    // success.
    const inner = res?.result as { ok?: boolean } | undefined;
    const failed = res?.ok === false || inner?.ok === false;
    setPeerStatus(prev => ({ ...prev, [key]: failed ? 'error' : 'ok' }));
    setBusy(null);
  };

  if (isLoading) {
    return <div className="flex items-center gap-2 text-xs text-gray-400"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading portfolio…</div>;
  }

  return (
    <div className="space-y-4">
      {/* View tabs */}
      <div role="tablist" aria-label="Portfolio views" className="flex items-center gap-1 border-b border-zinc-800">
        <button role="tab" aria-selected={view === 'mine'} onClick={() => setView('mine')}
          className={`px-3 py-2 text-xs font-medium flex items-center gap-1.5 border-b-2 -mb-px transition-colors ${view === 'mine' ? 'text-white border-neon-cyan' : 'text-gray-400 border-transparent hover:text-gray-200'}`}>
          <Briefcase className="w-3.5 h-3.5" /> My Portfolio
        </button>
        <button role="tab" aria-selected={view === 'directory'} onClick={() => setView('directory')}
          className={`px-3 py-2 text-xs font-medium flex items-center gap-1.5 border-b-2 -mb-px transition-colors ${view === 'directory' ? 'text-white border-neon-cyan' : 'text-gray-400 border-transparent hover:text-gray-200'}`}>
          <Users className="w-3.5 h-3.5" /> Directory{!authLoading && !directoryLoading && otherPortfolios.length > 0 ? ` (${otherPortfolios.length})` : ''}
        </button>
      </div>

      {view === 'mine' && !portfolio && (
        <div className="rounded-lg border border-dashed border-zinc-700 bg-zinc-900/40 p-6 text-center space-y-2">
          <SvgIcon name="credential-badge" size={56} className="mx-auto text-neon-cyan/70" />
          <p className="text-sm text-white">Build a verifiable portfolio</p>
          <p className="text-xs text-gray-400 max-w-sm mx-auto">Skills, experience, and education — endorsed by others and validated against real evidence, not a resume you just typed once.</p>
          <button onClick={doCreate} disabled={creating} className="btn-neon cyan text-xs inline-flex items-center gap-1 disabled:opacity-40">
            {creating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Create my portfolio
          </button>
        </div>
      )}

      {view === 'mine' && portfolio && (
        <div className="space-y-5">
          {/* Publish toggle — governs whether this portfolio is reachable via
              the Directory tab (below) on every OTHER user's session, per the
              server's existing published/public visibility rule. */}
          <div className="flex items-center justify-between gap-2 bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-2">
            <div className="flex items-center gap-2 text-xs">
              {isPublished ? <Globe className="w-3.5 h-3.5 text-neon-green" /> : <Lock className="w-3.5 h-3.5 text-gray-400" />}
              <span className={isPublished ? 'text-neon-green' : 'text-gray-400'}>
                {isPublished ? 'Published — visible to peers in the Directory' : 'Private — only you can see this'}
              </span>
            </div>
            <button onClick={togglePublish} disabled={busy === 'publish'} className="btn-neon text-xs flex items-center gap-1 disabled:opacity-40">
              {busy === 'publish' ? <Loader2 className="w-3 h-3 animate-spin" /> : isPublished ? <Lock className="w-3 h-3" /> : <Globe className="w-3 h-3" />}
              {isPublished ? 'Unpublish' : 'Publish my portfolio'}
            </button>
          </div>

          {/* Action bar */}
          <div className="flex flex-wrap gap-2">
            <button onClick={() => callAction('analyze')} disabled={!!busy || data.skills.length === 0} className="btn-neon purple text-xs flex items-center gap-1 disabled:opacity-40">
              {busy === 'analyze' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} Analyze skills
            </button>
            <button onClick={() => callAction('generate_resume')} disabled={!!busy} className="btn-neon text-xs flex items-center gap-1 disabled:opacity-40">
              {busy === 'generate_resume' ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />} Generate resume
            </button>
            <button onClick={saveSnapshot} disabled={!!busy} className="btn-neon text-xs flex items-center gap-1 disabled:opacity-40">
              {busy === 'snapshot' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Camera className="w-3 h-3" />} Save snapshot
            </button>
            <button onClick={() => callAction('compare_versions')} disabled={!!busy} className="btn-neon text-xs flex items-center gap-1 disabled:opacity-40">
              {busy === 'compare_versions' ? <Loader2 className="w-3 h-3 animate-spin" /> : <GitCompare className="w-3 h-3" />} Compare vs. last snapshot
            </button>
            <button onClick={() => callAction('validate_claims')} disabled={!!busy || data.skills.length === 0} className="btn-neon text-xs flex items-center gap-1 disabled:opacity-40">
              {busy === 'validate_claims' ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />} Validate claims
            </button>
            <button onClick={exportPortfolioJson} disabled={!!busy} className="btn-neon text-xs flex items-center gap-1 disabled:opacity-40">
              <FileText className="w-3 h-3" /> Export portfolio (JSON)
            </button>
            {!armDeletePortfolio ? (
              <button onClick={() => setArmDeletePortfolio(true)} disabled={!!busy} className="btn-neon text-xs flex items-center gap-1 text-red-300 disabled:opacity-40">
                <Trash2 className="w-3 h-3" /> Delete portfolio
              </button>
            ) : (
              <>
                <button onClick={deletePortfolio} disabled={!!busy} className="btn-neon text-xs flex items-center gap-1 bg-red-500/20 text-red-200 disabled:opacity-40">
                  {busy === 'delete-portfolio' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />} Delete this portfolio and its contents? Click again to confirm
                </button>
                <button onClick={() => setArmDeletePortfolio(false)} className="btn-neon text-xs">Keep</button>
              </>
            )}
          </div>
          {data.snapshots.length === 0 && <p className="text-[10px] text-gray-400">Compare needs at least one saved snapshot — save one before making further changes to see a real diff.</p>}

          {result && <ActionResult kind={result.kind} data={result.data} />}

          {/* Skills */}
          <section className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400 flex items-center gap-1.5"><Award className="w-3.5 h-3.5" /> Skills</h2>
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3 grid grid-cols-1 sm:grid-cols-5 gap-2">
              <Field label="Skill"><input className={inputCls} value={skillName} onChange={e => setSkillName(e.target.value)} placeholder="Mixing" /></Field>
              <Field label="Category">
                <select className={inputCls} value={skillCategory} onChange={e => setSkillCategory(e.target.value)}>
                  {['technical', 'creative', 'business'].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Level">
                <select className={inputCls} value={skillLevel} onChange={e => setSkillLevel(e.target.value)}>
                  {['beginner', 'intermediate', 'advanced', 'expert'].map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </Field>
              <Field label="Years"><input type="number" min={0} className={inputCls} value={skillYears} onChange={e => setSkillYears(e.target.value)} /></Field>
              <Field label="Evidence links (one per line)"><input className={inputCls} value={skillEvidence} onChange={e => setSkillEvidence(e.target.value)} placeholder="https://..." /></Field>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={addSkill} disabled={!skillName.trim()} className="btn-neon cyan text-xs flex items-center gap-1 disabled:opacity-40"><Plus className="w-3 h-3" /> {editSkill ? 'Save changes' : 'Add skill'}</button>
              {editSkill && <button onClick={clearSkillDraft} className="btn-neon text-xs">Cancel edit</button>}
            </div>

            <div className="space-y-1.5">
              {data.skills.map(s => {
                const endorseCount = data.endorsements.filter(e => e.skillId === s.id).length;
                return (
                  <div key={s.id} className="bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 flex items-center justify-between gap-2">
                    <div>
                      <p className="text-xs text-white">{s.name} <span className="text-[10px] text-gray-400">· {s.category} · {s.level} · {s.yearsExperience}y</span></p>
                      <p className="text-[10px] text-gray-400">{s.evidence.length} evidence link{s.evidence.length === 1 ? '' : 's'} · {endorseCount} endorsement{endorseCount === 1 ? '' : 's'} <span className="text-gray-600">(peer-only — publish above so others can endorse you)</span></p>
                    </div>
                    <span className="flex items-center gap-2 shrink-0">
                      <button onClick={() => startEditSkill(s)} className="text-gray-400 hover:text-white" aria-label={`edit skill ${s.name}`}>Edit</button>
                      <StickyDeleteConfirm
                        onConfirm={() => removeSkill(s.id)}
                        armLabel={<Trash2 className="w-3.5 h-3.5" />}
                        confirmLabel="Remove skill?"
                        armAriaLabel="remove skill"
                        confirmAriaLabel={`Confirm remove skill ${s.name}`}
                        cancelAriaLabel="Cancel remove skill"
                        className="text-gray-400 hover:text-red-400"
                      />
                    </span>
                  </div>
                );
              })}
              {data.skills.length === 0 && <p className="text-xs text-gray-400">No skills yet — add one above.</p>}
            </div>
          </section>

          {/* Experience + Education side by side */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <section className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400 flex items-center gap-1.5"><Briefcase className="w-3.5 h-3.5" /> Experience</h2>
              <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Role"><input className={inputCls} value={role} onChange={e => setRole(e.target.value)} /></Field>
                  <Field label="Company"><input className={inputCls} value={company} onChange={e => setCompany(e.target.value)} /></Field>
                  <Field label="Start"><input className={inputCls} value={startDate} onChange={e => setStartDate(e.target.value)} placeholder="2023-01" /></Field>
                  <Field label="End (blank = current)"><input className={inputCls} value={endDate} onChange={e => setEndDate(e.target.value)} placeholder="2024-06" /></Field>
                </div>
                <button onClick={addExperience} disabled={!role.trim() || !company.trim()} className="btn-neon text-xs flex items-center gap-1 disabled:opacity-40"><Plus className="w-3 h-3" /> {editExp !== null ? 'Save changes' : 'Add'}</button>
                {editExp !== null && <button onClick={() => { setEditExp(null); setRole(''); setCompany(''); setStartDate(''); setEndDate(''); }} className="btn-neon text-xs ml-2">Cancel edit</button>}
              </div>
              <div className="space-y-1">
                {data.experience.map((e, i) => (
                  <div key={i} className="bg-zinc-900 border border-zinc-800 rounded p-2 text-xs text-white flex items-center justify-between gap-2">
                    <span>{e.role} · {e.company} <span className="text-[10px] text-gray-400">({e.startDate || '?'} – {e.endDate || 'present'})</span></span>
                    <span className="flex items-center gap-2 shrink-0">
                      <button onClick={() => startEditExperience(i)} className="text-gray-400 hover:text-white" aria-label={`edit experience ${e.role}`}>Edit</button>
                      <button onClick={() => removeExperience(i)} className="text-gray-400 hover:text-red-400" aria-label={`delete experience ${e.role}`}><Trash2 className="w-3.5 h-3.5" /></button>
                    </span>
                  </div>
                ))}
                {data.experience.length === 0 && <p className="text-xs text-gray-400">No experience entries yet.</p>}
              </div>
            </section>

            <section className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400 flex items-center gap-1.5"><GraduationCap className="w-3.5 h-3.5" /> Education</h2>
              <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Institution"><input className={inputCls} value={institution} onChange={e => setInstitution(e.target.value)} /></Field>
                  <Field label="Degree"><input className={inputCls} value={degree} onChange={e => setDegree(e.target.value)} /></Field>
                  <Field label="Field"><input className={inputCls} value={field} onChange={e => setField(e.target.value)} /></Field>
                  <Field label="Year"><input className={inputCls} value={year} onChange={e => setYear(e.target.value)} /></Field>
                </div>
                <button onClick={addEducation} disabled={!institution.trim()} className="btn-neon text-xs flex items-center gap-1 disabled:opacity-40"><Plus className="w-3 h-3" /> {editEdu !== null ? 'Save changes' : 'Add'}</button>
                {editEdu !== null && <button onClick={() => { setEditEdu(null); setInstitution(''); setDegree(''); setField(''); setYear(''); }} className="btn-neon text-xs ml-2">Cancel edit</button>}
              </div>
              <div className="space-y-1">
                {data.education.map((e, i) => (
                  <div key={i} className="bg-zinc-900 border border-zinc-800 rounded p-2 text-xs text-white flex items-center justify-between gap-2">
                    <span>{e.degree} {e.field ? `in ${e.field}` : ''} · {e.institution} <span className="text-[10px] text-gray-400">{e.year}</span></span>
                    <span className="flex items-center gap-2 shrink-0">
                      <button onClick={() => startEditEducation(i)} className="text-gray-400 hover:text-white" aria-label={`edit education ${e.institution}`}>Edit</button>
                      <button onClick={() => removeEducation(i)} className="text-gray-400 hover:text-red-400" aria-label={`delete education ${e.institution}`}><Trash2 className="w-3.5 h-3.5" /></button>
                    </span>
                  </div>
                ))}
                {data.education.length === 0 && <p className="text-xs text-gray-400">No education entries yet.</p>}
              </div>
            </section>
          </div>
        </div>
      )}

      {view === 'directory' && (
        <PeerDirectory
          items={otherPortfolios}
          isLoading={directoryLoading || authLoading}
          busy={busy}
          peerStatus={peerStatus}
          onEndorse={endorsePeerSkill}
        />
      )}
    </div>
  );
}

function PeerDirectory({ items, isLoading, busy, peerStatus, onEndorse }: {
  items: { id: string; ownerId?: string; title: string; data: PortfolioData }[];
  isLoading: boolean;
  busy: string | null;
  peerStatus: Record<string, 'ok' | 'error'>;
  onEndorse: (portfolioId: string, skillId: string) => void;
}) {
  if (isLoading) {
    return <div className="flex items-center gap-2 text-xs text-gray-400"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading directory…</div>;
  }
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-700 bg-zinc-900/40 p-6 text-center space-y-1">
        <Users className="w-6 h-6 mx-auto text-gray-400" />
        <p className="text-sm text-white">No published portfolios yet</p>
        <p className="text-xs text-gray-400 max-w-sm mx-auto">When another user publishes their portfolio, it shows up here — real endorsements only happen peer to peer.</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {items.map(p => {
        const skills = p.data?.skills || [];
        const endorsements = p.data?.endorsements || [];
        return (
          <div key={p.id} className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3 space-y-2">
            {/* FIX-experience-005: a legacy portfolio still titled with
                the generic creation default names nobody — and reads as
                the VIEWER's own portfolio. Say whose it is honestly:
                a peer's. (New portfolios are titled for their owner at
                creation, so their real title renders above.) */}
            <p className="text-xs font-semibold text-white flex items-center gap-1.5"><Briefcase className="w-3.5 h-3.5 text-gray-400" /> {p.title && p.title !== 'My Portfolio' ? p.title : "A peer's portfolio"}</p>
            <div className="space-y-1">
              {skills.map(s => {
                const key = `${p.id}:${s.id}`;
                const endorseCount = endorsements.filter(e => e.skillId === s.id).length;
                const status = peerStatus[key];
                return (
                  <div key={s.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-gray-300">{s.name} <span className="text-[10px] text-gray-400">· {s.category} · {s.level} · {endorseCount} endorsement{endorseCount === 1 ? '' : 's'}</span></span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {status === 'ok' && <CheckCircle2 className="w-3.5 h-3.5 text-neon-green" aria-label="endorsed" />}
                      {status === 'error' && <span className="text-[10px] text-red-400">already endorsed</span>}
                      <button
                        onClick={() => onEndorse(p.id, s.id)}
                        disabled={busy === `peer-endorse:${key}` || status === 'ok'}
                        className="text-[10px] px-2 py-1 rounded bg-neon-green/15 text-neon-green hover:bg-neon-green/25 flex items-center gap-1 disabled:opacity-40"
                      >
                        {busy === `peer-endorse:${key}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Award className="w-3 h-3" />} Endorse
                      </button>
                    </div>
                  </div>
                );
              })}
              {skills.length === 0 && <p className="text-[11px] text-gray-400">No skills listed yet.</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ActionResult({ kind, data }: { kind: string; data: Record<string, unknown> }) {
  if (kind === 'analyze') {
    const analysis = data.analysis as { skillCount: number; topSkills: { skill: string; strength: number; endorsements: number; evidenceCount: number }[]; categories: Record<string, number>; totalEndorsements: number } | undefined;
    if (!analysis) return null;
    return (
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3 space-y-2">
        <p className="text-xs font-semibold text-white">Skill analysis — {analysis.skillCount} skills, {analysis.totalEndorsements} total endorsements</p>
        <div className="space-y-1">
          {analysis.topSkills.map(s => (
            <div key={s.skill} className="flex items-center gap-2 text-[11px]">
              <span className="text-gray-300 w-28 truncate">{s.skill}</span>
              <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden"><div className="h-full bg-neon-purple" style={{ width: `${s.strength * 100}%` }} /></div>
              <span className="text-gray-400 w-24 text-right">strength {Math.round(s.strength * 100)}%</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (kind === 'generate_resume') {
    const resume = data.resume as { sections: { summary: Record<string, unknown>; skills: unknown[]; experience: unknown[]; education: unknown[] } } | undefined;
    if (!resume) return null;
    return (
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3 space-y-1">
        <p className="text-xs font-semibold text-white flex items-center gap-1"><FileText className="w-3.5 h-3.5" /> Resume generated ({resume.sections.skills.length} skills, {resume.sections.experience.length} roles, {resume.sections.education.length} degrees)</p>
        <pre className="text-[10px] text-gray-400 bg-black/30 rounded p-2 overflow-x-auto max-h-48">{JSON.stringify(resume.sections, null, 2)}</pre>
      </div>
    );
  }
  if (kind === 'compare_versions') {
    const comparison = data.comparison as { note?: string; added?: string[]; removed?: string[]; retained?: number; growthRate?: number | null } | undefined;
    if (!comparison) return null;
    if (comparison.note === 'no_previous_versions') return <p className="text-xs text-gray-400">No snapshot to compare against yet — save one first.</p>;
    return (
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3 space-y-1 text-[11px]">
        <p className="text-neon-green">+{comparison.added?.length || 0} added: {comparison.added?.join(', ') || '—'}</p>
        <p className="text-red-400">−{comparison.removed?.length || 0} removed: {comparison.removed?.join(', ') || '—'}</p>
        <p className="text-gray-400">{comparison.retained} retained · {comparison.growthRate === null ? '—' : `${comparison.growthRate}%`} growth</p>
      </div>
    );
  }
  if (kind === 'validate_claims') {
    const validated = data.validated as { skill: string; hasEvidence: boolean; validated: boolean }[] | undefined;
    if (!validated) return null;
    return (
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3 space-y-1">
        <p className="text-xs font-semibold text-white">{data.validCount as number}/{validated.length} skills have supporting evidence</p>
        {validated.map(v => (
          <p key={v.skill} className="text-[11px] flex items-center gap-1.5">
            {v.validated ? <CheckCircle2 className="w-3 h-3 text-neon-green" /> : <XCircle className="w-3 h-3 text-red-400" />}
            <span className="text-gray-300">{v.skill}</span>
          </p>
        ))}
      </div>
    );
  }
  return null;
}
