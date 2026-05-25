'use client';

/**
 * EducationActionPanel — teacher + student bench.
 * gradeCalculation / progressTrack / lesson-plan-generate (LLM) /
 * quiz-from-text (LLM) + mint/DM/publish/agent.
 */

import { useState } from 'react';
import { GraduationCap, TrendingUp, BookOpen, ListChecks, Sparkles, Send, Globe, Wand2, Loader2, Check, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, apiHelpers, lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('education', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'grade' | 'prog' | 'lesson' | 'quiz' | 'mint' | 'dm' | 'publish' | 'agent';
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface GradeBreak { category?: string; weight: number; earned: number; outOf: number; percent: number }
interface GradeResult { studentName?: string; finalPercent: number; letterGrade: string; breakdown: GradeBreak[]; passing: boolean; gpa?: number }
interface ProgPoint { date?: string; score: number }
interface ProgResult { studentName?: string; scores: ProgPoint[]; average: number; trend: string; improvement: number; mastery: string; recommendation: string }
interface LessonResult { topic: string; gradeLevel: string; objectives?: string[]; activities?: string[]; assessment?: string; materials?: string[]; differentiation?: string }
interface QuizQ { question: string; options?: string[]; answer?: string; explanation?: string }
interface QuizResult { questions: QuizQ[]; topic: string }

// No seeded examples — paste real grades / progress JSON or type the
// topic + source-text for lesson and quiz generation.
export function EducationActionPanel() {
  const [gradesText, setGradesText] = useState('');
  const [progText, setProgText] = useState('');
  const [lessonTopic, setLessonTopic] = useState('');
  const [lessonGrade, setLessonGrade] = useState('');
  const [quizText, setQuizText] = useState('');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [gradeResult, setGradeResult] = useState<GradeResult | null>(null);
  const [progResult, setProgResult] = useState<ProgResult | null>(null);
  const [lessonResult, setLessonResult] = useState<LessonResult | null>(null);
  const [quizResult, setQuizResult] = useState<QuizResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok = (m: string) => setFeedback({ kind: 'ok', text: m });
  const err = (m: string) => setFeedback({ kind: 'err', text: m });

  function parseJSON<T>(text: string): T | null { try { return JSON.parse(text) as T; } catch { return null; } }

  const pipe = usePipe();
  const dmRecall = useRecallableAction({ label: 'DM', windowMs: 60_000, onUndo: async (id) => { await api.delete(`/api/social/dm/${encodeURIComponent(id)}`); } });
  const publishRecall = useRecallableAction({ label: 'publish', windowMs: 30_000, onUndo: async (id) => { await api.delete(`/api/dtus/${encodeURIComponent(id)}/publish`); setPublishedDtuId(null); } });

  async function actGrade() {
    if (!gradesText.trim()) { err('Paste grades JSON first.'); return; }
    const parsed = parseJSON<Record<string, unknown>>(gradesText); if (!parsed) { err('Invalid grades JSON.'); return; }
    setBusy('grade'); setFeedback(null);
    try {
      const r = await callMacro<GradeResult>('gradeCalculation', { artifact: { data: parsed } });
      if (r.ok && r.result) { setGradeResult(r.result); pipe.publish('education.grade', r.result, { label: `${r.result.letterGrade} (${r.result.finalPercent}%)` }); ok(`${r.result.letterGrade} (${r.result.finalPercent}%).`); } else err(r.error ?? 'grade failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actProg() {
    if (!progText.trim()) { err('Paste progress JSON first.'); return; }
    const parsed = parseJSON<Record<string, unknown>>(progText); if (!parsed) { err('Invalid progress JSON.'); return; }
    setBusy('prog'); setFeedback(null);
    try {
      const r = await callMacro<ProgResult>('progressTrack', { artifact: { data: parsed } });
      if (r.ok && r.result) { setProgResult(r.result); pipe.publish('education.prog', r.result, { label: `Progress ${r.result.trend}` }); ok(`${r.result.trend} · ${r.result.mastery}.`); } else err(r.error ?? 'prog failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actLesson() {
    if (!lessonTopic.trim() || !lessonGrade.trim()) { err('Topic + grade level required.'); return; }
    setBusy('lesson'); setFeedback(null);
    try {
      const r = await callMacro<LessonResult>('lesson-plan-generate', { topic: lessonTopic.trim(), gradeLevel: lessonGrade, duration: 45 });
      if (r.ok && r.result) { setLessonResult(r.result); pipe.publish('education.lesson', r.result, { label: `Lesson: ${r.result.topic}` }); ok(`Lesson on ${r.result.topic}.`); } else err(r.error ?? 'lesson failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actQuiz() {
    if (!quizText.trim()) { err('Source text required.'); return; }
    setBusy('quiz'); setFeedback(null);
    try {
      const r = await callMacro<QuizResult>('quiz-from-text', { text: quizText.trim(), topic: lessonTopic, count: 5 });
      if (r.ok && r.result) { setQuizResult(r.result); pipe.publish('education.quiz', r.result, { label: `Quiz: ${r.result.topic} (${r.result.questions.length}q)` }); ok(`${r.result.questions.length} questions.`); } else err(r.error ?? 'quiz failed');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await lensRun({ domain: 'dtu', name: 'create', input: { title: `Class — ${lessonTopic}`, tags: ['education', 'class', `grade-${lessonGrade}`], source: 'education:class:mint', meta: { visibility: 'private', consent: { allowCitations: false }, ed: { grade: gradeResult, prog: progResult, lesson: lessonResult, quiz: quizResult } } } });
      const id = r.data?.result?.dtu?.id ?? r.data?.result?.id;
      if (id) { setMintedDtuId(id); pipe.publish('education.mintedDtuId', id, { label: `Class DTU ${id.slice(0, 8)}…` }); ok(`Class DTU ${id.slice(0, 8)}…`); } else err('No DTU id.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Recipient required.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [`🎓 Class update`, '',
      gradeResult ? `${gradeResult.studentName}: ${gradeResult.letterGrade} (${gradeResult.finalPercent}%) · ${gradeResult.passing ? '✓ passing' : '⚠ failing'}` : '',
      progResult ? `Progress: ${progResult.trend} (+${progResult.improvement}) · ${progResult.mastery} · ${progResult.recommendation}` : '',
      lessonResult ? `Lesson plan: ${lessonResult.topic} (G${lessonResult.gradeLevel}) · ${lessonResult.objectives?.length ?? 0} objectives` : '',
      quizResult ? `Quiz: ${quizResult.questions.length} questions on ${quizResult.topic}` : '',
      mintedDtuId ? `\n[DTU ${mintedDtuId}]` : '',
    ].filter(Boolean).join('\n');
    try {
      const messageId = await dmRecall.run(async () => {
        const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body });
        if (r.data?.ok === false) throw new Error(r.data?.error ?? 'send failed');
        return r.data?.message?.id as string;
      });
      if (messageId) { ok('Sent. 60s to recall.'); setRecipient(''); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actPublish() {
    if (!lessonResult && !quizResult) { err('Generate lesson or quiz first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await lensRun({ domain: 'dtu', name: 'create', input: { title: `Lesson — ${lessonTopic} (G${lessonGrade})`, tags: ['education', 'lesson', 'public', `grade-${lessonGrade}`], source: 'education:lesson:publish', meta: { visibility: 'public', consent: { allowCitations: true }, lesson: lessonResult, quiz: quizResult } } });
        const newId = r.data?.result?.dtu?.id ?? r.data?.result?.id;
        if (!newId) throw new Error('No DTU id.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish failed');
        return newId as string;
      });
      if (id) { setPublishedDtuId(id); pipe.publish('education.publishedDtuId', id, { label: `Public lesson ${id.slice(0, 8)}…` }); ok(`Published ${id.slice(0, 8)}… · 30s to recall.`); }
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = `Teacher feedback brief. ${gradeResult ? `Student ${gradeResult.studentName}: ${gradeResult.letterGrade} (${gradeResult.finalPercent}%).` : ''} ${progResult ? `Progress trend: ${progResult.trend} (${progResult.improvement >= 0 ? '+' : ''}${progResult.improvement}), mastery ${progResult.mastery}.` : ''} ${lessonResult ? `Current topic: ${lessonResult.topic}.` : ''} Give one concrete strength to praise + one specific area for next-week focus. Plain text, 3 sentences max.`;
      const r = await lensRun({ domain: 'chat_agent', name: 'do', input: { task, maxTurns: 3 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Feedback ready.'); } else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); } finally { setBusy(null); }
  }

  const actions = [
    { id: 'grade' as ActionId, label: 'Grade', desc: 'gradeCalculation', icon: GraduationCap, accent: '#3b82f6', handler: actGrade },
    { id: 'prog' as ActionId, label: 'Progress', desc: 'progressTrack', icon: TrendingUp, accent: '#22c55e', handler: actProg },
    { id: 'lesson' as ActionId, label: 'Lesson', desc: 'lesson-plan (LLM)', icon: BookOpen, accent: '#a855f7', handler: actLesson },
    { id: 'quiz' as ActionId, label: 'Quiz', desc: 'quiz-from-text (LLM)', icon: ListChecks, accent: '#f59e0b', handler: actQuiz },
    { id: 'mint' as ActionId, label: mintedDtuId ? 'Saved' : 'Mint', desc: mintedDtuId ? `${mintedDtuId.slice(0, 8)}…` : 'Private class DTU', icon: Sparkles, accent: '#06b6d4', handler: actMint },
    { id: 'dm' as ActionId, label: 'DM', desc: 'Send class update', icon: Send, accent: '#ec4899', handler: actDm },
    { id: 'publish' as ActionId, label: publishedDtuId ? 'Published' : 'Publish', desc: publishedDtuId ? `${publishedDtuId.slice(0, 8)}…` : 'Public lesson', icon: Globe, accent: '#15803d', handler: actPublish },
    { id: 'agent' as ActionId, label: 'Feedback', desc: 'Agent: praise + focus', icon: Wand2, accent: '#eab308', handler: actAgent },
  ];

  const LETTER_COLOR: Record<string, string> = { A: 'text-emerald-300', B: 'text-blue-300', C: 'text-amber-300', D: 'text-orange-300', F: 'text-red-300' };

  return (
    <div className="rounded-lg border border-indigo-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-indigo-500/10 pb-2">
        <GraduationCap className="h-4 w-4 text-indigo-400" />
        <h3 className="text-sm font-semibold text-white">Classroom bench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">grades · progress · lesson plan · quiz</span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold">Grades JSON</label>
          <textarea value={gradesText} onChange={(e) => setGradesText(e.target.value)} rows={6} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-green-400 font-semibold">Progress JSON</label>
          <textarea value={progText} onChange={(e) => setProgText(e.target.value)} rows={6} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white font-mono mt-1" />
        </div>
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-purple-400 font-semibold">Lesson + quiz</div>
          <input type="text" value={lessonTopic} onChange={(e) => setLessonTopic(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[11px] text-white" placeholder="Topic" />
          <input type="text" value={lessonGrade} onChange={(e) => setLessonGrade(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[11px] text-white" placeholder="Grade level" />
          <textarea value={quizText} onChange={(e) => setQuizText(e.target.value)} rows={3} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1 text-[10px] text-white" placeholder="Quiz source text" />
          <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white" placeholder="DM recipient" />
          <div className="flex items-center gap-2 flex-wrap">
            <RecallSlot ctl={dmRecall} />
            <RecallSlot ctl={publishRecall} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
        {actions.map(act => {
          const Icon = act.icon; const isBusy = busy === act.id;
          return (
            <button key={act.id} type="button" disabled={!!busy} onClick={act.handler}
              className={cn('flex flex-col items-start gap-1.5 p-2.5 rounded-lg text-left border transition-all', 'bg-zinc-900/40 border-zinc-800 hover:bg-zinc-800/60 hover:border-zinc-700', 'disabled:opacity-40 disabled:cursor-not-allowed')}>
              <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ backgroundColor: act.accent + '20', color: act.accent }}>
                {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
              </div>
              <div className="text-[11px] font-semibold text-zinc-100 leading-tight">{act.label}</div>
              <div className="text-[10px] text-zinc-400 leading-tight line-clamp-2">{act.desc}</div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {gradeResult && (
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5 max-h-48 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">{gradeResult.studentName}</div>
            <div className={cn('text-3xl font-bold', LETTER_COLOR[gradeResult.letterGrade?.[0] ?? 'F'])}>{gradeResult.letterGrade}<span className="text-sm text-zinc-400"> {gradeResult.finalPercent}%</span></div>
            {gradeResult.gpa != null && <div className="text-[10px] text-zinc-400">GPA {gradeResult.gpa}</div>}
            {gradeResult.breakdown.map((b, i) => <div key={i} className="text-[10px] text-zinc-300 mt-0.5 flex items-center gap-2"><span className="font-mono w-20 truncate">{b.category}</span><div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden"><div className="h-full bg-blue-400" style={{ width: `${b.percent}%` }} /></div><span className="font-mono text-blue-200">{b.percent}%</span></div>)}
          </div>
        )}
        {progResult && (
          <div className="rounded-md border border-green-500/30 bg-green-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-green-300 font-semibold">Progress · {progResult.trend}</div>
            <div className="text-2xl font-bold text-green-300">avg {progResult.average}</div>
            <div className="text-[10px] text-zinc-400">{progResult.scores.length} data points · improvement {progResult.improvement >= 0 ? '+' : ''}{progResult.improvement}</div>
            <div className="text-[11px] text-zinc-200 font-semibold capitalize">{progResult.mastery}</div>
            <div className="text-[10px] text-green-200 italic mt-0.5">{progResult.recommendation}</div>
            <div className="flex gap-0.5 mt-1 h-6 items-end">{progResult.scores.map((s, i) => <div key={i} className="flex-1 rounded-t-sm bg-green-400" style={{ height: `${s.score}%` }} title={`${s.date}: ${s.score}`} />)}</div>
          </div>
        )}
        {lessonResult && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5 max-h-60 overflow-y-auto md:col-span-2">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">Lesson · {lessonResult.topic} (G{lessonResult.gradeLevel})</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-1">
              {lessonResult.objectives && <div><div className="text-[10px] text-purple-200 font-semibold uppercase tracking-wider mb-0.5">Objectives</div>{lessonResult.objectives.map((o, i) => <div key={i} className="text-[10px] text-zinc-300">→ {o}</div>)}</div>}
              {lessonResult.activities && <div><div className="text-[10px] text-purple-200 font-semibold uppercase tracking-wider mb-0.5">Activities</div>{lessonResult.activities.map((a, i) => <div key={i} className="text-[10px] text-zinc-300">→ {a}</div>)}</div>}
            </div>
            {lessonResult.assessment && <div className="text-[10px] text-purple-200 mt-2"><strong>Assessment:</strong> {lessonResult.assessment}</div>}
            {lessonResult.materials && <div className="text-[10px] text-zinc-400 mt-1">Materials: {lessonResult.materials.join(', ')}</div>}
          </div>
        )}
        {quizResult && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 max-h-60 overflow-y-auto md:col-span-2">
            <div className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold">Quiz · {quizResult.questions.length} questions</div>
            {quizResult.questions.slice(0, 5).map((q, i) => <div key={i} className="mt-2 text-[11px] text-zinc-200"><strong>{i + 1}. {q.question}</strong>{q.options && <ol className="ml-3 mt-0.5">{q.options.map((o, j) => <li key={j} className={cn('text-[10px]', q.answer === o ? 'text-emerald-300 font-semibold' : 'text-zinc-400')}>{String.fromCharCode(65 + j)}) {o}</li>)}</ol>}{q.explanation && <div className="text-[10px] text-amber-200 italic mt-0.5">{q.explanation}</div>}</div>)}
          </div>
        )}
      </div>

      {agentReply && (<div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 max-h-60 overflow-y-auto"><div className="flex items-center gap-1.5 text-yellow-400 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Teacher feedback</div><pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed">{agentReply}</pre></div>)}

      <AnimatePresence>
        {feedback && (<motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }} className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>{feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}<span>{feedback.text}</span></motion.div>)}
      </AnimatePresence>
    </div>
  );
}
