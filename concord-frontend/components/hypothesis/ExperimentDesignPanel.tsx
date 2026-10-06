'use client';

/**
 * ExperimentDesignPanel — plan and read experiments with the hypothesis
 * domain's own engines: two-proportion A/B test (abTest), Beta-Binomial
 * Bayesian update (bayesianInference) and two-group power analysis
 * (powerAnalysis: sample size, achieved power or detectable effect).
 * The posterior curve is drawn from the posterior α/β the engine returns.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { Loader2, Scale, Split, Target } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

/* eslint-disable @typescript-eslint/no-explicit-any */

function Card({ icon, title, hint, children }: { icon: ReactNode; title: string; hint: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-white/10 bg-black/30 p-4 transition-colors hover:border-white/20">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-100">{icon}{title}</h3>
      <p className="mb-3 mt-1 text-[11px] text-gray-500">{hint}</p>
      {children}
    </section>
  );
}

function Num({ label, value, onChange, step = 'any' }: { label: string; value: string; onChange: (v: string) => void; step?: string }) {
  return (
    <label className="flex flex-col gap-1 text-[11px] text-gray-400">
      {label}
      <input type="number" step={step} value={value} onChange={(e) => onChange(e.target.value)} className="rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 font-mono text-xs text-white focus:border-neon-cyan/50 focus:outline-none" />
    </label>
  );
}

function Run({ onClick, busy, children }: { onClick: () => void; busy: boolean; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-neon-cyan/20 px-3 py-1.5 text-xs font-semibold text-neon-cyan transition-colors hover:bg-neon-cyan/30 disabled:opacity-50">
      {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{children}
    </button>
  );
}

function Row({ k, v, tone }: { k: string; v: ReactNode; tone?: string }) {
  return <div className="flex justify-between gap-3 py-0.5 text-xs"><span className="text-gray-400">{k}</span><span className={cn('font-mono text-gray-100', tone)}>{v}</span></div>;
}

function useRun() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const run = async (action: string, input: Record<string, unknown>) => {
    setBusy(true); setError(null);
    try {
      const r = await lensRun('hypothesis', action, input);
      if (!r.data.ok || !r.data.result) { setResult(null); setError(r.data.error || 'Computation failed.'); }
      else setResult(r.data.result);
    } catch (e) { setResult(null); setError((e as Error).message); } finally { setBusy(false); }
  };
  return { busy, error, result, run };
}

function Err({ msg }: { msg: string | null }) {
  return msg ? <p role="alert" className="mt-2 text-xs text-rose-400">{msg}</p> : null;
}

function AbTestCard() {
  const [f, setF] = useState({ cv: '5000', cc: '400', vv: '5000', vc: '460', alpha: '0.05' });
  const { busy, error, result, run } = useRun();
  return (
    <Card icon={<Split className="h-4 w-4 text-neon-cyan" />} title="A/B test" hint="Two-proportion z-test on conversions, with the difference's confidence interval and achieved power.">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Num label="Control visitors" value={f.cv} onChange={(v) => setF({ ...f, cv: v })} />
        <Num label="Control conversions" value={f.cc} onChange={(v) => setF({ ...f, cc: v })} />
        <Num label="Variant visitors" value={f.vv} onChange={(v) => setF({ ...f, vv: v })} />
        <Num label="Variant conversions" value={f.vc} onChange={(v) => setF({ ...f, vc: v })} />
        <Num label="α" value={f.alpha} onChange={(v) => setF({ ...f, alpha: v })} />
      </div>
      <div className="mt-3">
        <Run busy={busy} onClick={() => void run('abTest', {
          control: { visitors: Number(f.cv), conversions: Number(f.cc) },
          variant: { visitors: Number(f.vv), conversions: Number(f.vc) },
          alpha: Number(f.alpha) || 0.05,
        })}>Analyze</Run>
      </div>
      <Err msg={error} />
      {result && (
        <div className="mt-3 grid gap-x-6 sm:grid-cols-2">
          <div>
            <Row k="Control rate" v={result.control?.rate} />
            <Row k="Variant rate" v={result.variant?.rate} />
            <Row k="Difference" v={result.absoluteDifference} />
            <Row k="Relative uplift" v={result.relativeUplift} />
          </div>
          <div>
            <Row k="z / p" v={`${result.zStatistic} / ${result.pValue}`} tone={result.significant ? 'text-emerald-300' : 'text-amber-300'} />
            <Row k={`${result.confidenceInterval?.level} CI`} v={`${result.confidenceInterval?.lower} … ${result.confidenceInterval?.upper}`} />
            <Row k="Power" v={result.statisticalPower} />
            <Row k="n for 80% power" v={String(result.sampleSizeForPower80)} />
          </div>
          <p className={cn('mt-2 text-xs sm:col-span-2', result.significant ? 'text-emerald-300' : 'text-amber-300')}>{result.recommendation}</p>
        </div>
      )}
    </Card>
  );
}

function BetaCurve({ prior, posterior }: { prior: { alpha: number; beta: number }; posterior: { alpha: number; beta: number } }) {
  const paths = useMemo(() => {
    const curve = (a: number, b: number) => {
      const pts: Array<[number, number]> = [];
      for (let i = 1; i < 200; i++) {
        const x = i / 200;
        pts.push([x, (a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x)]);
      }
      const max = Math.max(...pts.map((p) => p[1]));
      return pts.map(([x, l]) => `${(x * 300).toFixed(1)},${(80 - Math.exp(l - max) * 76).toFixed(1)}`).join(' ');
    };
    return { prior: curve(prior.alpha, prior.beta), posterior: curve(posterior.alpha, posterior.beta) };
  }, [prior.alpha, prior.beta, posterior.alpha, posterior.beta]);
  return (
    <svg viewBox="0 0 300 84" className="mt-3 h-24 w-full" role="img" aria-label="Prior and posterior distributions">
      <polyline points={paths.prior} fill="none" stroke="currentColor" className="text-gray-600" strokeWidth="1.5" strokeDasharray="4 3" />
      <polyline points={paths.posterior} fill="none" stroke="currentColor" className="text-neon-cyan" strokeWidth="2" />
      <line x1="0" y1="82" x2="300" y2="82" stroke="currentColor" className="text-white/10" />
      <text x="0" y="83" className="fill-gray-500 text-[7px]">0</text>
      <text x="294" y="83" className="fill-gray-500 text-[7px]">1</text>
    </svg>
  );
}

function BayesCard() {
  const [f, setF] = useState({ a: '1', b: '1', successes: '27', trials: '40' });
  const { busy, error, result, run } = useRun();
  return (
    <Card icon={<Scale className="h-4 w-4 text-purple-300" />} title="Bayesian update" hint="Beta prior on a rate, updated with successes out of trials. Bayes factor tests the rate against 0.5.">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Num label="Prior α" value={f.a} onChange={(v) => setF({ ...f, a: v })} />
        <Num label="Prior β" value={f.b} onChange={(v) => setF({ ...f, b: v })} />
        <Num label="Successes" value={f.successes} onChange={(v) => setF({ ...f, successes: v })} step="1" />
        <Num label="Trials" value={f.trials} onChange={(v) => setF({ ...f, trials: v })} step="1" />
      </div>
      <div className="mt-3">
        <Run busy={busy} onClick={() => void run('bayesianInference', {
          prior: { distribution: 'beta', alpha: Number(f.a) || 1, beta: Number(f.b) || 1 },
          observations: { successes: Number(f.successes) || 0, trials: Number(f.trials) || 0 },
        })}>Update belief</Run>
      </div>
      <Err msg={error} />
      {result?.posterior && (
        <>
          <BetaCurve prior={result.prior} posterior={result.posterior} />
          <div className="grid gap-x-6 sm:grid-cols-2">
            <Row k="Posterior" v={`Beta(${result.posterior.alpha}, ${result.posterior.beta})`} />
            <Row k="Mean / mode" v={`${result.posterior.mean} / ${result.posterior.mode}`} />
            <Row k="95% credible" v={`${result.credibleInterval.lower} … ${result.credibleInterval.upper}`} />
            <Row k="Bayes factor (vs 0.5)" v={`${result.bayesFactor} · ${String(result.evidenceStrength).replace(/_/g, ' ')}`} />
          </div>
        </>
      )}
    </Card>
  );
}

function PowerCard() {
  const [solve, setSolve] = useState<'sampleSize' | 'power' | 'effectSize'>('sampleSize');
  const [f, setF] = useState({ effectSize: '0.5', power: '0.8', sampleSize: '50', alpha: '0.05' });
  const { busy, error, result, run } = useRun();
  const go = () => {
    const input: Record<string, unknown> = { solve, alpha: Number(f.alpha) || 0.05 };
    if (solve !== 'effectSize') input.effectSize = Number(f.effectSize);
    if (solve !== 'power') input.power = Number(f.power);
    if (solve !== 'sampleSize') input.sampleSize = Number(f.sampleSize);
    void run('powerAnalysis', input);
  };
  return (
    <Card icon={<Target className="h-4 w-4 text-amber-300" />} title="Power analysis" hint="Two independent groups, two-sided. Solve for any one of sample size, power or detectable effect (Cohen's d).">
      <div className="mb-3 inline-flex rounded-full border border-white/10 p-0.5">
        {([['sampleSize', 'Sample size'], ['power', 'Power'], ['effectSize', 'Detectable effect']] as const).map(([id, label]) => (
          <button key={id} type="button" aria-pressed={solve === id} onClick={() => setSolve(id)} className={cn('rounded-full px-3 py-1 text-[11px] transition-colors', solve === id ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-200')}>{label}</button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {solve !== 'effectSize' && <Num label="Effect size d" value={f.effectSize} onChange={(v) => setF({ ...f, effectSize: v })} />}
        {solve !== 'power' && <Num label="Power" value={f.power} onChange={(v) => setF({ ...f, power: v })} />}
        {solve !== 'sampleSize' && <Num label="n per group" value={f.sampleSize} onChange={(v) => setF({ ...f, sampleSize: v })} step="1" />}
        <Num label="α" value={f.alpha} onChange={(v) => setF({ ...f, alpha: v })} />
      </div>
      <div className="mt-3"><Run busy={busy} onClick={go}>Solve</Run></div>
      <Err msg={error} />
      {result && (
        <div className="mt-3">
          {result.solve === 'sampleSize' && (
            <p className="text-sm text-gray-200"><span className="font-mono text-2xl text-amber-200">{result.perGroup}</span> per group · {result.totalForTwoGroups} total for a {result.effectMagnitude} effect</p>
          )}
          {result.solve === 'power' && (
            <p className="text-sm text-gray-200"><span className={cn('font-mono text-2xl', result.adequate ? 'text-emerald-300' : 'text-amber-200')}>{result.powerPercent}</span> power · {result.recommendation}</p>
          )}
          {result.solve === 'effectSize' && (
            <p className="text-sm text-gray-200">Smallest detectable d <span className="font-mono text-2xl text-amber-200">{result.minimumDetectableEffect}</span> ({result.effectMagnitude})</p>
          )}
        </div>
      )}
    </Card>
  );
}

export function ExperimentDesignPanel() {
  return (
    <div className="space-y-4">
      <AbTestCard />
      <div className="grid gap-4 xl:grid-cols-2">
        <BayesCard />
        <PowerCard />
      </div>
    </div>
  );
}
