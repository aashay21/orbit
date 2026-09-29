// Takes a consistent copy of the live database (safe while Orbit is running).
// Usage: node scripts/snapshot.mjs [label]   → data/backups/orbit-<label>-<timestamp>.db
import Database from "better-sqlite3";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = resolve(process.env.ORBIT_DATA ?? join(root, "data"));
const file = join(dataDir, "orbit.db");
if (!existsSync(file)) {
  console.log("  (no database yet, nothing to snapshot)");
  process.exit(0);
}
const label = process.argv[2] ?? "manual";
const dir = join(dataDir, "backups");
mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const out = join(dir, `orbit-${label}-${stamp}.db`);
const db = new Database(file, { readonly: true, fileMustExist: true });
await db.backup(out);
db.close();
// Keep the 10 most recent snapshots for this label.
const mine = readdirSync(dir).filter((f) => f.startsWith(`orbit-${label}-`)).sort();
for (const old of mine.slice(0, Math.max(0, mine.length - 10))) rmSync(join(dir, old));
console.log(`  saved ${out}`);
