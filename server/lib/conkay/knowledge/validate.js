// server/lib/conkay/knowledge/validate.js
//
// Full validation of an entity record: JSON Schema shape, the claim rules on
// every property claim, and the discipline extensions.

import { validateEntityShape } from "./schema.js";
import { validateClaim } from "./claims.js";
import { validateExtensions } from "./extensions/index.js";

/** Returns { ok, errors, warnings }. */
export function validateEntity(record) {
  const errors = validateEntityShape(record);
  const warnings = [];
  if (!errors.length) {
    (record.properties || []).forEach((c, i) => errors.push(...validateClaim(c, `$.properties[${i}]`)));
    const ext = validateExtensions(record);
    errors.push(...ext.errors);
    warnings.push(...ext.warnings);
  }
  return { ok: errors.length === 0, errors, warnings };
}

validateEntity.claim = (c) => validateClaim(c);
