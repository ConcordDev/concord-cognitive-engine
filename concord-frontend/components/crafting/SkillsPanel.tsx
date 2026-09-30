'use client';

import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { api } from '@/lib/api/client';
import {
  Award, RefreshCw, AlertCircle, Loader2, ArrowUpCircle,
} from 'lucide-react';
import {
  activeWorldId,
  type SkillRow,
} from './crafting-shared';

const ProgressionPanel = dynamic(
  () => import('@/components/concordia/skills/ProgressionPanel'),
  { ssr: false }
);

export function SkillsPanel({ onChanged }: { onChanged: () => void }) {
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [skillDTUs, setSkillDTUs] = useState<Array<{ id: string; title: string; type: string; data?: unknown }>>([]);
  const [progressionRows, setProgressionRows] = useState<Array<{
    id: string; title: string; skill_level: number;
    total_experience: number; practice_count: number; teaching_count: number;
    cross_world_uses: number; hybrid_contributions: number;
    mastery: { badge: string; title: string; aura: string | null; npcRecognition: boolean; teacherEligible: boolean; level: number; nextThreshold: number | null };
  }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [training, setTraining] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [craftingSkills, livedSkills] = await Promise.all([
        api.get('/api/crafting/skills').then((r) => r.data).catch(() => null),
        api.get('/api/worlds/skills/mine').then((r) => r.data).catch(() => null),
      ]);
      setSkills((craftingSkills?.skillLevels ?? []) as SkillRow[]);
      setSkillDTUs(((craftingSkills?.skillDTUs ?? []) as Array<{ id: string; title: string; type: string; data?: unknown }>));
      setProgressionRows((livedSkills?.skills ?? []) as typeof progressionRows);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function train(skill_type: string) {
    setTraining(skill_type);
    try {
      await api.post('/api/crafting/skills/train', {
        skill_type, worldId: activeWorldId(), xp: 50,
      });
      onChanged();
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Train failed');
    } finally {
      setTraining(null);
    }
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold inline-flex items-center gap-2">
          <Award className="w-4 h-4 text-amber-300" /> Character & skills
        </h2>
        <button onClick={load} className="text-white/40 hover:text-white text-xs inline-flex items-center gap-1">
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </div>

      {error && (
        <div role="alert" className="flex items-center justify-between gap-3 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2 mb-3">
          <span className="text-sm text-red-300 inline-flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5" /> {error}
          </span>
          <button
            onClick={load}
            className="text-xs px-2 py-1 rounded border border-red-500/40 bg-red-500/10 hover:bg-red-500/20 text-red-200 inline-flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" /> Retry
          </button>
        </div>
      )}

      {loading ? (
        <div role="status" aria-live="polite" className="flex items-center gap-2 text-white/60">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div>
            <h3 className="text-xs uppercase tracking-wide text-white/40 mb-2">Practiced skills</h3>
            {progressionRows.length === 0 ? (
              <p className="text-white/50 text-sm">
                No practiced skills yet. Use a skill in the world to begin growing it.
              </p>
            ) : (
              <ProgressionPanel skills={progressionRows} />
            )}
          </div>

          <div>
            <h3 className="text-xs uppercase tracking-wide text-white/40 mb-2">Crafting skill levels</h3>
            {skills.length === 0 ? (
              <p className="text-white/50 text-sm">No crafting skills logged yet.</p>
            ) : (
              <ul className="space-y-2">
                {skills.map((s, i) => (
                  <li key={`${s.skill_type}-${s.native_world_type}-${i}`} className="bg-white/5 border border-white/10 rounded-lg p-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold">{s.skill_type}</p>
                      <p className="text-[11px] text-white/50">
                        Lv {Number(s.level ?? 0).toFixed(1)}
                        {s.native_world_type && <span className="text-white/30"> · {s.native_world_type}</span>}
                      </p>
                    </div>
                    <button
                      onClick={() => s.skill_type && train(s.skill_type)}
                      disabled={training === s.skill_type}
                      className="px-3 py-1.5 bg-violet-500/20 border border-violet-500/40 rounded-md text-xs hover:bg-violet-500/30 disabled:opacity-50 inline-flex items-center gap-1"
                    >
                      {training === s.skill_type ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowUpCircle className="w-3.5 h-3.5" />}
                      Train +50
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {skillDTUs.length > 0 && (
              <div className="mt-4">
                <h3 className="text-xs uppercase tracking-wide text-white/40 mb-2">Skill DTUs</h3>
                <ul className="space-y-1.5">
                  {skillDTUs.slice(0, 8).map((d) => (
                    <li key={d.id} className="bg-white/5 border border-white/10 rounded px-3 py-2 text-xs flex items-center justify-between">
                      <span className="truncate">{d.title}</span>
                      <span className="text-white/40 font-mono">{d.type}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
