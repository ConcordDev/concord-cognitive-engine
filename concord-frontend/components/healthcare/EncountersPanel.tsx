'use client';

import { useEffect, useState } from 'react';
import { ClipboardList, Loader2, Plus, Sparkles, CheckCircle, Save, FileText, X } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Patient { id: string; firstName: string; lastName: string; mrn: string }
interface Encounter {
  id: string; number: string;
  patientId: string; patientName: string;
  encounterType: string; encounteredAt: string;
  chiefComplaint: string;
  subjective: string; objective: string; assessment: string; plan: string;
  diagnosisCodes: string[]; cptCodes: string[];
  provider: string;
  status: 'open' | 'signed' | 'amended';
  signedAt: string | null;
}
interface SmartPhrase { id: string; name: string; text: string }

const TYPES = ['office_visit','telehealth','urgent_care','er','admission','followup','annual'];

export function EncountersPanel({ patientId }: { patientId: string }) {
  const [patient, setPatient] = useState<Patient | null>(null);
  const [list, setList] = useState<Encounter[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [active, setActive] = useState<Encounter | null>(null);
  const [smartPhrases, setSmartPhrases] = useState<SmartPhrase[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newEnc, setNewEnc] = useState({ encounterType: 'office_visit', chiefComplaint: '', provider: '' });
  const [saving, setSaving] = useState(false);
  const [signing, setSigning] = useState(false);
  const [avsText, setAvsText] = useState<string | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh is a stable closure; only patientId should retrigger
  useEffect(() => { refresh(); }, [patientId]);

  async function refresh() {
    setLoading(true);
    try {
      const [list, det, sp] = await Promise.all([
        lensRun({ domain: 'healthcare', action: 'encounters-list', input: { patientId } }),
        lensRun({ domain: 'healthcare', action: 'patients-detail', input: { id: patientId } }),
        lensRun({ domain: 'healthcare', action: 'smartphrases-list', input: {} }),
      ]);
      setPatient((det.data?.result?.patient || null) as Patient | null);
      const encs = (list.data?.result?.encounters || []) as Encounter[];
      setList(encs);
      setSmartPhrases((sp.data?.result?.smartPhrases || []) as SmartPhrase[]);
      if (encs.length > 0 && !activeId) {
        setActiveId(encs[0].id);
        setActive(encs[0]);
      }
    } catch (e) { console.error('[Encounters] refresh failed', e); }
    finally { setLoading(false); }
  }

  async function create() {
    try {
      const r = await lensRun({ domain: 'healthcare', action: 'encounters-create', input: { patientId, ...newEnc } });
      if (r.data?.ok === false) { alert(r.data?.error); return; }
      setNewEnc({ encounterType: 'office_visit', chiefComplaint: '', provider: '' });
      setCreating(false);
      const enc = r.data?.result?.encounter;
      await refresh();
      if (enc) { setActiveId(enc.id); setActive(enc); }
    } catch (e) { console.error('[Encounters] create', e); }
  }

  async function save() {
    if (!active) return;
    setSaving(true);
    try {
      await lensRun({ domain: 'healthcare', action: 'encounters-save-soap', input: {
        id: active.id, chiefComplaint: active.chiefComplaint,
        subjective: active.subjective, objective: active.objective,
        assessment: active.assessment, plan: active.plan,
        provider: active.provider,
      } });
      await refresh();
    } catch (e) { console.error('[Encounters] save', e); }
    finally { setSaving(false); }
  }

  async function sign() {
    if (!active) return;
    setSigning(true);
    try {
      const r = await lensRun({ domain: 'healthcare', action: 'encounters-sign', input: { id: active.id } });
      if (r.data?.ok === false) { alert(r.data?.error); return; }
      await refresh();
    } catch (e) { console.error('[Encounters] sign', e); }
    finally { setSigning(false); }
  }

  async function expand(field: 'subjective' | 'objective' | 'assessment' | 'plan') {
    if (!active) return;
    try {
      const r = await lensRun({ domain: 'healthcare', action: 'smartphrases-expand', input: { text: active[field] } });
      const expanded = r.data?.result?.expanded || '';
      setActive({ ...active, [field]: expanded });
    } catch (e) { console.error('[Encounters] expand', e); }
  }

  async function generateAvs() {
    if (!active) return;
    try {
      const r = await lensRun({ domain: 'healthcare', action: 'visit-summary', input: { encounterId: active.id } });
      if (r.data?.ok === false) { alert(r.data?.error); return; }
      setAvsText(String(r.data?.result?.text || ''));
    } catch (e) { console.error('[Encounters] avs', e); }
  }

  const isSigned = active?.status === 'signed';

  return (
    <div className="grid grid-cols-12 gap-3">
      <div className="col-span-4 bg-[#0d1117] border border-cyan-500/15 rounded-lg overflow-hidden">
        <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-semibold text-gray-200">Encounters</span>
          <span className="text-[10px] text-gray-400">{list.length}</span>
          <button onClick={() => setCreating(v => !v)} className="ml-auto px-2.5 py-1 text-xs rounded bg-cyan-500 text-black font-semibold hover:bg-cyan-400 inline-flex items-center gap-1">
            <Plus className="w-3 h-3" />New
          </button>
        </header>
        {patient && <div className="px-4 py-1.5 border-b border-white/10 text-[11px] text-gray-400">{patient.lastName}, {patient.firstName} · <span className="font-mono">{patient.mrn}</span></div>}
        {creating && (
          <div className="p-3 grid grid-cols-12 gap-2 border-b border-white/10">
            <select value={newEnc.encounterType} onChange={e => setNewEnc({ ...newEnc, encounterType: e.target.value })} className="col-span-6 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
              {TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
            </select>
            <input value={newEnc.provider} onChange={e => setNewEnc({ ...newEnc, provider: e.target.value })} placeholder="Provider" className="col-span-6 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <input value={newEnc.chiefComplaint} onChange={e => setNewEnc({ ...newEnc, chiefComplaint: e.target.value })} placeholder="Chief complaint" className="col-span-12 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <button onClick={create} className="col-span-12 px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400">Start encounter</button>
          </div>
        )}
        <ul className="max-h-[36rem] overflow-y-auto divide-y divide-white/5">
          {loading ? (
            <li className="flex items-center justify-center py-8 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" />Loading…</li>
          ) : list.length === 0 ? (
            <li className="px-3 py-8 text-center text-xs text-gray-400">No encounters yet.</li>
          ) : (
            list.map(e => (
              <li key={e.id} onClick={() => { setActiveId(e.id); setActive(e); }} className={cn('px-4 py-2.5 cursor-pointer flex items-center gap-2 hover:bg-white/[0.03]', activeId === e.id && 'bg-cyan-500/[0.06]')}>
                <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded font-mono', e.status === 'signed' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300')}>{e.status}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-white truncate">{e.encounterType.replace('_', ' ')}</div>
                  <div className="text-[10px] text-gray-400 truncate">{e.chiefComplaint || '(no CC)'}</div>
                </div>
                <span className="text-[10px] text-gray-400 font-mono">{e.encounteredAt.slice(0, 10)}</span>
              </li>
            ))
          )}
        </ul>
      </div>

      {/* SOAP editor */}
      <div className="col-span-8">
        {active ? (
          <div className="bg-[#0d1117] border border-cyan-500/15 rounded-lg overflow-hidden">
            <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-cyan-400" />
              <span className="text-sm font-semibold text-gray-200">{active.encounterType.replace('_', ' ')} · {active.encounteredAt.slice(0, 10)}</span>
              {isSigned ? (
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-[10px] text-emerald-300 inline-flex items-center gap-1"><CheckCircle className="w-3.5 h-3.5" /> signed {active.signedAt?.slice(0, 10)}</span>
                  <button onClick={generateAvs} className="px-2.5 py-1 text-xs rounded border border-white/15 text-gray-300 hover:bg-white/[0.05] inline-flex items-center gap-1">
                    <FileText className="w-3 h-3" />After-visit summary
                  </button>
                </div>
              ) : (
                <div className="ml-auto flex items-center gap-2">
                  <button onClick={save} disabled={saving} className="px-2.5 py-1 text-xs rounded border border-white/15 text-gray-300 hover:bg-white/[0.05] disabled:opacity-40 inline-flex items-center gap-1">
                    {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}Save
                  </button>
                  <button onClick={sign} disabled={signing} className="px-2.5 py-1 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-40 inline-flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" />Sign note
                  </button>
                </div>
              )}
            </header>
            <div className="p-4 space-y-3">
              <input
                value={active.chiefComplaint}
                onChange={e => setActive({ ...active, chiefComplaint: e.target.value })}
                disabled={isSigned}
                placeholder="Chief complaint"
                className="w-full px-2 py-1.5 text-sm bg-lattice-deep border border-lattice-border rounded text-white"
              />
              {(['subjective','objective','assessment','plan'] as const).map(field => (
                <div key={field}>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold">{field}</label>
                    {!isSigned && (
                      <button onClick={() => expand(field)} className="text-[10px] text-cyan-300 hover:text-cyan-200 inline-flex items-center gap-1">
                        <Sparkles className="w-3 h-3" />Expand .dotphrases
                      </button>
                    )}
                  </div>
                  <textarea
                    value={active[field]}
                    onChange={e => setActive({ ...active, [field]: e.target.value })}
                    disabled={isSigned}
                    rows={field === 'subjective' || field === 'plan' ? 6 : 4}
                    placeholder={field === 'subjective' ? 'HPI, ROS, history… (use .ros / .dotphrases)' : field === 'objective' ? 'Vitals, exam findings, lab/imaging results… (use .normalexam)' : field === 'assessment' ? 'Diagnoses, clinical impression…' : 'Orders, follow-up, education, return precautions… (use .urireturn etc.)'}
                    className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono whitespace-pre-wrap"
                  />
                </div>
              ))}
              {smartPhrases.length > 0 && !isSigned && (
                <div className="rounded border border-white/10 bg-black/30 p-2">
                  <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1">Available SmartPhrases (type the trigger in any field, then click expand)</div>
                  <div className="flex flex-wrap gap-1">
                    {smartPhrases.map(sp => (
                      <span key={sp.id} className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-300 font-mono" title={sp.text}>{sp.name}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full bg-[#0d1117] border border-cyan-500/15 rounded-lg p-10 text-xs text-gray-400">Pick an encounter or start a new one.</div>
        )}
      </div>

      {avsText !== null && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6" onClick={() => setAvsText(null)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
          <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg w-full max-w-xl max-h-[80%] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
            <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
              <FileText className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-xs font-semibold text-gray-200 flex-1">After-visit summary</span>
              <button aria-label="Close" type="button" onClick={() => setAvsText(null)} className="text-gray-400 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <pre className="overflow-auto p-4 text-[11px] text-gray-200 whitespace-pre-wrap font-mono">{avsText}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

export default EncountersPanel;
