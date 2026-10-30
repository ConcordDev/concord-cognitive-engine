// server/migrations/493_friendships_blocked_by.js
//
// friendships.blocked_by — who set a 'blocked' row's block.
//
// Migration 214's requester/addressee record the original friend
// request's direction, which is not who blocked: an addressee
// blocking their requester is the ordinary case, and with no blocker
// recorded, unblockUser could not tell the blocker from the blocked
// party — either side could lift the block, so the blocked party
// could unilaterally restore contact the blocker severed (deploy-seat
// review hold GB-0045 on PR #1840). lib/friendships.js now records
// blocked_by at block time and restricts unblock to the blocker;
// rows blocked before this column exists carry NULL and stay
// liftable by either party (their blocker is unprovable).

export function up(db) {
  const tableInfo = db.prepare("PRAGMA table_info(friendships)").all();
  if (tableInfo.length === 0) return; // 214 creates the table; nothing to alter yet
  if (!tableInfo.some((col) => col.name === "blocked_by")) {
    db.exec(`ALTER TABLE friendships ADD COLUMN blocked_by TEXT`);
  }
}

export function down(db) {
  const tableInfo = db.prepare("PRAGMA table_info(friendships)").all();
  if (tableInfo.some((col) => col.name === "blocked_by")) {
    db.exec(`ALTER TABLE friendships DROP COLUMN blocked_by`);
  }
}
