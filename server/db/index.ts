import Database from "better-sqlite3";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { migrations } from "./migrations.ts";

export type DB = Database.Database;

export const DEFAULT_COLUMNS = [
  { name: "Backlog", color: "#8b8fd6", isDone: false },
  { name: "To Do", color: "#38bdf8", isDone: false },
  { name: "In Progress", color: "#a78bfa", isDone: false },
  { name: "Review", color: "#e879f9", isDone: false },
  { name: "Done", color: "#34d399", isDone: true },
];

/** Opens (or creates) the database, applies pending migrations and seeds default columns. */
export function openDatabase(file: string): DB {
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  seedColumns(db);
  return db;
}

function migrate(db: DB) {
  const current = db.pragma("user_version", { simple: true }) as number;
  for (let v = current; v < migrations.length; v++) {
    db.transaction(() => {
      db.exec(migrations[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}

function seedColumns(db: DB) {
  const { n } = db.prepare("SELECT count(*) AS n FROM columns").get() as { n: number };
  if (n > 0) return;
  const insert = db.prepare(
    "INSERT INTO columns (name, color, position, is_done, created_at) VALUES (?, ?, ?, ?, ?)",
  );
  const now = new Date().toISOString();
  DEFAULT_COLUMNS.forEach((c, i) => insert.run(c.name, c.color, (i + 1) * 1024, c.isDone ? 1 : 0, now));
}

/**
 * Writes a consistent snapshot to backupDir as orbit-YYYY-MM-DD.db (one per day)
 * and prunes all but the newest `keep` snapshots.
 */
export async function backupDatabase(db: DB, backupDir: string, keep = 14) {
  mkdirSync(backupDir, { recursive: true });
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  await db.backup(join(backupDir, `orbit-${stamp}.db`));
  const snapshots = readdirSync(backupDir).filter((f) => /^orbit-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
  for (const old of snapshots.slice(0, Math.max(0, snapshots.length - keep))) {
    rmSync(join(backupDir, old));
  }
}
