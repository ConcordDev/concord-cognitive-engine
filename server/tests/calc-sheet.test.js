// GB-1534: the one-page human calc sheet, rendered from a signed v2 calc
// receipt. An outside reviewer with only this page must see what was
// computed, against what basis, what was NOT checked, how the solver
// compares to the hand calculation, and how to tamper-check the numbers.
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { resetSigningKeyCache, verifyAttestation } from "../lib/receipts/attest.js";
import { buildBeamCalcReceipt } from "../lib/conkay/beam-study.js";
import { solveBeamStudy } from "../domains/engineering.js";
import { renderCalcSheetHtml } from "../lib/receipts/calc-sheet.js";
import { qrCodewords, qrMatrix } from "../lib/receipts/qr-svg.js";

const ENV_KEYS = [
  "CONCORD_RECEIPT_SIGNING_KEY",
  "CONCORD_RECEIPT_SIGNING_KEY_PATH",
  "CONCORD_RECEIPT_EXTRA_PUBLIC_KEYS",
];

function clearKey() {
  for (const k of ENV_KEYS) delete process.env[k];
  resetSigningKeyCache();
}

beforeEach(() => {
  clearKey();
  const { privateKey } = crypto.generateKeyPairSync("ed25519");
  process.env.CONCORD_RECEIPT_SIGNING_KEY = privateKey.export({ type: "pkcs8", format: "pem" });
  resetSigningKeyCache();
});
afterEach(() => clearKey());

const FIXED_NOW = () => "2026-11-14T15:30:00.000Z";
const DEMO_INPUT = {
  dims: { length: 1200, height: 200, flangeWidth: 100, flangeThickness: 10, webThickness: 6 },
  loadN: 200000,
  support: "simply-supported",
  material: "steel-a992",
};

function beamReceipt() {
  const solved = solveBeamStudy(DEMO_INPUT);
  // Rebuild the same receipt at a fixed clock so the sheet is deterministic.
  return buildBeamCalcReceipt(
    {
      dims: solved.study.dims, support: solved.study.support, loadN: solved.study.loadN,
      material: { E: solved.study.material.E, yield: solved.study.material.yield },
      segments: solved.study.segments,
    },
    solved.summary,
    { utilizationByMember: solved.result.utilizationByMember, now: FIXED_NOW },
  );
}

describe("calc sheet (GB-1534)", () => {
  it("renders the whole story on one page: basis, inputs, hand check, NOT CHECKED, sign-off", () => {
    const receipt = beamReceipt();
    const html = renderCalcSheetHtml(receipt, { verify: verifyAttestation(receipt) });
    // Verdict line: a yield-only PASS is never a bare PASS.
    assert.match(html, /Yield check only — PASS/);
    assert.match(html, /Signature check:/);
    assert.match(html, /VALID/);
    // Design basis banner.
    assert.match(html, /Design basis/);
    assert.match(html, /none — yield check only/);
    // Inputs in plain units, load shown in kN, hashes out of the main body.
    assert.match(html, /Length/);
    assert.match(html, /1200 mm/);
    assert.match(html, /200 kN/);
    // Hand check section with the formula.
    assert.match(html, /Hand check/);
    assert.match(html, /M = PL\/4/);
    assert.match(html, /agrees with the solver/);
    // The five NOT CHECKED sentences, in plain words.
    for (const sentence of [
      "Shear was not checked",
      "Lateral-torsional and local buckling were not checked",
      "Bearing at supports was not checked",
      "Connections were not checked",
      "Self-weight was not included",
    ]) {
      assert.ok(html.includes(sentence), `sheet must state: ${sentence}`);
    }
    // Reviewer sign-off block.
    for (const label of ["Checked by", "Signature", "Date", "Comments"]) {
      assert.ok(html.includes(label), `sign-off block must include ${label}`);
    }
    // Issuer, both clocks, and the verify link + QR.
    assert.match(html, /concord-os\.org/);
    assert.match(html, /14 Nov 2026 15:30:00 GMT \(UTC\)/);
    assert.match(html, /10:30:00 AM EST \(New York\)/);
    assert.ok(html.includes(`https://concord-os.org/verify?d=${receipt.signature.digest}`));
    assert.match(html, /<svg/);
    // No float noise anywhere on the page.
    assert.ok(!/\d\.\d{6,}/.test(html), "sheet must not carry raw float noise");
    // Print CSS keeps Save-as-PDF to one page.
    assert.match(html, /@page/);
  });

  it("an edited receipt renders INVALID with the reason", () => {
    const receipt = beamReceipt();
    const tampered = JSON.parse(JSON.stringify(receipt));
    tampered.results.maxStressMPa.value = 1;
    const html = renderCalcSheetHtml(tampered, { verify: verifyAttestation(tampered) });
    assert.match(html, /INVALID/);
    assert.match(html, /digest_mismatch/);
  });

  it("the QR codeword stream in the matrix round-trips to the payload", () => {
    const url = `https://concord-os.org/verify?d=${"ab".repeat(32)}`;
    const { version, size, modules } = qrMatrix(url);
    assert.equal(size, version * 4 + 17);
    // Read the codewords back out of the matrix (mask 0, the encoder's
    // fixed mask) and compare with the encoder's own stream.
    const reserved = [];
    for (let r = 0; r < size; r++) reserved.push(new Array(size).fill(false));
    const reserve = (r, c) => { if (r >= 0 && r < size && c >= 0 && c < size) reserved[r][c] = true; };
    const finder = (tr, tc) => { for (let dr = -1; dr <= 7; dr++) for (let dc = -1; dc <= 7; dc++) reserve(tr + dr, tc + dc); };
    finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
    for (let i = 0; i < size; i++) { reserve(6, i); reserve(i, 6); }
    reserve(size - 8, 8);
    const CENTERS = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };
    for (const r of CENTERS[version]) for (const c of CENTERS[version]) {
      if ((r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)) continue;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) reserve(r + dr, c + dc);
    }
    for (let i = 0; i < 9; i++) { reserve(8, i); reserve(i, 8); }
    for (let i = 0; i < 8; i++) reserve(8, size - 1 - i);
    for (let i = 0; i < 7; i++) reserve(size - 1 - i, 8);
    const bits = [];
    let up = true;
    for (let col = size - 1; col > 0; col -= 2) {
      if (col === 6) col = 5;
      for (let i = 0; i < size; i++) {
        const row = up ? size - 1 - i : i;
        for (const c of [col, col - 1]) {
          if (reserved[row][c]) continue;
          let bit = modules[row][c] ? 1 : 0;
          if ((row + c) % 2 === 0) bit ^= 1;
          bits.push(bit);
        }
      }
      up = !up;
    }
    const bytes = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) {
      bytes.push(parseInt(bits.slice(i, i + 8).join(""), 2));
    }
    const stream = qrCodewords([...new TextEncoder().encode(url)], version).codewords;
    assert.deepEqual(bytes.slice(0, stream.length), stream);
    // De-interleave the placed data codewords (level-M block table, QR
    // spec) and the payload itself decodes: byte mode, length, then the URL.
    const GROUPS = {
      1: [[1, 16]], 2: [[1, 28]], 3: [[1, 44]], 4: [[2, 32]], 5: [[2, 43]],
      6: [[4, 27]], 7: [[4, 31]], 8: [[2, 38], [2, 39]], 9: [[3, 36], [2, 37]],
      10: [[4, 43], [1, 44]],
    };
    const blocks = [];
    for (const [count, per] of GROUPS[version]) {
      for (let i = 0; i < count; i++) blocks.push(new Array(per).fill(0));
    }
    const totalData = blocks.reduce((sum, b) => sum + b.length, 0);
    const placed = bytes.slice(0, totalData);
    let cursor = 0;
    const maxPer = Math.max(...blocks.map((b) => b.length));
    for (let p = 0; p < maxPer; p++) {
      for (const block of blocks) {
        if (p < block.length) block[p] = placed[cursor++];
      }
    }
    const dataBits = blocks.flat().flatMap((b) => [...b.toString(2).padStart(8, "0")]).join("");
    assert.equal(dataBits.slice(0, 4), "0100");
    const len = parseInt(dataBits.slice(4, 12), 2);
    assert.equal(len, url.length);
    let text = "";
    for (let i = 0; i < len; i++) text += String.fromCharCode(parseInt(dataBits.slice(12 + i * 8, 20 + i * 8), 2));
    assert.equal(text, url);
  });
});
