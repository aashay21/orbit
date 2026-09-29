import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { PRIORITIES, type ChangeEvent } from "../shared/types.ts";
import { reportToHtml, reportToMarkdown } from "../shared/report.ts";
import { ConflictError, InvalidError, NotFoundError, type Ctx, type Repo } from "./repo.ts";
import type { NotificationSettings, NotificationsView } from "../shared/notifications.ts";
import type { Notifier } from "./notify/notifier.ts";

const id = z.coerce.number().int().positive();
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color must be #rrggbb");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD").nullable();
const priority = z.enum(PRIORITIES);
const recurrence = z.object({
  freq: z.enum(["daily", "weekly", "monthly", "yearly"]),
  interval: z.number().int().min(1).max(365),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  monthDay: z.number().int().min(1).max(31).optional(),
  until: date.optional(),
  columnId: id.nullable().optional(),
}).nullable();

const hm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Time must be HH:MM");
const weekdays = z.array(z.number().int().min(0).max(6)).max(7);

const schemas = {
  notifications: z.object({
    enabled: z.boolean().optional(),
    teamsWebhook: z.string().trim().max(2000).url().startsWith("https://", "The webhook URL must start with https://").nullable().optional(),
    digest: z.object({ enabled: z.boolean(), time: hm, days: weekdays }).partial().optional(),
    dueReminders: z.object({ enabled: z.boolean(), time: hm }).partial().optional(),
    taskReminders: z.object({ enabled: z.boolean() }).partial().optional(),
    blockers: z.object({ enabled: z.boolean() }).partial().optional(),
    claudeCompleted: z.object({ enabled: z.boolean() }).partial().optional(),
    report: z.object({
      enabled: z.boolean(), frequency: z.enum(["daily", "weekly"]), weekday: z.number().int().min(0).max(6),
      days: weekdays, time: hm, projectId: id.nullable(), notes: z.boolean(),
    }).partial().optional(),
  }),
  sendReport: z.object({ from: date.unwrap(), to: date.unwrap(), projectId: id.nullable().optional(), notes: z.boolean().optional() }),
  projectCreate: z.object({
    name: z.string().min(1).max(80),
    parentId: id.nullable().optional(),
    key: z.string().max(6).nullable().optional(),
    color: color.optional(),
    description: z.string().max(4000).optional(),
  }),
  projectPatch: z.object({
    name: z.string().min(1).max(80).optional(),
    parentId: id.nullable().optional(),
    key: z.string().max(6).nullable().optional(),
    color: color.optional(),
    description: z.string().max(4000).optional(),
    position: z.number().optional(),
    archived: z.boolean().optional(),
  }),
  columnCreate: z.object({
    name: z.string().min(1).max(40),
    color: color.optional(),
    isDone: z.boolean().optional(),
    isActive: z.boolean().optional(),
    wipLimit: z.number().int().positive().nullable().optional(),
  }),
  columnPatch: z.object({
    name: z.string().min(1).max(40).optional(),
    color: color.optional(),
    isDone: z.boolean().optional(),
    isActive: z.boolean().optional(),
    wipLimit: z.number().int().positive().nullable().optional(),
    shift: z.union([z.literal(-1), z.literal(1)]).optional(),
  }),
  taskCreate: z.object({
    title: z.string().min(1).max(300),
    projectId: id,
    columnId: id.optional(),
    description: z.string().max(50_000).optional(),
    priority: priority.optional(),
    dueDate: date.optional(),
    tagIds: z.array(id).optional(),
    tags: z.array(z.string().min(1).max(40)).optional(),
    subtasks: z.array(z.string().min(1).max(300)).optional(),
    recurrence: recurrence.optional(),
    remindAt: z.string().max(40).nullable().optional(),
    placement: z.enum(["top", "bottom"]).optional(),
  }),
  taskPatch: z.object({
    title: z.string().min(1).max(300).optional(),
    description: z.string().max(50_000).optional(),
    priority: priority.optional(),
    dueDate: date.optional(),
    projectId: id.optional(),
    tagIds: z.array(id).optional(),
    tags: z.array(z.string().min(1).max(40)).optional(),
    recurrence: recurrence.optional(),
    blocked: z.string().max(500).nullable().optional(),
    remindAt: z.string().max(40).nullable().optional(),
  }),
  taskMove: z.object({
    columnId: id,
    afterKey: z.string().nullable().optional(),
    beforeKey: z.string().nullable().optional(),
  }),
  subtask: z.object({ title: z.string().min(1).max(300) }),
  subtaskPatch: z.object({ title: z.string().min(1).max(300).optional(), done: z.boolean().optional() }),
  note: z.object({ body: z.string().min(1).max(20_000) }),
  tag: z.object({ name: z.string().min(1).max(40), color: color.optional() }),
  tagPatch: z.object({ name: z.string().min(1).max(40).optional(), color: color.optional() }),
};

function ctxOf(c: Context): Ctx {
  const actor = c.req.header("x-orbit-actor");
  return {
    actor: actor === "claude" ? "claude" : actor === "system" ? "system" : "user",
    clientId: c.req.header("x-orbit-client") ?? null,
  };
}

async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new InvalidError("Request body must be JSON");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new InvalidError(parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  }
  return parsed.data;
}

/** Settings as the UI sees them: the webhook URL is secret, so only a short hint is returned. */
function publicSettings(s: NotificationSettings) {
  const { teamsWebhook, ...rest } = s;
  const hint = teamsWebhook ? `${new URL(teamsWebhook).host} · …${teamsWebhook.slice(-6)}` : null;
  return { ...rest, webhook: { set: !!teamsWebhook, hint } };
}

export function createApp(repo: Repo, notifier?: Notifier) {
  const api = new Hono();

  api.onError((err, c) => {
    const status = err instanceof NotFoundError ? 404 : err instanceof ConflictError ? 409 : err instanceof InvalidError ? 400 : 500;
    if (status === 500) console.error(err);
    return c.json({ error: status === 500 ? "Something went wrong" : err.message }, status);
  });

  // Reject requests from other websites: a page on the internet must not be able to drive a
  // local server through the browser. Same-origin and non-browser clients (no Origin) pass.
  api.use("*", async (c, next) => {
    const origin = c.req.header("origin");
    if (origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
      return c.json({ error: "Forbidden origin" }, 403);
    }
    if (c.req.header("x-orbit-actor") === "claude") repo.claudeSeenAt = new Date().toISOString();
    await next();
  });

  api.get("/health", (c) => c.json({ ok: true }));
  api.get("/board", (c) => c.json(repo.getBoard()));
  api.get("/stats", (c) => c.json(repo.getStats()));
  api.get("/export", (c) => {
    c.header("content-disposition", `attachment; filename="orbit-export-${new Date().toISOString().slice(0, 10)}.json"`);
    return c.json(repo.exportAll());
  });

  // Notifications (Teams)
  const notificationsView = (): NotificationsView => ({ settings: publicSettings(repo.getNotificationSettings()), log: repo.notifyLogRecent() });
  api.get("/notifications", (c) => c.json(notificationsView()));
  api.put("/notifications", async (c) => {
    const patch = await body(c, schemas.notifications);
    const cur = repo.getNotificationSettings();
    repo.saveNotificationSettings({
      ...cur,
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.teamsWebhook !== undefined ? { teamsWebhook: patch.teamsWebhook || null } : {}),
      digest: { ...cur.digest, ...patch.digest },
      dueReminders: { ...cur.dueReminders, ...patch.dueReminders },
      taskReminders: { ...cur.taskReminders, ...patch.taskReminders },
      blockers: { ...cur.blockers, ...patch.blockers },
      claudeCompleted: { ...cur.claudeCompleted, ...patch.claudeCompleted },
      report: { ...cur.report, ...patch.report },
    });
    return c.json(notificationsView());
  });
  api.post("/notifications/test", async (c) => {
    if (!notifier) throw new InvalidError("Notifications aren't running");
    const error = await notifier.test();
    return c.json({ ok: !error, error, view: notificationsView() });
  });
  api.post("/notifications/report", async (c) => {
    if (!notifier) throw new InvalidError("Notifications aren't running");
    const b = await body(c, schemas.sendReport);
    const error = await notifier.sendReport(b.from, b.to, b.projectId ?? null, b.notes ?? true);
    if (error) throw new InvalidError(`Couldn't send to Teams: ${error}`);
    return c.json({ ok: true });
  });

  // ?from=&to= (YYYY-MM-DD, inclusive) [&projectId=] [&format=json|md|html] [&notes=0]
  api.get("/report", (c) => {
    const q = c.req.query();
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const report = repo.getReport(q.from ?? iso, q.to ?? q.from ?? iso, q.projectId ? Number(q.projectId) : null);
    const opts = { notes: q.notes !== "0" };
    if (q.format === "md") return c.text(reportToMarkdown(report, opts), 200, { "content-type": "text/markdown; charset=utf-8" });
    if (q.format === "html") return c.html(reportToHtml(report, opts));
    return c.json(report);
  });

  api.get("/activity", (c) => {
    const limit = Number(c.req.query("limit") ?? 100);
    const before = c.req.query("before");
    return c.json(repo.listActivity({ limit, beforeId: before ? Number(before) : undefined }));
  });

  // Projects
  api.post("/projects", async (c) => c.json(repo.createProject(ctxOf(c), await body(c, schemas.projectCreate)), 201));
  api.patch("/projects/:id", async (c) => {
    const pid = id.parse(c.req.param("id"));
    const { archived, ...patch } = await body(c, schemas.projectPatch);
    let p = repo.updateProject(ctxOf(c), pid, patch);
    if (archived !== undefined) p = repo.setProjectArchived(ctxOf(c), pid, archived);
    return c.json(p);
  });
  api.delete("/projects/:id", (c) => {
    repo.deleteProject(ctxOf(c), id.parse(c.req.param("id")));
    return c.body(null, 204);
  });

  // Columns
  api.post("/columns", async (c) => c.json(repo.createColumn(ctxOf(c), await body(c, schemas.columnCreate)), 201));
  api.patch("/columns/:id", async (c) => {
    const cid = id.parse(c.req.param("id"));
    const { shift, ...patch } = await body(c, schemas.columnPatch);
    const col = repo.updateColumn(ctxOf(c), cid, patch);
    if (shift) repo.shiftColumn(ctxOf(c), cid, shift);
    return c.json(col);
  });
  api.delete("/columns/:id", (c) => {
    const moveTo = c.req.query("moveTo");
    repo.deleteColumn(ctxOf(c), id.parse(c.req.param("id")), moveTo ? Number(moveTo) : undefined);
    return c.body(null, 204);
  });
  api.post("/columns/:id/archive", (c) => c.json({ archived: repo.archiveColumn(ctxOf(c), id.parse(c.req.param("id"))) }));

  // Tasks
  api.get("/tasks", (c) => {
    const q = c.req.query();
    return c.json(repo.listTasks({
      archived: q.archived === "1" || q.archived === "true",
      projectId: q.projectId ? Number(q.projectId) : undefined,
      columnId: q.columnId ? Number(q.columnId) : undefined,
      search: q.q,
      limit: q.limit ? Number(q.limit) : undefined,
    }));
  });
  api.post("/tasks", async (c) => c.json(repo.createTask(ctxOf(c), await body(c, schemas.taskCreate)), 201));
  api.get("/tasks/:key", (c) => c.json(repo.getTask(c.req.param("key"))));
  api.patch("/tasks/:key", async (c) => c.json(repo.updateTask(ctxOf(c), c.req.param("key"), await body(c, schemas.taskPatch))));
  api.post("/tasks/:key/move", async (c) => c.json(repo.moveTask(ctxOf(c), c.req.param("key"), await body(c, schemas.taskMove))));
  api.post("/tasks/:key/archive", (c) => c.json(repo.setTaskArchived(ctxOf(c), c.req.param("key"), true)));
  api.post("/tasks/:key/restore", (c) => c.json(repo.setTaskArchived(ctxOf(c), c.req.param("key"), false)));
  api.delete("/tasks/:key", (c) => {
    repo.deleteTask(ctxOf(c), c.req.param("key"));
    return c.body(null, 204);
  });

  // Subtasks & notes
  api.post("/tasks/:key/subtasks", async (c) => c.json(repo.addSubtask(ctxOf(c), c.req.param("key"), (await body(c, schemas.subtask)).title), 201));
  api.patch("/subtasks/:id", async (c) => c.json(repo.updateSubtask(ctxOf(c), id.parse(c.req.param("id")), await body(c, schemas.subtaskPatch))));
  api.delete("/subtasks/:id", (c) => c.json(repo.deleteSubtask(ctxOf(c), id.parse(c.req.param("id")))));
  api.post("/tasks/:key/notes", async (c) => c.json(repo.addNote(ctxOf(c), c.req.param("key"), (await body(c, schemas.note)).body), 201));
  api.delete("/notes/:id", (c) => c.json(repo.deleteNote(ctxOf(c), id.parse(c.req.param("id")))));

  // Tags
  api.get("/tags", (c) => c.json(repo.listTags()));
  api.post("/tags", async (c) => c.json(repo.createTag(ctxOf(c), await body(c, schemas.tag)), 201));
  api.patch("/tags/:id", async (c) => c.json(repo.updateTag(ctxOf(c), id.parse(c.req.param("id")), await body(c, schemas.tagPatch))));
  api.delete("/tags/:id", (c) => {
    repo.deleteTag(ctxOf(c), id.parse(c.req.param("id")));
    return c.body(null, 204);
  });

  // Live updates: every change is pushed to open tabs so the board redraws without refreshing.
  api.get("/events", (c) =>
    streamSSE(c, async (stream) => {
      const onChange = (ev: ChangeEvent) => void stream.writeSSE({ event: "change", data: JSON.stringify(ev) });
      repo.events.on("change", onChange);
      stream.onAbort(() => void repo.events.off("change", onChange));
      while (!stream.aborted) {
        await stream.writeSSE({ event: "ping", data: "" });
        await stream.sleep(25_000);
      }
      repo.events.off("change", onChange);
    }),
  );

  const app = new Hono();
  app.route("/api", api);
  return app;
}
