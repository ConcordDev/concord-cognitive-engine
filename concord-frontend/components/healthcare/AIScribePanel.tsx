'use client';

import { useState } from 'react';
import { Sparkles, Loader2, FileText, Copy, Send, Mic } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface SOAP { chiefComplaint: string; subjective: string; objective: string; plan: string; assessment: string }
interface Patient { id: string; firstName: string; lastName: string; mrn: string }
interface Encounter { id: string; number: string; encounterType: string; status: string }

export function AIScribePanel({
  patient, encounter, onApplied,
}: {
  patient?: Patient | null;
  encounter?: Encounter | null;
  onApplied?: () => void;
}) {
  const [raw, setRaw] = useState('');
  const [loading, setLoading] = useState(false);
  const [soap, setSoap] = useState<SOAP | null>(null);
  const [source, setSource] = useState<'brain' | 'deterministic' | 'deterministic_after_brain_error' | 'deterministic_brain_unparseable' | null>(null);
  const [recording, setRecording] = useState(false);
  const [applied, setApplied] = useState(false);

  async function transcribe() {
    if (raw.trim().length < 30) {
      alert('Transcript too short (need 30+ chars).');
      return;
    }
    setLoading(true);
    setSoap(null);
    setApplied(false);
    try {
      const r = await lensRun({ domain: 'healthcare', action: 'ai-scribe', input: { text: raw } });
      if (r.data?.ok === false) { alert(r.data?.error); return; }
      setSoap(r.data?.result?.soap as SOAP);
      setSource(r.data?.result?.source);
    } catch (e) { console.error('[Scribe] failed', e); }
    finally { setLoading(false); }
  }

  function startVoice() {
    // Browser Web Speech API (no external dependency). Most modern browsers expose webkitSpeechRecognition.
    type SRType = new () => SRInstance;
    interface SRInstance { continuous: boolean; interimResults: boolean; lang: string; start(): void; stop(): void; onresult: (e: SREvent) => void; onerror: (e: { error: string }) => void; onend: () => void }
    interface SREvent { resultIndex: number; results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }
    const SR = (window as unknown as { SpeechRecognition?: SRType; webkitSpeechRecognition?: SRType }).SpeechRecognition || (window as unknown as { webkitSpeechRecognition?: SRType }).webkitSpeechRecognition;
    if (!SR) { alert('Browser does not support voice dictation. Try Chrome/Edge.'); return; }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';
    let final = '';
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += t + ' ';
        else interim += t;
      }
      setRaw((prev) => {
        // Replace the last interim if any; for simplicity append finals + show interim at end.
        return (prev.replace(/\s*<<interim>>.*?<<\/interim>>$/, '') + (final ? final : `<<interim>>${interim}<</interim>>`));
      });
    };
    rec.onend = () => {
      setRecording(false);
      setRaw(prev => prev.replace(/<<interim>>.*?<<\/interim>>/g, '').trim() + ' ');
    };
    rec.onerror = (e) => { console.warn('[Scribe] voice error', e.error); setRecording(false); };
    rec.start();
    setRecording(true);
    // Stop on next click
    (window as unknown as { __scribeRec?: SRInstance }).__scribeRec = rec;
  }

  function stopVoice() {
    const rec = (window as unknown as { __scribeRec?: { stop(): void } }).__scribeRec;
    if (rec) rec.stop();
    setRecording(false);
  }

  async function applyToEncounter() {
    if (!soap || !encounter) return;
    try {
      await lensRun({ domain: 'healthcare', action: 'encounters-save-soap', input: {
        id: encounter.id,
        chiefComplaint: soap.chiefComplaint,
        subjective: soap.subjective,
        objective: soap.objective,
        assessment: soap.assessment,
        plan: soap.plan,
      } });
      setApplied(true);
      onApplied?.();
    } catch (e) { console.error('[Scribe] apply', e); }
  }

  async function copyToClipboard() {
    if (!soap) return;
    const formatted = `Chief Complaint: ${soap.chiefComplaint}\n\nSUBJECTIVE:\n${soap.subjective}\n\nOBJECTIVE:\n${soap.objective}\n\nASSESSMENT:\n${soap.assessment}\n\nPLAN:\n${soap.plan}`;
    try {
      await navigator.clipboard.writeText(formatted);
      alert('SOAP note copied to clipboard.');
    } catch (e) { console.error('[Scribe] copy', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/15 rounded-lg overflow-hidden">
      <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-cyan-400" />
        <span className="text-sm font-semibold text-gray-200">AI Scribe — raw note → structured SOAP</span>
        {patient && <span className="text-[10px] text-gray-400">{patient.lastName}, {patient.firstName} · <span className="font-mono">{patient.mrn}</span></span>}
      </header>
      <div className="grid grid-cols-2 gap-0 h-[28rem]">
        {/* Left: raw text input */}
        <div className="p-3 border-r border-white/10 flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Encounter transcript / dictation</div>
            <button
              onClick={recording ? stopVoice : startVoice}
              className={`px-2 py-1 text-xs rounded inline-flex items-center gap-1 ${recording ? 'bg-rose-500 text-white animate-pulse' : 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/25'}`}
            >
              <Mic className="w-3 h-3" />{recording ? 'Stop' : 'Voice dictate'}
            </button>
          </div>
          <textarea
            value={raw}
            onChange={e => setRaw(e.target.value)}
            placeholder="Paste or dictate raw clinical note text. e.g. 'Patient is a 45 y/o male presenting with 3 days of productive cough and fever to 101.2. Exam reveals scattered rhonchi…'"
            className="flex-1 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono whitespace-pre-wrap resize-none"
          />
          <div className="mt-2 flex items-center justify-between">
            <div className="text-[10px] text-gray-400">{raw.length} chars</div>
            <button onClick={transcribe} disabled={loading || raw.length < 30} className="px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-40 inline-flex items-center gap-1">
              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}Structure SOAP
            </button>
          </div>
        </div>

        {/* Right: structured SOAP output */}
        <div className="p-3 flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Structured SOAP{source && <span className="ml-2 text-[9px] text-cyan-300">· {source}</span>}</div>
            {soap && (
              <div className="flex items-center gap-1">
                <button onClick={copyToClipboard} className="px-2 py-1 text-xs rounded border border-white/15 text-gray-300 hover:bg-white/[0.05] inline-flex items-center gap-1">
                  <Copy className="w-3 h-3" />Copy
                </button>
                {encounter && (
                  <button onClick={applyToEncounter} disabled={applied} className="px-2 py-1 text-xs rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400 disabled:opacity-40 inline-flex items-center gap-1">
                    <Send className="w-3 h-3" />{applied ? 'Applied' : 'Apply to encounter'}
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="flex-1 overflow-y-auto pr-1 space-y-2 text-xs">
            {soap ? (
              <>
                <Field label="Chief Complaint" value={soap.chiefComplaint} />
                <Field label="Subjective" value={soap.subjective} />
                <Field label="Objective" value={soap.objective} />
                <Field label="Assessment" value={soap.assessment} />
                <Field label="Plan" value={soap.plan} />
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-gray-400 text-[11px]">
                <FileText className="w-8 h-8 opacity-30 mb-2" />
                Click "Structure SOAP" to convert raw text into structured Chief Complaint / Subjective / Objective / Assessment / Plan.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold">{label}</div>
      <div className="px-2 py-1.5 bg-black/30 border border-white/10 rounded text-gray-200 font-mono whitespace-pre-wrap min-h-[2rem]">{value || <span className="italic text-gray-400">(empty)</span>}</div>
    </div>
  );
}

export default AIScribePanel;
