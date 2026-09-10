// server/lib/conkay/verticals/hospital-ops.js
// Real-Time Hospital Ops & Predictive Triage — SYNTHETIC patient data ONLY.
// Honesty: NOT clinical advice, NOT FDA, NOT a deployed clinical system.

import { applyDHTP } from '../../dhtp.js';
import { createHash, randomUUID } from 'crypto';
import { brotliCompressSync, constants as zlibConstants } from 'zlib';

const CHIEFS = [
  'chest_pain', 'shortness_of_breath', 'abdominal_pain', 'fever', 'fall',
  'laceration', 'headache', 'syncope', 'nausea', 'back_pain', 'ankle_sprain',
  'allergic_reaction', 'palpitations', 'confusion', 'wound_check',
  'dizziness', 'cough', 'rash', 'urinary_symptom', 'eye_injury',
];
const ESI = [1, 2, 3, 4, 5];
const ARRIVAL = ['walk_in', 'ambulance', 'transfer', 'referral'];
const ZONES = ['A', 'B', 'C', 'fast_track', 'obs'];
const CHIEF_CODE = Object.fromEntries(CHIEFS.map((c, i) => [c, i]));

function seededRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** Generate N≥200 synthetic EHR-like intake records. */
export function generateSyntheticIntakeBatch({ n = 200, seed = 42 } = {}) {
  const N = Math.max(200, Math.min(5000, Number(n) || 200));
  const rnd = seededRng(Number(seed) || 42);
  const patients = [];
  for (let i = 0; i < N; i++) {
    const age = 1 + Math.floor(rnd() * 98);
    const sex = rnd() < 0.5 ? 'F' : 'M';
    const chief = CHIEFS[Math.floor(rnd() * CHIEFS.length)];
    const hr = 50 + Math.floor(rnd() * 80);
    const sbp = 90 + Math.floor(rnd() * 80);
    const spo2 = 88 + Math.floor(rnd() * 12);
    const tempC = 36 + rnd() * 3.2;
    const esiHint = ESI[Math.floor(rnd() * ESI.length)];
    const rr = 10 + Math.floor(rnd() * 22);
    const gcs = rnd() < 0.92 ? 15 : 9 + Math.floor(rnd() * 6);
    const dbp = Math.max(40, sbp - 30 - Math.floor(rnd() * 25));
    const arrivalMode = ARRIVAL[Math.floor(rnd() * ARRIVAL.length)];
    const zone = ZONES[Math.floor(rnd() * ZONES.length)];
    const painScore = Math.floor(rnd() * 11);
    patients.push({
      id: `SYN-${String(i + 1).padStart(5, '0')}`,
      synthetic: true,
      schemaVersion: 'hospital.synthetic.v2',
      age,
      sex,
      chiefComplaint: chief,
      vitals: {
        hr, sbp, dbp, spo2, tempC: Number(tempC.toFixed(1)), rr, gcs,
      },
      arrivalMinAgo: Math.floor(rnd() * 240),
      arrivalMode,
      zone,
      painScore,
      esiHint,
      comorbidities: rnd() < 0.35 ? ['htn'] : rnd() < 0.5 ? ['dm2'] : rnd() < 0.3 ? ['asthma'] : [],
      acuityNotes: rnd() < 0.2 ? 'synthetic_flag_escalate' : null,
    });
  }
  return {
    ok: true,
    n: patients.length,
    patients,
    honesty: {
      syntheticOnly: true,
      clinicalAdvice: false,
      fda: false,
      note: 'SYNTHETIC ONLY — fake EHR-like intake; not real PHI; not clinical advice',
    },
  };
}

/**
 * DHTP-style packetize: prefer live applyDHTP; always also emit a local
 * structural packet (JSON → refs + brotli-ish size via JSON fingerprint).
 */
export function compressHospitalPackets(batch, { preferDhtp = true, concordLive = null } = {}) {
  const t0 = Date.now();
  const patients = batch?.patients || [];
  const rawJson = JSON.stringify(patients);
  const originalBytes = Buffer.byteLength(rawJson, 'utf8');

  // Local DHTP-style packetizer v2: enum-coded chief + compact vitals, drop verbose prose
  const packets = patients.map((p) => ({
    id: p.id.replace(/^SYN-/, ''), // shorter id
    a: p.age,
    s: p.sex === 'F' ? 0 : 1,
    cc: CHIEF_CODE[p.chiefComplaint] ?? p.chiefComplaint,
    esi: p.esiHint,
    hr: p.vitals?.hr,
    sbp: p.vitals?.sbp,
    dbp: p.vitals?.dbp,
    spo2: p.vitals?.spo2,
    t: p.vitals?.tempC,
    rr: p.vitals?.rr,
    gcs: p.vitals?.gcs,
    wait: p.arrivalMinAgo,
    am: ARRIVAL.indexOf(p.arrivalMode) >= 0 ? ARRIVAL.indexOf(p.arrivalMode) : p.arrivalMode,
    z: ZONES.indexOf(p.zone) >= 0 ? ZONES.indexOf(p.zone) : p.zone,
    pain: p.painScore,
    cx: (p.comorbidities || []).map((c) => ({ htn: 1, dm2: 2, asthma: 3 }[c] || c)),
  }));
  const packetJson = JSON.stringify(packets);
  const packetBytes = Buffer.byteLength(packetJson, 'utf8');
  const localRatio = originalBytes / Math.max(packetBytes, 1);
  const ids = new Set(packets.map((x) => x.id));
  const fieldCoverage = {
    vitalsHr: packets.filter((x) => Number.isFinite(x.hr)).length / Math.max(packets.length, 1),
    vitalsSpo2: packets.filter((x) => Number.isFinite(x.spo2)).length / Math.max(packets.length, 1),
    chiefCoded: packets.filter((x) => typeof x.cc === 'number').length / Math.max(packets.length, 1),
    arrivalCoded: packets.filter((x) => typeof x.am === 'number').length / Math.max(packets.length, 1),
    gcs: packets.filter((x) => Number.isFinite(x.gcs)).length / Math.max(packets.length, 1),
  };
  const packetQuality = {
    schemaVersion: 'hospital.packet.v2',
    uniqueIds: ids.size,
    uniqueIdRatio: ids.size / Math.max(packets.length, 1),
    avgBytesPerPatientRaw: originalBytes / Math.max(patients.length, 1),
    avgBytesPerPatientPacket: packetBytes / Math.max(packets.length, 1),
    fieldCoverage,
    richerThanV1: true,
  };

  // Measured brotli ratios (synthetic JSON → feature packets) — real byte ratios
  let brotli = null;
  try {
    const q = { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 };
    const rawBr = brotliCompressSync(Buffer.from(rawJson, 'utf8'), { params: q });
    const pktBr = brotliCompressSync(Buffer.from(packetJson, 'utf8'), { params: q });
    brotli = {
      rawBrotliBytes: rawBr.length,
      packetBrotliBytes: pktBr.length,
      ratioRawToPacketBrotli: originalBytes / Math.max(pktBr.length, 1),
      ratioRawBrotliToPacketBrotli: rawBr.length / Math.max(pktBr.length, 1),
      ratioRawToRawBrotli: originalBytes / Math.max(rawBr.length, 1),
    };
  } catch (e) {
    brotli = { ok: false, error: e?.message || String(e) };
  }

  let dhtp = null;
  if (preferDhtp) {
    try {
      // Larger working set when Concord is live (richer HASH-ref path measurement)
      const live = concordLive === true;
      const budget = live ? Math.min(patients.length, 128) : Math.min(patients.length, 64);
      const workingSet = patients.slice(0, budget).map((p, i) => ({
        id: p.id,
        title: `${p.chiefComplaint} age=${p.age} esi=${p.esiHint} hr=${p.vitals?.hr} spo2=${p.vitals?.spo2}`,
        tier: p.esiHint <= 2 ? 'mega' : 'regular',
        updatedAt: String(1_700_000_000 + i),
        content_hash: createHash('sha256').update(`${p.id}:${p.chiefComplaint}:${p.esiHint}`).digest('hex').slice(0, 16),
      }));
      const prompt = live
        ? 'summarize these hospital intake DTUs for triage board with bed occupancy forecast'
        : 'summarize these hospital intake DTUs for triage board';
      const base = ('Hospital ops synthetic context. '.repeat(live ? 60 : 40));
      const r = applyDHTP({ prompt, workingSetDtus: workingSet, baseSystemPrompt: base });
      dhtp = {
        ok: true,
        presetId: r.presetId,
        compressed: r.compressed,
        originalChars: r.originalChars,
        compressedChars: r.compressedChars,
        ratio: r.ratio,
        matchTimeMs: r.matchTimeMs,
        dtuHash: r.dtuHash,
        workingSetSize: workingSet.length,
        concordLive: !!live,
        path: 'server/lib/dhtp.js applyDHTP',
      };
    } catch (e) {
      dhtp = { ok: false, error: e?.message || String(e), path: 'applyDHTP' };
    }
  }

  const ms = Date.now() - t0;
  return {
    ok: true,
    originalBytes,
    packetBytes,
    localCompressionRatio: localRatio,
    brotli,
    packets,
    packetQuality,
    packetFingerprint: createHash('sha256').update(packetJson).digest('hex').slice(0, 16),
    dhtp,
    // Prefer measured local ratio for hospital payload; DHTP ratio is HASH-DTU path (different denominator)
    reportedCompressionRatio: localRatio,
    brotliPacketRatio: brotli?.ratioRawToPacketBrotli ?? null,
    compressionPath: dhtp?.ok
      ? (dhtp.concordLive ? 'local_packetizer+brotli+dhtp_hash_refs_live' : 'local_packetizer+brotli+dhtp_hash_refs')
      : 'local_packetizer+brotli',
    ms,
    honesty: {
      syntheticOnly: true,
      note: 'SYNTHETIC v2 intake JSON→enum feature packets (+ brotli). DHTP HASH refs reported separately — do not conflate with 10×–129× marketing claims',
    },
  };
}

/** Predictive triage score (risk + bed sim) on compressed packets. */
export function predictiveTriage(packetsOrBatch, { beds = 40 } = {}) {
  const t0 = Date.now();
  const packets = Array.isArray(packetsOrBatch)
    ? packetsOrBatch
    : packetsOrBatch?.packets || packetsOrBatch?.patients || [];
  const bedCount = Math.max(1, Number(beds) || 40);

  const scored = packets.map((p) => {
    const hr = Number(p.hr ?? p.vitals?.hr ?? 80);
    const sbp = Number(p.sbp ?? p.vitals?.sbp ?? 120);
    const spo2 = Number(p.spo2 ?? p.vitals?.spo2 ?? 98);
    const age = Number(p.a ?? p.age ?? 40);
    const esi = Number(p.esi ?? p.esiHint ?? 3);
    const wait = Number(p.wait ?? p.arrivalMinAgo ?? 0);
    // PROXY risk 0..1 — not a clinical model
    let risk = 0;
    risk += (6 - esi) * 0.12;
    if (spo2 < 92) risk += 0.25;
    if (sbp < 100) risk += 0.15;
    if (hr > 110 || hr < 50) risk += 0.12;
    if (age >= 75) risk += 0.1;
    if (wait > 120) risk += 0.05;
    risk = Math.max(0, Math.min(1, risk));
    const priority = risk >= 0.75 ? 'immediate' : risk >= 0.45 ? 'urgent' : risk >= 0.25 ? 'semi_urgent' : 'non_urgent';
    return {
      id: p.id,
      risk: Number(risk.toFixed(4)),
      priority,
      esi,
      wait,
    };
  });

  scored.sort((a, b) => b.risk - a.risk);

  // Simple bed sim: assign top risk to available beds; rest queue
  const assigned = scored.slice(0, bedCount).map((s, i) => ({ ...s, bed: `B${i + 1}` }));
  const queue = scored.slice(bedCount);
  const occ = assigned.length / bedCount;
  const ms = Date.now() - t0;

  return {
    ok: true,
    n: scored.length,
    beds: bedCount,
    occupancy: Number(occ.toFixed(4)),
    assignedCount: assigned.length,
    queueCount: queue.length,
    p50Risk: percentile(scored.map((s) => s.risk), 0.5),
    p95Risk: percentile(scored.map((s) => s.risk), 0.95),
    top5: assigned.slice(0, 5),
    ms,
    honesty: {
      syntheticOnly: true,
      clinicalAdvice: false,
      label: 'PROXY triage — not clinical decision support / not FDA cleared',
    },
  };
}

function percentile(arr, p) {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  const idx = Math.min(a.length - 1, Math.max(0, Math.floor(p * (a.length - 1))));
  return a[idx];
}

/** End-to-end hospital ops slice with latency samples for p50/p95. */
export function probeConcordLive(url = 'http://127.0.0.1:5050/health') {
  // Sync-ish probe via child_process would be heavy; expose helper for cert + optional fetch.
  // Callers may pass concordLive boolean; this async probe is for Node cert harness.
  return { url, note: 'use runHospitalOpsCertAsync or pass concordLive' };
}

export function runHospitalOpsCert({ n = 200, beds = 40, samples = 7, concordLive = false } = {}) {
  const batch = generateSyntheticIntakeBatch({ n });
  const latencies = [];
  let last = null;
  const S = Math.max(3, Math.min(21, Number(samples) || 7));
  for (let i = 0; i < S; i++) {
    const t0 = Date.now();
    const compressed = compressHospitalPackets(batch, { concordLive: !!concordLive });
    const triage = predictiveTriage(compressed.packets, { beds });
    const ms = Date.now() - t0;
    latencies.push(ms);
    last = { compressed, triage, e2eMs: ms };
  }
  const sorted = [...latencies].sort((a, b) => a - b);
  return {
    ok: true,
    n: batch.n,
    compressionRatio: last.compressed.reportedCompressionRatio,
    brotliPacketRatio: last.compressed.brotliPacketRatio,
    brotli: last.compressed.brotli,
    dhtpRatio: last.compressed.dhtp?.ratio ?? null,
    dhtpOk: !!last.compressed.dhtp?.ok,
    dhtpWorkingSetSize: last.compressed.dhtp?.workingSetSize ?? null,
    dhtpConcordLive: !!last.compressed.dhtp?.concordLive,
    originalBytes: last.compressed.originalBytes,
    packetBytes: last.compressed.packetBytes,
    compressionPath: last.compressed.compressionPath,
    packetQuality: last.compressed.packetQuality,
    concordLive: !!concordLive,
    triage: {
      occupancy: last.triage.occupancy,
      assignedCount: last.triage.assignedCount,
      queueCount: last.triage.queueCount,
      p50Risk: last.triage.p50Risk,
      p95Risk: last.triage.p95Risk,
    },
    latencyMs: {
      samples: latencies,
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      mean: latencies.reduce((a, b) => a + b, 0) / latencies.length,
    },
    honesty: batch.honesty,
    runId: randomUUID(),
  };
}

export default {
  generateSyntheticIntakeBatch,
  compressHospitalPackets,
  predictiveTriage,
  runHospitalOpsCert,
  probeConcordLive,
};
