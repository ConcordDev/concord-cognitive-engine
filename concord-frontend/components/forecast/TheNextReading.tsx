'use client';

/** Forecast north star — one series, drawn only after forecast.recent answers. */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { LensShell } from '@/components/lens/LensShell';
import { NorthGreeting, QuietMore, northCtaClass } from '@/components/code/CodeFamilyChrome';
import { NorthError, northPage } from '@/components/lens/NorthStarChrome';
import { lensRun } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { useLensNav } from '@/hooks/useLensNav';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

type Forecast = {
  weather?: { kind?: string; temperature_c?: number | null } | null;
};

export function TheNextReading({ onOpenDesk }: { onOpenDesk: () => void }) {
  useLensNav('forecast');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [worldId, setWorldId] = useState('');
  const [note, setNote] = useState('');
  const choose = useMutation({
    mutationFn: async (id: string) => {
      const res = await lensRun<{ ok?: boolean; forecast?: Forecast | null; error?: string }>('forecast', 'recent', { worldId: id });
      if (!res.data.ok || !res.data.result) throw new Error(res.data.error || 'The feed did not answer.');
      if (res.data.result.ok === false) throw new Error(res.data.result.error || 'The feed did not answer.');
      return res.data.result.forecast ?? null;
    },
  });
  const forecast = choose.data;
  const weather = forecast?.weather;
  const actError = choose.error instanceof Error ? choose.error.message : '';

  function chooseSeries() {
    const id = worldId.trim();
    setNote('');
    if (!id) {
      setNote('Name a series before asking the feed.');
      return;
    }
    choose.mutate(id);
  }

  return (
    <LensShell lensId="forecast" asMain={false} disableAgentFab>
      <div data-lens-theme="forecast" className={northPage}>
        <div className="flex items-start justify-between gap-4">
          <NorthGreeting kicker="Forecast" title={who ? `The next reading, ${who}` : 'The next reading'} />
          <QuietMore items={[{ id: 'desk', label: 'Outlook' }]} onPick={onOpenDesk} />
        </div>
        <label className="mt-6 block max-w-md text-[13px] text-zinc-500">
          Series
          <input
            value={worldId}
            onChange={(e) => setWorldId(e.target.value)}
            className="mt-1 w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-[15px] text-zinc-100 outline-none"
          />
        </label>
        {(actError || note) && <NorthError message={actError || note} />}
        <div className="mt-4 flex min-h-[360px] items-end rounded-2xl border border-white/10 px-4 py-4" data-testid="forecast-stage">
          {(!forecast || !weather?.kind) && (
            <p className="text-[14px] text-zinc-400">No series yet. Nothing is drawn until a feed answers.</p>
          )}
          {weather?.kind && (
            <p className="text-[16px] text-zinc-100" data-testid="forecast-reading">
              {weather.kind}
              {typeof weather.temperature_c === 'number' ? ` · ${weather.temperature_c}°C` : ''}
            </p>
          )}
        </div>
        <button type="button" className={northCtaClass} onClick={chooseSeries} disabled={choose.isPending}>Choose a series</button>
      </div>
    </LensShell>
  );
}
