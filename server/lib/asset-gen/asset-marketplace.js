// server/lib/asset-gen/asset-marketplace.js
//
// V1.2 Wave C — Creation → Economy Loop, closing the gap a grounding audit
// found: Program C's real CAS→FEA→GLB generative asset pipeline
// (parametric-mesh.js → fea-gate.js → generate-asset.js) and the evo-asset
// promote/resolve pipeline (evo-asset/registry.js + scheduler.js) both
// produce genuinely validated, on-disk 3D assets — but neither had ANY path
// to the marketplace. A structurally-verified generated sword had nowhere
// to become a purchasable listing.
//
// Reference pattern: server/lib/forge-marketplace.js's
// mintForgeAppAsDtu/listForgeAppOnMarketplace ("mint the artifact as a real
// DTU, then list that DTU"). This module follows the SAME two-step shape,
// with one deliberate correction the grounding audit called out:
// forge-marketplace.js's mintForgeAppAsDtu does a raw `INSERT INTO dtus`
// against the SQL table directly, which never touches the in-memory
// `STATE.dtus` map — and `marketplace.list`/`marketplace.purchaseWithRoyalties`
// (server.js) primarily read/write `STATE.dtus`. A raw-SQL-only DTU can
// silently be invisible to the very listing macro meant to sell it. This
// module instead mints through the REAL `dtu.create` macro
// (`ctx.macro.run("dtu", "create", …)`, the same call server/domains/
// gamedesign.js's `scene-save` action uses) — that path writes BOTH the SQL
// row (via pipelineCommitDTU) AND `STATE.dtus`, so the DTU this module mints
// is immediately visible to `marketplace.list` with no separate hydration
// step required.
//
// Honest-by-construction (per CLAUDE.md): this module NEVER fabricates a
// "verified" claim. `mintGeneratedAssetAsDtu` inspects the asset record's
// REAL fea-gate.js#structuralCheck result (`feaResult.ok`) and:
//   - by default REFUSES to mint an asset with no passing FEA check
//     (`{ ok:false, reason:"fea_not_passed" }`) — nothing to honestly sell;
//   - only mints an unverified asset when the caller explicitly opts in
//     via `allowUnverified:true`, and even then the DTU's title/tags/content
//     say "unverified" in plain language — it is never presented as passed.
// The FEA summary written into the DTU (maxUtilization, worstStress,
// allowable, safetyFactor, tipLoadN, material) is copied VERBATIM from the
// real `structuralCheck`/`optimizeToPass` result on the input asset record —
// never recomputed, rounded to look better, or invented.
//
// A known pre-existing quirk this module works around (see
// `_PERSONAL_SCOPE_NOTE` below): `dtu.create` always sets a fresh DTU's
// `scope` to `"local"`, but `marketplace.list` only accepts `scope ===
// "personal"` (or unset) DTUs. There is no macro today that promotes
// local → personal (`scope.promote` only accepts global/creative_global
// targets). This module sets `scope: "personal"` directly on the object
// `dtu.create` returns — the SAME object reference `dtu.create` already
// stored into `STATE.dtus` (confirmed empirically: mutating the returned
// object and then calling `marketplace.list` succeeds) — mirroring how
// several other DTU-producing flows in server.js (dream/npc_autobiography
// composition) construct personal-scope DTUs directly from the start. No
// locked file (`dtu.create`, `marketplace.list`, `purchaseWithRoyalties`)
// is modified by this module.

import crypto from "node:crypto";

function _shortTag(seed) {
  const s = String(seed || Date.now());
  return crypto.createHash("sha1").update(s).digest("hex").slice(0, 8);
}

const _PERSONAL_SCOPE_NOTE =
  "dtu.create defaults scope to 'local'; marketplace.list requires 'personal'. " +
  "This module promotes the freshly-minted DTU to 'personal' in place so it " +
  "is immediately listable — see this file's header comment for the full story.";

/**
 * Build an honest FEA summary object from a real fea-gate.js result
 * (`structuralCheck`'s return shape, also carried on `optimizeToPass`'s
 * `.check` field and `generateValidatedAsset`'s `.feaResult`). Every value
 * is copied verbatim — this function never computes or infers a number.
 *
 * @param {object|null|undefined} feaResult
 * @returns {{ok:boolean, maxUtilization:number|null, worstStress:number|null,
 *   allowable:number|null, safetyFactor:number|null, tipLoadN:number|null,
 *   material:string|null, reason:string|null}|null}
 */
export function summarizeFeaResult(feaResult) {
  if (!feaResult || typeof feaResult !== "object") return null;
  return {
    ok: feaResult.ok === true,
    maxUtilization: Number.isFinite(feaResult.maxUtilization) ? feaResult.maxUtilization : null,
    worstStress: Number.isFinite(feaResult.worstStress) ? feaResult.worstStress : null,
    allowable: Number.isFinite(feaResult.allowable) ? feaResult.allowable : null,
    safetyFactor: Number.isFinite(feaResult.safetyFactor) ? feaResult.safetyFactor : null,
    tipLoadN: Number.isFinite(feaResult.tipLoadN) ? feaResult.tipLoadN : null,
    material: feaResult.material || null,
    reason: feaResult.reason || null,
  };
}

/**
 * Mint a completed, generated-and-validated asset (the output of
 * `generateValidatedAsset` in ./generate-asset.js — `{ archetype, material,
 * glbPath, massProps, feaResult, params }` — or the equivalent fields read
 * off a promoted `evo_assets` row) as a real, purchasable DTU.
 *
 * @param {object} ctx            a macro ctx with a working `ctx.macro.run`
 *   (e.g. the ctx passed into any `register()`/`registerLensAction()`
 *   handler, or `makeInternalCtx(...)` for internal/system callers).
 * @param {object} assetRecord
 * @param {string} assetRecord.archetype     e.g. "sword"
 * @param {string} [assetRecord.material]    MATERIAL_LIBRARY key
 * @param {string} assetRecord.glbPath       on-disk path to the packed .glb
 * @param {object} [assetRecord.massProps]   generate-asset.js#massProperties output
 * @param {object} [assetRecord.feaResult]   fea-gate.js#structuralCheck output
 * @param {object} [assetRecord.params]      the generation params (genParams)
 * @param {string} [assetRecord.assetId]     evo_assets.id, when minting from a
 *   registered/promoted evo-asset rather than a fresh generateValidatedAsset call
 * @param {string} [assetRecord.sourceId]    evo_assets.source_id (targetSourceId)
 * @param {object} [opts]
 * @param {boolean} [opts.allowUnverified=false] mint even when feaResult is
 *   missing/failing — the DTU is honestly labeled "(Unverified)" and never
 *   claims to have passed. Default is to REFUSE (no fabricated pass, and no
 *   silent "looks fine" listing either).
 * @param {string} [opts.title]
 * @returns {Promise<{ok:boolean, dtuId?:string, verified?:boolean,
 *   feaSummary?:object|null, reason?:string}>}
 */
export async function mintGeneratedAssetAsDtu(ctx, assetRecord, opts = {}) {
  if (!ctx?.macro?.run) return { ok: false, reason: "no_macro_runtime" };
  const { archetype, material, glbPath, massProps, feaResult, params, assetId, sourceId } = assetRecord || {};
  if (!archetype || !glbPath) return { ok: false, reason: "missing_inputs" };

  const feaSummary = summarizeFeaResult(feaResult);
  const feaOk = feaSummary?.ok === true;
  const allowUnverified = opts.allowUnverified === true;

  // Honest gate: never mint a fabricated "verified" claim. Refuse outright
  // unless the caller explicitly accepts an unverified listing.
  if (!feaOk && !allowUnverified) {
    return { ok: false, reason: "fea_not_passed", feaSummary };
  }

  const materialLabel = material || feaSummary?.material || null;
  const massKg = Number.isFinite(massProps?.mass_kg) ? massProps.mass_kg : null;

  // dtu.create's commit path (pipelineCommitDTU) rejects any non-"user"/
  // "import"-source DTU whose title exactly matches an existing DTU's title
  // (the dedup gate). Two distinct generated assets of the same archetype +
  // material would otherwise collide on the same generic default title and
  // the SECOND one would silently fail to mint — a real correctness bug,
  // not a test-only nuisance. Tag the default title with a short id derived
  // from whatever uniquely identifies THIS generation (evo-asset id/source
  // id when minting a registered asset, else the generated .glb's own
  // filename, which generate-asset.js already stamps with a params hash +
  // timestamp) so distinct assets never collide. An explicit opts.title
  // always wins and is used verbatim (the caller owns uniqueness then).
  const uniqueTag = _shortTag(assetId || sourceId || glbPath);
  const baseTitle = `Generated ${archetype}${materialLabel ? ` (${materialLabel})` : ""} #${uniqueTag}`;
  const title = String(opts.title || (feaOk ? baseTitle : `${baseTitle} — Unverified`)).slice(0, 200);

  const meta = {
    kind: "generated_asset",
    archetype,
    material: materialLabel,
    glbPath,
    massKg,
    feaVerified: feaOk,
    feaSummary,
    genParams: params || null,
    evoAssetId: assetId || null,
    evoSourceId: sourceId || null,
  };

  const definitions = [
    `${archetype} generated by the parametric-mesh + material-grounding pipeline` +
      (materialLabel ? ` (material: ${materialLabel})` : "") + ".",
  ];
  const claims = feaOk
    ? [
        `Structural FEA check PASSED: max utilization ${_fmtNum(feaSummary.maxUtilization)} ` +
          `(allowable stress ${_fmtNum(feaSummary.allowable)} Pa, safety factor ${_fmtNum(feaSummary.safetyFactor)}, ` +
          `tip load ${_fmtNum(feaSummary.tipLoadN)} N).`,
      ]
    : [
        "No passing structural FEA check is on record for this asset — minted as UNVERIFIED at the caller's " +
          "explicit request; it is not represented as structurally validated.",
      ];

  const massClause = massKg !== null ? `, mass ${massKg.toFixed(3)}kg` : "";
  const summary = feaOk
    ? `${baseTitle} — FEA-validated (max utilization ${_fmtNum(feaSummary.maxUtilization)}${massClause}).`
    : `${baseTitle} — UNVERIFIED: no passing structural check on record for this asset.`;

  const created = await ctx.macro.run("dtu", "create", {
    title,
    domain: "engineering",
    source: "asset-gen",
    tags: ["generated-asset", archetype, feaOk ? "fea-verified" : "fea-unverified"].filter(Boolean),
    meta,
    core: { definitions, claims },
    human: { summary },
  });

  if (!created?.ok) {
    return { ok: false, reason: created?.reason || created?.error || "dtu_create_failed" };
  }

  const dtu = created.dtu;
  // See _PERSONAL_SCOPE_NOTE above — dtu.create always starts a DTU at
  // scope:"local"; marketplace.list only accepts "personal" (or unset).
  // `dtu` here is the SAME object dtu.create already stored in STATE.dtus,
  // so this mutation is visible to every subsequent macro call, exactly
  // like dtu.create's own `dtu.scope = "local"` assignment was.
  if (dtu && dtu.scope !== "personal") {
    dtu.scope = "personal";
  }

  return { ok: true, dtuId: dtu?.id, verified: feaOk, feaSummary };
}

function _fmtNum(n) {
  if (!Number.isFinite(n)) return "n/a";
  const abs = Math.abs(n);
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e6)) return n.toExponential(3);
  return String(Math.round(n * 1000) / 1000);
}

/**
 * List a previously-minted generated-asset DTU on the marketplace via the
 * REAL, purchasable `marketplace.list` macro (server.js — the same one the
 * Creator lens's Listings tab uses, backed by `dtu.marketplace` +
 * `marketplace.purchaseWithRoyalties`'s 95%-creator / 5%-platform royalty
 * cascade). This function does not reimplement any listing/pricing logic —
 * it is a thin, honest pass-through.
 *
 * @param {object} ctx      macro ctx with a working `ctx.macro.run`
 * @param {string} dtuId    id returned by `mintGeneratedAssetAsDtu`
 * @param {number} price    non-negative listing price (same currency units
 *   `marketplace.list` expects — CC/USD per existing convention)
 * @param {object} [opts]
 * @param {string} [opts.currency="USD"]
 * @param {string} [opts.title]
 * @param {string} [opts.description]
 * @param {string[]} [opts.tags]
 * @returns {Promise<{ok:boolean, listing?:object, reason?:string}>}
 */
export async function listGeneratedAssetOnMarketplace(ctx, dtuId, price, opts = {}) {
  if (!ctx?.macro?.run) return { ok: false, reason: "no_macro_runtime" };
  if (!dtuId) return { ok: false, reason: "missing_dtu_id" };
  const numPrice = Number(price);
  if (!Number.isFinite(numPrice) || numPrice < 0) return { ok: false, reason: "invalid_price" };

  const listed = await ctx.macro.run("marketplace", "list", {
    dtuId,
    price: numPrice,
    currency: opts.currency || "USD",
    contentType: "generated_asset",
    title: opts.title,
    description: opts.description,
    tags: opts.tags,
  });

  if (!listed?.ok) {
    return { ok: false, reason: listed?.error || listed?.reason || "listing_failed" };
  }
  return { ok: true, listing: listed.listing };
}

/**
 * Convenience: mint + list a completed asset-gen output in one call — the
 * shape `engineering.mint-and-list` (server/domains/engineering.js) wraps.
 *
 * @param {object} ctx
 * @param {object} assetRecord   see `mintGeneratedAssetAsDtu`
 * @param {number} price
 * @param {object} [opts]        forwarded to both mint + list steps
 * @returns {Promise<{ok:boolean, dtuId?:string, verified?:boolean,
 *   feaSummary?:object|null, listing?:object, reason?:string}>}
 */
export async function mintAndListGeneratedAsset(ctx, assetRecord, price, opts = {}) {
  const minted = await mintGeneratedAssetAsDtu(ctx, assetRecord, opts);
  if (!minted.ok) return minted;

  const listed = await listGeneratedAssetOnMarketplace(ctx, minted.dtuId, price, opts);
  if (!listed.ok) {
    return { ok: false, reason: listed.reason, dtuId: minted.dtuId, verified: minted.verified, feaSummary: minted.feaSummary };
  }
  return {
    ok: true,
    dtuId: minted.dtuId,
    verified: minted.verified,
    feaSummary: minted.feaSummary,
    listing: listed.listing,
  };
}
