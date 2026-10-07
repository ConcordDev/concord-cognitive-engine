'use client';

/**
 * State for one ConKay workspace: the study inputs, the last real solve, and
 * the actions that change them. The server (engineering.beamStudy*) is the
 * source of truth — every result shown came back from a solve, and reopening
 * a workspace reads the stored study back rather than recomputing anything
 * locally.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { dtuReadBackCall, dtuReadBackMatches, dtuRecordId } from '@/components/wallet/walletReceipt';
import { beamReportDtuCall } from '@/lib/conkay/beam-report';
import {
  studyFromSaved,
  type BeamDims,
  type BeamStudyResult,
  type BeamSupport,
  type MaterialOption,
} from '@/lib/conkay/workspace-commands';

export interface StudyInputs {
  name: string;
  dims: BeamDims;
  loadN: number;
  support: BeamSupport;
  materialId: string;
}

export interface Material extends MaterialOption {
  category: string;
  E: number;
  yield: number;
  density: number;
}

// Starting parameters for a new study — an editable template (a W12-class
// rolled section on a 1.2 m span), not a result. Nothing is shown as solved
// until engineering.beamStudy returns.
export const NEW_STUDY: StudyInputs = {
  name: 'I-beam study',
  dims: { length: 1200, height: 300, flangeWidth: 150, flangeThickness: 15, webThickness: 9 },
  loadN: 200000,
  support: 'simply-supported',
  materialId: 'steel-a992',
};

export type SolveStatus = 'idle' | 'loading' | 'solving' | 'error';

export interface SweepRow {
  value: number;
  ok: boolean;
  error?: string;
  maxStressMPa?: number;
  maxDeflectionMm?: number;
  utilization?: number;
  safetyFactor?: number;
  pass?: boolean;
  handCheckAgrees?: boolean;
  areaMm2?: number;
}

export interface SweepResult {
  jobId: string | null;
  param: string;
  elapsedMs: number;
  rows: SweepRow[];
  lightestPassing: number | null;
}

export function inputsMatchResult(inputs: StudyInputs, r: BeamStudyResult | null): boolean {
  if (!r) return false;
  const d = inputs.dims;
  return (Object.keys(d) as Array<keyof BeamDims>).every((k) => Math.abs(d[k] - r.dims[k]) < 1e-9)
    && Math.abs(inputs.loadN - r.loadN) < 1e-9
    && inputs.support === r.support
    && inputs.materialId === r.material.id;
}

export function useConKayWorkspace(workspaceId: string | null) {
  const [inputs, setInputs] = useState<StudyInputs>(NEW_STUDY);
  const [result, setResult] = useState<BeamStudyResult | null>(null);
  const [previous, setPrevious] = useState<BeamStudyResult | null>(null);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [status, setStatus] = useState<SolveStatus>('loading');
  const [error, setError] = useState('');
  const resultRef = useRef<BeamStudyResult | null>(null);
  useEffect(() => { resultRef.current = result; }, [result]);

  useEffect(() => {
    let live = true;
    void lensRun<{ materials: Material[] }>('engineering', 'materialLibrary', {}).then((r) => {
      if (live && Array.isArray(r.data?.result?.materials)) setMaterials(r.data.result.materials);
    });
    return () => { live = false; };
  }, []);

  const reload = useCallback(async () => {
    setStatus('loading');
    setError('');
    const r = await lensRun<{ study: Record<string, unknown> | null }>(
      'engineering', 'beamStudy-get', workspaceId ? { workspaceId } : {},
    );
    if (r.data?.ok === false) {
      setStatus('error');
      setError(r.data.error || 'Could not open this workspace.');
      return null;
    }
    const study = studyFromSaved(r.data?.result?.study);
    setResult(study);
    setPrevious(null);
    setInputs(study
      ? { name: study.name, dims: study.dims, loadN: study.loadN, support: study.support, materialId: study.material.id }
      : NEW_STUDY);
    setStatus('idle');
    return study;
  }, [workspaceId]);

  useEffect(() => { void reload(); }, [reload]);

  const solve = useCallback(async (next?: StudyInputs): Promise<{ result: BeamStudyResult } | { error: string }> => {
    const run = next ?? inputs;
    if (next) setInputs(next);
    setStatus('solving');
    setError('');
    const r = await lensRun<BeamStudyResult>('engineering', 'beamStudy', {
      name: run.name,
      dims: run.dims,
      loadN: run.loadN,
      support: run.support,
      material: run.materialId,
      ...(workspaceId ? { workspaceId } : {}),
    });
    const res = r.data?.result;
    if (r.data?.ok === false || !res || !Number.isFinite(res.maxStressMPa)) {
      const msg = r.data?.error || 'The solver returned no result.';
      setStatus('error');
      setError(msg);
      return { error: msg };
    }
    const full: BeamStudyResult = { ...res, workspaceId, dtuId: null };
    setPrevious(resultRef.current);
    // Set now, not on the next render: "run fea and keep as dtu" keeps this
    // solve in the same turn.
    resultRef.current = full;
    setResult(full);
    setStatus('idle');
    return { result: full };
  }, [inputs, workspaceId]);

  const sweep = useCallback(async (param: keyof BeamDims | 'loadN', values: number[]): Promise<SweepResult | { error: string }> => {
    const r = await lensRun<SweepResult>('engineering', 'beamSweep', {
      dims: inputs.dims,
      loadN: inputs.loadN,
      support: inputs.support,
      material: inputs.materialId,
      param,
      values,
    });
    if (r.data?.ok === false || !r.data?.result) return { error: r.data?.error || 'The sweep returned nothing.' };
    return r.data.result;
  }, [inputs]);

  const saveModel = useCallback(async (): Promise<{ id: string; name: string } | { error: string }> => {
    const m = (mm: number) => mm / 1000;
    const r = await lensRun<{ part: { id: string; name: string } }>('engineering', 'savePart', {
      kind: 'i-beam',
      name: inputs.name,
      material: inputs.materialId,
      params: {
        length: m(inputs.dims.length),
        height: m(inputs.dims.height),
        flangeWidth: m(inputs.dims.flangeWidth),
        flangeThickness: m(inputs.dims.flangeThickness),
        webThickness: m(inputs.dims.webThickness),
      },
    });
    const part = r.data?.result?.part;
    if (r.data?.ok === false || !part?.id) return { error: r.data?.error || 'The part store refused this model.' };
    return { id: part.id, name: part.name };
  }, [inputs]);

  /** Create the report DTU, read it back, then attach it to the study. */
  const keepAsDtu = useCallback(async (): Promise<{ dtuId: string } | { error: string }> => {
    const current = resultRef.current;
    const call = beamReportDtuCall(current);
    if (!call || !current?.jobId) return { error: 'Run the FEA first — a DTU must record a real solve.' };
    const created = await lensRun(call.domain, call.action, call.input);
    const id = dtuRecordId(created.data);
    if (!id) return { error: created.data?.error || 'The DTU store refused this report.' };
    const back = await lensRun(dtuReadBackCall(id).domain, dtuReadBackCall(id).action, dtuReadBackCall(id).input);
    if (!dtuReadBackMatches(id, back.data)) return { error: `Saved as ${id} but the read-back did not return it.` };
    const kept = await lensRun('engineering', 'beamStudy-keep', {
      jobId: current.jobId,
      dtuId: id,
      ...(workspaceId ? { workspaceId } : {}),
    });
    if (kept.data?.ok === false) return { error: kept.data.error || 'The study did not record the DTU.' };
    setResult((r) => (r && r.jobId === current.jobId ? { ...r, dtuId: id } : r));
    return { dtuId: id };
  }, [workspaceId]);

  return {
    inputs, setInputs, result, previous, materials, status, error,
    solve, sweep, saveModel, keepAsDtu, reload,
    stale: Boolean(result) && !inputsMatchResult(inputs, result),
  };
}

export type ConKayWorkspaceState = ReturnType<typeof useConKayWorkspace>;
