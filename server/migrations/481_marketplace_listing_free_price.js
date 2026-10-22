// Studio can list a track for free. marketplace_economy_listings was created
// with CHECK(price > 0). SQLite cannot relax a CHECK in place, so the table
// is rebuilt with CHECK(price >= 0). Indexes are recreated from the SQL that
// existed before the rename, and only for columns that are already present.

export function up(db) {
  rebuildPriceCheck(db, /CHECK\s*\(\s*price\s*>\s*0\s*\)/i, "CHECK(price >= 0)");
}

export function down(db) {
  const free = db.prepare("SELECT COUNT(*) AS c FROM marketplace_economy_listings WHERE price <= 0").get();
  if (free?.c) throw new Error("cannot revert 481 while a free listing exists");
  rebuildPriceCheck(db, /CHECK\s*\(\s*price\s*>=\s*0\s*\)/i, "CHECK(price > 0)");
}

export const description = "Allow free (price 0) economy marketplace listings";

function rebuildPriceCheck(db, fromRe, toSql) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'marketplace_economy_listings'").get();
  if (!row?.sql || !fromRe.test(row.sql)) return;
  const indexes = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'marketplace_economy_listings' AND sql IS NOT NULL"
  ).all();
  const cols = db.prepare("PRAGMA table_info(marketplace_economy_listings)").all().map((c) => c.name);
  const createSql = row.sql.replace(fromRe, toSql);
  db.exec("ALTER TABLE marketplace_economy_listings RENAME TO marketplace_economy_listings_price_old");
  db.exec(createSql);
  const list = cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(", ");
  db.exec(`INSERT INTO marketplace_economy_listings (${list}) SELECT ${list} FROM marketplace_economy_listings_price_old`);
  db.exec("DROP TABLE marketplace_economy_listings_price_old");
  for (const idx of indexes) {
    if (idx.sql) db.exec(idx.sql);
  }
}
