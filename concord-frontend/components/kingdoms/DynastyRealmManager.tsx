'use client';

/**
 * DynastyRealmManager — Crusader Kings III-parity realm-management surface
 * for the kingdoms lens. Wires the kingdoms.* dynasty / council / diplomacy /
 * war / economy / intrigue / law macros into a single tabbed workbench.
 *
 * Every macro called here is a real backend handler in server/domains/kingdoms.js.
 * No mock / seed data — all state is fetched live and mutated through macros.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Crown, Users, Scroll, Sword, Coins, Skull, Scale, Loader2, Plus, Check, AlertTriangle,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { TreeDiagram, type TreeNode } from '@/components/viz';

// ── shared types ──────────────────────────────────────────────────────

interface Character {
  id: string; name: string; gender: string; age: number; alive: boolean;
  isRuler: boolean; parentIds: string[]; spouseId: string | null;
  traits: string[]; martial: number; diplomacy: number; stewardship: number; intrigue: number;
}
interface Marriage { id: string; aId: string; bId: string; alliance: boolean }
interface CouncilSeat { seat: string; appointment: CouncilAppointment | null }
interface CouncilAppointment {
  seat: string; charId: string; charName: string; agenda: string; competence: number; loyalty: number;
}
interface Treaty {
  id: string; kind: string; counterparty: string; tributeAmount: number; status: string;
}
interface Claim { id: string; target: string; title: string; strength: number; status: string }
interface War {
  id: string; target: string; casusBelli: string; attackerLevies: number; defenderLevies: number;
  warScore: number; status: string; battles: Battle[];
}
interface Battle { id: string; attackerWon: boolean; attackerLosses: number; defenderLosses: number; warScore: number }
interface Building { id: string; kind: string; label: string }
interface Economy { treasury: number; taxRate: number; buildings: Building[] }
interface EconomyDerived { monthlyIncome: number; totalLevyBonus: number; effectiveTaxRate: number }
interface BuildingSpec { cost: number; taxBonus: number; levyBonus: number; label: string }
interface Scheme {
  id: string; kind: string; label: string; target: string; progress: number;
  successChance: number; discoveryRisk: number; status: string;
}
interface SchemeSpec { baseSuccess: number; label: string; discoveryRisk: number }
interface RealmLaw { succession: string; genderLaw: string; crownAuthority: number }

type TabId = 'dynasty' | 'council' | 'diplomacy' | 'war' | 'economy' | 'intrigue' | 'law';
type Feedback = { kind: 'ok' | 'err'; text: string } | null;

interface MacroEnvelope<T> { ok: boolean; result: T | null; error: string | null }

async function km<T>(name: string, input: Record<string, unknown> = {}): Promise<MacroEnvelope<T>> {
  const r = await lensRun<T>('kingdoms', name, input);
  return r.data;
}

const STAT_LABEL: Record<string, string> = {
  martial: 'Mar', diplomacy: 'Dip', stewardship: 'Stw', intrigue: 'Int',
};

// ── root ──────────────────────────────────────────────────────────────

export function DynastyRealmManager() {
  const [tab, setTab] = useState<TabId>('dynasty');
  const [feedback, setFeedback] = useState<Feedback>(null);

  const ok = useCallback((text: string) => setFeedback({ kind: 'ok', text }), []);
  const err = useCallback((text: string) => setFeedback({ kind: 'err', text }), []);

  const tabs: Array<{ id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'dynasty', label: 'Dynasty', icon: Crown },
    { id: 'council', label: 'Council', icon: Users },
    { id: 'diplomacy', label: 'Diplomacy', icon: Scroll },
    { id: 'war', label: 'War', icon: Sword },
    { id: 'economy', label: 'Economy', icon: Coins },
    { id: 'intrigue', label: 'Intrigue', icon: Skull },
    { id: 'law', label: 'Law', icon: Scale },
  ];

  return (
    <div className="rounded-xl border border-amber-500/20 bg-gradient-to-br from-zinc-950 to-amber-950/10 p-4">
      <header className="mb-3 flex items-center gap-2 border-b border-amber-500/10 pb-2">
        <Crown className="h-4 w-4 text-amber-400" />
        <h3 className="text-sm font-semibold text-white">Dynasty &amp; Realm</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
          crusader kings III
        </span>
      </header>

      <nav className="mb-4 flex flex-wrap gap-1">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => { setTab(t.id); setFeedback(null); }}
              className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
                tab === t.id ? 'bg-amber-600 text-white' : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800'
              }`}
            >
              <Icon className="h-3 w-3" /> {t.label}
            </button>
          );
        })}
      </nav>

      {tab === 'dynasty' && <DynastyTab onOk={ok} onErr={err} />}
      {tab === 'council' && <CouncilTab onOk={ok} onErr={err} />}
      {tab === 'diplomacy' && <DiplomacyTab onOk={ok} onErr={err} />}
      {tab === 'war' && <WarTab onOk={ok} onErr={err} />}
      {tab === 'economy' && <EconomyTab onOk={ok} onErr={err} />}
      {tab === 'intrigue' && <IntrigueTab onOk={ok} onErr={err} />}
      {tab === 'law' && <LawTab onOk={ok} onErr={err} />}

      {feedback && (
        <div
          className={`mt-3 flex items-start gap-2 rounded border px-3 py-2 text-[11px] ${
            feedback.kind === 'ok'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
          }`}
        >
          {feedback.kind === 'ok' ? <Check className="mt-0.5 h-3 w-3" /> : <AlertTriangle className="mt-0.5 h-3 w-3" />}
          <span>{feedback.text}</span>
        </div>
      )}
    </div>
  );
}

interface TabProps { onOk: (t: string) => void; onErr: (t: string) => void }

// ── Dynasty ───────────────────────────────────────────────────────────

function DynastyTab({ onOk, onErr }: TabProps) {
  const [chars, setChars] = useState<Character[]>([]);
  const [marriages, setMarriages] = useState<Marriage[]>([]);
  const [ruler, setRuler] = useState<Character | null>(null);
  const [heir, setHeir] = useState<Character | null>(null);
  const [successionLaw, setSuccessionLaw] = useState('primogeniture');
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState('');
  const [gender, setGender] = useState<'male' | 'female'>('male');
  const [age, setAge] = useState('25');
  const [parent, setParent] = useState('');
  const [isRuler, setIsRuler] = useState(false);
  const [marryA, setMarryA] = useState('');
  const [marryB, setMarryB] = useState('');

  const refresh = useCallback(async () => {
    const r = await km<{
      characters: Character[]; marriages: Marriage[]; ruler: Character | null;
      heir: Character | null; successionLaw: string;
    }>('dynasty_tree');
    if (r.ok && r.result) {
      setChars(r.result.characters);
      setMarriages(r.result.marriages);
      setRuler(r.result.ruler);
      setHeir(r.result.heir);
      setSuccessionLaw(r.result.successionLaw);
    } else if (r.error) onErr(r.error);
  }, [onErr]);

  useEffect(() => { void refresh(); }, [refresh]);

  const create = async () => {
    if (!name.trim()) { onErr('Name required.'); return; }
    setBusy(true);
    const r = await km<{ character: Character }>('char_create', {
      name: name.trim(), gender, age: Number(age) || 25,
      parentIds: parent ? [parent] : [], isRuler,
    });
    setBusy(false);
    if (r.ok && r.result) {
      onOk(`${r.result.character.name} added to the dynasty.`);
      setName(''); setParent(''); setIsRuler(false);
      await refresh();
    } else onErr(r.error || 'char_create failed');
  };

  const marry = async () => {
    if (!marryA || !marryB) { onErr('Pick two characters to wed.'); return; }
    setBusy(true);
    const r = await km<{ marriage: Marriage }>('char_marry', { aId: marryA, bId: marryB, alliance: true });
    setBusy(false);
    if (r.ok) { onOk('Marriage sealed.'); setMarryA(''); setMarryB(''); await refresh(); }
    else onErr(r.error || 'char_marry failed');
  };

  const kill = async (charId: string) => {
    setBusy(true);
    const r = await km<{ successionTriggered: boolean; newRuler: Character | null }>('char_death', { charId });
    setBusy(false);
    if (r.ok) {
      onOk(r.result?.successionTriggered
        ? `Ruler dies. ${r.result.newRuler ? `${r.result.newRuler.name} succeeds.` : 'No heir — dynasty in crisis.'}`
        : 'Character deceased.');
      await refresh();
    } else onErr(r.error || 'char_death failed');
  };

  // Build a dynasty tree rooted at the ruler (or first parentless character).
  const dynastyTree = buildDynastyTree(chars, ruler);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
        <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-amber-300">Add character</h4>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name"
            className="rounded bg-zinc-950 px-2 py-1 text-[12px] text-white" />
          <select value={gender} onChange={(e) => setGender(e.target.value as 'male' | 'female')}
            className="rounded bg-zinc-950 px-2 py-1 text-[12px] text-white">
            <option value="male">male</option>
            <option value="female">female</option>
          </select>
          <input value={age} onChange={(e) => setAge(e.target.value.replace(/[^\d]/g, ''))} placeholder="Age"
            className="rounded bg-zinc-950 px-2 py-1 text-[12px] text-white" />
          <select value={parent} onChange={(e) => setParent(e.target.value)}
            className="rounded bg-zinc-950 px-2 py-1 text-[11px] text-white">
            <option value="">— no parent —</option>
            {chars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-[11px] text-zinc-300">
            <input type="checkbox" checked={isRuler} onChange={(e) => setIsRuler(e.target.checked)} />
            Reigning ruler
          </label>
          <button type="button" onClick={create} disabled={busy}
            className="flex items-center justify-center gap-1 rounded bg-amber-700 px-2 py-1 text-[12px] font-medium text-white hover:bg-amber-600 disabled:opacity-50">
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Add
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <InfoCard label="Succession law" value={successionLaw} />
        <InfoCard label="Reigning ruler" value={ruler ? `${ruler.name} (${ruler.age})` : 'none'} />
        <InfoCard label="Designated heir" value={heir ? `${heir.name} (${heir.age})` : 'no heir'} />
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
        <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-amber-300">
          Bloodline ({chars.length})
        </h4>
        {chars.length === 0 ? (
          <p className="text-[12px] text-zinc-500">No characters yet — add the dynasty founder above.</p>
        ) : dynastyTree ? (
          <TreeDiagram root={dynastyTree} />
        ) : null}
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
        <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-amber-300">Characters</h4>
        <ul className="space-y-1">
          {chars.map((c) => (
            <li key={c.id} className="flex items-center justify-between rounded bg-zinc-950 px-2 py-1 text-[11px]">
              <span className="text-zinc-200">
                {c.isRuler && '👑 '}{c.name} <span className="text-zinc-500">· {c.gender}, {c.age}{!c.alive && ' · ✝'}</span>
                {c.spouseId && <span className="text-pink-400"> · wed</span>}
              </span>
              <span className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-zinc-500">
                  M{c.martial} D{c.diplomacy} S{c.stewardship} I{c.intrigue}
                </span>
                {c.alive && (
                  <button type="button" onClick={() => kill(c.id)} disabled={busy}
                    className="rounded bg-rose-900/50 px-1.5 py-0.5 text-[10px] text-rose-300 hover:bg-rose-800/60">
                    kill
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
        <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-amber-300">Arrange marriage</h4>
        <div className="grid grid-cols-3 gap-2">
          <select value={marryA} onChange={(e) => setMarryA(e.target.value)}
            className="rounded bg-zinc-950 px-2 py-1 text-[11px] text-white">
            <option value="">— spouse A —</option>
            {chars.filter((c) => c.alive && !c.spouseId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={marryB} onChange={(e) => setMarryB(e.target.value)}
            className="rounded bg-zinc-950 px-2 py-1 text-[11px] text-white">
            <option value="">— spouse B —</option>
            {chars.filter((c) => c.alive && !c.spouseId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button type="button" onClick={marry} disabled={busy}
            className="rounded bg-pink-800 px-2 py-1 text-[12px] font-medium text-white hover:bg-pink-700 disabled:opacity-50">
            Wed
          </button>
        </div>
        {marriages.length > 0 && (
          <ul className="mt-2 space-y-0.5">
            {marriages.map((m) => (
              <li key={m.id} className="text-[10px] text-zinc-500">
                {nameOf(chars, m.aId)} ⚭ {nameOf(chars, m.bId)}{m.alliance && ' · alliance'}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── Council ───────────────────────────────────────────────────────────

function CouncilTab({ onOk, onErr }: TabProps) {
  const [seats, setSeats] = useState<CouncilSeat[]>([]);
  const [chars, setChars] = useState<Character[]>([]);
  const [openSeats, setOpenSeats] = useState(0);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    const c = await km<{ seats: CouncilSeat[]; openSeats: number }>('council_list');
    if (c.ok && c.result) { setSeats(c.result.seats); setOpenSeats(c.result.openSeats); }
    else if (c.error) onErr(c.error);
    const d = await km<{ characters: Character[] }>('dynasty_tree');
    if (d.ok && d.result) setChars(d.result.characters.filter((x) => x.alive));
  }, [onErr]);

  useEffect(() => { void refresh(); }, [refresh]);

  const appoint = async (seat: string) => {
    const charId = pick[seat];
    if (!charId) { onErr('Pick a courtier for this seat.'); return; }
    setBusy(true);
    const r = await km<{ appointment: CouncilAppointment }>('council_appoint', { seat, charId });
    setBusy(false);
    if (r.ok && r.result) { onOk(`${r.result.appointment.charName} appointed ${seat}.`); await refresh(); }
    else onErr(r.error || 'council_appoint failed');
  };

  const dismiss = async (seat: string) => {
    setBusy(true);
    const r = await km('council_dismiss', { seat });
    setBusy(false);
    if (r.ok) { onOk(`${seat} dismissed.`); await refresh(); }
    else onErr(r.error || 'council_dismiss failed');
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-zinc-500">{openSeats} open seat{openSeats === 1 ? '' : 's'}. Each councilor pursues an agenda drawn from their best stat.</p>
      {seats.map((s) => (
        <div key={s.seat} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
          <div className="flex items-center justify-between">
            <h4 className="text-[12px] font-semibold capitalize text-amber-200">{s.seat.replace(/_/g, ' ')}</h4>
            {s.appointment && (
              <button type="button" onClick={() => dismiss(s.seat)} disabled={busy}
                className="rounded bg-rose-900/50 px-1.5 py-0.5 text-[10px] text-rose-300 hover:bg-rose-800/60">
                dismiss
              </button>
            )}
          </div>
          {s.appointment ? (
            <div className="mt-1.5 text-[11px] text-zinc-300">
              <div className="font-medium text-white">{s.appointment.charName}</div>
              <div className="text-zinc-400">Agenda: {s.appointment.agenda}</div>
              <div className="mt-0.5 flex gap-3 font-mono text-[10px] text-zinc-500">
                <span>competence {s.appointment.competence}</span>
                <span>loyalty {s.appointment.loyalty}</span>
              </div>
            </div>
          ) : (
            <div className="mt-1.5 flex gap-2">
              <select value={pick[s.seat] || ''} onChange={(e) => setPick((p) => ({ ...p, [s.seat]: e.target.value }))}
                className="flex-1 rounded bg-zinc-950 px-2 py-1 text-[11px] text-white">
                <option value="">— select courtier —</option>
                {chars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button type="button" onClick={() => appoint(s.seat)} disabled={busy}
                className="rounded bg-amber-700 px-2 py-1 text-[11px] font-medium text-white hover:bg-amber-600 disabled:opacity-50">
                Appoint
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Diplomacy ─────────────────────────────────────────────────────────

function DiplomacyTab({ onOk, onErr }: TabProps) {
  const [treaties, setTreaties] = useState<Treaty[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [busy, setBusy] = useState(false);

  const [tKind, setTKind] = useState('alliance');
  const [tParty, setTParty] = useState('');
  const [tTribute, setTTribute] = useState('');
  const [cTarget, setCTarget] = useState('');
  const [cStrength, setCStrength] = useState('25');

  const refresh = useCallback(async () => {
    const r = await km<{ treaties: Treaty[]; claims: Claim[] }>('diplomacy_list');
    if (r.ok && r.result) { setTreaties(r.result.treaties); setClaims(r.result.claims); }
    else if (r.error) onErr(r.error);
  }, [onErr]);

  useEffect(() => { void refresh(); }, [refresh]);

  const propose = async () => {
    if (!tParty.trim()) { onErr('Counterparty required.'); return; }
    setBusy(true);
    const r = await km('treaty_propose', {
      kind: tKind, counterparty: tParty.trim(),
      tributeAmount: tKind === 'tribute' ? Number(tTribute) || 0 : 0,
    });
    setBusy(false);
    if (r.ok) { onOk(`${tKind} treaty proposed to ${tParty.trim()}.`); setTParty(''); setTTribute(''); await refresh(); }
    else onErr(r.error || 'treaty_propose failed');
  };

  const resolve = async (treatyId: string, status: 'accepted' | 'rejected' | 'broken') => {
    setBusy(true);
    const r = await km('treaty_resolve', { treatyId, status });
    setBusy(false);
    if (r.ok) { onOk(`Treaty ${status}.`); await refresh(); }
    else onErr(r.error || 'treaty_resolve failed');
  };

  const fabricate = async () => {
    if (!cTarget.trim()) { onErr('Claim target required.'); return; }
    setBusy(true);
    const r = await km('claim_fabricate', { target: cTarget.trim(), strength: Number(cStrength) || 25 });
    setBusy(false);
    if (r.ok) { onOk(`Claim fabricated against ${cTarget.trim()}.`); setCTarget(''); await refresh(); }
    else onErr(r.error || 'claim_fabricate failed');
  };

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
        <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-amber-300">Propose treaty</h4>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <select value={tKind} onChange={(e) => setTKind(e.target.value)}
            className="rounded bg-zinc-950 px-2 py-1 text-[11px] text-white">
            {['alliance', 'non_aggression', 'tribute', 'trade_pact', 'vassalage'].map((k) => (
              <option key={k} value={k}>{k.replace(/_/g, ' ')}</option>
            ))}
          </select>
          <input value={tParty} onChange={(e) => setTParty(e.target.value)} placeholder="Counterparty"
            className="rounded bg-zinc-950 px-2 py-1 text-[12px] text-white" />
          <input value={tTribute} onChange={(e) => setTTribute(e.target.value.replace(/[^\d]/g, ''))}
            placeholder="Tribute (if any)" disabled={tKind !== 'tribute'}
            className="rounded bg-zinc-950 px-2 py-1 text-[12px] text-white disabled:opacity-40" />
          <button type="button" onClick={propose} disabled={busy}
            className="rounded bg-amber-700 px-2 py-1 text-[12px] font-medium text-white hover:bg-amber-600 disabled:opacity-50">
            Propose
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
        <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-amber-300">Treaties ({treaties.length})</h4>
        {treaties.length === 0 ? (
          <p className="text-[12px] text-zinc-500">No treaties yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {treaties.map((t) => (
              <li key={t.id} className="rounded bg-zinc-950 px-2 py-1.5 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-200">{t.kind.replace(/_/g, ' ')} · {t.counterparty}
                    {t.tributeAmount > 0 && <span className="text-amber-400"> · {t.tributeAmount} tribute</span>}
                  </span>
                  <span className="font-mono text-[10px] text-zinc-500">{t.status}</span>
                </div>
                {t.status === 'proposed' && (
                  <div className="mt-1 flex gap-1.5">
                    <button type="button" onClick={() => resolve(t.id, 'accepted')} disabled={busy}
                      className="rounded bg-emerald-800 px-1.5 py-0.5 text-[10px] text-emerald-200 hover:bg-emerald-700">accept</button>
                    <button type="button" onClick={() => resolve(t.id, 'rejected')} disabled={busy}
                      className="rounded bg-rose-900/60 px-1.5 py-0.5 text-[10px] text-rose-300 hover:bg-rose-800">reject</button>
                  </div>
                )}
                {t.status === 'accepted' && (
                  <button type="button" onClick={() => resolve(t.id, 'broken')} disabled={busy}
                    className="mt-1 rounded bg-rose-900/60 px-1.5 py-0.5 text-[10px] text-rose-300 hover:bg-rose-800">break treaty</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
        <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-amber-300">Fabricate claim</h4>
        <div className="grid grid-cols-3 gap-2">
          <input value={cTarget} onChange={(e) => setCTarget(e.target.value)} placeholder="Target realm/title"
            className="rounded bg-zinc-950 px-2 py-1 text-[12px] text-white" />
          <input value={cStrength} onChange={(e) => setCStrength(e.target.value.replace(/[^\d]/g, ''))} placeholder="Strength"
            className="rounded bg-zinc-950 px-2 py-1 text-[12px] text-white" />
          <button type="button" onClick={fabricate} disabled={busy}
            className="rounded bg-amber-700 px-2 py-1 text-[12px] font-medium text-white hover:bg-amber-600 disabled:opacity-50">
            Fabricate
          </button>
        </div>
        {claims.length > 0 && (
          <ul className="mt-2 space-y-0.5">
            {claims.map((c) => (
              <li key={c.id} className="text-[10px] text-zinc-400">
                {c.title} · strength {c.strength} · <span className="text-amber-400">{c.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── War ───────────────────────────────────────────────────────────────

function WarTab({ onOk, onErr }: TabProps) {
  const [wars, setWars] = useState<War[]>([]);
  const [casusBelli, setCasusBelli] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const [target, setTarget] = useState('');
  const [cb, setCb] = useState('conquest');
  const [levies, setLevies] = useState('500');
  const [commanderMartial, setCommanderMartial] = useState('10');

  const refresh = useCallback(async () => {
    const r = await km<{ wars: War[]; casusBelli: string[] }>('war_list');
    if (r.ok && r.result) { setWars(r.result.wars); setCasusBelli(r.result.casusBelli); if (!cb && r.result.casusBelli[0]) setCb(r.result.casusBelli[0]); }
    else if (r.error) onErr(r.error);
  }, [onErr, cb]);

  useEffect(() => { void refresh(); }, [refresh]);

  const declare = async () => {
    if (!target.trim()) { onErr('War target required.'); return; }
    setBusy(true);
    const r = await km('war_declare', { target: target.trim(), casusBelli: cb, levies: Number(levies) || 0 });
    setBusy(false);
    if (r.ok) { onOk(`War declared on ${target.trim()}.`); setTarget(''); await refresh(); }
    else onErr(r.error || 'war_declare failed');
  };

  const battle = async (warId: string) => {
    setBusy(true);
    const r = await km<{ battle: Battle }>('war_battle', { warId, commanderMartial: Number(commanderMartial) || 10 });
    setBusy(false);
    if (r.ok && r.result) { onOk(`Battle fought — ${r.result.battle.attackerWon ? 'we hold the field' : 'we are routed'}.`); await refresh(); }
    else onErr(r.error || 'war_battle failed');
  };

  const end = async (warId: string, outcome: 'white_peace' | 'settled') => {
    setBusy(true);
    const r = await km('war_end', { warId, outcome });
    setBusy(false);
    if (r.ok) { onOk('War concluded.'); await refresh(); }
    else onErr(r.error || 'war_end failed');
  };

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
        <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-amber-300">Declare war</h4>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Target realm"
            className="rounded bg-zinc-950 px-2 py-1 text-[12px] text-white" />
          <select value={cb} onChange={(e) => setCb(e.target.value)}
            className="rounded bg-zinc-950 px-2 py-1 text-[11px] text-white">
            {casusBelli.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
          </select>
          <input value={levies} onChange={(e) => setLevies(e.target.value.replace(/[^\d]/g, ''))} placeholder="Levies raised"
            className="rounded bg-zinc-950 px-2 py-1 text-[12px] text-white" />
          <button type="button" onClick={declare} disabled={busy}
            className="rounded bg-rose-800 px-2 py-1 text-[12px] font-medium text-white hover:bg-rose-700 disabled:opacity-50">
            Declare
          </button>
        </div>
        <label className="mt-2 block text-[10px] text-zinc-500">
          Commander martial skill
          <input value={commanderMartial} onChange={(e) => setCommanderMartial(e.target.value.replace(/[^\d]/g, ''))}
            className="ml-2 w-16 rounded bg-zinc-950 px-2 py-0.5 text-[11px] text-white" />
        </label>
      </div>

      {wars.length === 0 ? (
        <p className="text-[12px] text-zinc-500">No wars under way.</p>
      ) : (
        wars.map((w) => (
          <div key={w.id} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
            <div className="flex items-center justify-between">
              <h4 className="text-[12px] font-semibold text-rose-200">War on {w.target}</h4>
              <span className="font-mono text-[10px] text-zinc-500">{w.status} · cb {w.casusBelli}</span>
            </div>
            <div className="mt-1.5 grid grid-cols-3 gap-2 text-[11px]">
              <Stat label="Our levies" value={w.attackerLevies} />
              <Stat label="Enemy levies" value={w.defenderLevies} />
              <Stat label="War score" value={w.warScore} tone={w.warScore >= 0 ? 'good' : 'bad'} />
            </div>
            {w.battles.length > 0 && (
              <ul className="mt-2 space-y-0.5">
                {w.battles.map((b) => (
                  <li key={b.id} className="text-[10px] text-zinc-500">
                    {b.attackerWon ? '✓ victory' : '✗ defeat'} · −{b.attackerLosses} ours / −{b.defenderLosses} theirs · score {b.warScore}
                  </li>
                ))}
              </ul>
            )}
            {w.status === 'active' && (
              <div className="mt-2 flex gap-1.5">
                <button type="button" onClick={() => battle(w.id)} disabled={busy}
                  className="rounded bg-rose-800 px-2 py-1 text-[11px] font-medium text-white hover:bg-rose-700 disabled:opacity-50">
                  Fight a battle
                </button>
                <button type="button" onClick={() => end(w.id, 'white_peace')} disabled={busy}
                  className="rounded bg-zinc-800 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-700">
                  White peace
                </button>
                <button type="button" onClick={() => end(w.id, 'settled')} disabled={busy}
                  className="rounded bg-amber-800 px-2 py-1 text-[11px] text-amber-200 hover:bg-amber-700">
                  Settle on score
                </button>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

// ── Economy ───────────────────────────────────────────────────────────

function EconomyTab({ onOk, onErr }: TabProps) {
  const [economy, setEconomy] = useState<Economy | null>(null);
  const [derived, setDerived] = useState<EconomyDerived | null>(null);
  const [catalog, setCatalog] = useState<Record<string, BuildingSpec>>({});
  const [busy, setBusy] = useState(false);
  const [taxRate, setTaxRate] = useState('');

  const refresh = useCallback(async () => {
    const r = await km<{ economy: Economy; catalog: Record<string, BuildingSpec>; derived: EconomyDerived }>('economy_get');
    if (r.ok && r.result) {
      setEconomy(r.result.economy);
      setDerived(r.result.derived);
      setCatalog(r.result.catalog);
      setTaxRate(String(r.result.economy.taxRate));
    } else if (r.error) onErr(r.error);
  }, [onErr]);

  useEffect(() => { void refresh(); }, [refresh]);

  const setTax = async () => {
    const rate = Number(taxRate);
    setBusy(true);
    const r = await km('economy_set_tax', { taxRate: rate });
    setBusy(false);
    if (r.ok) { onOk(`Tax rate set to ${(rate * 100).toFixed(0)}%.`); await refresh(); }
    else onErr(r.error || 'economy_set_tax failed');
  };

  const build = async (kind: string) => {
    setBusy(true);
    const r = await km('economy_build', { kind });
    setBusy(false);
    if (r.ok) { onOk(`${catalog[kind]?.label || kind} constructed.`); await refresh(); }
    else onErr(r.error || 'economy_build failed');
  };

  const collect = async () => {
    setBusy(true);
    const r = await km<{ collected: number }>('economy_collect');
    setBusy(false);
    if (r.ok && r.result) { onOk(`Collected ${r.result.collected} from the realm.`); await refresh(); }
    else onErr(r.error || 'economy_collect failed');
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <InfoCard label="Treasury" value={economy ? String(economy.treasury) : '—'} />
        <InfoCard label="Monthly income" value={derived ? String(derived.monthlyIncome) : '—'} />
        <InfoCard label="Effective tax" value={derived ? `${(derived.effectiveTaxRate * 100).toFixed(1)}%` : '—'} />
        <InfoCard label="Levy bonus" value={derived ? `+${derived.totalLevyBonus}` : '—'} />
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
        <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-amber-300">Tax rate</h4>
        <div className="flex items-center gap-2">
          <input value={taxRate} onChange={(e) => setTaxRate(e.target.value.replace(/[^\d.]/g, ''))}
            placeholder="0.00 – 0.50"
            className="w-28 rounded bg-zinc-950 px-2 py-1 text-[12px] text-white" />
          <button type="button" onClick={setTax} disabled={busy}
            className="rounded bg-amber-700 px-2 py-1 text-[12px] font-medium text-white hover:bg-amber-600 disabled:opacity-50">
            Set tax
          </button>
          <button type="button" onClick={collect} disabled={busy}
            className="rounded bg-emerald-800 px-2 py-1 text-[12px] font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
            Collect taxes
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
        <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-amber-300">Construction</h4>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {Object.entries(catalog).map(([kind, spec]) => (
            <div key={kind} className="flex items-center justify-between rounded bg-zinc-950 px-2 py-1.5 text-[11px]">
              <div>
                <div className="font-medium text-zinc-200">{spec.label}</div>
                <div className="font-mono text-[10px] text-zinc-500">
                  cost {spec.cost} · +{(spec.taxBonus * 100).toFixed(0)}% tax · +{spec.levyBonus} levy
                </div>
              </div>
              <button type="button" onClick={() => build(kind)}
                disabled={busy || (economy ? economy.treasury < spec.cost : true)}
                className="rounded bg-amber-700 px-2 py-1 text-[10px] font-medium text-white hover:bg-amber-600 disabled:opacity-40">
                Build
              </button>
            </div>
          ))}
        </div>
        {economy && economy.buildings.length > 0 && (
          <p className="mt-2 text-[10px] text-zinc-500">
            Built: {economy.buildings.map((b) => b.label).join(', ')}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Intrigue ──────────────────────────────────────────────────────────

function IntrigueTab({ onOk, onErr }: TabProps) {
  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [kinds, setKinds] = useState<Record<string, SchemeSpec>>({});
  const [busy, setBusy] = useState(false);

  const [kind, setKind] = useState('sway');
  const [target, setTarget] = useState('');
  const [agentIntrigue, setAgentIntrigue] = useState('10');

  const refresh = useCallback(async () => {
    const r = await km<{ schemes: Scheme[]; kinds: Record<string, SchemeSpec> }>('scheme_list');
    if (r.ok && r.result) { setSchemes(r.result.schemes); setKinds(r.result.kinds); }
    else if (r.error) onErr(r.error);
  }, [onErr]);

  useEffect(() => { void refresh(); }, [refresh]);

  const start = async () => {
    if (!target.trim()) { onErr('Scheme target required.'); return; }
    setBusy(true);
    const r = await km('scheme_start', { kind, target: target.trim(), agentIntrigue: Number(agentIntrigue) || 10 });
    setBusy(false);
    if (r.ok) { onOk(`Scheme begun against ${target.trim()}.`); setTarget(''); await refresh(); }
    else onErr(r.error || 'scheme_start failed');
  };

  const advance = async (schemeId: string) => {
    setBusy(true);
    const r = await km<{ scheme: Scheme; discovered: boolean }>('scheme_advance', { schemeId });
    setBusy(false);
    if (r.ok && r.result) {
      onOk(r.result.discovered ? 'The plot has been uncovered!'
        : r.result.scheme.status === 'succeeded' ? 'The scheme succeeds.'
        : r.result.scheme.status === 'failed' ? 'The scheme falls apart.'
        : `Scheme advances — ${r.result.scheme.progress}%.`);
      await refresh();
    } else onErr(r.error || 'scheme_advance failed');
  };

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
        <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-amber-300">Begin scheme</h4>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <select value={kind} onChange={(e) => setKind(e.target.value)}
            className="rounded bg-zinc-950 px-2 py-1 text-[11px] text-white">
            {Object.entries(kinds).map(([k, spec]) => <option key={k} value={k}>{spec.label}</option>)}
          </select>
          <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Target"
            className="rounded bg-zinc-950 px-2 py-1 text-[12px] text-white" />
          <input value={agentIntrigue} onChange={(e) => setAgentIntrigue(e.target.value.replace(/[^\d]/g, ''))}
            placeholder="Agent intrigue"
            className="rounded bg-zinc-950 px-2 py-1 text-[12px] text-white" />
          <button type="button" onClick={start} disabled={busy}
            className="rounded bg-purple-800 px-2 py-1 text-[12px] font-medium text-white hover:bg-purple-700 disabled:opacity-50">
            Plot
          </button>
        </div>
        {kinds[kind] && (
          <p className="mt-1.5 text-[10px] text-zinc-500">
            Base success {(kinds[kind].baseSuccess * 100).toFixed(0)}% · discovery risk {(kinds[kind].discoveryRisk * 100).toFixed(0)}%
          </p>
        )}
      </div>

      {schemes.length === 0 ? (
        <p className="text-[12px] text-zinc-500">No schemes in motion.</p>
      ) : (
        schemes.map((sc) => (
          <div key={sc.id} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
            <div className="flex items-center justify-between">
              <h4 className="text-[12px] font-semibold text-purple-200">{sc.label} → {sc.target}</h4>
              <span className="font-mono text-[10px] text-zinc-500">{sc.status}</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded bg-zinc-950">
              <div className="h-full bg-purple-500" style={{ width: `${sc.progress}%` }} />
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-zinc-500">
              <span>progress {sc.progress}%</span>
              <span>success {(sc.successChance * 100).toFixed(0)}%</span>
            </div>
            {sc.status === 'plotting' && (
              <button type="button" onClick={() => advance(sc.id)} disabled={busy}
                className="mt-2 rounded bg-purple-800 px-2 py-1 text-[11px] font-medium text-white hover:bg-purple-700 disabled:opacity-50">
                Advance plot
              </button>
            )}
          </div>
        ))
      )}
    </div>
  );
}

// ── Law ───────────────────────────────────────────────────────────────

function LawTab({ onOk, onErr }: TabProps) {
  const [law, setLaw] = useState<RealmLaw | null>(null);
  const [options, setOptions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const [succession, setSuccession] = useState('primogeniture');
  const [genderLaw, setGenderLaw] = useState('male_preference');
  const [crownAuthority, setCrownAuthority] = useState('1');

  const refresh = useCallback(async () => {
    const r = await km<{ law: RealmLaw; successionOptions: string[] }>('law_get');
    if (r.ok && r.result) {
      setLaw(r.result.law);
      setOptions(r.result.successionOptions);
      setSuccession(r.result.law.succession);
      setGenderLaw(r.result.law.genderLaw || 'male_preference');
      setCrownAuthority(String(r.result.law.crownAuthority ?? 1));
    } else if (r.error) onErr(r.error);
  }, [onErr]);

  useEffect(() => { void refresh(); }, [refresh]);

  const save = async () => {
    setBusy(true);
    const r = await km<{ law: RealmLaw }>('law_set', {
      succession, genderLaw, crownAuthority: Number(crownAuthority) || 1,
    });
    setBusy(false);
    if (r.ok) { onOk('Realm law amended.'); await refresh(); }
    else onErr(r.error || 'law_set failed');
  };

  return (
    <div className="space-y-3">
      {law && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <InfoCard label="Succession" value={law.succession} />
          <InfoCard label="Gender law" value={law.genderLaw} />
          <InfoCard label="Crown authority" value={String(law.crownAuthority)} />
        </div>
      )}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
        <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-amber-300">Amend law</h4>
        <div className="space-y-2">
          <label className="block text-[11px] text-zinc-400">
            Succession type
            <select value={succession} onChange={(e) => setSuccession(e.target.value)}
              className="mt-0.5 w-full rounded bg-zinc-950 px-2 py-1 text-[12px] text-white">
              {options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
          <label className="block text-[11px] text-zinc-400">
            Gender law
            <select value={genderLaw} onChange={(e) => setGenderLaw(e.target.value)}
              className="mt-0.5 w-full rounded bg-zinc-950 px-2 py-1 text-[12px] text-white">
              {['male_preference', 'female_preference', 'equal', 'agnatic', 'enatic'].map((g) => (
                <option key={g} value={g}>{g.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </label>
          <label className="block text-[11px] text-zinc-400">
            Crown authority (0–4)
            <input value={crownAuthority} onChange={(e) => setCrownAuthority(e.target.value.replace(/[^\d]/g, ''))}
              className="mt-0.5 w-full rounded bg-zinc-950 px-2 py-1 text-[12px] text-white" />
          </label>
          <button type="button" onClick={save} disabled={busy}
            className="rounded bg-amber-700 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-amber-600 disabled:opacity-50">
            {busy ? 'Saving…' : 'Enact law'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── small shared atoms ────────────────────────────────────────────────

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-2.5">
      <div className="text-[9px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-0.5 truncate text-[13px] font-semibold capitalize text-amber-100">{value}</div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'good' | 'bad' }) {
  return (
    <div className="rounded bg-zinc-950 px-2 py-1">
      <div className="text-[9px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`text-[13px] font-semibold tabular-nums ${
        tone === 'good' ? 'text-emerald-300' : tone === 'bad' ? 'text-rose-300' : 'text-zinc-100'
      }`}>{value}</div>
    </div>
  );
}

function nameOf(chars: Character[], id: string): string {
  return chars.find((c) => c.id === id)?.name || id.slice(0, 8);
}

function buildDynastyTree(chars: Character[], ruler: Character | null): TreeNode | null {
  if (chars.length === 0) return null;
  const root = ruler || chars.find((c) => c.parentIds.length === 0) || chars[0];
  const seen = new Set<string>();
  const toNode = (c: Character): TreeNode => {
    seen.add(c.id);
    const kids = chars.filter((x) => !seen.has(x.id) && x.parentIds.includes(c.id));
    return {
      id: c.id,
      label: `${c.isRuler ? '👑 ' : ''}${c.name}${c.alive ? '' : ' ✝'}`,
      detail: `${c.gender}, age ${c.age} · ${STAT_LABEL.martial} ${c.martial} ${STAT_LABEL.diplomacy} ${c.diplomacy} ${STAT_LABEL.stewardship} ${c.stewardship} ${STAT_LABEL.intrigue} ${c.intrigue}`,
      tone: c.isRuler ? 'good' : c.alive ? 'default' : 'bad',
      children: kids.length ? kids.map(toNode) : undefined,
    };
  };
  return toNode(root);
}
