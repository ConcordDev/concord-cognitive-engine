'use client';

/**
 * EFBEndorsements — logbook endorsements + ratings tracking.
 *
 * ForeFlight feature-parity backlog item 6. Per-user CRUD over CFI
 * endorsements and pilot certificates / ratings via endorsements-list /
 * endorsement-add / endorsement-delete / rating-add / rating-delete.
 * All data is the user's own input — no fabricated endorsements.
 */

import { useState, useEffect, useCallback } from 'react';
import { Loader2, Award, Stamp, Plus, Trash2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Endorsement {
  id: string;
  kind: string;
  date: string;
  cfiName: string;
  cfiCertNumber: string;
  farReference: string;
  expiryDate: string | null;
  text: string;
}
interface Rating {
  id: string;
  kind: string;
  dateEarned: string;
  certificateNumber: string;
  examiner: string;
  checkrideAirport: string;
  limitations: string;
}

const ENDORSEMENT_TYPES = [
  'solo', 'solo_cross_country', 'complex', 'high_performance', 'tailwheel',
  'high_altitude', 'flight_review', 'ipc', 'checkride_recommendation',
  'knowledge_test', 'practical_test', 'type_specific', 'other',
];
const RATING_TYPES = [
  'student_pilot', 'sport_pilot', 'recreational_pilot', 'private_pilot',
  'commercial_pilot', 'atp', 'instrument_airplane', 'multi_engine_land',
  'single_engine_sea', 'multi_engine_sea', 'cfi', 'cfii', 'mei',
  'type_rating', 'glider', 'rotorcraft', 'other',
];

const fmt = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const today = () => new Date().toISOString().slice(0, 10);

export default function EFBEndorsements() {
  const [endorsements, setEndorsements] = useState<Endorsement[]>([]);
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [endForm, setEndForm] = useState({
    kind: 'flight_review',
    date: today(),
    cfiName: '',
    cfiCertNumber: '',
    farReference: '',
    expiresMonths: 0,
    text: '',
  });
  const [ratForm, setRatForm] = useState({
    kind: 'private_pilot',
    dateEarned: today(),
    certificateNumber: '',
    examiner: '',
    checkrideAirport: '',
    limitations: '',
  });
  const [savingEnd, setSavingEnd] = useState(false);
  const [savingRat, setSavingRat] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('aviation', 'endorsements-list', {});
    if (r.data?.ok && r.data.result) {
      const res = r.data.result as { endorsements?: Endorsement[]; ratings?: Rating[] };
      setEndorsements(res.endorsements || []);
      setRatings(res.ratings || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const addEndorsement = useCallback(async () => {
    if (!endForm.cfiName.trim()) {
      setError('CFI name is required for an endorsement.');
      return;
    }
    setSavingEnd(true);
    setError(null);
    const r = await lensRun('aviation', 'endorsement-add', { ...endForm });
    if (r.data?.ok) {
      setEndForm({ ...endForm, cfiName: '', cfiCertNumber: '', farReference: '', text: '' });
      await refresh();
    } else {
      setError(r.data?.error || 'Could not add endorsement.');
    }
    setSavingEnd(false);
  }, [endForm, refresh]);

  const addRating = useCallback(async () => {
    setSavingRat(true);
    setError(null);
    const r = await lensRun('aviation', 'rating-add', { ...ratForm });
    if (r.data?.ok) {
      setRatForm({ ...ratForm, certificateNumber: '', examiner: '', checkrideAirport: '', limitations: '' });
      await refresh();
    } else {
      setError(r.data?.error || 'Could not add rating.');
    }
    setSavingRat(false);
  }, [ratForm, refresh]);

  const delEndorsement = useCallback(
    async (id: string) => {
      await lensRun('aviation', 'endorsement-delete', { id });
      await refresh();
    },
    [refresh],
  );
  const delRating = useCallback(
    async (id: string) => {
      await lensRun('aviation', 'rating-delete', { id });
      await refresh();
    },
    [refresh],
  );

  const inputCls =
    'px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100';

  return (
    <div className="space-y-4">
      {error && <p className="text-xs text-rose-300">{error}</p>}

      {/* Ratings */}
      <div className="rounded-lg border border-amber-500/20 bg-black/20 p-3">
        <div className="flex items-center gap-2 mb-3">
          <Award className="w-4 h-4 text-amber-400" />
          <span className="text-xs font-semibold text-gray-200 uppercase tracking-wider">
            Certificates & ratings
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <select
            value={ratForm.kind}
            onChange={(e) => setRatForm({ ...ratForm, kind: e.target.value })}
            className={inputCls + ' font-mono'}
          >
            {RATING_TYPES.map((t) => (
              <option key={t} value={t}>
                {fmt(t)}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={ratForm.dateEarned}
            onChange={(e) => setRatForm({ ...ratForm, dateEarned: e.target.value })}
            className={inputCls + ' font-mono'}
          />
          <input
            type="text"
            value={ratForm.certificateNumber}
            onChange={(e) => setRatForm({ ...ratForm, certificateNumber: e.target.value })}
            placeholder="Certificate #"
            className={inputCls}
          />
          <input
            type="text"
            value={ratForm.examiner}
            onChange={(e) => setRatForm({ ...ratForm, examiner: e.target.value })}
            placeholder="Examiner / DPE"
            className={inputCls}
          />
          <input
            type="text"
            value={ratForm.checkrideAirport}
            onChange={(e) => setRatForm({ ...ratForm, checkrideAirport: e.target.value.toUpperCase() })}
            placeholder="Checkride airport"
            maxLength={4}
            className={inputCls + ' font-mono uppercase'}
          />
          <input
            type="text"
            value={ratForm.limitations}
            onChange={(e) => setRatForm({ ...ratForm, limitations: e.target.value })}
            placeholder="Limitations (optional)"
            className={inputCls}
          />
        </div>
        <button
          type="button"
          onClick={addRating}
          disabled={savingRat}
          className="inline-flex items-center gap-1 px-3 py-1 rounded-md border border-amber-500/40 bg-amber-500/15 text-xs text-amber-100 disabled:opacity-40"
        >
          {savingRat ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
          Add rating
        </button>

        {loading ? (
          <div className="flex items-center py-4 text-xs text-gray-500">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
          </div>
        ) : ratings.length === 0 ? (
          <p className="text-xs text-gray-500 mt-3">No ratings recorded yet.</p>
        ) : (
          <div className="space-y-1.5 mt-3">
            {ratings.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between gap-2 rounded border border-white/5 bg-black/30 px-2 py-1.5 group"
              >
                <div>
                  <p className="text-xs text-amber-200 font-mono">{fmt(r.kind)}</p>
                  <p className="text-[10px] text-gray-500">
                    Earned {r.dateEarned}
                    {r.examiner ? ` · ${r.examiner}` : ''}
                    {r.checkrideAirport ? ` · ${r.checkrideAirport}` : ''}
                    {r.limitations ? ` · ${r.limitations}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => delRating(r.id)}
                  className="p-1 text-gray-600 hover:text-rose-300 opacity-0 group-hover:opacity-100"
                  aria-label="Delete rating"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Endorsements */}
      <div className="rounded-lg border border-sky-500/20 bg-black/20 p-3">
        <div className="flex items-center gap-2 mb-3">
          <Stamp className="w-4 h-4 text-sky-400" />
          <span className="text-xs font-semibold text-gray-200 uppercase tracking-wider">
            CFI endorsements
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 mb-2">
          <select
            value={endForm.kind}
            onChange={(e) => setEndForm({ ...endForm, kind: e.target.value })}
            className={inputCls + ' font-mono'}
          >
            {ENDORSEMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {fmt(t)}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={endForm.date}
            onChange={(e) => setEndForm({ ...endForm, date: e.target.value })}
            className={inputCls + ' font-mono'}
          />
          <input
            type="text"
            value={endForm.cfiName}
            onChange={(e) => setEndForm({ ...endForm, cfiName: e.target.value })}
            placeholder="CFI name"
            className={inputCls}
          />
          <input
            type="text"
            value={endForm.cfiCertNumber}
            onChange={(e) => setEndForm({ ...endForm, cfiCertNumber: e.target.value })}
            placeholder="CFI certificate #"
            className={inputCls}
          />
          <input
            type="text"
            value={endForm.farReference}
            onChange={(e) => setEndForm({ ...endForm, farReference: e.target.value })}
            placeholder="FAR reference (61.65)"
            className={inputCls + ' font-mono'}
          />
          <input
            type="number"
            min={0}
            value={endForm.expiresMonths}
            onChange={(e) => setEndForm({ ...endForm, expiresMonths: Math.max(0, Number(e.target.value)) })}
            placeholder="Expires (months, 0 = none)"
            className={inputCls + ' font-mono'}
          />
        </div>
        <textarea
          value={endForm.text}
          onChange={(e) => setEndForm({ ...endForm, text: e.target.value })}
          placeholder="Endorsement text (optional)"
          rows={2}
          className={inputCls + ' w-full mb-2'}
        />
        <button
          type="button"
          onClick={addEndorsement}
          disabled={savingEnd}
          className="inline-flex items-center gap-1 px-3 py-1 rounded-md border border-sky-500/40 bg-sky-500/15 text-xs text-sky-100 disabled:opacity-40"
        >
          {savingEnd ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
          Add endorsement
        </button>

        {!loading && endorsements.length === 0 ? (
          <p className="text-xs text-gray-500 mt-3">No endorsements recorded yet.</p>
        ) : (
          <div className="space-y-1.5 mt-3">
            {endorsements.map((e) => {
              const expired = e.expiryDate ? new Date(e.expiryDate).getTime() < Date.now() : false;
              return (
                <div
                  key={e.id}
                  className="flex items-center justify-between gap-2 rounded border border-white/5 bg-black/30 px-2 py-1.5 group"
                >
                  <div className="min-w-0">
                    <p className="text-xs text-sky-200 font-mono">
                      {fmt(e.kind)}
                      {e.farReference ? ` · ${e.farReference}` : ''}
                    </p>
                    <p className="text-[10px] text-gray-500 truncate">
                      {e.date} · {e.cfiName}
                      {e.cfiCertNumber ? ` (${e.cfiCertNumber})` : ''}
                      {e.expiryDate && (
                        <span className={expired ? 'text-rose-300 ml-1' : 'text-amber-300 ml-1'}>
                          {expired ? 'expired' : 'valid'} {e.expiryDate}
                        </span>
                      )}
                    </p>
                    {e.text && <p className="text-[10px] text-gray-600 truncate">{e.text}</p>}
                  </div>
                  <button
                    type="button"
                    onClick={() => delEndorsement(e.id)}
                    className="p-1 text-gray-600 hover:text-rose-300 opacity-0 group-hover:opacity-100"
                    aria-label="Delete endorsement"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
