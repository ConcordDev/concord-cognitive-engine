'use client';

import { useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { GraduationCap, Play, Loader2, Plus } from 'lucide-react';

export function AnalysisPanel() {
  const [analysisTab, setAnalysisTab] = useState<'strategySelection' | 'transferAnalysis' | 'performanceProfile'>('strategySelection');
  const [taskFeatures, setTaskFeatures] = useState({ complexity: 0.5, dimensionality: 0.5, noise: 0.3, sampleSize: 0.6, nonlinearity: 0.4 });
  const [sourceDomain, setSourceDomain] = useState({ name: '', concepts: '', skills: '' });
  const [targetDomain, setTargetDomain] = useState({ name: '', concepts: '', skills: '' });
  const [assessments, setAssessments] = useState<{ skill: string; difficulty: number; score: number }[]>([]);
  const [newAssessment, setNewAssessment] = useState({ skill: '', difficulty: 0.5, score: 0.7 });
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [isRunning, setIsRunning] = useState<string | null>(null);
  const splitCsv = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

  const handleAction = async (action: 'strategySelection' | 'transferAnalysis' | 'performanceProfile') => {
    let input: Record<string, unknown> = {};
    if (action === 'strategySelection') {
      input = { taskFeatures };
    } else if (action === 'transferAnalysis') {
      if (!sourceDomain.name.trim() || !targetDomain.name.trim()) {
        setActionResult({ message: 'Both source and target domain need a name.' });
        return;
      }
      input = {
        sourceDomain: { name: sourceDomain.name, concepts: splitCsv(sourceDomain.concepts), skills: splitCsv(sourceDomain.skills) },
        targetDomain: { name: targetDomain.name, concepts: splitCsv(targetDomain.concepts), skills: splitCsv(targetDomain.skills) },
      };
    } else {
      if (assessments.length === 0) {
        setActionResult({ message: 'Add at least one assessment below first.' });
        return;
      }
      input = { assessments };
    }
    setIsRunning(action);
    try {
      const res = await lensRun('metalearning', action, input);
      if (res.data.ok === false) { setActionResult({ message: `Action failed: ${res.data.error || 'Unknown error'}` }); } else { setActionResult(res.data.result as Record<string, unknown>); }
    } catch (e) { console.error(`Action ${action} failed:`, e); setActionResult({ message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}` }); }
    finally { setIsRunning(null); }
  };

  return (
    <div className="panel p-4 space-y-3">
      <h2 className="font-semibold flex items-center gap-2">
        <GraduationCap className="w-4 h-4 text-neon-cyan" />
        Metalearning Analysis
      </h2>
      <div className="flex gap-1 text-xs border-b border-white/10 pb-2">
        {([
          ['strategySelection', 'Strategy Selection'],
          ['transferAnalysis', 'Transfer Analysis'],
          ['performanceProfile', 'Performance Profile'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setAnalysisTab(id)}
            className={`px-3 py-1.5 rounded-t transition-colors ${analysisTab === id ? 'bg-neon-cyan/10 text-neon-cyan border-b-2 border-neon-cyan' : 'text-gray-400 hover:text-white'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {analysisTab === 'strategySelection' && (
        <div className="space-y-2">
          <p className="text-xs text-gray-400">
            Feature-based k-NN meta-learning: describe the task, get the recommended model family.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {(Object.keys(taskFeatures) as Array<keyof typeof taskFeatures>).map((k) => (
              <label key={k} className="text-[11px] text-gray-400 space-y-1">
                <span className="capitalize">{k}</span>
                <input
                  type="number" min={0} max={1} step={0.05}
                  value={taskFeatures[k]}
                  onChange={(e) => setTaskFeatures((prev) => ({ ...prev, [k]: Math.max(0, Math.min(1, Number(e.target.value) || 0)) }))}
                  className="input-lattice w-full text-xs"
                />
              </label>
            ))}
          </div>
          <button onClick={() => handleAction('strategySelection')} disabled={!!isRunning}
            className="btn-secondary text-sm flex items-center gap-1 disabled:opacity-50">
            {isRunning === 'strategySelection' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
            Select Strategy
          </button>
        </div>
      )}

      {analysisTab === 'transferAnalysis' && (
        <div className="space-y-2">
          <p className="text-xs text-gray-400">
            Jaccard concept/skill/vocabulary overlap — how much of what you know transfers.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <p className="text-[11px] uppercase tracking-wide text-neon-cyan">Source domain</p>
              <input value={sourceDomain.name} onChange={(e) => setSourceDomain((p) => ({ ...p, name: e.target.value }))} placeholder="name (e.g. Python)" className="input-lattice w-full text-xs" />
              <input value={sourceDomain.concepts} onChange={(e) => setSourceDomain((p) => ({ ...p, concepts: e.target.value }))} placeholder="concepts, comma-separated" className="input-lattice w-full text-xs" />
              <input value={sourceDomain.skills} onChange={(e) => setSourceDomain((p) => ({ ...p, skills: e.target.value }))} placeholder="skills, comma-separated" className="input-lattice w-full text-xs" />
            </div>
            <div className="space-y-1.5">
              <p className="text-[11px] uppercase tracking-wide text-neon-purple">Target domain</p>
              <input value={targetDomain.name} onChange={(e) => setTargetDomain((p) => ({ ...p, name: e.target.value }))} placeholder="name (e.g. Rust)" className="input-lattice w-full text-xs" />
              <input value={targetDomain.concepts} onChange={(e) => setTargetDomain((p) => ({ ...p, concepts: e.target.value }))} placeholder="concepts, comma-separated" className="input-lattice w-full text-xs" />
              <input value={targetDomain.skills} onChange={(e) => setTargetDomain((p) => ({ ...p, skills: e.target.value }))} placeholder="skills, comma-separated" className="input-lattice w-full text-xs" />
            </div>
          </div>
          <button onClick={() => handleAction('transferAnalysis')} disabled={!!isRunning}
            className="btn-secondary text-sm flex items-center gap-1 disabled:opacity-50">
            {isRunning === 'transferAnalysis' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
            Analyze Transfer
          </button>
        </div>
      )}

      {analysisTab === 'performanceProfile' && (
        <div className="space-y-2">
          <p className="text-xs text-gray-400">
            Add a few (skill, difficulty, score) assessments to build a strengths/weaknesses radar
            and find your zone-of-proximal-development difficulty target.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[11px] text-gray-400 space-y-1">
              <span>Skill</span>
              <input value={newAssessment.skill} onChange={(e) => setNewAssessment((p) => ({ ...p, skill: e.target.value }))} placeholder="e.g. recursion" className="input-lattice text-xs w-32" />
            </label>
            <label className="text-[11px] text-gray-400 space-y-1">
              <span>Difficulty (0-1)</span>
              <input type="number" min={0} max={1} step={0.1} value={newAssessment.difficulty} onChange={(e) => setNewAssessment((p) => ({ ...p, difficulty: Math.max(0, Math.min(1, Number(e.target.value) || 0)) }))} className="input-lattice text-xs w-20" />
            </label>
            <label className="text-[11px] text-gray-400 space-y-1">
              <span>Score (0-1)</span>
              <input type="number" min={0} max={1} step={0.1} value={newAssessment.score} onChange={(e) => setNewAssessment((p) => ({ ...p, score: Math.max(0, Math.min(1, Number(e.target.value) || 0)) }))} className="input-lattice text-xs w-20" />
            </label>
            <button
              onClick={() => { if (newAssessment.skill.trim()) { setAssessments((p) => [...p, { ...newAssessment, skill: newAssessment.skill.trim() }]); setNewAssessment((p) => ({ ...p, skill: '' })); } }}
              className="btn-secondary text-xs flex items-center gap-1"
            >
              <Plus className="w-3 h-3" /> Add
            </button>
          </div>
          {assessments.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {assessments.map((a, i) => (
                <span key={i} className="text-[11px] bg-lattice-surface rounded px-2 py-1 flex items-center gap-1.5">
                  {a.skill} · diff {a.difficulty} · score {a.score}
                  <button onClick={() => setAssessments((p) => p.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-400">×</button>
                </span>
              ))}
            </div>
          )}
          <button onClick={() => handleAction('performanceProfile')} disabled={!!isRunning}
            className="btn-secondary text-sm flex items-center gap-1 disabled:opacity-50">
            {isRunning === 'performanceProfile' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
            Build Profile
          </button>
        </div>
      )}

      {actionResult && (
        <div className="bg-lattice-deep rounded-lg p-4 space-y-3 text-sm">
          {'recommended' in actionResult && 'method' in actionResult && (
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <span className="text-gray-400 text-xs">Method: <span className="text-neon-cyan font-bold">{String(actionResult.method)}</span></span>
                <span className="text-gray-400 text-xs">Recommended: <span className="text-neon-green font-bold">{String(actionResult.recommended)}</span></span>
                <span className="text-gray-400 text-xs">Confidence: <span className="text-yellow-400">{String(actionResult.confidence)}</span></span>
              </div>
              {'rankings' in actionResult && Array.isArray(actionResult.rankings) && actionResult.rankings.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs text-gray-400 uppercase tracking-wider">Rankings</p>
                  {(actionResult.rankings as Array<Record<string, unknown>>).slice(0, 5).map((r, i) => (
                    <div key={i} className="flex justify-between text-xs bg-lattice-surface rounded px-2 py-1">
                      <span className="text-gray-300">{String(r.strategy || r.name)}</span>
                      <span className="text-neon-cyan">{String(r.score || r.rank || i + 1)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {'transferability' in actionResult && (
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <span className="text-gray-400 text-xs">Transferability: <span className="text-neon-green font-bold">{String(actionResult.transferability)}</span></span>
              </div>
              {'sharedConcepts' in actionResult && Array.isArray(actionResult.sharedConcepts) && actionResult.sharedConcepts.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {(actionResult.sharedConcepts as string[]).map((c, i) => (
                    <span key={i} className="text-xs bg-neon-cyan/10 border border-neon-cyan/20 rounded px-2 py-0.5 text-neon-cyan">{c}</span>
                  ))}
                </div>
              )}
              {'recommendation' in actionResult && <p className="text-xs text-gray-300">{String(actionResult.recommendation)}</p>}
            </div>
          )}
          {'overallScore' in actionResult && (
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <span className="text-neon-cyan font-bold text-xl">{String(actionResult.overallScore)}</span>
                <span className="text-gray-400 text-xs">Style: <span className="text-neon-purple">{String(actionResult.learningStyle)}</span></span>
              </div>
              {'strengths' in actionResult && Array.isArray(actionResult.strengths) && actionResult.strengths.length > 0 && (
                <div>
                  <p className="text-xs text-neon-green font-semibold mb-1">Strengths</p>
                  <div className="flex flex-wrap gap-1">
                    {(actionResult.strengths as Array<{skill: string; score: number}>).map((s, i) => (
                      <span key={i} className="text-xs bg-neon-green/10 border border-neon-green/20 rounded px-2 py-0.5 text-neon-green">{s.skill}</span>
                    ))}
                  </div>
                </div>
              )}
              {'weaknesses' in actionResult && Array.isArray(actionResult.weaknesses) && actionResult.weaknesses.length > 0 && (
                <div>
                  <p className="text-xs text-red-400 font-semibold mb-1">Weaknesses</p>
                  <div className="flex flex-wrap gap-1">
                    {(actionResult.weaknesses as Array<{skill: string; score: number}>).map((w, i) => (
                      <span key={i} className="text-xs bg-red-400/10 border border-red-400/20 rounded px-2 py-0.5 text-red-400">{w.skill}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          {'message' in actionResult && <p className="text-gray-400">{String(actionResult.message)}</p>}
        </div>
      )}
    </div>
  );
}
