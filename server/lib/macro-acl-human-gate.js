/**
 * @fileoverview Human ACL gate for the macro permission matrix (SEC-MACRO-ACL).
 *
 * server.js builds MACRO_ACL (per-macro) / MACRO_ACL_DOMAIN (per-domain) rule
 * maps with member/admin/owner tiers, but runMacro's canRunMacro gate only
 * fires for sovereign-only domains and non-human callers — so for signed-in
 * humans the admin-tier tags were decorative. This module closes that gap:
 * it enforces admin/owner-tier rules for human callers on a ROLE-ONLY basis
 * (human sessions carry scopes ["read","write"], so a scope check would lock
 * out real admins — see canRunMacro's scope logic).
 *
 * It must NOT be a blanket "admin domain = deny" rule: several admin-tagged
 * macros are deliberately used by ordinary members in the product (code-lens
 * AI edits, DTU import, crawl ingest, plugin listing, …). Those are listed
 * in MEMBER_USABLE_ADMIN_MACROS below and stay open.
 */

/**
 * Roles that satisfy admin/owner-tier macro rules. Deliberately the SAME list
 * for owner-tier macros: several owner-tier overrides already allow
 * admin/founder inline (goals.approve/activate allow founder; chicken3
 * meta_* allow founder), and using the strict _ACL_OWNER role list here would
 * lock admins out of macros they can legitimately run.
 */
const PRIVILEGED_ROLES = Object.freeze(["owner", "admin", "founder", "sovereign"]);

/**
 * Admin-tagged macros that stay open to members because the product uses
 * them and they are self-scoped or guarded inline. Keys are `${domain}.${name}`.
 */
const MEMBER_USABLE_ADMIN_MACROS = Object.freeze(new Set([
  "llm.local", // code lens AI edit/chat via /api/lens/run; BYO keys
  "llm.embed", // code lens embedding via /api/lens/run; BYO keys
  "import.json", // Restore DTU export / UniversalImport
  "import.markdown", // Restore DTU export / UniversalImport
  "crawl.fetch", // ingest page -> /api/ingest/url
  "crawl.enqueue", // ingest page -> /api/ingest/url
  "experiment.log", // member routes /api/experiments, /api/synth/combine; create caller DTUs
  "synth.combine", // member routes /api/experiments, /api/synth/combine; create caller DTUs
  "log.list", // self-scoped via projectLogs
  "plugin.list", // read-only listing
  "dtu.delete", // inline dtuMutationDenial owner check; CompareMergePanel
  "goals.config", // inline: non-admins get read-only config
]));

/**
 * Bulk self-scoped macro names — they only ever operate on the caller's own
 * data (council.list_mine etc.), so they are always allowed regardless of the
 * domain's tier.
 */
const SELF_SCOPED_NAMES = new Set(["list_mine", "recent_mine"]);

/**
 * Decide whether a human caller may run a macro that the MACRO ACL matrix
 * tags as admin/owner-tier. Role-only: scopes are ignored (except "*" super
 * scopes) because human sessions carry ["read","write"] scopes.
 *
 * @param {object} args
 * @param {object} args.ctx          the runMacro ctx (actor / internal flags)
 * @param {string} args.domain
 * @param {string} args.name
 * @param {Map<string,{roles:string[],scopes:string[]}>} args.macroAcl       per-macro rules, key `${domain}.${name}`
 * @param {Map<string,{roles:string[],scopes:string[]}>} args.macroAclDomain per-domain rules
 * @returns {null|{ok:false,error:string,status:403,code:"admin_only"}} null = allowed
 */
export function humanMacroAclDenial({ ctx, domain, name, macroAcl, macroAclDomain }) {
  // Internal system callers (emergent ticks, autogen, repair cortex) bypass.
  if (ctx?.internal === true || ctx?.actor?.internal === true) return null;
  // Self-scoped bulk macros never touch other users' data.
  if (SELF_SCOPED_NAMES.has(name)) return null;
  // Product-facing admin-tagged macros stay open to members (guarded inline).
  if (MEMBER_USABLE_ADMIN_MACROS.has(`${domain}.${name}`)) return null;

  const rule = macroAcl.get(`${domain}.${name}`) || macroAclDomain.get(domain);
  // No rule at all: unchanged default-allow behavior.
  if (!rule) return null;
  // Member-tier or public rules: unchanged, everyone can run them.
  const roles = rule.roles;
  if (!Array.isArray(roles) || roles.length === 0 || roles.includes("member") || roles.includes("viewer")) return null;

  // Admin or owner tier: allowed only for privileged roles / super scopes.
  const actor = ctx?.actor || {};
  const privileged = PRIVILEGED_ROLES.includes(actor.role) || (actor.scopes || []).includes("*");
  if (privileged) return null;
  return {
    ok: false,
    error: `forbidden: ${domain}.${name} requires an admin role`,
    status: 403,
    code: "admin_only",
  };
}

export { PRIVILEGED_ROLES, MEMBER_USABLE_ADMIN_MACROS, SELF_SCOPED_NAMES };