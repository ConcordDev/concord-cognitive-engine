// server/lib/cross-model-dtu.js
//
// Cohesive R-3, DTU-pair enrolment — adapters on the cross-model
// validator (lib/cross-model-validator.js), same entry shape:
// { errors, warnings, checked, unverifiable }, an error LIST with
// locations, never a boolean. Two surfaces whose declarations and
// bindings drifted apart silently before this pass:
//
// (1) DTU content classes (lib/dtu-content-classes.js).
//     Declarations: CONTENT_CLASSES + ADMISSION_PROFILES (per-class
//     personalMin / publicMin / rejectReason / useAcademicCore /
//     requireCompositionForPublic). Bindings: inferClass (which
//     classes real inputs can reach) and scoreAdmission (which
//     profile fields the evaluator actually honours). A class with
//     no profile silently degrades to the generic profile in
//     getAdmissionProfile — a declaration that lies; a profile
//     field nobody reads is a requirement bound to nothing.
//
// (2) Artifact schemas (lib/artifact-schemas.js registry) vs the
//     quality gate's enforcement model (lib/quality-gate.js) and
//     the vocabulary registry it consults. A schema's `required`
//     field with no declared property, a `type` the gate has no
//     branch for, or a `vocabulary:` name that resolves to nothing
//     are all bindings to fields/targets that do not exist — the
//     gate then validates less than the schema declares, silently.
//
// NOT enrolled here, by design: whether each schema's (domain,
// action) names a real lens action. The lens-action registry lives
// in server.js's monolith scope and is not importable; that check
// belongs to the boot report-mode slice, where the live registry
// exists. Nothing in this module reaches for it statically.
//
// Clean-room note: as with the R-3 engine — the mechanism (an
// independent pass walking declarations against their bindings,
// returning located errors) is reimplemented from the Research
// brief's description in Concord's idiom. No Cohesive code was
// read or copied — that repo carries no LICENSE (ideas yes,
// code no).

const GATE_TYPES = new Set(["string", "number", "array", "object"]);

/**
 * Validate DTU content-class declarations against their bindings.
 *
 * @param {{ contentClasses: string[],
 *           admissionProfiles: Record<string, object>,
 *           inferClass: (input: object) => string,
 *           probes: Record<string, object>,
 *           scoreAdmission: (dtu: object, opts?: object) => object }} input
 *   `probes` carries one crafted input per class the caller expects
 *   inferClass to reach; a declared class with no probe is reported
 *   unverifiable (the caller asserts probe coverage separately).
 * @returns {{ errors: Array, warnings: Array, checked: object, unverifiable: Array }}
 */
export function validateContentClasses({ contentClasses, admissionProfiles, inferClass, probes, scoreAdmission }) {
  const errors = [];
  const warnings = [];
  const unverifiable = [];
  const classes = Array.isArray(contentClasses) ? contentClasses : [];
  const profiles = admissionProfiles && typeof admissionProfiles === "object" ? admissionProfiles : {};
  let reachabilityChecked = 0;

  // profile-coverage, both directions
  for (const cls of classes) {
    if (!profiles[cls]) {
      errors.push({
        surface: "dtu-content-classes", location: `ADMISSION_PROFILES.${cls}`, kind: "class_without_profile",
        detail: `class "${cls}" is declared in CONTENT_CLASSES but has no admission profile — getAdmissionProfile silently falls back to the generic profile`,
      });
    }
  }
  for (const key of Object.keys(profiles)) {
    if (!classes.includes(key)) {
      errors.push({
        surface: "dtu-content-classes", location: `ADMISSION_PROFILES.${key}`, kind: "profile_without_class",
        detail: `admission profile "${key}" exists for no declared class — unreachable`,
      });
    }
  }

  // minima-ordering + the composition gate, per profile
  for (const cls of classes) {
    const p = profiles[cls];
    if (!p) continue;
    if (typeof p.personalMin === "number" && typeof p.publicMin === "number" && p.publicMin < p.personalMin) {
      errors.push({
        surface: "dtu-content-classes", location: `ADMISSION_PROFILES.${cls}`, kind: "minima_inverted",
        detail: `publicMin (${p.publicMin}) < personalMin (${p.personalMin}) — public admission is easier than personal, the reverse of every other profile's ordering`,
      });
    }
    if (p.requireCompositionForPublic === true && typeof scoreAdmission === "function") {
      const richCore = { definitions: ["d1", "d2"], invariants: ["i1"], claims: ["c1"], examples: ["e1"], nextActions: ["n1"] };
      const without = scoreAdmission(
        { title: "cross-model gate probe", core: richCore },
        { contentClass: cls, promotePublic: true },
      );
      if (without?.ok !== false || without?.reason !== p.rejectReason) {
        errors.push({
          surface: "dtu-content-classes↔scoreAdmission", location: `ADMISSION_PROFILES.${cls}.requireCompositionForPublic`, kind: "requirement_gate_not_firing",
          detail: `profile declares requireCompositionForPublic but a public ${cls} DTU without composition was not rejected with the profile's reason (${p.rejectReason}); got ok=${without?.ok} reason=${without?.reason}`,
        });
      }
      const withComp = scoreAdmission(
        { title: "cross-model gate probe", core: { ...richCore, composition: "a+b" }, composition: "a+b" },
        { contentClass: cls, promotePublic: true },
      );
      if (withComp?.ok !== true) {
        errors.push({
          surface: "dtu-content-classes↔scoreAdmission", location: `ADMISSION_PROFILES.${cls}.requireCompositionForPublic`, kind: "requirement_gate_overfiring",
          detail: `a public ${cls} DTU WITH composition was rejected (${withComp?.reason}) — the gate fires past its declared condition`,
        });
      }
    }
  }

  // class-reachability, behaviourally
  for (const cls of classes) {
    const probe = probes?.[cls];
    if (!probe) {
      unverifiable.push({
        surface: "dtu-content-classes", location: `CONTENT_CLASSES.${cls}`, kind: "no_reachability_probe",
        detail: `no probe input supplied for class "${cls}" — reachability unchecked`,
      });
      continue;
    }
    reachabilityChecked++;
    const got = typeof inferClass === "function" ? inferClass(probe) : null;
    if (got !== cls) {
      errors.push({
        surface: "dtu-content-classes↔inferClass", location: `CONTENT_CLASSES.${cls}`, kind: "class_unreachable_by_probe",
        detail: `the probe input crafted for class "${cls}" infers as "${got}" — either the class is unreachable or the probe is wrong; either way the declaration and the producer disagree`,
      });
    }
  }

  return {
    errors,
    warnings,
    checked: { classes: classes.length, profiles: Object.keys(profiles).length, reachabilityProbes: reachabilityChecked },
    unverifiable,
  };
}

/**
 * Validate registered artifact schemas against the quality gate's
 * enforcement model.
 *
 * @param {{ schemas: Array<{domain: string, action: string, schema: object}>,
 *           getVocabulary: (name: string) => unknown }} input
 *   `schemas` in listArtifactSchemas() shape; `getVocabulary` is the
 *   gate's own lookup (quality-gate.js) — a name it returns nothing
 *   for is a binding to a vocabulary that does not exist.
 * @returns {{ errors: Array, warnings: Array, checked: object, unverifiable: Array }}
 */
export function validateArtifactSchemas({ schemas, getVocabulary }) {
  const errors = [];
  const warnings = [];
  const unverifiable = [];
  const list = Array.isArray(schemas) ? schemas : [];
  let fieldsChecked = 0;
  let vocabulariesChecked = 0;

  const walk = (schemaObj, path, where) => {
    if (!schemaObj || typeof schemaObj !== "object") return;
    const props = schemaObj.properties && typeof schemaObj.properties === "object" ? schemaObj.properties : {};
    for (const req of Array.isArray(schemaObj.required) ? schemaObj.required : []) {
      fieldsChecked++;
      if (!(req in props)) {
        errors.push({
          surface: "artifact-schemas", location: where, kind: "required_undeclared",
          detail: `required field "${path}${req}" is not declared in its sibling properties — the schema binds a field that does not exist`,
        });
      }
    }
    for (const [name, c] of Object.entries(props)) {
      if (!c || typeof c !== "object") continue;
      fieldsChecked++;
      if (c.type !== undefined && !GATE_TYPES.has(c.type)) {
        errors.push({
          surface: "artifact-schemas↔quality-gate", location: where, kind: "type_outside_gate_vocabulary",
          detail: `field "${path}${name}" declares type "${c.type}" — quality-gate has no branch for it (it enforces string, number, array, object), so the type is never checked`,
        });
      }
      if (typeof c.vocabulary === "string") {
        vocabulariesChecked++;
        const vocab = typeof getVocabulary === "function" ? getVocabulary(c.vocabulary) : undefined;
        if (!vocab) {
          errors.push({
            surface: "artifact-schemas↔vocabularies", location: where, kind: "vocabulary_unresolved",
            detail: `field "${path}${name}" references vocabulary "${c.vocabulary}", which the registry does not hold — the gate's vocabulary check silently skips it`,
          });
        }
      }
      if (c.items !== undefined && typeof c.items === "string") {
        warnings.push({
          surface: "artifact-schemas↔quality-gate", location: where, kind: "items_form_unenforced",
          detail: `field "${path}${name}" declares items as the bare type "${c.items}" — quality-gate enforces only object-form items, so the item type is never checked`,
        });
      }
      if (c.items && typeof c.items === "object") walk(c.items, `${path}${name}[].`, where);
      if (c.properties) walk(c, `${path}${name}.`, where);
    }
  };

  for (const entry of list) {
    walk(entry?.schema, "", `${entry?.domain}.${entry?.action}`);
  }

  return {
    errors,
    warnings,
    checked: { schemas: list.length, fields: fieldsChecked, vocabularies: vocabulariesChecked },
    unverifiable,
  };
}

export default { validateContentClasses, validateArtifactSchemas };
