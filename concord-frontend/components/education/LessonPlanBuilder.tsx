'use client';

import { useState } from 'react';
import { BookOpen, Loader2, Sparkles, Download, Copy, Check, FileText } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface LessonPlan {
  title: string;
  subject: string;
  grade: string;
  duration: string;
  standards?: string[];
  objectives: string[];
  materials: string[];
  warmUp: string;
  mainActivity: string;
  practice: string;
  closure: string;
  differentiation?: {
    struggling: string;
    grade_level: string;
    advanced: string;
  };
  assessment: string;
}

export function LessonPlanBuilder() {
  const [subject, setSubject] = useState('Algebra I');
  const [grade, setGrade] = useState('8th');
  const [duration, setDuration] = useState('45 min');
  const [topic, setTopic] = useState('Solving linear equations with one variable');
  const [standard, setStandard] = useState('CCSS.MATH.CONTENT.8.EE.C.7');
  const [generating, setGenerating] = useState(false);
  const [plan, setPlan] = useState<LessonPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function generate() {
    if (!topic.trim()) { setError('Topic is required.'); return; }
    setError(null); setGenerating(true); setPlan(null);
    try {
      const res = await lensRun({
        domain: 'education',
        action: 'lesson-plan-generate',
        input: { subject, grade, duration, topic, standard },
      });
      setPlan(res.data?.result?.plan as LessonPlan || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'generate failed');
    } finally { setGenerating(false); }
  }

  function exportText() {
    if (!plan) return '';
    return `# ${plan.title}
Subject: ${plan.subject} · Grade ${plan.grade} · ${plan.duration}
${plan.standards?.length ? `Standards: ${plan.standards.join(', ')}` : ''}

## Objectives
${plan.objectives.map(o => `- ${o}`).join('\n')}

## Materials
${plan.materials.map(m => `- ${m}`).join('\n')}

## Warm-up
${plan.warmUp}

## Main activity
${plan.mainActivity}

## Practice
${plan.practice}

## Closure
${plan.closure}

${plan.differentiation ? `## Differentiation
- Struggling: ${plan.differentiation.struggling}
- On grade: ${plan.differentiation.grade_level}
- Advanced: ${plan.differentiation.advanced}` : ''}

## Assessment
${plan.assessment}
`;
  }

  function copy() {
    navigator.clipboard?.writeText(exportText());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function download() {
    const blob = new Blob([exportText()], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${(plan?.title || 'lesson-plan').replace(/\s+/g, '-')}.md`;
    a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <BookOpen className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Lesson plan builder</span>
        <span className="ml-auto text-[10px] text-gray-400">Save teachers 5+ hrs/week</span>
      </header>

      <div className="p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3 text-xs">
          <Field label="Subject">
            <input value={subject} onChange={e => setSubject(e.target.value)} className="w-full px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white" />
          </Field>
          <Field label="Grade">
            <input value={grade} onChange={e => setGrade(e.target.value)} className="w-full px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white" />
          </Field>
          <Field label="Duration">
            <input value={duration} onChange={e => setDuration(e.target.value)} className="w-full px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white" />
          </Field>
          <Field label="Standard (optional)">
            <input value={standard} onChange={e => setStandard(e.target.value)} className="w-full px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white" />
          </Field>
        </div>
        <Field label="Topic">
          <textarea
            value={topic}
            onChange={e => setTopic(e.target.value)}
            rows={2}
            className="w-full px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white resize-y"
          />
        </Field>
        <button
          onClick={generate}
          disabled={generating}
          className="inline-flex items-center gap-2 px-4 py-2 rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-50"
        >
          {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          Generate plan
        </button>
        {error && <div className="text-xs text-red-400">{error}</div>}

        {plan && (
          <div className="space-y-3 pt-3 border-t border-white/10">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-white">{plan.title}</h3>
              <button onClick={copy} title="Copy" className="ml-auto inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded border border-white/10 text-gray-300 hover:text-white">
                {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                {copied ? 'Copied' : 'Copy MD'}
              </button>
              <button onClick={download} title="Download" className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded border border-white/10 text-gray-300 hover:text-white">
                <Download className="w-3 h-3" /> .md
              </button>
            </div>
            <div className="text-[10px] text-gray-400">{plan.subject} · Grade {plan.grade} · {plan.duration}</div>

            <Section title="Objectives" items={plan.objectives} accent="text-green-300" />
            <Section title="Materials" items={plan.materials} accent="text-cyan-300" />
            <Block title="Warm-up" body={plan.warmUp} />
            <Block title="Main activity" body={plan.mainActivity} />
            <Block title="Practice" body={plan.practice} />
            <Block title="Closure" body={plan.closure} />
            {plan.differentiation && (
              <div className="space-y-1">
                <h4 className="text-xs font-bold text-yellow-300">Differentiation</h4>
                <ul className="text-xs space-y-1 ml-4">
                  <li><span className="text-gray-400">Struggling:</span> <span className="text-gray-200">{plan.differentiation.struggling}</span></li>
                  <li><span className="text-gray-400">On grade:</span> <span className="text-gray-200">{plan.differentiation.grade_level}</span></li>
                  <li><span className="text-gray-400">Advanced:</span> <span className="text-gray-200">{plan.differentiation.advanced}</span></li>
                </ul>
              </div>
            )}
            <Block title="Assessment" body={plan.assessment} />
            <p className="text-[10px] text-gray-400 inline-flex items-center gap-1">
              <FileText className="w-3 h-3" /> Saved as DTU — sellable on the marketplace, royalties on every fork
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-gray-400 block mb-0.5">{label}</span>
      {children}
    </label>
  );
}

function Section({ title, items, accent }: { title: string; items: string[]; accent: string }) {
  return (
    <div>
      <h4 className={cn('text-xs font-bold mb-1', accent)}>{title}</h4>
      <ul className="ml-4 list-disc space-y-0.5 text-xs text-gray-200">
        {items.map((it, i) => <li key={i}>{it}</li>)}
      </ul>
    </div>
  );
}

function Block({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h4 className="text-xs font-bold text-purple-300 mb-1">{title}</h4>
      <p className="text-xs text-gray-200 whitespace-pre-wrap">{body}</p>
    </div>
  );
}

export default LessonPlanBuilder;
