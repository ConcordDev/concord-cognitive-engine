// server/migrations/072_users_first_visit.js
// Server-side onboarding completion tracking. Phase 17 of polish-to-ten.
//
// The OnboardingWizard previously used localStorage exclusively, which
// means logout/login on a different device re-fires the wizard for the
// same user. This migration adds a server-confirmed column.

export function up(db) {
  try {
    db.exec(`ALTER TABLE users ADD COLUMN first_visit_completed_at INTEGER`);
  } catch (e) {
    if (!e?.message?.includes("duplicate column")) throw e;
  }
}
