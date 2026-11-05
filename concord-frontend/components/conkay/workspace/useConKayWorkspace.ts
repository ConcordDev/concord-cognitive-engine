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
import { currentModelFromStudy, nextModelName, preferredModelName, setConkayCurrentModel } from '@/lib/conkay/model-export';
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
  /** Required safety factor; null/undefined = check against yield (SF 1). */
  requiredSafetyFactor?: number | null;
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
  name: 'I-beam',
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
    && inputs.materialId === r.material.id
    && (inputs.requiredSafetyFactor ?? null) === (r.safetyCheck?.stated ? r.safetyCheck.requiredSafetyFactor : null);
}

export function useConKayWorkspace(workspaceId: string | null) {
  const [inputs, setInputs] = useState<StudyInputs>(NEW_STUDY);
  const [result, setResult] = useState<BeamStudyResult | null>(null);
  const [previous, setPrevious] = useState<BeamStudyResult | null>(null);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [status, setStatus] = useState<SolveStatus>('loading');
  const [error, setError] = useState('');
  /** The Models entry the open study belongs to (Save updates it in place). */
  const [partId, setPartId] = useState<string | null>(null);
  /** No saved study for this workspace: the UI starts on "What do you want to build?". */
  const [fresh, setFresh] = useState(false);
  const startBeam = useCallback(() => setFresh(false), []);
  const resultRef = useRef<BeamStudyResult | null>(null);
  useEffect(() => { resultRef.current = result; }, [result]);

  // The lens-header Export menu reads this. It is the study on screen, with
  // solver numbers only when they still match these inputs.
  useEffect(() => {
    const fresh = inputsMatchResult(inputs, result) ? result : null;
    setConkayCurrentModel(currentModelFromStudy(inputs, fresh));
    return () => setConkayCurrentModel(null);
  }, [inputs, result]);

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
    setFresh(!study);
    setResult(study);
    setPrevious(null);
    setInputs(study
      ? {
        name: study.name, dims: study.dims, loadN: study.loadN, support: study.support, materialId: study.material.id,
        requiredSafetyFactor: study.safetyCheck?.stated ? study.safetyCheck.requiredSafetyFactor : null,
      }
      : NEW_STUDY);
    setStatus('idle');
    // Adopt the Models entry this study was saved as (same name and section),
    // so Save keeps updating it in place across reloads. Best-effort: any
    // mismatch simply leaves the study unlinked.
    if (study) {
      try {
        const listed = await lensRun<{ parts: Array<{ id: string; name?: string; params?: Record<string, number>; material?: string | null }> }>('engineering', 'listParts', {});
        const parts = listed.data?.ok === false ? [] : (listed.data?.result?.parts ?? []);
        const mm = (v?: number) => Math.round((v ?? 0) * 1000 * 1000) / 1000;
        const match = parts.filter((p) => p.name === study.name && p.params
          && Math.abs(mm(p.params.length) - study.dims.length) < 1e-6
          && Math.abs(mm(p.params.webThickness) - study.dims.webThickness) < 1e-6
          && Math.abs(mm(p.params.flangeWidth) - study.dims.flangeWidth) < 1e-6);
        setPartId(match.length === 1 ? match[0].id : null);
      } catch { setPartId(null); }
    } else {
      setPartId(null);
    }
    return study;
  }, [workspaceId]);

  useEffect(() => { void reload(); }, [reload]);

  const solve = useCallback(async (next?: StudyInputs): Promise<{ result: BeamStudyResult } | { error: string }> => {
    const run = next ?? inputs;
    if (next) setInputs(next);
    setStatus('solving');
    setFresh(false);
    setError('');
    const r = await lensRun<BeamStudyResult>('engineering', 'beamStudy', {
      name: run.name,
      dims: run.dims,
      loadN: run.loadN,
      support: run.support,
      material: run.materialId,
      ...(run.requiredSafetyFactor ? { requiredSafetyFactor: run.requiredSafetyFactor } : {}),
      ...(workspaceId ? { workspaceId } : {}),
    });
    const res = r.data?.result;
    if (r.data?.ok === false || !res || !Number.isFinite(res.maxStressMPa)) {
      const msg = r.data?.error || 'The solver returned no result.';
      setStatus('error');
      setError(msg);
      return { error: msg };
    }
    // dtuId rides the solve response: the server carries a kept DTU over
    // when the re-solve's inputs are identical to the kept solve's (F12a).
    const full: BeamStudyResult = { ...res, workspaceId, dtuId: res.dtuId ?? null };
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

  const suggestName = useCallback(async (current?: string): Promise<string> => {
    const listed = await lensRun<{ parts: Array<{ name?: string }> }>('engineering', 'listParts', {});
    const existing = listed.data?.ok === false
      ? []
      : (listed.data?.result?.parts ?? []).map((p) => String(p?.name || ''));
    return nextModelName(preferredModelName(current ?? inputs.name, 'i-beam'), existing);
  }, [inputs.name]);

  /**
   * Save the open study to Models. With a linked part (opened from Models,
   * saved before, or adopted on reload) this UPDATES that entry in place;
   * otherwise it creates one — under exactly the name given. A name that
   * belongs to a different model is refused loudly, never silently
   * incremented (ConKay F3). `asCopy` forces a new entry (Save as copy).
   */
  const saveModel = useCallback(async (nameOverride?: string, opts?: { asCopy?: boolean }): Promise<{ id: string; name: string } | { error: string }> => {
    const listed = await lensRun<{ parts: Array<{ id: string; name?: string }> }>('engineering', 'listParts', {});
    const existing = listed.data?.ok === false
      ? []
      : (listed.data?.result?.parts ?? []).map((p) => ({ id: String(p?.id || ''), name: String(p?.name || '') }));
    const requested = nameOverride !== undefined ? nameOverride.trim() : preferredModelName(inputs.name, 'i-beam');
    if (!requested) return { error: 'A model name is required.' };
    const linkId = opts?.asCopy ? null : partId;
    const clash = existing.find((p) => p.name === requested && p.id !== linkId);
    if (clash) {
      return { error: `A model named “${requested}” already exists. Open it from Models to update it, or save under a different name.` };
    }
    const fresh = inputsMatchResult(inputs, resultRef.current) ? resultRef.current : null;
    const snapshot = currentModelFromStudy(inputs, fresh);
    const r = await lensRun<{ part: { id: string; name: string } }>('engineering', 'savePart', {
      ...(linkId ? { id: linkId } : {}),
      kind: 'i-beam',
      designType: 'i-beam',
      name: requested,
      material: inputs.materialId,
      params: snapshot.params,
      study: snapshot.study,
      results: snapshot.results,
      solverVersion: snapshot.solverVersion,
    });
    const part = r.data?.result?.part;
    if (r.data?.ok === false || !part?.id) return { error: r.data?.error || 'The part store refused this model.' };
    setPartId(part.id);
    return { id: part.id, name: part.name };
  }, [inputs, partId]);

  /** Start a fresh study in this workspace (ConKay F4): the template, unsolved, unlinked. */
  const resetStudy = useCallback(() => {
    setInputs(NEW_STUDY);
    setResult(null);
    setPrevious(null);
    resultRef.current = null;
    setPartId(null);
    setFresh(false);
    setStatus('idle');
    setError('');
  }, []);

  /** Open a saved model as the study, linked so Save updates it in place. */
  const openModel = useCallback((name: string, dims: BeamDims, materialId: string | null, id: string) => {
    setInputs((s) => ({ ...s, name, dims, materialId: materialId || s.materialId }));
    setPartId(id || null);
    setFresh(false);
  }, []);

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
    solve, sweep, saveModel, suggestName, keepAsDtu, reload, resetStudy, openModel,
    partId,
    fresh, startBeam,
    stale: Boolean(result) && !inputsMatchResult(inputs, result),
  };
}

export type ConKayWorkspaceState = ReturnType<typeof useConKayWorkspace>;
