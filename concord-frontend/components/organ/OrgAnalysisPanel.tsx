'use client';

import { useState } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  GitBranch, Play, Loader2, X, Upload, AlertTriangle,
} from 'lucide-react';

interface RosterEmployee {
  id: string;
  name: string;
  title: string;
  managerId: string | null;
  skills: string[];
  role?: string;
  demographics?: Record<string, string>;
}
interface OrgChartResult {
  totalEmployees: number;
  totalManagers: number;
  individualContributors: number;
  flatnessLabel: string;
  bottleneckManagers: Array<{ name: string; id: string; directReports: number }>;
  message?: string;
}
interface TeamCompResult {
  teamSize: number;
  uniqueSkills: number;
  gaps: string[];
  belbinRoleBalance?: {
    score: number;
    filledRoles: number;
    totalRoles: number;
    missingRoles: string[];
    distribution: Record<string, number>;
  };
  demographics?: Record<string, { groups: Record<string, number>; simpsonDiversity: number; uniqueValues: number }>;
  message?: string;
}
interface CommsResult {
  nodes: number;
  edges: number;
  density: number;
  silos: unknown[];
  hubs: Array<{ node: string }>;
  message?: string;
}

export function OrgAnalysisPanel() {
  const [isRunning, setIsRunning] = useState<string | null>(null);
  const [orgChartResult, setOrgChartResult] = useState<OrgChartResult | null>(null);
  const [teamResult, setTeamResult] = useState<TeamCompResult | null>(null);
  const [commsResult, setCommsResult] = useState<CommsResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showCommsPaste, setShowCommsPaste] = useState(false);
  const [commsCsv, setCommsCsv] = useState('');

  const loadRoster = async (): Promise<RosterEmployee[] | null> => {
    const r = await lensRun<{ employees: RosterEmployee[] }>('organ', 'roster-list');
    if (!r.data.ok || !r.data.result) return null;
    return r.data.result.employees || [];
  };

  const runOrgChart = async () => {
    setIsRunning('orgChart'); setErrorMsg(null);
    const employees = await loadRoster();
    if (!employees || employees.length === 0) { setErrorMsg('No roster yet — add people in the Org Chart tab above first.'); setIsRunning(null); return; }
    const r = await lensRun<OrgChartResult>('organ', 'orgChart', { employees });
    if (r.data.ok && r.data.result) setOrgChartResult(r.data.result); else setErrorMsg(r.data.error || 'Org chart analysis failed');
    setIsRunning(null);
  };

  const runTeamComp = async () => {
    setIsRunning('teamComposition'); setErrorMsg(null);
    const employees = await loadRoster();
    if (!employees || employees.length === 0) { setErrorMsg('No roster yet — add people in the Org Chart tab above first.'); setIsRunning(null); return; }
    const team = employees.map((e) => ({ name: e.name, skills: e.skills || [], role: e.role, demographics: e.demographics }));
    const r = await lensRun<TeamCompResult>('organ', 'teamComposition', { team });
    if (r.data.ok && r.data.result) setTeamResult(r.data.result); else setErrorMsg(r.data.error || 'Team composition analysis failed');
    setIsRunning(null);
  };

  const runCommsFlow = async () => {
    if (!commsCsv.trim()) { setErrorMsg('Paste a from,to[,channel[,weight]] log first'); return; }
    setIsRunning('communicationFlow'); setErrorMsg(null);
    const communications = commsCsv
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [from, to, channel, weight] = line.split(',').map((s) => s.trim());
        return { from, to, channel: channel || undefined, weight: weight ? Number(weight) : undefined };
      })
      .filter((c) => c.from && c.to);
    const r = await lensRun<CommsResult>('organ', 'communicationFlow', { communications });
    if (r.data.ok && r.data.result) { setCommsResult(r.data.result); setShowCommsPaste(false); } else setErrorMsg(r.data.error || 'Communication flow analysis failed');
    setIsRunning(null);
  };

  return (
    <div className="panel p-4 space-y-3">
      <h2 className="font-semibold flex items-center gap-2">
        <GitBranch className="w-4 h-4 text-neon-cyan" />
        Org Analysis
        <span className="text-xs text-gray-400 font-normal">graph-theory macros run against the live roster</span>
      </h2>
      <div className="flex flex-wrap gap-2">
        <button onClick={runOrgChart} disabled={!!isRunning} className="btn-secondary text-sm flex items-center gap-1 disabled:opacity-50">
          {isRunning === 'orgChart' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
          Span of Control / Bottlenecks
        </button>
        <button onClick={runTeamComp} disabled={!!isRunning} className="btn-secondary text-sm flex items-center gap-1 disabled:opacity-50">
          {isRunning === 'teamComposition' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
          Skill Coverage / Diversity
        </button>
        <button onClick={() => setShowCommsPaste(true)} disabled={!!isRunning} className="btn-secondary text-sm flex items-center gap-1 disabled:opacity-50">
          {isRunning === 'communicationFlow' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
          Communication Flow (paste log)
        </button>
      </div>
      {errorMsg && (
        <div className="text-xs text-red-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {errorMsg}</div>
      )}

      {orgChartResult && (
        <div className="bg-lattice-deep rounded-lg p-4 space-y-2 text-sm">
          {orgChartResult.message ? <p className="text-gray-400">{orgChartResult.message}</p> : (
            <>
              <div className="flex flex-wrap gap-4 text-xs">
                <span className="text-gray-400">Employees: <span className="text-neon-cyan font-bold">{orgChartResult.totalEmployees}</span></span>
                <span className="text-gray-400">Managers: <span className="text-neon-cyan">{orgChartResult.totalManagers}</span></span>
                <span className="text-gray-400">Structure: <span className="text-neon-purple">{orgChartResult.flatnessLabel}</span></span>
              </div>
              {orgChartResult.bottleneckManagers?.length > 0 && (
                <div>
                  <p className="text-xs text-yellow-400 font-semibold mb-1">Bottleneck Managers</p>
                  {orgChartResult.bottleneckManagers.map((m, i) => (
                    <span key={i} className="text-xs bg-yellow-400/10 border border-yellow-400/20 rounded px-2 py-0.5 mr-1 text-yellow-400">{m.name} ({m.directReports})</span>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {teamResult && (
        <div className="bg-lattice-deep rounded-lg p-4 space-y-2 text-sm">
          {teamResult.message ? <p className="text-gray-400">{teamResult.message}</p> : (
            <>
              <div className="flex flex-wrap gap-4 text-xs">
                <span className="text-gray-400">Size: <span className="text-neon-cyan">{teamResult.teamSize}</span></span>
                <span className="text-gray-400">Skills: <span className="text-neon-cyan">{teamResult.uniqueSkills}</span></span>
              </div>
              {teamResult.gaps?.length > 0 && (
                <div>
                  <p className="text-xs text-red-400 font-semibold mb-1">Skill Gaps (required, uncovered)</p>
                  <div className="flex flex-wrap gap-1">
                    {teamResult.gaps.map((g, i) => <span key={i} className="text-xs bg-red-400/10 border border-red-400/20 rounded px-2 py-0.5 text-red-400">{g}</span>)}
                  </div>
                </div>
              )}
              <div>
                <p className="text-xs text-neon-purple font-semibold mb-1">Belbin Role Balance</p>
                {teamResult.belbinRoleBalance && teamResult.belbinRoleBalance.filledRoles > 0 ? (
                  <>
                    <span className="text-xs text-gray-400">
                      {teamResult.belbinRoleBalance.filledRoles}/{teamResult.belbinRoleBalance.totalRoles} roles filled
                      {' '}(<span className="text-neon-cyan">{(teamResult.belbinRoleBalance.score * 100).toFixed(0)}%</span>)
                    </span>
                    {teamResult.belbinRoleBalance.missingRoles.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {teamResult.belbinRoleBalance.missingRoles.map((r, i) => (
                          <span key={i} className="text-xs bg-lattice-surface border border-lattice-border rounded px-2 py-0.5 text-gray-500">{r}</span>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-gray-500">Not offered — no roster member has a Belbin team role set. Add one via Edit Person.</p>
                )}
              </div>
              <div>
                <p className="text-xs text-neon-purple font-semibold mb-1">Demographic Diversity (Simpson&apos;s index)</p>
                {teamResult.demographics && Object.keys(teamResult.demographics).length > 0 ? (
                  <div className="space-y-1">
                    {Object.entries(teamResult.demographics).map(([key, d]) => (
                      <div key={key} className="flex items-center gap-2 text-xs">
                        <span className="text-gray-400 w-20 shrink-0">{key}</span>
                        <span className="text-neon-cyan">{d.simpsonDiversity.toFixed(2)}</span>
                        <span className="text-gray-500">({d.uniqueValues} groups)</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-500">Not offered — no roster member has demographics set. Add via Edit Person.</p>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {commsResult && (
        <div className="bg-lattice-deep rounded-lg p-4 space-y-2 text-sm">
          {commsResult.message ? <p className="text-gray-400">{commsResult.message}</p> : (
            <>
              <div className="flex flex-wrap gap-4 text-xs">
                <span className="text-gray-400">Nodes: <span className="text-neon-cyan">{commsResult.nodes}</span></span>
                <span className="text-gray-400">Edges: <span className="text-neon-cyan">{commsResult.edges}</span></span>
                <span className="text-gray-400">Density: <span className="text-neon-green">{commsResult.density}</span></span>
                <span className="text-gray-400">Silos: <span className="text-red-400">{commsResult.silos?.length || 0}</span></span>
              </div>
              {commsResult.hubs?.length > 0 && (
                <div>
                  <p className="text-xs text-neon-green font-semibold mb-1">Hubs</p>
                  <div className="flex flex-wrap gap-1">
                    {commsResult.hubs.map((h, i) => <span key={i} className="text-xs bg-neon-green/10 border border-neon-green/20 rounded px-2 py-0.5 text-neon-green">{h.node}</span>)}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {showCommsPaste && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="panel p-5 max-w-lg w-full space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm">Paste a Communication Log</h3>
              <button onClick={() => setShowCommsPaste(false)} className="text-gray-400 hover:text-white" aria-label="Close"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-xs text-gray-400">
              Concord has no internal message-log substrate to analyze automatically —
              this macro is a real network-analysis engine (density, reciprocity, silo
              detection, betweenness-centrality brokers), but it needs your own
              interaction log. One row per line: <code className="text-neon-cyan">from,to,channel,weight</code>
              {' '}(channel and weight optional).
            </p>
            <textarea
              value={commsCsv}
              onChange={(e) => setCommsCsv(e.target.value)}
              placeholder={'ada,grace,slack,3\ngrace,ada,slack,2\nada,linus,email'}
              rows={8}
              className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded text-xs font-mono focus:border-neon-cyan outline-none"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowCommsPaste(false)} className="px-3 py-1.5 text-sm text-gray-400 hover:text-white">Cancel</button>
              <button onClick={runCommsFlow} disabled={isRunning === 'communicationFlow'} className="btn-neon text-sm flex items-center gap-1">
                {isRunning === 'communicationFlow' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                Analyze
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

