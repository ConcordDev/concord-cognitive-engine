'use client';

import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Stethoscope, AlertTriangle, Activity, FlaskConical, Syringe, ClipboardList, Loader2, Plus, Search, Pencil, X, Check, Camera, Trash2, AlertCircle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui';

interface Patient { id: string; mrn: string; firstName: string; lastName: string; dob: string; sex: string; phone: string; email: string; insurancePlan: string; insuranceMemberId?: string; address: string; emergencyContact?: string; preferredPharmacy?: string }
interface Problem { id: string; name: string; icd10: string; status: 'active' | 'resolved' | 'inactive'; onsetDate: string; resolvedDate: string | null }
interface Allergy { id: string; allergen: string; kind: string; severity: 'mild' | 'moderate' | 'severe' | 'life_threatening'; reaction: string }
interface Vital { id: string; recordedAt: string; systolic: number | null; diastolic: number | null; heartRate: number | null; tempF: number | null; spo2: number | null; weightLb: number | null; heightIn: number | null; bmi?: number; flags: string[] }
interface Lab { id: string; test: string; value: number; unit: string; refLow: number | null; refHigh: number | null; flag: string; collectedAt: string }
interface Immun { id: string; vaccine: string; manufacturer: string; lotNumber: string; administeredAt: string }
interface Encounter { id: string; number: string; encounterType: string; encounteredAt: string; chiefComplaint: string; status: string; signedAt: string | null }
interface PhotoNote { id: string; number: string; imageRef: string; bodyRegion: string; note: string; analysisResult: string; analysisSource: string; analysisModel: string | null; capturedAt: string }
interface ChartDetail {
  patient: Patient;
  problems: Problem[];
  allergies: Allergy[];
  vitals: Vital[];
  labs: Lab[];
  immunizations: Immun[];
  encounters: Encounter[];
  photoNotes: PhotoNote[];
}
interface ICDMatch { code: string; description: string }

const SEV_COLOUR: Record<Allergy['severity'], string> = {
  life_threatening: 'bg-rose-500/30 text-rose-200',
  severe:           'bg-rose-500/20 text-rose-300',
  moderate:         'bg-amber-500/20 text-amber-300',
  mild:             'bg-yellow-500/15 text-yellow-300',
};

const FLAG_COLOUR: Record<string, string> = {
  critical_high: 'bg-rose-500/30 text-rose-200',
  critical_low:  'bg-rose-500/30 text-rose-200',
  high:          'bg-amber-500/20 text-amber-300',
  low:           'bg-amber-500/20 text-amber-300',
  normal:        'bg-emerald-500/15 text-emerald-300',
  unflagged:     'bg-white/10 text-gray-400',
};

const KNOWN_TESTS = ['glucose','a1c','sodium','potassium','creatinine','bun','hemoglobin','hematocrit','wbc','platelets','ast','alt','tsh','ldl','hdl','troponin_i'];

export function PatientChartPanel({ patientId }: { patientId: string }) {
  const [data, setData] = useState<ChartDetail | null>(null);
  const [tab, setTab] = useState<'problems' | 'allergies' | 'meds' | 'vitals' | 'labs' | 'immunizations' | 'encounters' | 'photos'>('problems');
  const [loading, setLoading] = useState(true);
  // Forms
  const [showProblemForm, setShowProblemForm] = useState(false);
  const [problemDraft, setProblemDraft] = useState({ name: '', icd10: '', notes: '' });
  const [icdQuery, setIcdQuery] = useState('');
  const [icdMatches, setIcdMatches] = useState<ICDMatch[]>([]);
  const [allergyDraft, setAllergyDraft] = useState({ allergen: '', kind: 'drug', severity: 'moderate' as Allergy['severity'], reaction: '' });
  const [showAllergyForm, setShowAllergyForm] = useState(false);
  const [vitalsDraft, setVitalsDraft] = useState({ systolic: '', diastolic: '', heartRate: '', tempF: '', spo2: '', weightLb: '', heightIn: '', painScore: '' });
  const [showVitalsForm, setShowVitalsForm] = useState(false);
  const [labDraft, setLabDraft] = useState({ test: 'glucose', value: '' });
  const [showLabForm, setShowLabForm] = useState(false);
  const [knownTests, setKnownTests] = useState<{ test: string; unit: string; low: number; high: number }[]>([]);
  // healthcare.patients-update — was a real macro with no editor anywhere:
  // a patient's demographics/contact/insurance could be created once
  // (patients-create) but never corrected.
  const [editingPatient, setEditingPatient] = useState(false);
  const [patientDraft, setPatientDraft] = useState<Partial<Patient>>({});
  const [savingPatient, setSavingPatient] = useState(false);
  // healthcare.photo-notes-* — closes docs/WAVE4_INVENTORY.md line 188 /
  // healthcare-capability-map.md's "vision (photo→LLaVA analysis) has no
  // image-upload UI anywhere". Uploading a photo runs it through the real
  // vision brain server-side and only shows a result once that call
  // genuinely succeeds — a down/unavailable brain surfaces as an honest
  // error here, never a fabricated analysis.
  const photoFileRef = useRef<HTMLInputElement>(null);
  const [photoBodyRegion, setPhotoBodyRegion] = useState('');
  const [photoNoteText, setPhotoNoteText] = useState('');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh is a stable closure; only patientId should retrigger
  useEffect(() => { refresh(); }, [patientId]);

  async function refresh() {
    setLoading(true);
    try {
      const [r, kt] = await Promise.all([
        lensRun({ domain: 'healthcare', action: 'patients-detail', input: { id: patientId } }),
        lensRun<{ tests: { test: string; unit: string; low: number; high: number }[] }>({ domain: 'healthcare', action: 'labs-known-tests', input: {} }),
      ]);
      setData((r.data?.result as ChartDetail) || null);
      if (kt.data?.ok && kt.data.result?.tests?.length) setKnownTests(kt.data.result.tests);
    } catch (e) { console.error('[Chart] failed', e); }
    finally { setLoading(false); }
  }

  function startEditPatient() {
    if (!data) return;
    setPatientDraft({ ...data.patient });
    setEditingPatient(true);
  }
  async function savePatient() {
    if (!data) return;
    setSavingPatient(true);
    try {
      const r = await lensRun({ domain: 'healthcare', action: 'patients-update', input: { id: data.patient.id, ...patientDraft } });
      if (r.data?.ok === false) { alert(r.data?.error); return; }
      setEditingPatient(false);
      await refresh();
    } catch (e) { console.error('[Chart] patients-update', e); }
    finally { setSavingPatient(false); }
  }

  async function lookupICD(q: string) {
    setIcdQuery(q);
    if (q.length < 2) { setIcdMatches([]); return; }
    try {
      const r = await lensRun({ domain: 'healthcare', action: 'icd10-search', input: { q } });
      setIcdMatches((r.data?.result?.matches || []) as ICDMatch[]);
    } catch {}
  }

  async function addProblem() {
    if (!problemDraft.name.trim()) return;
    try {
      await lensRun({ domain: 'healthcare', action: 'problems-add', input: { ...problemDraft, patientId } });
      setProblemDraft({ name: '', icd10: '', notes: '' });
      setIcdQuery(''); setIcdMatches([]); setShowProblemForm(false);
      await refresh();
    } catch (e) { console.error('[Chart] addProblem', e); }
  }

  async function resolveProblem(id: string) {
    try {
      await lensRun({ domain: 'healthcare', action: 'problems-update', input: { id, status: 'resolved' } });
      await refresh();
    } catch (e) { console.error('[Chart] resolve', e); }
  }

  async function addAllergy() {
    if (!allergyDraft.allergen.trim()) return;
    try {
      await lensRun({ domain: 'healthcare', action: 'allergies-add', input: { ...allergyDraft, patientId } });
      setAllergyDraft({ allergen: '', kind: 'drug', severity: 'moderate', reaction: '' });
      setShowAllergyForm(false);
      await refresh();
    } catch (e) { console.error('[Chart] addAllergy', e); }
  }

  async function deleteAllergy(id: string) {
    if (!confirm('Remove this allergy?')) return;
    try {
      await lensRun({ domain: 'healthcare', action: 'allergies-delete', input: { id } });
      await refresh();
    } catch (e) { console.error('[Chart] deleteAllergy', e); }
  }

  // Reads the selected file as a base64 data: URL (same FileReader.readAsDataURL
  // idiom used by TravelDocsPanel.tsx's onFileSelected / PjTaskDetail.tsx's
  // uploadFile), then runs it through the REAL healthcare.photo-notes-add
  // macro — which itself calls the same callVision()/callVisionUrl() the
  // plain `vision` macro uses. Nothing renders as an analyzed photo until
  // that macro call returns ok:true with a real analysisResult; a down
  // vision brain (or a rejected upload) surfaces as an honest error here.
  async function onPhotoFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (photoFileRef.current) photoFileRef.current.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { setPhotoError('Please choose an image file.'); return; }
    if (file.size > 5 * 1024 * 1024) { setPhotoError('Image exceeds the 5 MB limit.'); return; }
    setPhotoError(null);
    setUploadingPhoto(true);
    try {
      const imageDataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Could not read the image file'));
        reader.readAsDataURL(file);
      });
      const r = await lensRun({
        domain: 'healthcare', action: 'photo-notes-add',
        input: { patientId, imageDataUrl, bodyRegion: photoBodyRegion.trim(), note: photoNoteText.trim() },
      });
      if (r.data?.ok) {
        setPhotoBodyRegion('');
        setPhotoNoteText('');
        await refresh();
      } else {
        setPhotoError(r.data?.error || 'Vision analysis failed — photo was not saved.');
      }
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : 'Could not read or upload the image.');
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function deletePhotoNote(id: string) {
    if (!confirm('Remove this photo note?')) return;
    try {
      await lensRun({ domain: 'healthcare', action: 'photo-notes-delete', input: { id } });
      await refresh();
    } catch (e) { console.error('[Chart] deletePhotoNote', e); }
  }

  async function recordVitals() {
    const input: Record<string, unknown> = { patientId };
    for (const k of Object.keys(vitalsDraft) as Array<keyof typeof vitalsDraft>) {
      if (vitalsDraft[k] !== '') input[k] = Number(vitalsDraft[k]);
    }
    if (Object.keys(input).length === 1) return;
    try {
      await lensRun({ domain: 'healthcare', action: 'vitals-record', input });
      setVitalsDraft({ systolic: '', diastolic: '', heartRate: '', tempF: '', spo2: '', weightLb: '', heightIn: '', painScore: '' });
      setShowVitalsForm(false);
      await refresh();
    } catch (e) { console.error('[Chart] vitals', e); }
  }

  async function recordLab() {
    if (!labDraft.test || !labDraft.value) return;
    try {
      await lensRun({ domain: 'healthcare', action: 'labs-record', input: { patientId, test: labDraft.test, value: Number(labDraft.value) } });
      setLabDraft({ test: 'glucose', value: '' });
      setShowLabForm(false);
      await refresh();
    } catch (e) { console.error('[Chart] lab', e); }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="bg-lattice-deep border border-cyan-500/15 rounded-lg p-3">
          <div className="grid grid-cols-12 gap-3 items-center">
            <div className="col-span-3 flex items-center gap-3">
              <Skeleton variant="avatar" width={48} height={48} />
              <div className="space-y-1.5">
                <Skeleton variant="line" width="8rem" height="1rem" />
                <Skeleton variant="line" width="5rem" height="0.625rem" />
              </div>
            </div>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="col-span-2 space-y-1.5">
                <Skeleton variant="line" width="70%" height="0.625rem" />
                <Skeleton variant="line" width="90%" height="0.75rem" />
              </div>
            ))}
          </div>
        </div>
        <div className="bg-lattice-deep border border-cyan-500/15 rounded-lg overflow-hidden">
          <Skeleton variant="table-row" columns={4} />
          <Skeleton variant="table-row" columns={4} />
          <Skeleton variant="table-row" columns={4} />
        </div>
      </div>
    );
  }
  if (!data) return <div className="p-10 text-center text-xs text-gray-400">Patient not found.</div>;

  const p = data.patient;
  const activeProblems = data.problems.filter(x => x.status === 'active');
  const lifeThreatAllergies = data.allergies.filter(a => a.severity === 'life_threatening' || a.severity === 'severe');
  const criticalLabs = data.labs.filter(l => /critical/.test(l.flag)).slice(0, 5);

  return (
    <div className="space-y-3">
      {/* Patient banner (Epic-style) */}
      <div className="bg-lattice-deep border border-cyan-500/15 rounded-lg p-3">
        <div className="grid grid-cols-12 gap-3 items-center">
          <div className="col-span-3 flex items-center gap-3">
            <div className={cn(
              'w-12 h-12 rounded-full flex items-center justify-center text-base font-bold',
              p.sex === 'F' ? 'bg-rose-500/20 text-rose-200' : p.sex === 'M' ? 'bg-cyan-500/20 text-cyan-200' : 'bg-amber-500/20 text-amber-200',
            )}>{p.firstName.slice(0, 1)}{p.lastName.slice(0, 1)}</div>
            <div>
              <div className="text-base font-semibold text-white">{p.lastName}, {p.firstName}</div>
              <div className="text-[10px] text-gray-400 font-mono">{p.mrn}</div>
            </div>
          </div>
          <div className="col-span-2"><div className="text-[10px] text-gray-400">DOB / Age</div><div className="text-xs text-white">{p.dob || '—'}</div></div>
          <div className="col-span-1"><div className="text-[10px] text-gray-400">Sex</div><div className="text-xs text-white">{p.sex}</div></div>
          <div className="col-span-2"><div className="text-[10px] text-gray-400">Phone / Email</div><div className="text-xs text-white truncate">{p.phone || '—'} {p.email && `· ${p.email}`}</div></div>
          <div className="col-span-3"><div className="text-[10px] text-gray-400">Insurance</div><div className="text-xs text-white truncate">{p.insurancePlan || '—'}</div></div>
          <div className="col-span-1 flex justify-end">
            <button onClick={startEditPatient} aria-label="Edit patient" className="p-1.5 rounded text-gray-400 hover:text-cyan-300 hover:bg-white/5">
              <Pencil className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {editingPatient && (
          <div className="mt-2 border border-white/10 rounded p-3 grid grid-cols-4 gap-2 bg-black/30">
            <input value={patientDraft.phone || ''} onChange={e => setPatientDraft({ ...patientDraft, phone: e.target.value })} placeholder="Phone" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <input value={patientDraft.email || ''} onChange={e => setPatientDraft({ ...patientDraft, email: e.target.value })} placeholder="Email" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <input value={patientDraft.address || ''} onChange={e => setPatientDraft({ ...patientDraft, address: e.target.value })} placeholder="Address" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <input value={patientDraft.insurancePlan || ''} onChange={e => setPatientDraft({ ...patientDraft, insurancePlan: e.target.value })} placeholder="Insurance plan" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <input value={patientDraft.insuranceMemberId || ''} onChange={e => setPatientDraft({ ...patientDraft, insuranceMemberId: e.target.value })} placeholder="Member ID" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <input value={patientDraft.emergencyContact || ''} onChange={e => setPatientDraft({ ...patientDraft, emergencyContact: e.target.value })} placeholder="Emergency contact" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <input value={patientDraft.preferredPharmacy || ''} onChange={e => setPatientDraft({ ...patientDraft, preferredPharmacy: e.target.value })} placeholder="Preferred pharmacy" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <div className="col-span-4 flex items-center gap-2 justify-end">
              <button onClick={() => setEditingPatient(false)} className="px-2.5 py-1 text-xs rounded text-gray-400 hover:text-white inline-flex items-center gap-1"><X className="w-3 h-3" />Cancel</button>
              <button onClick={savePatient} disabled={savingPatient} className="px-2.5 py-1 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-40 inline-flex items-center gap-1"><Check className="w-3 h-3" />{savingPatient ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        )}

        {/* Critical alerts row */}
        {(lifeThreatAllergies.length > 0 || criticalLabs.length > 0) && (
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            {lifeThreatAllergies.map(a => (
              <span key={a.id} className="inline-flex items-center gap-1 text-[10px] uppercase px-2 py-0.5 rounded bg-rose-500/25 text-rose-200 font-mono">
                <AlertTriangle className="w-3 h-3" /> {a.severity === 'life_threatening' ? 'LIFE-THREAT' : 'SEVERE'} · {a.allergen}
              </span>
            ))}
            {criticalLabs.map(l => (
              <span key={l.id} className="inline-flex items-center gap-1 text-[10px] uppercase px-2 py-0.5 rounded bg-rose-500/25 text-rose-200 font-mono">
                <AlertTriangle className="w-3 h-3" /> {l.flag.replace('_', ' ')} · {l.test} {l.value}{l.unit}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Chart tabs */}
      <div className="bg-lattice-deep border border-cyan-500/15 rounded-lg overflow-hidden">
        <nav className="flex items-center gap-1 border-b border-white/10 px-2 py-2 overflow-x-auto">
          {([
            { id: 'problems',      label: 'Problem List', count: activeProblems.length, icon: ClipboardList },
            { id: 'allergies',     label: 'Allergies',    count: data.allergies.length, icon: AlertTriangle },
            { id: 'vitals',        label: 'Vitals',       count: data.vitals.length,    icon: Activity },
            { id: 'labs',          label: 'Labs',         count: data.labs.length,      icon: FlaskConical },
            { id: 'immunizations', label: 'Immunizations',count: data.immunizations.length, icon: Syringe },
            { id: 'encounters',    label: 'Encounters',   count: data.encounters.length,icon: Stethoscope },
            { id: 'photos',        label: 'Photos',       count: data.photoNotes.length,icon: Camera },
          ] as const).map(t => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button key={t.id} onClick={() => setTab(t.id)} className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded',
                active ? 'bg-cyan-500/15 text-cyan-200 border border-cyan-500/30' : 'text-gray-400 hover:text-white border border-transparent',
              )}>
                <Icon className="w-3 h-3" />
                {t.label}
                <span className="text-[10px] text-gray-400 font-mono">({t.count})</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4">
          {/* PROBLEMS */}
          {tab === 'problems' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Active problems · {activeProblems.length}</div>
                <button onClick={() => setShowProblemForm(v => !v)} className="px-2.5 py-1 text-xs rounded bg-cyan-500 text-black font-semibold hover:bg-cyan-400 inline-flex items-center gap-1">
                  <Plus className="w-3 h-3" />Add problem
                </button>
              </div>
              {showProblemForm && (
                <div className="border border-white/10 rounded p-3 space-y-2 bg-black/30">
                  <input value={problemDraft.name} onChange={e => setProblemDraft({ ...problemDraft, name: e.target.value })} placeholder="Problem (e.g. Hypertension) *" className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
                  <div className="flex items-center gap-2">
                    <Search className="w-3.5 h-3.5 text-gray-400" />
                    <input value={icdQuery} onChange={e => lookupICD(e.target.value)} placeholder="Search ICD-10 (live NLM lookup)" className="flex-1 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
                    {problemDraft.icd10 && <span className="text-[10px] font-mono text-emerald-300">{problemDraft.icd10}</span>}
                  </div>
                  {icdMatches.length > 0 && (
                    <ul className="max-h-32 overflow-y-auto border border-white/10 rounded bg-black/40">
                      {icdMatches.map(m => (
                        <li key={m.code} onClick={() => { setProblemDraft({ ...problemDraft, icd10: m.code, name: problemDraft.name || m.description }); setIcdMatches([]); setIcdQuery(m.code); }} className="px-2 py-1 text-[11px] hover:bg-cyan-500/10 cursor-pointer flex gap-2">
                          <span className="font-mono text-cyan-300 w-16">{m.code}</span>
                          <span className="text-white truncate">{m.description}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <input value={problemDraft.notes} onChange={e => setProblemDraft({ ...problemDraft, notes: e.target.value })} placeholder="Notes" className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
                  <button onClick={addProblem} className="w-full px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400">Save problem</button>
                </div>
              )}
              {data.problems.length === 0 ? (
                <div className="py-6 text-center text-xs text-gray-400">No problems documented.</div>
              ) : (
                <ul className="divide-y divide-white/5">
                  {data.problems.map(pr => (
                    <li key={pr.id} className="py-2 flex items-center gap-3">
                      <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded font-mono', pr.status === 'active' ? 'bg-amber-500/20 text-amber-300' : 'bg-gray-500/20 text-gray-400')}>{pr.status}</span>
                      <span className="text-xs font-mono text-cyan-300 w-16">{pr.icd10 || '—'}</span>
                      <span className="flex-1 text-sm text-white truncate">{pr.name}</span>
                      <span className="text-[10px] text-gray-400">{pr.onsetDate}</span>
                      {pr.status === 'active' && <button onClick={() => resolveProblem(pr.id)} className="px-2 py-0.5 text-[10px] rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30">Resolve</button>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* ALLERGIES */}
          {tab === 'allergies' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Allergies · {data.allergies.length}</div>
                <button onClick={() => setShowAllergyForm(v => !v)} className="px-2.5 py-1 text-xs rounded bg-cyan-500 text-black font-semibold hover:bg-cyan-400 inline-flex items-center gap-1">
                  <Plus className="w-3 h-3" />Add allergy
                </button>
              </div>
              {showAllergyForm && (
                <div className="border border-white/10 rounded p-3 grid grid-cols-12 gap-2 bg-black/30">
                  <input value={allergyDraft.allergen} onChange={e => setAllergyDraft({ ...allergyDraft, allergen: e.target.value })} placeholder="Allergen *" className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
                  <select value={allergyDraft.kind} onChange={e => setAllergyDraft({ ...allergyDraft, kind: e.target.value })} className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
                    <option value="drug">Drug</option><option value="food">Food</option><option value="environmental">Environmental</option><option value="other">Other</option>
                  </select>
                  <select value={allergyDraft.severity} onChange={e => setAllergyDraft({ ...allergyDraft, severity: e.target.value as Allergy['severity'] })} className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
                    <option value="mild">Mild</option><option value="moderate">Moderate</option><option value="severe">Severe</option><option value="life_threatening">Life-threatening</option>
                  </select>
                  <button onClick={addAllergy} className="col-span-2 px-2 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400">Save</button>
                  <input value={allergyDraft.reaction} onChange={e => setAllergyDraft({ ...allergyDraft, reaction: e.target.value })} placeholder="Reaction (e.g. hives, anaphylaxis)" className="col-span-12 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
                </div>
              )}
              {data.allergies.length === 0 ? (
                <div className="py-6 text-center text-xs text-emerald-300/70">No known allergies (NKDA)</div>
              ) : (
                <ul className="divide-y divide-white/5">
                  {data.allergies.map(a => (
                    <li key={a.id} className="py-2 flex items-center gap-3 group">
                      <AlertTriangle className={cn('w-3.5 h-3.5', a.severity === 'life_threatening' || a.severity === 'severe' ? 'text-rose-400' : 'text-amber-400')} />
                      <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded font-mono', SEV_COLOUR[a.severity])}>{a.severity.replace('_', ' ')}</span>
                      <span className="text-[10px] text-gray-400 uppercase">{a.kind}</span>
                      <span className="flex-1 text-sm text-white">{a.allergen}</span>
                      <span className="text-[10px] text-gray-400 truncate max-w-[200px]">{a.reaction || '—'}</span>
                      <button onClick={() => deleteAllergy(a.id)} className="opacity-0 group-hover:opacity-100 text-rose-300 text-[10px]">remove</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* VITALS */}
          {tab === 'vitals' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Vitals · {data.vitals.length}</div>
                <button onClick={() => setShowVitalsForm(v => !v)} className="px-2.5 py-1 text-xs rounded bg-cyan-500 text-black font-semibold hover:bg-cyan-400 inline-flex items-center gap-1">
                  <Plus className="w-3 h-3" />Record vitals
                </button>
              </div>
              {showVitalsForm && (
                <div className="border border-white/10 rounded p-3 grid grid-cols-8 gap-2 bg-black/30">
                  {(['systolic','diastolic','heartRate','tempF','spo2','weightLb','heightIn','painScore'] as const).map(k => (
                    <div key={k}>
                      <div className="text-[10px] text-gray-400 mb-0.5 uppercase">{k.replace(/([A-Z])/g, ' $1').replace('Lb', '(lb)').replace('In', '(in)').replace('F', '(°F)')}</div>
                      <input type="number" step="0.1" value={vitalsDraft[k]} onChange={e => setVitalsDraft({ ...vitalsDraft, [k]: e.target.value })} className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
                    </div>
                  ))}
                  <button onClick={recordVitals} className="col-span-8 px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400">Record</button>
                </div>
              )}
              {data.vitals.length === 0 ? (
                <div className="py-6 text-center text-xs text-gray-400">No vitals recorded.</div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="text-[10px] uppercase text-gray-400 border-b border-white/5">
                    <tr><th scope="col" className="text-left py-1.5">Time</th><th scope="col">BP</th><th scope="col">HR</th><th scope="col">Temp</th><th scope="col">SpO2</th><th scope="col">BMI</th><th scope="col">Pain</th><th scope="col" className="text-right">Flags</th></tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {data.vitals.slice(0, 12).map(v => (
                      <tr key={v.id} className="hover:bg-white/[0.03]">
                        <td className="py-1.5 text-[10px] text-gray-400 font-mono">{v.recordedAt.slice(0, 16).replace('T', ' ')}</td>
                        <td className="font-mono text-white">{v.systolic !== null ? `${v.systolic}/${v.diastolic}` : '—'}</td>
                        <td className="font-mono text-white">{v.heartRate ?? '—'}</td>
                        <td className="font-mono text-white">{v.tempF ?? '—'}</td>
                        <td className="font-mono text-white">{v.spo2 ?? '—'}{v.spo2 ? '%' : ''}</td>
                        <td className="font-mono text-white">{v.bmi ?? '—'}</td>
                        <td className="font-mono text-white">{v.heartRate !== null ? '' : ''}{(v as Vital & { painScore?: number }).painScore ?? '—'}</td>
                        <td className="text-right">
                          {v.flags?.length > 0 && (
                            <div className="flex justify-end gap-1 flex-wrap">
                              {v.flags.map(f => <span key={f} className="text-[9px] px-1 rounded bg-rose-500/20 text-rose-300 font-mono">{f}</span>)}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* LABS */}
          {tab === 'labs' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Lab results · {data.labs.length}</div>
                <button onClick={() => setShowLabForm(v => !v)} className="px-2.5 py-1 text-xs rounded bg-cyan-500 text-black font-semibold hover:bg-cyan-400 inline-flex items-center gap-1">
                  <Plus className="w-3 h-3" />Record lab
                </button>
              </div>
              {showLabForm && (
                <div className="border border-white/10 rounded p-3 grid grid-cols-12 gap-2 bg-black/30">
                  <select value={labDraft.test} onChange={e => setLabDraft({ ...labDraft, test: e.target.value })} className="col-span-6 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
                    {(knownTests.length > 0 ? knownTests.map(t => t.test) : KNOWN_TESTS).map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <input type="number" step="0.01" value={labDraft.value} onChange={e => setLabDraft({ ...labDraft, value: e.target.value })} placeholder="Value *" className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
                  <button onClick={recordLab} className="col-span-3 px-2 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400">Save</button>
                  {(() => {
                    const range = knownTests.find(t => t.test === labDraft.test);
                    return range ? (
                      <p className="col-span-12 text-[10px] text-gray-400">Reference range: {range.low}–{range.high} {range.unit}</p>
                    ) : null;
                  })()}
                </div>
              )}
              {data.labs.length === 0 ? (
                <div className="py-6 text-center text-xs text-gray-400">No lab results.</div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="text-[10px] uppercase text-gray-400 border-b border-white/5">
                    <tr><th scope="col" className="text-left py-1.5">Test</th><th scope="col" className="text-right">Value</th><th scope="col" className="text-right">Reference</th><th scope="col" className="text-right">Flag</th><th scope="col" className="text-right">Date</th></tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {data.labs.map(l => (
                      <tr key={l.id} className="hover:bg-white/[0.03]">
                        <td className="py-1.5 text-white">{l.test}</td>
                        <td className="text-right font-mono text-white">{l.value} {l.unit}</td>
                        <td className="text-right font-mono text-[10px] text-gray-400">{l.refLow !== null && l.refHigh !== null ? `${l.refLow}–${l.refHigh}` : '—'}</td>
                        <td className="text-right"><span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded font-mono', FLAG_COLOUR[l.flag] || FLAG_COLOUR.unflagged)}>{l.flag.replace('_', ' ')}</span></td>
                        <td className="text-right text-[10px] text-gray-400 font-mono">{l.collectedAt.slice(0, 10)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* IMMUNIZATIONS */}
          {tab === 'immunizations' && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-2">Immunizations · {data.immunizations.length}</div>
              {data.immunizations.length === 0 ? (
                <div className="py-6 text-center text-xs text-gray-400">No immunizations on file.</div>
              ) : (
                <ul className="divide-y divide-white/5">
                  {data.immunizations.map(i => (
                    <li key={i.id} className="py-2 flex items-center gap-3">
                      <Syringe className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-sm text-white">{i.vaccine}</span>
                      <span className="text-[10px] text-gray-400">{i.manufacturer || '—'} · lot {i.lotNumber || '—'}</span>
                      <span className="ml-auto text-[10px] text-gray-400 font-mono">{i.administeredAt}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* ENCOUNTERS */}
          {tab === 'encounters' && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-2">Encounters · {data.encounters.length}</div>
              {data.encounters.length === 0 ? (
                <div className="py-6 text-center text-xs text-gray-400">No encounters yet. Start one from the Encounters tab.</div>
              ) : (
                <ul className="divide-y divide-white/5">
                  {data.encounters.map(e => (
                    <li key={e.id} className="py-2 flex items-center gap-3">
                      <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded font-mono', e.status === 'signed' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300')}>{e.status}</span>
                      <span className="font-mono text-[10px] text-gray-400">{e.number}</span>
                      <span className="text-xs text-white truncate flex-1">{e.encounterType.replace('_', ' ')}: {e.chiefComplaint || '(no CC)'}</span>
                      <span className="text-[10px] text-gray-400 font-mono">{e.encounteredAt.slice(0, 10)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* PHOTOS */}
          {tab === 'photos' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Photo notes · {data.photoNotes.length}</div>
              </div>

              <div className="border border-white/10 rounded p-3 space-y-2 bg-black/30">
                <div className="grid grid-cols-2 gap-2">
                  <input value={photoBodyRegion} onChange={e => setPhotoBodyRegion(e.target.value)} placeholder="Body region (e.g. left forearm)" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
                  <input value={photoNoteText} onChange={e => setPhotoNoteText(e.target.value)} placeholder="Note (optional)" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
                </div>
                <input ref={photoFileRef} type="file" accept="image/*" className="hidden" onChange={e => { void onPhotoFileSelected(e); }} />
                <button onClick={() => photoFileRef.current?.click()} disabled={uploadingPhoto}
                  className="w-full px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-40 inline-flex items-center justify-center gap-1.5">
                  {uploadingPhoto ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Analyzing photo…</> : <><Camera className="w-3.5 h-3.5" />Capture / upload photo</>}
                </button>
                <p className="text-[10px] text-gray-400">Routed through the real vision brain server-side (Qwen2.5-VL). The photo is only saved to the chart once analysis succeeds.</p>
                {photoError && (
                  <div className="flex items-start gap-1.5 text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded px-2 py-1.5">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{photoError}</span>
                  </div>
                )}
              </div>

              {data.photoNotes.length === 0 ? (
                <div className="py-6 text-center text-xs text-gray-400">No photo notes yet.</div>
              ) : (
                <ul className="divide-y divide-white/5">
                  {data.photoNotes.map(ph => (
                    <li key={ph.id} className="py-2.5 flex items-start gap-3 group">
                      {/* eslint-disable-next-line @next/next/no-img-element -- data: URL thumbnail, same pattern as LensAgentPanel.tsx */}
                      <img src={ph.imageRef} alt={ph.bodyRegion || 'patient photo'} className="w-16 h-16 rounded object-cover border border-white/10 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-[10px] text-gray-400">{ph.number}</span>
                          {ph.bodyRegion && <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-200">{ph.bodyRegion}</span>}
                          <span className="text-[10px] text-gray-400 font-mono">{ph.capturedAt.slice(0, 16).replace('T', ' ')}</span>
                        </div>
                        {ph.note && <p className="text-xs text-white mt-1">{ph.note}</p>}
                        <p className="text-xs text-gray-300 mt-1 whitespace-pre-wrap">{ph.analysisResult}</p>
                        <p className="text-[10px] text-gray-500 mt-0.5">Vision analysis · {ph.analysisModel || ph.analysisSource}</p>
                      </div>
                      <button onClick={() => deletePhotoNote(ph.id)} aria-label="Delete photo note" className="opacity-0 group-hover:opacity-100 text-rose-300 hover:text-rose-200 shrink-0">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default PatientChartPanel;
