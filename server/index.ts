import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { backupDatabase, openDatabase } from "./db/index.ts";
import { createApp } from "./app.ts";
import { Repo } from "./repo.ts";
import { Notifier } from "./notify/notifier.ts";

const here = dirname(fileURLToPath(import.meta.url));
// Runs from server/ in development and from dist/server/ once built.
const projectRoot = existsSync(resolve(here, "../package.json")) ? resolve(here, "..") : resolve(here, "../..");

const port = Number(process.env.PORT ?? 4700);
// 127.0.0.1 only: Orbit is never reachable from other machines on the network.
const host = "127.0.0.1";
const dataDir = resolve(process.env.ORBIT_DATA ?? join(projectRoot, "data"));
const webDir = resolve(projectRoot, "dist/web");

mkdirSync(dataDir, { recursive: true });
const db = openDatabase(join(dataDir, "orbit.db"));
const repo = new Repo(db);
const notifier = new Notifier(repo);
notifier.start();
const app = createApp(repo, notifier);

if (existsSync(webDir)) {
  const root = relative(process.cwd(), webDir) || ".";
  app.use("/*", serveStatic({ root }));
  // Single-page app: unknown paths fall back to index.html.
  const indexHtml = readFileSync(join(webDir, "index.html"), "utf8");
  app.get("*", (c) => c.html(indexHtml));
}

// Daily snapshot on start and every 6 hours (one file per day, last 14 kept).
const backupDir = join(dataDir, "backups");
const backup = () => backupDatabase(db, backupDir).catch((e) => console.error("Backup failed:", e));
void backup();
setInterval(backup, 6 * 60 * 60 * 1000).unref();

const server = serve({ fetch: app.fetch, port, hostname: host }, () => {
  console.log(`Orbit is running at http://${host}:${port} (data: ${dataDir})`);
});

const shutdown = () => {
  server.close();
  db.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
