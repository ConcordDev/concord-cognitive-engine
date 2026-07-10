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
 */

import { useMemo, useState } from 'react';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import {
  Loader2, Plus, Trash2, Award, Sparkles, FileText, GitCompare,
  ShieldCheck, Briefcase, GraduationCap, Camera, CheckCircle2, XCircle,
} from 'lucide-react';

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
  const { items, isLoading, create, update } = useLensData<PortfolioData>('experience', 'portfolio', { noSeed: true, limit: 1 });
  const runAction = useRunArtifact('experience');
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ kind: string; data: Record<string, unknown> } | null>(null);

  // Skill draft
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

  const portfolio = items[0];
  const data: PortfolioData = useMemo(() => ({ ...EMPTY_PORTFOLIO, ...(portfolio?.data || {}) }), [portfolio]);

  const doCreate = async () => {
    setCreating(true);
    await create({ title: 'My Portfolio', data: EMPTY_PORTFOLIO });
    setCreating(false);
  };

  const saveData = async (patch: Partial<PortfolioData>) => {
    if (!portfolio) return;
    await update(portfolio.id, { data: { ...data, ...patch } });
  };

  const addSkill = async () => {
    if (!skillName.trim()) return;
    const skill: Skill = {
      id: skillName.trim().toLowerCase().replace(/\s+/g, '-'),
      name: skillName.trim(), category: skillCategory, level: skillLevel,
      yearsExperience: Number(skillYears) || 0,
      evidence: skillEvidence.split('\n').map(s => s.trim()).filter(Boolean),
    };
    await saveData({ skills: [...data.skills.filter(s => s.id !== skill.id), skill] });
    setSkillName(''); setSkillEvidence(''); setSkillYears('1');
  };
  const removeSkill = async (id: string) => saveData({ skills: data.skills.filter(s => s.id !== id) });

  const addExperience = async () => {
    if (!role.trim() || !company.trim()) return;
    await saveData({ experience: [...data.experience, { role: role.trim(), company: company.trim(), startDate, endDate }] });
    setRole(''); setCompany(''); setStartDate(''); setEndDate('');
  };
  const addEducation = async () => {
    if (!institution.trim()) return;
    await saveData({ education: [...data.education, { institution: institution.trim(), degree, field, year }] });
    setInstitution(''); setDegree(''); setField(''); setYear('');
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

  const endorseSkill = async (skillId: string) => {
    setBusy(`endorse:${skillId}`);
    if (portfolio) await runAction.mutateAsync({ id: portfolio.id, action: 'endorse', params: { skillId, comment: '' } });
    setBusy(null);
  };

  if (isLoading) {
    return <div className="flex items-center gap-2 text-xs text-gray-400"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading portfolio…</div>;
  }

  if (!portfolio) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-700 bg-zinc-900/40 p-6 text-center space-y-2">
        <Briefcase className="w-6 h-6 mx-auto text-gray-500" />
        <p className="text-sm text-white">Build a verifiable portfolio</p>
        <p className="text-xs text-gray-400 max-w-sm mx-auto">Skills, experience, and education — endorsed by others and validated against real evidence, not a resume you just typed once.</p>
        <button onClick={doCreate} disabled={creating} className="btn-neon cyan text-xs inline-flex items-center gap-1 disabled:opacity-40">
          {creating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Create my portfolio
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
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
      </div>
      {data.snapshots.length === 0 && <p className="text-[10px] text-gray-500">Compare needs at least one saved snapshot — save one before making further changes to see a real diff.</p>}

      {result && <ActionResult kind={result.kind} data={result.data} />}

      {/* Skills */}
      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 flex items-center gap-1.5"><Award className="w-3.5 h-3.5" /> Skills</h3>
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
        <button onClick={addSkill} disabled={!skillName.trim()} className="btn-neon cyan text-xs flex items-center gap-1 disabled:opacity-40"><Plus className="w-3 h-3" /> Add skill</button>

        <div className="space-y-1.5">
          {data.skills.map(s => {
            const endorseCount = data.endorsements.filter(e => e.skillId === s.id).length;
            return (
              <div key={s.id} className="bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs text-white">{s.name} <span className="text-[10px] text-gray-400">· {s.category} · {s.level} · {s.yearsExperience}y</span></p>
                  <p className="text-[10px] text-gray-400">{s.evidence.length} evidence link{s.evidence.length === 1 ? '' : 's'} · {endorseCount} endorsement{endorseCount === 1 ? '' : 's'}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => endorseSkill(s.id)} disabled={busy === `endorse:${s.id}`} className="text-[10px] px-2 py-1 rounded bg-neon-green/15 text-neon-green hover:bg-neon-green/25 flex items-center gap-1">
                    {busy === `endorse:${s.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Award className="w-3 h-3" />} Endorse
                  </button>
                  <button onClick={() => removeSkill(s.id)} className="text-gray-500 hover:text-red-400" aria-label="remove skill"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            );
          })}
          {data.skills.length === 0 && <p className="text-xs text-gray-400">No skills yet — add one above.</p>}
        </div>
      </section>

      {/* Experience + Education side by side */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 flex items-center gap-1.5"><Briefcase className="w-3.5 h-3.5" /> Experience</h3>
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Role"><input className={inputCls} value={role} onChange={e => setRole(e.target.value)} /></Field>
              <Field label="Company"><input className={inputCls} value={company} onChange={e => setCompany(e.target.value)} /></Field>
              <Field label="Start"><input className={inputCls} value={startDate} onChange={e => setStartDate(e.target.value)} placeholder="2023-01" /></Field>
              <Field label="End (blank = current)"><input className={inputCls} value={endDate} onChange={e => setEndDate(e.target.value)} placeholder="2024-06" /></Field>
            </div>
            <button onClick={addExperience} disabled={!role.trim() || !company.trim()} className="btn-neon text-xs flex items-center gap-1 disabled:opacity-40"><Plus className="w-3 h-3" /> Add</button>
          </div>
          <div className="space-y-1">
            {data.experience.map((e, i) => (
              <div key={i} className="bg-zinc-900 border border-zinc-800 rounded p-2 text-xs text-white">{e.role} · {e.company} <span className="text-[10px] text-gray-400">({e.startDate || '?'} – {e.endDate || 'present'})</span></div>
            ))}
            {data.experience.length === 0 && <p className="text-xs text-gray-400">No experience entries yet.</p>}
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 flex items-center gap-1.5"><GraduationCap className="w-3.5 h-3.5" /> Education</h3>
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Institution"><input className={inputCls} value={institution} onChange={e => setInstitution(e.target.value)} /></Field>
              <Field label="Degree"><input className={inputCls} value={degree} onChange={e => setDegree(e.target.value)} /></Field>
              <Field label="Field"><input className={inputCls} value={field} onChange={e => setField(e.target.value)} /></Field>
              <Field label="Year"><input className={inputCls} value={year} onChange={e => setYear(e.target.value)} /></Field>
            </div>
            <button onClick={addEducation} disabled={!institution.trim()} className="btn-neon text-xs flex items-center gap-1 disabled:opacity-40"><Plus className="w-3 h-3" /> Add</button>
          </div>
          <div className="space-y-1">
            {data.education.map((e, i) => (
              <div key={i} className="bg-zinc-900 border border-zinc-800 rounded p-2 text-xs text-white">{e.degree} {e.field ? `in ${e.field}` : ''} · {e.institution} <span className="text-[10px] text-gray-400">{e.year}</span></div>
            ))}
            {data.education.length === 0 && <p className="text-xs text-gray-400">No education entries yet.</p>}
          </div>
        </section>
      </div>
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
