import { EventEmitter } from "node:events";
import type { DB } from "./db/index.ts";
import type {
  Activity, Actor, Board, ChangeEvent, Column, Note, Priority, Project, Stats, Subtask, Tag, Task, TaskDetail,
} from "../shared/types.ts";

export class NotFoundError extends Error {}
export class ConflictError extends Error {}
export class InvalidError extends Error {}

/** Who is making a change, and from which browser tab (so a tab can ignore its own echoes). */
export interface Ctx {
  actor: Actor;
  clientId: string | null;
}

const STEP = 1024;

export const PROJECT_COLORS = ["#2dd4bf", "#a78bfa", "#fb7185", "#fbbf24", "#38bdf8", "#f472b6", "#a3e635", "#fb923c"];
export const TAG_COLORS = ["#94a3b8", "#60a5fa", "#c084fc", "#f472b6", "#34d399", "#fbbf24", "#f87171", "#22d3ee"];

/** Midpoint between two sort positions, or null when they're too close and the list needs rebalancing. */
function between(a: number | null, b: number | null): number | null {
  if (a == null && b == null) return STEP;
  if (a == null) return b! - STEP;
  if (b == null) return a + STEP;
  const mid = (a + b) / 2;
  return mid > a && mid < b ? mid : null;
}

type Row = Record<string, any>;

const toProject = (r: Row): Project => ({
  id: r.id, parentId: r.parent_id, name: r.name, key: r.key, color: r.color,
  description: r.description, position: r.position, archivedAt: r.archived_at, createdAt: r.created_at,
});

const toColumn = (r: Row): Column => ({
  id: r.id, name: r.name, color: r.color, position: r.position, isDone: !!r.is_done, wipLimit: r.wip_limit,
});

const toTask = (r: Row): Task => ({
  id: r.id, key: r.key, projectId: r.project_id, columnId: r.column_id, title: r.title,
  description: r.description, priority: r.priority, dueDate: r.due_date, position: r.position,
  tagIds: r.tag_ids ? String(r.tag_ids).split(",").map(Number) : [],
  subtasksDone: r.st_done ?? 0, subtasksTotal: r.st_total ?? 0, notesCount: r.notes_count ?? 0,
  lastActor: r.last_actor, createdAt: r.created_at, updatedAt: r.updated_at,
  completedAt: r.completed_at, archivedAt: r.archived_at,
});

const toActivity = (r: Row): Activity => ({
  id: r.id, taskId: r.task_id, taskKey: r.task_key, taskTitle: r.task_title, projectId: r.project_id,
  actor: r.actor, type: r.type, data: JSON.parse(r.data), createdAt: r.created_at,
});

const TASK_SELECT = `
  SELECT t.*,
    (SELECT group_concat(tag_id) FROM task_tags WHERE task_id = t.id) AS tag_ids,
    (SELECT count(*) FROM subtasks WHERE task_id = t.id) AS st_total,
    (SELECT count(*) FROM subtasks WHERE task_id = t.id AND done = 1) AS st_done,
    (SELECT count(*) FROM notes WHERE task_id = t.id) AS notes_count
  FROM tasks t`;

export interface ProjectInput {
  name: string;
  parentId?: number | null;
  key?: string | null;
  color?: string;
  description?: string;
}

export interface TaskInput {
  title: string;
  projectId: number;
  columnId?: number;
  description?: string;
  priority?: Priority;
  dueDate?: string | null;
  tagIds?: number[];
  tags?: string[];
  subtasks?: string[];
  placement?: "top" | "bottom";
}

export interface TaskPatch {
  title?: string;
  description?: string;
  priority?: Priority;
  dueDate?: string | null;
  projectId?: number;
  tagIds?: number[];
  tags?: string[];
}

export interface MoveInput {
  columnId: number;
  /** Key of the task that should end up directly above. */
  afterKey?: string | null;
  /** Key of the task that should end up directly below. */
  beforeKey?: string | null;
}

export class Repo {
  readonly events = new EventEmitter();

  constructor(readonly db: DB) {
    this.events.setMaxListeners(100);
  }

  // ---------- helpers ----------

  private now() {
    return new Date().toISOString();
  }

  private emit(ctx: Ctx, kind: string, summary: string, taskKey?: string) {
    const ev: ChangeEvent = { actor: ctx.actor, clientId: ctx.clientId, kind, summary, taskKey };
    this.events.emit("change", ev);
  }

  private log(ctx: Ctx, type: string, task: Row | null, data: Record<string, unknown> = {}, projectId?: number) {
    this.db
      .prepare(
        `INSERT INTO activity (task_id, task_key, task_title, project_id, actor, type, data, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(task?.id ?? null, task?.key ?? null, task?.title ?? null, projectId ?? task?.project_id ?? null,
        ctx.actor, type, JSON.stringify(data), this.now());
  }

  private projectRow(id: number): Row {
    const r = this.db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as Row | undefined;
    if (!r) throw new NotFoundError(`Project ${id} not found`);
    return r;
  }

  private columnRow(id: number): Row {
    const r = this.db.prepare("SELECT * FROM columns WHERE id = ?").get(id) as Row | undefined;
    if (!r) throw new NotFoundError(`Column ${id} not found`);
    return r;
  }

  private taskRow(key: string): Row {
    const r = this.db.prepare("SELECT * FROM tasks WHERE key = ? COLLATE NOCASE").get(key) as Row | undefined;
    if (!r) throw new NotFoundError(`Task ${key} not found`);
    return r;
  }

  private rootOf(projectId: number): Row {
    let p = this.projectRow(projectId);
    while (p.parent_id != null) p = this.projectRow(p.parent_id);
    return p;
  }

  private descendantIds(projectId: number): number[] {
    const rows = this.db
      .prepare(
        `WITH RECURSIVE d(id) AS (SELECT ? UNION ALL SELECT p.id FROM projects p JOIN d ON p.parent_id = d.id)
         SELECT id FROM d`,
      )
      .all(projectId) as Row[];
    return rows.map((r) => r.id);
  }

  /** Derives a unique 2–5 letter prefix from a name: "Acme Client" → "ACM". */
  private deriveKey(name: string): string {
    const letters = name.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const base = (/^[A-Z]/.test(letters) ? letters : `P${letters}`).slice(0, 3).padEnd(2, "X");
    let key = base;
    for (let i = 2; this.keyTaken(key); i++) key = `${base}${i}`;
    return key;
  }

  private keyTaken(key: string, exceptId?: number) {
    return !!this.db
      .prepare("SELECT 1 FROM projects WHERE key = ? COLLATE NOCASE AND id IS NOT ?")
      .get(key, exceptId ?? null);
  }

  private normalizeKey(key: string, exceptId?: number): string {
    const k = key.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9]{1,5}$/.test(k)) {
      throw new InvalidError("Project key must be 2–6 letters or digits, starting with a letter");
    }
    if (this.keyTaken(k, exceptId)) throw new ConflictError(`Project key ${k} is already in use`);
    return k;
  }

  private nextTaskKey(projectId: number): string {
    const root = this.rootOf(projectId);
    let seq = root.next_seq as number;
    let key = `${root.key}-${seq}`;
    // Skip numbers already used, e.g. if a prefix was renamed and later reused.
    while (this.db.prepare("SELECT 1 FROM tasks WHERE key = ?").get(key)) key = `${root.key}-${++seq}`;
    this.db.prepare("UPDATE projects SET next_seq = ? WHERE id = ?").run(seq + 1, root.id);
    return key;
  }

  private assertDate(d: string | null | undefined) {
    if (d != null && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new InvalidError("Due date must be YYYY-MM-DD");
  }

  /** Resolves tag names to ids, creating any that don't exist yet. */
  private ensureTags(names: string[]): number[] {
    return names
      .map((n) => n.trim())
      .filter(Boolean)
      .map((name) => {
        const existing = this.db.prepare("SELECT id FROM tags WHERE name = ?").get(name) as Row | undefined;
        if (existing) return existing.id as number;
        const { n } = this.db.prepare("SELECT count(*) AS n FROM tags").get() as Row;
        return Number(this.db.prepare("INSERT INTO tags (name, color) VALUES (?, ?)").run(name, TAG_COLORS[n % TAG_COLORS.length]).lastInsertRowid);
      });
  }

  private setTaskTags(taskId: number, tagIds: number[]) {
    this.db.prepare("DELETE FROM task_tags WHERE task_id = ?").run(taskId);
    const ins = this.db.prepare("INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?, ?)");
    for (const id of new Set(tagIds)) {
      if (!this.db.prepare("SELECT 1 FROM tags WHERE id = ?").get(id)) throw new NotFoundError(`Tag ${id} not found`);
      ins.run(taskId, id);
    }
  }

  private touch(ctx: Ctx, taskId: number) {
    this.db.prepare("UPDATE tasks SET updated_at = ?, last_actor = ? WHERE id = ?").run(this.now(), ctx.actor, taskId);
  }

  private rebalanceColumn(columnId: number) {
    const rows = this.db.prepare("SELECT id FROM tasks WHERE column_id = ? ORDER BY position, id").all(columnId) as Row[];
    const upd = this.db.prepare("UPDATE tasks SET position = ? WHERE id = ?");
    rows.forEach((r, i) => upd.run((i + 1) * STEP, r.id));
  }

  /** Computes a sort position in a column relative to optional neighbours (excluding `selfId`). */
  private positionIn(columnId: number, selfId: number | null, afterKey?: string | null, beforeKey?: string | null, placement: "top" | "bottom" = "bottom"): number {
    const inColumn = (key?: string | null) => {
      if (!key) return null;
      const r = this.db.prepare("SELECT id, position FROM tasks WHERE key = ? COLLATE NOCASE AND column_id = ? AND id IS NOT ?").get(key, columnId, selfId) as Row | undefined;
      return r ?? null;
    };
    const compute = () => {
      // The task above wins: the moved task lands directly below it, even if tasks hidden by a
      // filter sit between it and `beforeKey`. `beforeKey` alone means "directly above that one".
      let after = inColumn(afterKey);
      let before = after ? null : inColumn(beforeKey);
      if (after) {
        before = this.db.prepare("SELECT position FROM tasks WHERE column_id = ? AND position > ? AND id IS NOT ? ORDER BY position LIMIT 1").get(columnId, after.position, selfId) as Row | undefined ?? null;
      } else if (before && !after) {
        after = this.db.prepare("SELECT position FROM tasks WHERE column_id = ? AND position < ? AND id IS NOT ? ORDER BY position DESC LIMIT 1").get(columnId, before.position, selfId) as Row | undefined ?? null;
      } else if (!after && !before) {
        const edge = this.db.prepare(`SELECT ${placement === "top" ? "min" : "max"}(position) AS p FROM tasks WHERE column_id = ? AND id IS NOT ?`).get(columnId, selfId) as Row;
        if (edge.p == null) return STEP;
        return placement === "top" ? edge.p - STEP : edge.p + STEP;
      }
      return between(after?.position ?? null, before?.position ?? null);
    };
    let pos = compute();
    if (pos == null) {
      this.rebalanceColumn(columnId);
      pos = compute();
    }
    return pos!;
  }

  // ---------- reads ----------

  getBoard(): Board {
    const columns = (this.db.prepare("SELECT * FROM columns ORDER BY position").all() as Row[]).map(toColumn);
    const projects = (this.db.prepare("SELECT * FROM projects ORDER BY position, id").all() as Row[]).map(toProject);
    const tags = this.listTags();
    const tasks = (this.db
      .prepare(`${TASK_SELECT} WHERE t.archived_at IS NULL
        AND t.project_id NOT IN (SELECT id FROM projects WHERE archived_at IS NOT NULL)
        ORDER BY t.column_id, t.position`)
      .all() as Row[]).map(toTask);
    return { columns, projects, tags, tasks };
  }

  listTasks(opts: { archived?: boolean; projectId?: number; columnId?: number; search?: string; limit?: number } = {}): Task[] {
    const where: string[] = [opts.archived ? "t.archived_at IS NOT NULL" : "t.archived_at IS NULL"];
    const args: unknown[] = [];
    if (opts.projectId != null) {
      const ids = this.descendantIds(opts.projectId);
      where.push(`t.project_id IN (${ids.map(() => "?").join(",")})`);
      args.push(...ids);
    }
    if (opts.columnId != null) { where.push("t.column_id = ?"); args.push(opts.columnId); }
    if (opts.search) {
      where.push("(t.title LIKE ? OR t.key LIKE ? OR t.description LIKE ?)");
      const q = `%${opts.search}%`;
      args.push(q, q, q);
    }
    const order = opts.archived ? "t.archived_at DESC" : "t.column_id, t.position";
    return (this.db.prepare(`${TASK_SELECT} WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ?`).all(...args, opts.limit ?? 500) as Row[]).map(toTask);
  }

  getTask(key: string): TaskDetail {
    const row = this.db.prepare(`${TASK_SELECT} WHERE t.key = ? COLLATE NOCASE`).get(key) as Row | undefined;
    if (!row) throw new NotFoundError(`Task ${key} not found`);
    const subtasks = (this.db.prepare("SELECT * FROM subtasks WHERE task_id = ? ORDER BY position, id").all(row.id) as Row[])
      .map((r): Subtask => ({ id: r.id, taskId: r.task_id, title: r.title, done: !!r.done, position: r.position }));
    const notes = (this.db.prepare("SELECT * FROM notes WHERE task_id = ? ORDER BY created_at DESC, id DESC").all(row.id) as Row[])
      .map((r): Note => ({ id: r.id, taskId: r.task_id, body: r.body, actor: r.actor, createdAt: r.created_at }));
    const activity = (this.db.prepare("SELECT * FROM activity WHERE task_id = ? ORDER BY created_at DESC, id DESC LIMIT 200").all(row.id) as Row[]).map(toActivity);
    return { ...toTask(row), subtasks, notes, activity };
  }

  listActivity(opts: { limit?: number; beforeId?: number } = {}): Activity[] {
    return (this.db
      .prepare("SELECT * FROM activity WHERE id < ? ORDER BY id DESC LIMIT ?")
      .all(opts.beforeId ?? Number.MAX_SAFE_INTEGER, Math.min(opts.limit ?? 100, 500)) as Row[]).map(toActivity);
  }

  listTags(): Tag[] {
    return (this.db.prepare("SELECT * FROM tags ORDER BY name").all() as Row[]).map((r) => ({ id: r.id, name: r.name, color: r.color }));
  }

  getStats(now = new Date()): Stats {
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(dayStart);
    weekStart.setDate(weekStart.getDate() - ((dayStart.getDay() + 6) % 7)); // Monday
    const rows = this.db.prepare("SELECT completed_at FROM tasks WHERE completed_at >= ?").all(weekStart.toISOString()) as Row[];
    const week = [0, 0, 0, 0, 0, 0, 0];
    let doneToday = 0;
    for (const r of rows) {
      const d = new Date(r.completed_at);
      const idx = Math.floor((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - weekStart.getTime()) / 86_400_000);
      if (idx >= 0 && idx < 7) week[idx]++;
      if (d >= dayStart) doneToday++;
    }
    const today = `${dayStart.getFullYear()}-${String(dayStart.getMonth() + 1).padStart(2, "0")}-${String(dayStart.getDate()).padStart(2, "0")}`;
    const { n: overdue } = this.db
      .prepare(`SELECT count(*) AS n FROM tasks t JOIN columns c ON c.id = t.column_id
        WHERE t.archived_at IS NULL AND c.is_done = 0 AND t.due_date < ?`)
      .get(today) as Row;
    return { doneToday, doneThisWeek: week.reduce((a, b) => a + b, 0), week, overdue };
  }

  exportAll() {
    const all = (t: string) => this.db.prepare(`SELECT * FROM ${t}`).all();
    return {
      app: "orbit", version: 1, exportedAt: this.now(),
      projects: all("projects"), columns: all("columns"), tasks: all("tasks"), tags: all("tags"),
      taskTags: all("task_tags"), subtasks: all("subtasks"), notes: all("notes"), activity: all("activity"),
    };
  }

  // ---------- projects ----------

  createProject(ctx: Ctx, input: ProjectInput): Project {
    const name = input.name.trim();
    if (!name) throw new InvalidError("Project name is required");
    return this.db.transaction(() => {
      let key: string | null = null;
      let color = input.color;
      if (input.parentId != null) {
        const parent = this.projectRow(input.parentId);
        color ??= parent.color;
      } else {
        key = input.key ? this.normalizeKey(input.key) : this.deriveKey(name);
        const { n } = this.db.prepare("SELECT count(*) AS n FROM projects WHERE parent_id IS NULL").get() as Row;
        color ??= PROJECT_COLORS[n % PROJECT_COLORS.length];
      }
      const { p } = this.db.prepare("SELECT max(position) AS p FROM projects").get() as Row;
      const now = this.now();
      const id = Number(this.db
        .prepare(`INSERT INTO projects (parent_id, name, key, color, description, position, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(input.parentId ?? null, name, key, color, input.description ?? "", (p ?? 0) + STEP, now, now).lastInsertRowid);
      this.log(ctx, "project_created", null, { name }, id);
      this.emit(ctx, "project", `Created project ${name}`);
      return toProject(this.projectRow(id));
    })();
  }

  updateProject(ctx: Ctx, id: number, patch: Partial<ProjectInput> & { position?: number }): Project {
    return this.db.transaction(() => {
      const cur = this.projectRow(id);
      const sets: Record<string, unknown> = {};
      if (patch.name !== undefined) {
        if (!patch.name.trim()) throw new InvalidError("Project name is required");
        sets.name = patch.name.trim();
      }
      if (patch.color !== undefined) sets.color = patch.color;
      if (patch.description !== undefined) sets.description = patch.description;
      if (patch.position !== undefined) sets.position = patch.position;
      if (patch.parentId !== undefined && patch.parentId !== cur.parent_id) {
        if (patch.parentId != null) {
          this.projectRow(patch.parentId);
          if (this.descendantIds(id).includes(patch.parentId)) {
            throw new InvalidError("A project can't be moved inside itself");
          }
          sets.parent_id = patch.parentId;
          sets.key = null; // subprojects use their root's prefix
        } else {
          sets.parent_id = null;
          sets.key = patch.key ? this.normalizeKey(patch.key, id) : this.deriveKey(cur.name);
        }
      }
      if (patch.key !== undefined && sets.key === undefined) {
        if ((sets.parent_id ?? cur.parent_id) != null) throw new InvalidError("Only top-level projects have a key");
        if (patch.key) sets.key = this.normalizeKey(patch.key, id);
      }
      const cols = Object.keys(sets);
      if (cols.length) {
        this.db.prepare(`UPDATE projects SET ${cols.map((c) => `${c} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
          .run(...Object.values(sets), this.now(), id);
        this.emit(ctx, "project", `Updated project ${sets.name ?? cur.name}`);
      }
      return toProject(this.projectRow(id));
    })();
  }

  setProjectArchived(ctx: Ctx, id: number, archived: boolean): Project {
    return this.db.transaction(() => {
      const cur = this.projectRow(id);
      const ids = this.descendantIds(id);
      this.db.prepare(`UPDATE projects SET archived_at = ? WHERE id IN (${ids.map(() => "?").join(",")})`)
        .run(archived ? this.now() : null, ...ids);
      this.log(ctx, archived ? "project_archived" : "project_restored", null, { name: cur.name }, id);
      this.emit(ctx, "project", `${archived ? "Archived" : "Restored"} project ${cur.name}`);
      return toProject(this.projectRow(id));
    })();
  }

  deleteProject(ctx: Ctx, id: number) {
    this.db.transaction(() => {
      const cur = this.projectRow(id);
      const ids = this.descendantIds(id);
      const { n } = this.db.prepare(`SELECT count(*) AS n FROM tasks WHERE project_id IN (${ids.map(() => "?").join(",")})`).get(...ids) as Row;
      if (n > 0) throw new ConflictError(`${cur.name} still has ${n} task${n === 1 ? "" : "s"}; move or delete them first, or archive the project`);
      this.db.prepare("DELETE FROM projects WHERE id = ?").run(id);
      this.emit(ctx, "project", `Deleted project ${cur.name}`);
    })();
  }

  // ---------- columns ----------

  createColumn(ctx: Ctx, input: { name: string; color?: string; isDone?: boolean; wipLimit?: number | null }): Column {
    if (!input.name.trim()) throw new InvalidError("Column name is required");
    const { p } = this.db.prepare("SELECT max(position) AS p FROM columns").get() as Row;
    const id = Number(this.db
      .prepare("INSERT INTO columns (name, color, position, is_done, wip_limit, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(input.name.trim(), input.color ?? "#94a3b8", (p ?? 0) + STEP, input.isDone ? 1 : 0, input.wipLimit ?? null, this.now()).lastInsertRowid);
    this.emit(ctx, "column", `Added column ${input.name}`);
    return toColumn(this.columnRow(id));
  }

  updateColumn(ctx: Ctx, id: number, patch: { name?: string; color?: string; isDone?: boolean; wipLimit?: number | null }): Column {
    const cur = this.columnRow(id);
    const sets: Record<string, unknown> = {};
    if (patch.name !== undefined) {
      if (!patch.name.trim()) throw new InvalidError("Column name is required");
      sets.name = patch.name.trim();
    }
    if (patch.color !== undefined) sets.color = patch.color;
    if (patch.isDone !== undefined) sets.is_done = patch.isDone ? 1 : 0;
    if (patch.wipLimit !== undefined) sets.wip_limit = patch.wipLimit;
    const cols = Object.keys(sets);
    if (cols.length) {
      this.db.prepare(`UPDATE columns SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`).run(...Object.values(sets), id);
      this.emit(ctx, "column", `Updated column ${sets.name ?? cur.name}`);
    }
    return toColumn(this.columnRow(id));
  }

  /** Moves a column one step left (-1) or right (+1). */
  shiftColumn(ctx: Ctx, id: number, dir: -1 | 1): Column[] {
    return this.db.transaction(() => {
      const cols = this.db.prepare("SELECT id, position FROM columns ORDER BY position").all() as Row[];
      const i = cols.findIndex((c) => c.id === id);
      if (i < 0) throw new NotFoundError(`Column ${id} not found`);
      const j = i + dir;
      if (j >= 0 && j < cols.length) {
        const upd = this.db.prepare("UPDATE columns SET position = ? WHERE id = ?");
        upd.run(cols[j].position, cols[i].id);
        upd.run(cols[i].position, cols[j].id);
        this.emit(ctx, "column", "Reordered columns");
      }
      return (this.db.prepare("SELECT * FROM columns ORDER BY position").all() as Row[]).map(toColumn);
    })();
  }

  /** Deletes a column; if it holds tasks, they move to `moveTo` (required in that case). */
  deleteColumn(ctx: Ctx, id: number, moveTo?: number) {
    this.db.transaction(() => {
      const cur = this.columnRow(id);
      const { total } = this.db.prepare("SELECT count(*) AS total FROM columns").get() as Row;
      if (total <= 1) throw new ConflictError("The board needs at least one column");
      const { n } = this.db.prepare("SELECT count(*) AS n FROM tasks WHERE column_id = ?").get(id) as Row;
      if (n > 0) {
        if (moveTo == null || moveTo === id) throw new ConflictError(`${cur.name} has ${n} task${n === 1 ? "" : "s"}; choose a column to move them to`);
        const target = this.columnRow(moveTo);
        const { p } = this.db.prepare("SELECT max(position) AS p FROM tasks WHERE column_id = ?").get(moveTo) as Row;
        const tasks = this.db.prepare("SELECT id FROM tasks WHERE column_id = ? ORDER BY position").all(id) as Row[];
        const upd = this.db.prepare("UPDATE tasks SET column_id = ?, position = ?, completed_at = ? WHERE id = ?");
        tasks.forEach((t, i) => upd.run(moveTo, (p ?? 0) + (i + 1) * STEP, target.is_done ? this.now() : null, t.id));
      }
      this.db.prepare("DELETE FROM columns WHERE id = ?").run(id);
      this.emit(ctx, "column", `Deleted column ${cur.name}`);
    })();
  }

  // ---------- tasks ----------

  createTask(ctx: Ctx, input: TaskInput): TaskDetail {
    const title = input.title.trim();
    if (!title) throw new InvalidError("Task title is required");
    this.assertDate(input.dueDate);
    return this.db.transaction(() => {
      const project = this.projectRow(input.projectId);
      if (project.archived_at) throw new InvalidError(`Project ${project.name} is archived`);
      const column = input.columnId != null
        ? this.columnRow(input.columnId)
        : (this.db.prepare("SELECT * FROM columns ORDER BY position LIMIT 1").get() as Row);
      const key = this.nextTaskKey(project.id);
      const now = this.now();
      const position = this.positionIn(column.id, null, null, null, input.placement ?? "bottom");
      const id = Number(this.db
        .prepare(`INSERT INTO tasks (key, project_id, column_id, title, description, priority, due_date, position,
            last_actor, created_at, updated_at, completed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(key, project.id, column.id, title, input.description ?? "", input.priority ?? "none", input.dueDate ?? null,
          position, ctx.actor, now, now, column.is_done ? now : null).lastInsertRowid);
      const tagIds = [...(input.tagIds ?? []), ...this.ensureTags(input.tags ?? [])];
      if (tagIds.length) this.setTaskTags(id, tagIds);
      const insSub = this.db.prepare("INSERT INTO subtasks (task_id, title, position) VALUES (?, ?, ?)");
      (input.subtasks ?? []).map((s) => s.trim()).filter(Boolean).forEach((s, i) => insSub.run(id, s, (i + 1) * STEP));
      const row = this.taskRow(key);
      this.log(ctx, "created", row, { column: column.name });
      this.emit(ctx, "task", `Created ${key}`, key);
      return this.getTask(key);
    })();
  }

  updateTask(ctx: Ctx, key: string, patch: TaskPatch): TaskDetail {
    this.assertDate(patch.dueDate);
    return this.db.transaction(() => {
      const cur = this.taskRow(key);
      const sets: Record<string, unknown> = {};
      const changes: Record<string, unknown> = {};
      if (patch.title !== undefined && patch.title.trim() !== cur.title) {
        if (!patch.title.trim()) throw new InvalidError("Task title is required");
        sets.title = patch.title.trim();
        changes.title = [cur.title, sets.title];
      }
      if (patch.description !== undefined && patch.description !== cur.description) {
        sets.description = patch.description;
        changes.description = true;
      }
      if (patch.priority !== undefined && patch.priority !== cur.priority) {
        sets.priority = patch.priority;
        changes.priority = [cur.priority, patch.priority];
      }
      if (patch.dueDate !== undefined && patch.dueDate !== cur.due_date) {
        sets.due_date = patch.dueDate;
        changes.dueDate = [cur.due_date, patch.dueDate];
      }
      if (patch.projectId !== undefined && patch.projectId !== cur.project_id) {
        const from = this.projectRow(cur.project_id);
        const to = this.projectRow(patch.projectId);
        if (to.archived_at) throw new InvalidError(`Project ${to.name} is archived`);
        sets.project_id = to.id;
        changes.project = [from.name, to.name];
      }
      if (Object.keys(sets).length) {
        this.db.prepare(`UPDATE tasks SET ${Object.keys(sets).map((c) => `${c} = ?`).join(", ")} WHERE id = ?`)
          .run(...Object.values(sets), cur.id);
      }
      if (patch.tagIds !== undefined || patch.tags !== undefined) {
        const before = (this.db.prepare("SELECT tag_id FROM task_tags WHERE task_id = ? ORDER BY tag_id").all(cur.id) as Row[]).map((r) => r.tag_id);
        const next = [...new Set([...(patch.tagIds ?? before), ...this.ensureTags(patch.tags ?? [])])].sort((a, b) => a - b);
        if (before.join() !== next.join()) {
          this.setTaskTags(cur.id, next);
          changes.tags = true;
        }
      }
      if (Object.keys(changes).length) {
        this.touch(ctx, cur.id);
        this.log(ctx, "updated", { ...cur, title: sets.title ?? cur.title }, changes);
        this.emit(ctx, "task", `Updated ${cur.key}`, cur.key);
      }
      return this.getTask(cur.key);
    })();
  }

  moveTask(ctx: Ctx, key: string, input: MoveInput): TaskDetail {
    return this.db.transaction(() => {
      const cur = this.taskRow(key);
      const from = this.columnRow(cur.column_id);
      const to = this.columnRow(input.columnId);
      const position = this.positionIn(to.id, cur.id, input.afterKey, input.beforeKey);
      let completedAt = cur.completed_at;
      if (to.is_done && !from.is_done) completedAt = this.now();
      if (!to.is_done) completedAt = null;
      this.db.prepare("UPDATE tasks SET column_id = ?, position = ?, completed_at = ? WHERE id = ?")
        .run(to.id, position, completedAt, cur.id);
      if (from.id !== to.id) {
        this.touch(ctx, cur.id);
        const type = to.is_done && !from.is_done ? "completed" : !to.is_done && from.is_done ? "reopened" : "moved";
        this.log(ctx, type, cur, { from: from.name, to: to.name });
        this.emit(ctx, "task", `Moved ${cur.key} to ${to.name}`, cur.key);
      } else {
        this.emit(ctx, "task", `Reordered ${cur.key}`, cur.key);
      }
      return this.getTask(cur.key);
    })();
  }

  setTaskArchived(ctx: Ctx, key: string, archived: boolean): TaskDetail {
    return this.db.transaction(() => {
      const cur = this.taskRow(key);
      if (!!cur.archived_at === archived) return this.getTask(cur.key);
      const sets = ["archived_at = ?"];
      const args: unknown[] = [archived ? this.now() : null];
      if (!archived) {
        // Restore to the bottom of its column so it doesn't land somewhere arbitrary.
        sets.push("position = ?");
        args.push(this.positionIn(cur.column_id, cur.id));
      }
      this.db.prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`).run(...args, cur.id);
      this.touch(ctx, cur.id);
      this.log(ctx, archived ? "archived" : "restored", cur);
      this.emit(ctx, "task", `${archived ? "Archived" : "Restored"} ${cur.key}`, cur.key);
      return this.getTask(cur.key);
    })();
  }

  /** Archives every task currently in a column (typically Done). Returns the count. */
  archiveColumn(ctx: Ctx, columnId: number): number {
    return this.db.transaction(() => {
      const col = this.columnRow(columnId);
      const rows = this.db.prepare("SELECT * FROM tasks WHERE column_id = ? AND archived_at IS NULL").all(columnId) as Row[];
      const now = this.now();
      const upd = this.db.prepare("UPDATE tasks SET archived_at = ?, updated_at = ?, last_actor = ? WHERE id = ?");
      for (const r of rows) {
        upd.run(now, now, ctx.actor, r.id);
        this.log(ctx, "archived", r);
      }
      if (rows.length) this.emit(ctx, "task", `Archived ${rows.length} task${rows.length === 1 ? "" : "s"} from ${col.name}`);
      return rows.length;
    })();
  }

  deleteTask(ctx: Ctx, key: string) {
    this.db.transaction(() => {
      const cur = this.taskRow(key);
      this.log(ctx, "deleted", cur);
      this.db.prepare("DELETE FROM tasks WHERE id = ?").run(cur.id);
      this.emit(ctx, "task", `Deleted ${cur.key}`, cur.key);
    })();
  }

  // ---------- subtasks ----------

  addSubtask(ctx: Ctx, key: string, title: string): TaskDetail {
    if (!title.trim()) throw new InvalidError("Subtask title is required");
    return this.db.transaction(() => {
      const task = this.taskRow(key);
      const { p } = this.db.prepare("SELECT max(position) AS p FROM subtasks WHERE task_id = ?").get(task.id) as Row;
      this.db.prepare("INSERT INTO subtasks (task_id, title, position) VALUES (?, ?, ?)").run(task.id, title.trim(), (p ?? 0) + STEP);
      this.touch(ctx, task.id);
      this.log(ctx, "subtask_added", task, { title: title.trim() });
      this.emit(ctx, "task", `Added a subtask to ${task.key}`, task.key);
      return this.getTask(task.key);
    })();
  }

  updateSubtask(ctx: Ctx, id: number, patch: { title?: string; done?: boolean }): TaskDetail {
    return this.db.transaction(() => {
      const sub = this.db.prepare("SELECT * FROM subtasks WHERE id = ?").get(id) as Row | undefined;
      if (!sub) throw new NotFoundError(`Subtask ${id} not found`);
      const task = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(sub.task_id) as Row;
      if (patch.title !== undefined) {
        if (!patch.title.trim()) throw new InvalidError("Subtask title is required");
        this.db.prepare("UPDATE subtasks SET title = ? WHERE id = ?").run(patch.title.trim(), id);
      }
      if (patch.done !== undefined && patch.done !== !!sub.done) {
        this.db.prepare("UPDATE subtasks SET done = ? WHERE id = ?").run(patch.done ? 1 : 0, id);
        this.log(ctx, patch.done ? "subtask_done" : "subtask_reopened", task, { title: sub.title });
      }
      this.touch(ctx, task.id);
      this.emit(ctx, "task", `Updated a subtask on ${task.key}`, task.key);
      return this.getTask(task.key);
    })();
  }

  deleteSubtask(ctx: Ctx, id: number): TaskDetail {
    return this.db.transaction(() => {
      const sub = this.db.prepare("SELECT * FROM subtasks WHERE id = ?").get(id) as Row | undefined;
      if (!sub) throw new NotFoundError(`Subtask ${id} not found`);
      const task = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(sub.task_id) as Row;
      this.db.prepare("DELETE FROM subtasks WHERE id = ?").run(id);
      this.touch(ctx, task.id);
      this.emit(ctx, "task", `Removed a subtask from ${task.key}`, task.key);
      return this.getTask(task.key);
    })();
  }

  // ---------- notes ----------

  addNote(ctx: Ctx, key: string, body: string): TaskDetail {
    if (!body.trim()) throw new InvalidError("Note can't be empty");
    return this.db.transaction(() => {
      const task = this.taskRow(key);
      this.db.prepare("INSERT INTO notes (task_id, body, actor, created_at) VALUES (?, ?, ?, ?)").run(task.id, body.trim(), ctx.actor, this.now());
      this.touch(ctx, task.id);
      this.log(ctx, "note", task, { excerpt: body.trim().slice(0, 140) });
      this.emit(ctx, "task", `${ctx.actor === "claude" ? "Claude added" : "Added"} a note to ${task.key}`, task.key);
      return this.getTask(task.key);
    })();
  }

  deleteNote(ctx: Ctx, id: number): TaskDetail {
    return this.db.transaction(() => {
      const note = this.db.prepare("SELECT * FROM notes WHERE id = ?").get(id) as Row | undefined;
      if (!note) throw new NotFoundError(`Note ${id} not found`);
      const task = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(note.task_id) as Row;
      this.db.prepare("DELETE FROM notes WHERE id = ?").run(id);
      this.emit(ctx, "task", `Removed a note from ${task.key}`, task.key);
      return this.getTask(task.key);
    })();
  }

  // ---------- tags ----------

  createTag(ctx: Ctx, input: { name: string; color?: string }): Tag {
    const name = input.name.trim();
    if (!name) throw new InvalidError("Tag name is required");
    if (this.db.prepare("SELECT 1 FROM tags WHERE name = ?").get(name)) throw new ConflictError(`Tag ${name} already exists`);
    const [id] = this.ensureTags([name]);
    if (input.color) this.db.prepare("UPDATE tags SET color = ? WHERE id = ?").run(input.color, id);
    this.emit(ctx, "tag", `Created tag ${name}`);
    return this.listTags().find((t) => t.id === id)!;
  }

  updateTag(ctx: Ctx, id: number, patch: { name?: string; color?: string }): Tag {
    const cur = this.db.prepare("SELECT * FROM tags WHERE id = ?").get(id) as Row | undefined;
    if (!cur) throw new NotFoundError(`Tag ${id} not found`);
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new InvalidError("Tag name is required");
      if (this.db.prepare("SELECT 1 FROM tags WHERE name = ? AND id != ?").get(name, id)) throw new ConflictError(`Tag ${name} already exists`);
      this.db.prepare("UPDATE tags SET name = ? WHERE id = ?").run(name, id);
    }
    if (patch.color !== undefined) this.db.prepare("UPDATE tags SET color = ? WHERE id = ?").run(patch.color, id);
    this.emit(ctx, "tag", `Updated tag ${patch.name ?? cur.name}`);
    return this.listTags().find((t) => t.id === id)!;
  }

  deleteTag(ctx: Ctx, id: number) {
    const cur = this.db.prepare("SELECT * FROM tags WHERE id = ?").get(id) as Row | undefined;
    if (!cur) throw new NotFoundError(`Tag ${id} not found`);
    this.db.prepare("DELETE FROM tags WHERE id = ?").run(id);
    this.emit(ctx, "tag", `Deleted tag ${cur.name}`);
  }
}
