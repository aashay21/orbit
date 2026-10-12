import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../server/db/index.ts";
import { Repo, type Ctx } from "../server/repo.ts";
import { createApp } from "../server/app.ts";

const me: Ctx = { actor: "user", clientId: null };
const claude: Ctx = { actor: "claude", clientId: null };

let repo: Repo;
beforeEach(() => {
  repo = new Repo(openDatabase(":memory:"));
});

const col = (name: string) => repo.getBoard().columns.find((c) => c.name === name)!;
const keysIn = (name: string) => repo.getBoard().tasks.filter((t) => t.columnId === col(name).id).map((t) => t.key);

describe("setup", () => {
  it("seeds the five default columns with Done marked as done", () => {
    const cols = repo.getBoard().columns;
    expect(cols.map((c) => c.name)).toEqual(["Backlog", "To Do", "In Progress", "Review", "Done"]);
    expect(cols.filter((c) => c.isDone).map((c) => c.name)).toEqual(["Done"]);
  });
});

describe("projects and task keys", () => {
  it("derives unique prefixes and numbers tasks per root project", () => {
    const infra = repo.createProject(me, { name: "Infra" });
    const tf = repo.createProject(me, { name: "Terraform", parentId: infra.id });
    const inf2 = repo.createProject(me, { name: "Infrastructure" });
    expect(infra.key).toBe("INF");
    expect(tf.key).toBeNull();
    expect(tf.color).toBe(infra.color);
    expect(inf2.key).toBe("INF2");

    const a = repo.createTask(me, { title: "A", projectId: infra.id });
    const b = repo.createTask(me, { title: "B", projectId: tf.id });
    expect([a.key, b.key]).toEqual(["INF-1", "INF-2"]);
  });

  it("keeps a task's key when it moves to another project", () => {
    const a = repo.createProject(me, { name: "Alpha" });
    const b = repo.createProject(me, { name: "Beta" });
    const t = repo.createTask(me, { title: "Portable", projectId: a.id });
    const moved = repo.updateTask(me, t.key, { projectId: b.id });
    expect(moved.key).toBe("ALP-1");
    expect(moved.projectId).toBe(b.id);
    expect(repo.createTask(me, { title: "Next", projectId: b.id }).key).toBe("BET-1");
  });

  it("rejects cycles and refuses to delete projects that still have tasks", () => {
    const p = repo.createProject(me, { name: "Parent" });
    const c = repo.createProject(me, { name: "Child", parentId: p.id });
    expect(() => repo.updateProject(me, p.id, { parentId: c.id })).toThrow(/inside itself/);
    repo.createTask(me, { title: "x", projectId: c.id });
    expect(() => repo.deleteProject(me, p.id)).toThrow(/still has 1 task/);
  });

  it("hides tasks of archived projects from the board", () => {
    const p = repo.createProject(me, { name: "Old" });
    repo.createTask(me, { title: "x", projectId: p.id });
    repo.setProjectArchived(me, p.id, true);
    expect(repo.getBoard().tasks).toHaveLength(0);
  });
});

describe("moving tasks", () => {
  it("orders tasks relative to neighbours and survives many inserts between the same pair", () => {
    const p = repo.createProject(me, { name: "Orbit" });
    const [a, b] = ["a", "b"].map((t) => repo.createTask(me, { title: t, projectId: p.id }));
    const todo = col("To Do").id;
    repo.moveTask(me, a.key, { columnId: todo });
    repo.moveTask(me, b.key, { columnId: todo, afterKey: a.key });
    const inserted: string[] = [];
    for (let i = 0; i < 60; i++) {
      const t = repo.createTask(me, { title: `m${i}`, projectId: p.id });
      repo.moveTask(me, t.key, { columnId: todo, afterKey: a.key, beforeKey: b.key });
      inserted.unshift(t.key);
    }
    const order = keysIn("To Do");
    expect(order[0]).toBe(a.key);
    expect(order.at(-1)).toBe(b.key);
    expect(order.slice(1, -1)).toEqual(inserted);
  });

  it("sets and clears completedAt when entering and leaving a done column", () => {
    const p = repo.createProject(me, { name: "Orbit" });
    const t = repo.createTask(me, { title: "ship", projectId: p.id });
    const done = repo.moveTask(me, t.key, { columnId: col("Done").id });
    expect(done.completedAt).not.toBeNull();
    expect(repo.getStats().doneToday).toBe(1);
    const back = repo.moveTask(me, t.key, { columnId: col("Review").id });
    expect(back.completedAt).toBeNull();
    expect(back.activity.map((a) => a.type).slice(0, 3)).toEqual(["reopened", "completed", "created"]);
  });

  it("records who made each change", () => {
    const p = repo.createProject(me, { name: "Orbit" });
    const t = repo.createTask(me, { title: "x", projectId: p.id });
    const after = repo.addNote(claude, t.key, "Implemented and tested.");
    expect(after.lastActor).toBe("claude");
    expect(after.notes[0].actor).toBe("claude");
    expect(after.activity[0]).toMatchObject({ type: "note", actor: "claude" });
  });
});

describe("columns", () => {
  it("moves tasks when deleting a non-empty column and keeps at least one column", () => {
    const p = repo.createProject(me, { name: "Orbit" });
    const t = repo.createTask(me, { title: "x", projectId: p.id, columnId: col("Review").id });
    expect(() => repo.deleteColumn(me, col("Review").id)).toThrow(/choose a column/);
    repo.deleteColumn(me, col("Review").id, col("Done").id);
    expect(repo.getTask(t.key).completedAt).not.toBeNull();
    for (const c of repo.getBoard().columns.slice(1)) repo.deleteColumn(me, c.id, repo.getBoard().columns[0].id);
    expect(() => repo.deleteColumn(me, repo.getBoard().columns[0].id)).toThrow(/at least one column/);
  });
});

describe("tags and archive", () => {
  it("creates tags by name and archives a whole column", () => {
    const p = repo.createProject(me, { name: "Orbit" });
    const t = repo.createTask(me, { title: "x", projectId: p.id, tags: ["bug", "Bug", "ui"], columnId: col("Done").id });
    expect(repo.listTags().map((g) => g.name)).toEqual(["bug", "ui"]);
    expect(t.tagIds).toHaveLength(2);
    expect(repo.archiveColumn(me, col("Done").id)).toBe(1);
    expect(repo.listTasks({ archived: true }).map((x) => x.key)).toEqual([t.key]);
    repo.setTaskArchived(me, t.key, false);
    expect(repo.getBoard().tasks).toHaveLength(1);
  });
});

describe("HTTP API", () => {
  it("validates input, maps errors to status codes and tags the actor", async () => {
    const app = createApp(repo);
    const post = (path: string, data: unknown, headers: Record<string, string> = {}) =>
      app.request(`/api${path}`, { method: "POST", body: JSON.stringify(data), headers: { "content-type": "application/json", ...headers } });

    expect((await post("/projects", { name: "" })).status).toBe(400);
    const p = await (await post("/projects", { name: "Home" })).json();
    const res = await post("/tasks", { title: "Fix tap", projectId: p.id, priority: "high", dueDate: "2026-10-01" }, { "x-orbit-actor": "claude" });
    expect(res.status).toBe(201);
    const task = await res.json();
    expect(task).toMatchObject({ key: "HOM-1", priority: "high", lastActor: "claude" });
    expect((await app.request("/api/tasks/NOPE-1")).status).toBe(404);
    expect((await post("/tasks", { title: "x", projectId: p.id, dueDate: "tomorrow" })).status).toBe(400);
    expect((await post("/projects", { name: "Evil" }, { origin: "https://example.com" })).status).toBe(403);
  });
});

describe("auto-archiving done tasks", () => {
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
  const completeAt = (key: string, iso: string) => repo.db.prepare("UPDATE tasks SET completed_at = ? WHERE key = ?").run(iso, key);

  it("archives tasks done for longer than the setting, keeps recent ones, and logs it", () => {
    const p = repo.createProject(me, { name: "Orbit" });
    const old = repo.createTask(me, { title: "old", projectId: p.id, columnId: col("Done").id });
    const recent = repo.createTask(me, { title: "recent", projectId: p.id, columnId: col("Done").id });
    const open = repo.createTask(me, { title: "open", projectId: p.id, columnId: col("Review").id });
    completeAt(old.key, daysAgo(8));
    completeAt(recent.key, daysAgo(6));

    expect(repo.getBoardSettings()).toEqual({ autoArchiveDays: 7 });
    expect(repo.autoArchiveDone()).toBe(1);
    expect(repo.getBoard().tasks.map((t) => t.key).sort()).toEqual([open.key, recent.key].sort());
    expect(repo.getTask(old.key).archivedAt).not.toBeNull();
    expect(repo.getTask(old.key).activity[0]).toMatchObject({ type: "archived", actor: "system", data: { auto: true, days: 7 } });
    expect(repo.autoArchiveDone()).toBe(0); // idempotent

    // Archived tasks still count in reports for the period they were completed.
    const from = daysAgo(10).slice(0, 10);
    const to = new Date().toISOString().slice(0, 10);
    expect(repo.getReport(from, to).completed.map((t) => t.title).sort()).toEqual(["old", "recent"]);
  });

  it("follows a shorter or disabled setting", () => {
    const p = repo.createProject(me, { name: "Orbit" });
    const t = repo.createTask(me, { title: "x", projectId: p.id, columnId: col("Done").id });
    completeAt(t.key, daysAgo(4));
    repo.saveBoardSettings(me, { autoArchiveDays: null });
    expect(repo.autoArchiveDone()).toBe(0);
    repo.saveBoardSettings(me, { autoArchiveDays: 3 });
    expect(repo.getBoard().settings.autoArchiveDays).toBe(3);
    expect(repo.autoArchiveDone()).toBe(1);
  });

  it("validates the setting over the API and applies it straight away", async () => {
    const app = createApp(repo);
    const p = repo.createProject(me, { name: "Orbit" });
    const t = repo.createTask(me, { title: "x", projectId: p.id, columnId: col("Done").id });
    completeAt(t.key, daysAgo(2));
    const put = (b: unknown) => app.request("/api/settings/board", { method: "PUT", body: JSON.stringify(b), headers: { "content-type": "application/json" } });
    expect((await put({ autoArchiveDays: 0 })).status).toBe(400);
    expect(await (await put({ autoArchiveDays: 1 })).json()).toEqual({ autoArchiveDays: 1 });
    expect(repo.getTask(t.key).archivedAt).not.toBeNull();
  });
});
