import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Activity, Board, Project, Stats, Task, TaskDetail } from "../shared/types.ts";
import { PRIORITIES } from "../shared/types.ts";
import { describeRecurrence, fmtDate } from "../shared/recurrence.ts";
import { OrbitClient, OrbitError } from "./client.ts";
import { parseDue, parseRecurrence, projectPath, resolveColumn, resolveProject, ResolveError, type RecurrenceInput } from "./resolve.ts";

export const INSTRUCTIONS = `Orbit is the user's personal Kanban board, running locally. Use these tools to read and update their tasks.

- Tasks have permanent IDs like INF-42. Always mention the ID when you refer to a task.
- Projects nest (e.g. "Acme Client / Landing Zone"). Refer to them by name, path, top-level prefix (INF) or id.
- Columns are the user's own; read them from board_overview instead of assuming names. complete_task moves a task to the column that counts as done.
- When the user is working on an Orbit task with you, keep it current: move it to the in-progress column when you start, add a short note when something meaningful happens (decision, blocker, result), and move it on when finished. Tell the user what you changed.
- Don't create, move or archive tasks the user hasn't asked about or clearly agreed to. There is no delete tool; only the user deletes tasks.
- Dates accept YYYY-MM-DD, today, tomorrow, weekday names, or +3d.`;

type Text = { content: { type: "text"; text: string }[]; isError?: boolean };
const ok = (text: string): Text => ({ content: [{ type: "text", text }] });

/** Wraps a handler so resolution and API errors come back as readable tool errors. */
const safe = <A,>(fn: (args: A) => Promise<string>) => async (args: A): Promise<Text> => {
  try {
    return ok(await fn(args));
  } catch (e) {
    if (e instanceof OrbitError || e instanceof ResolveError) return { content: [{ type: "text", text: e.message }], isError: true };
    throw e;
  }
};

const priority = z.enum(PRIORITIES).describe("none, low, medium, high or urgent");
const due = z.string().nullable().describe('Due date: YYYY-MM-DD, "today", "tomorrow", a weekday like "friday", "+3d", or null/"none" to clear');
const repeat = z.union([
  z.string(),
  z.object({
    freq: z.enum(["daily", "weekly", "monthly", "yearly"]),
    interval: z.number().int().min(1).optional(),
    weekdays: z.array(z.union([z.number().int().min(0).max(6), z.string()])).optional().describe("Weekly only, e.g. [\"mon\", \"thu\"]"),
    month_day: z.number().int().min(1).max(31).optional(),
    until: z.string().nullable().optional(),
    column: z.union([z.string(), z.number()]).nullable().optional().describe("Column new copies start in"),
  }),
]).nullable().describe('Repeat rule: "daily", "every weekday", "weekly", "every 2 weeks", "every monday and thursday", "monthly", "yearly", "none" (null also clears), optionally "..., until 2026-12-31"; or a structured object. Completing a repeating task creates its next occurrence.');

const today = () => fmtDate(new Date());

function dueLabel(d: string | null): string {
  if (!d) return "";
  const diff = Math.round((new Date(`${d}T00:00`).getTime() - new Date(`${today()}T00:00`).getTime()) / 86_400_000);
  const rel = diff < 0 ? `${-diff}d overdue` : diff === 0 ? "today" : diff === 1 ? "tomorrow" : `in ${diff}d`;
  return `due ${d} (${rel})`;
}

function taskLine(board: Board, t: Task): string {
  const col = board.columns.find((c) => c.id === t.columnId);
  const tags = board.tags.filter((g) => t.tagIds.includes(g.id)).map((g) => `#${g.name}`);
  const bits = [
    `${t.key} · ${t.title}`,
    col?.name ?? "?",
    t.priority !== "none" ? t.priority : null,
    col?.isDone ? null : dueLabel(t.dueDate) || null,
    projectPath(board.projects, t.projectId),
    tags.length ? tags.join(" ") : null,
    t.subtasksTotal ? `${t.subtasksDone}/${t.subtasksTotal} subtasks` : null,
    t.recurrence && !t.nextKey ? `repeats: ${describeRecurrence(t.recurrence).toLowerCase()}` : null,
  ];
  return bits.filter(Boolean).join(" · ");
}

function taskDetail(board: Board, t: TaskDetail): string {
  const col = board.columns.find((c) => c.id === t.columnId);
  const tags = board.tags.filter((g) => t.tagIds.includes(g.id)).map((g) => g.name);
  const lines = [
    `${t.key}: ${t.title}`,
    `Column: ${col?.name}${col?.isDone ? " (done)" : ""}   Project: ${projectPath(board.projects, t.projectId)}`,
    `Priority: ${t.priority}   Due: ${t.dueDate ? dueLabel(t.dueDate).replace(/^due /, "") : "none"}   Tags: ${tags.join(", ") || "none"}`,
    `Repeat: ${describeRecurrence(t.recurrence)}${t.nextKey ? ` (next occurrence: ${t.nextKey})` : ""}`,
    t.archivedAt ? `Archived: ${t.archivedAt.slice(0, 10)}` : null,
    "",
    "Description:",
    t.description.trim() || "(none)",
  ];
  if (t.subtasks.length) {
    lines.push("", "Subtasks:", ...t.subtasks.map((s) => `  [${s.done ? "x" : " "}] ${s.title}  (id ${s.id})`));
  }
  if (t.notes.length) {
    lines.push("", "Notes (newest first):", ...t.notes.slice(0, 10).map((n) => `  - ${n.createdAt.slice(0, 16).replace("T", " ")} ${n.actor === "claude" ? "Claude" : "User"}: ${n.body.replace(/\n/g, "\n    ")}`));
  }
  lines.push("", "Recent history:", ...t.activity.slice(0, 8).map((a) => `  - ${a.createdAt.slice(0, 16).replace("T", " ")} ${a.actor}: ${activityText(a)}`));
  return lines.filter((l) => l !== null).join("\n");
}

function activityText(a: Activity): string {
  const d = a.data as Record<string, any>;
  switch (a.type) {
    case "created": return d.recurredFrom ? `repeated from ${d.recurredFrom} into ${d.column}` : `created in ${d.column}`;
    case "moved": case "completed": case "reopened": return `${a.type} ${d.from} → ${d.to}`;
    case "recurred": return `scheduled next occurrence ${d.nextKey} for ${d.dueDate}`;
    case "note": return `note: ${d.excerpt}`;
    case "updated": return `updated ${Object.keys(d).join(", ")}`;
    case "subtask_added": case "subtask_done": case "subtask_reopened": return `${a.type.replace("_", " ")}: ${d.title}`;
    default: return a.type.replace(/_/g, " ");
  }
}

function projectTree(board: Board): string {
  const doneCols = new Set(board.columns.filter((c) => c.isDone).map((c) => c.id));
  const open = (p: Project) => board.tasks.filter((t) => t.projectId === p.id && !doneCols.has(t.columnId)).length;
  const walk = (parent: number | null, depth: number): string[] =>
    board.projects
      .filter((p) => p.parentId === parent && !p.archivedAt)
      .flatMap((p) => [`${"  ".repeat(depth)}- ${p.name}${p.key ? ` [${p.key}]` : ""} (id ${p.id}, ${open(p)} open)`, ...walk(p.id, depth + 1)]);
  return walk(null, 0).join("\n") || "(no projects yet)";
}

export function registerTools(server: McpServer, client = new OrbitClient()) {
  const board = () => client.get<Board>("/board");
  const tagArg = z.array(z.string().min(1).max(40));

  server.registerTool("board_overview", {
    title: "Board overview",
    description: "Snapshot of the board: today's date, columns with counts, projects, what's in progress, overdue and due soon, and completions today/this week. Start here.",
    annotations: { readOnlyHint: true },
  }, safe(async () => {
    const [b, stats] = await Promise.all([board(), client.get<Stats>("/stats")]);
    const t0 = today();
    const doneCols = new Set(b.columns.filter((c) => c.isDone).map((c) => c.id));
    const open = b.tasks.filter((t) => !doneCols.has(t.columnId));
    const soon = open.filter((t) => t.dueDate && t.dueDate >= t0 && t.dueDate <= fmtDate(new Date(Date.now() + 7 * 86_400_000)));
    const overdue = open.filter((t) => t.dueDate && t.dueDate < t0);
    const inProgress = b.columns.filter((c) => !c.isDone && /progress|doing|active/i.test(c.name));
    const section = (title: string, list: Task[]) => (list.length ? [`${title}:`, ...list.map((t) => `  ${taskLine(b, t)}`)] : [`${title}: none`]);
    return [
      `Today is ${new Date().toDateString()}.`,
      `Columns: ${b.columns.map((c) => `${c.name} (${b.tasks.filter((t) => t.columnId === c.id).length}${c.isDone ? ", done" : ""}${c.wipLimit ? `, WIP ${c.wipLimit}` : ""})`).join(" → ")}`,
      `Completed: ${stats.doneToday} today, ${stats.doneThisWeek} this week.`,
      "",
      "Projects:",
      projectTree(b),
      "",
      ...inProgress.flatMap((c) => section(c.name, b.tasks.filter((t) => t.columnId === c.id))),
      ...section("Overdue", overdue),
      ...section("Due in the next 7 days", soon),
    ].join("\n");
  }));

  server.registerTool("list_projects", {
    title: "List projects",
    description: "The project tree with prefixes, ids and open-task counts.",
    annotations: { readOnlyHint: true },
  }, safe(async () => projectTree(await board())));

  server.registerTool("list_tasks", {
    title: "List tasks",
    description: "Find tasks. All filters are optional and combine. Done tasks are excluded unless include_done is true; archived tasks only with archived: true.",
    inputSchema: {
      project: z.union([z.string(), z.number()]).optional().describe("Name, path, prefix or id; includes subprojects"),
      column: z.union([z.string(), z.number()]).optional(),
      priority: z.array(priority).optional(),
      due: z.enum(["overdue", "today", "this_week", "none"]).optional(),
      tag: z.string().optional(),
      search: z.string().optional().describe("Matches ID, title or description"),
      include_done: z.boolean().optional(),
      archived: z.boolean().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    },
    annotations: { readOnlyHint: true },
  }, safe(async (a) => {
    const b = await board();
    let tasks = a.archived ? await client.get<Task[]>("/tasks?archived=1&limit=500") : b.tasks;
    if (a.project !== undefined) {
      const root = resolveProject(b, a.project);
      const ids = new Set([root.id]);
      for (let grew = true; grew;) {
        grew = false;
        for (const p of b.projects) if (p.parentId != null && ids.has(p.parentId) && !ids.has(p.id)) { ids.add(p.id); grew = true; }
      }
      tasks = tasks.filter((t) => ids.has(t.projectId));
    }
    const doneCols = new Set(b.columns.filter((c) => c.isDone).map((c) => c.id));
    if (a.column !== undefined) {
      const c = resolveColumn(b, a.column);
      tasks = tasks.filter((t) => t.columnId === c.id);
    } else if (!a.include_done && !a.archived) {
      tasks = tasks.filter((t) => !doneCols.has(t.columnId));
    }
    if (a.priority?.length) tasks = tasks.filter((t) => a.priority!.includes(t.priority));
    const t0 = today();
    const weekEnd = fmtDate(new Date(Date.now() + 7 * 86_400_000));
    if (a.due === "overdue") tasks = tasks.filter((t) => t.dueDate && t.dueDate < t0);
    if (a.due === "today") tasks = tasks.filter((t) => t.dueDate === t0);
    if (a.due === "this_week") tasks = tasks.filter((t) => t.dueDate && t.dueDate <= weekEnd);
    if (a.due === "none") tasks = tasks.filter((t) => !t.dueDate);
    if (a.tag) {
      const tag = b.tags.find((g) => g.name.toLowerCase() === a.tag!.toLowerCase().replace(/^#/, ""));
      tasks = tag ? tasks.filter((t) => t.tagIds.includes(tag.id)) : [];
    }
    if (a.search) {
      const q = a.search.toLowerCase();
      tasks = tasks.filter((t) => `${t.key} ${t.title} ${t.description}`.toLowerCase().includes(q));
    }
    const limit = a.limit ?? 50;
    if (!tasks.length) return "No matching tasks.";
    const shown = tasks.slice(0, limit).map((t) => taskLine(b, t));
    return [`${tasks.length} task${tasks.length === 1 ? "" : "s"}${tasks.length > limit ? ` (showing ${limit})` : ""}:`, ...shown].join("\n");
  }));

  server.registerTool("get_task", {
    title: "Get task",
    description: "Everything about one task: details, description, subtasks (with ids), notes and recent history.",
    inputSchema: { key: z.string().describe("Task ID, e.g. INF-42") },
    annotations: { readOnlyHint: true },
  }, safe(async ({ key }) => {
    const [b, t] = await Promise.all([board(), client.get<TaskDetail>(`/tasks/${encodeURIComponent(key)}`)]);
    return taskDetail(b, t);
  }));

  server.registerTool("create_task", {
    title: "Create task",
    description: "Add a task to a project. Lands at the bottom of the first column unless you pass one.",
    inputSchema: {
      title: z.string().min(1).max(300),
      project: z.union([z.string(), z.number()]).describe("Name, path (\"Infra/Terraform\"), prefix or id"),
      column: z.union([z.string(), z.number()]).optional(),
      priority: priority.optional(),
      due_date: due.optional(),
      description: z.string().optional().describe("Markdown"),
      tags: tagArg.optional().describe("Tag names; new ones are created"),
      subtasks: z.array(z.string().min(1).max(300)).optional(),
      repeat: repeat.optional(),
    },
  }, safe(async (a) => {
    const b = await board();
    const project = resolveProject(b, a.project);
    const t = await client.post<TaskDetail>("/tasks", {
      title: a.title,
      projectId: project.id,
      columnId: a.column !== undefined ? resolveColumn(b, a.column).id : undefined,
      priority: a.priority,
      dueDate: a.due_date !== undefined ? parseDue(a.due_date) : undefined,
      description: a.description,
      tags: a.tags,
      subtasks: a.subtasks,
      recurrence: a.repeat !== undefined ? parseRecurrence(a.repeat as RecurrenceInput | null, b) : undefined,
    });
    return `Created ${taskLine(await board(), t)}`;
  }));

  server.registerTool("update_task", {
    title: "Update task",
    description: "Change a task's title, description, priority, due date, project, tags or repeat rule. Only the fields you pass change.",
    inputSchema: {
      key: z.string(),
      title: z.string().min(1).max(300).optional(),
      description: z.string().optional().describe("Replaces the whole description (Markdown)"),
      append_description: z.string().optional().describe("Appended to the existing description"),
      priority: priority.optional(),
      due_date: due.optional(),
      project: z.union([z.string(), z.number()]).optional(),
      tags: tagArg.optional().describe("Replaces all tags"),
      add_tags: tagArg.optional(),
      remove_tags: tagArg.optional(),
      repeat: repeat.optional(),
    },
  }, safe(async (a) => {
    const b = await board();
    const cur = await client.get<TaskDetail>(`/tasks/${encodeURIComponent(a.key)}`);
    const patch: Record<string, unknown> = {};
    if (a.title !== undefined) patch.title = a.title;
    if (a.description !== undefined) patch.description = a.description;
    if (a.append_description) patch.description = `${(a.description ?? cur.description).trimEnd()}${cur.description.trim() ? "\n\n" : ""}${a.append_description}`;
    if (a.priority !== undefined) patch.priority = a.priority;
    if (a.due_date !== undefined) patch.dueDate = parseDue(a.due_date);
    if (a.project !== undefined) patch.projectId = resolveProject(b, a.project).id;
    if (a.repeat !== undefined) patch.recurrence = parseRecurrence(a.repeat as RecurrenceInput | null, b);
    if (a.tags || a.add_tags || a.remove_tags) {
      const nameOf = (id: number) => b.tags.find((g) => g.id === id)?.name ?? "";
      let names = a.tags ?? cur.tagIds.map(nameOf);
      names = [...names, ...(a.add_tags ?? [])];
      const drop = new Set((a.remove_tags ?? []).map((n) => n.toLowerCase()));
      names = names.filter((n) => !drop.has(n.toLowerCase()));
      patch.tagIds = [];
      patch.tags = [...new Set(names)];
    }
    if (!Object.keys(patch).length) return "Nothing to change.";
    const t = await client.patch<TaskDetail>(`/tasks/${encodeURIComponent(a.key)}`, patch);
    return `Updated ${taskLine(await board(), t)}`;
  }));

  server.registerTool("move_task", {
    title: "Move task",
    description: "Move a task to a column (by name or id). Moving into a done column completes it; a repeating task then schedules its next occurrence.",
    inputSchema: {
      key: z.string(),
      column: z.union([z.string(), z.number()]),
      position: z.enum(["top", "bottom"]).optional().describe("Default: bottom"),
    },
  }, safe(async (a) => {
    const b = await board();
    const col = resolveColumn(b, a.column);
    const inCol = b.tasks.filter((t) => t.columnId === col.id && t.key.toLowerCase() !== a.key.toLowerCase());
    const body = a.position === "top" ? { columnId: col.id, beforeKey: inCol[0]?.key ?? null } : { columnId: col.id, afterKey: inCol.at(-1)?.key ?? null };
    const t = await client.post<TaskDetail>(`/tasks/${encodeURIComponent(a.key)}/move`, body);
    return `Moved ${t.key} to ${col.name}.${t.nextKey ? ` It repeats, so ${t.nextKey} was created for the next occurrence.` : ""}`;
  }));

  server.registerTool("complete_task", {
    title: "Complete task",
    description: "Mark a task done: moves it to the column that counts as done, optionally adding a closing note first.",
    inputSchema: { key: z.string(), note: z.string().optional().describe("What was done / outcome") },
  }, safe(async (a) => {
    const b = await board();
    const done = b.columns.find((c) => c.isDone);
    if (!done) return "No column is marked as done on this board. Ask the user which column to use, then call move_task.";
    if (a.note) await client.post(`/tasks/${encodeURIComponent(a.key)}/notes`, { body: a.note });
    const t = await client.post<TaskDetail>(`/tasks/${encodeURIComponent(a.key)}/move`, { columnId: done.id, afterKey: b.tasks.filter((x) => x.columnId === done.id).at(-1)?.key ?? null });
    return `Completed ${t.key} (${done.name}).${t.nextKey ? ` Next occurrence: ${taskLine(await board(), (await client.get<TaskDetail>(`/tasks/${t.nextKey}`)))}` : ""}`;
  }));

  server.registerTool("add_note", {
    title: "Add note",
    description: "Attach a note (Markdown) to a task: progress, decisions, blockers, links. Shown as Claude's in the UI.",
    inputSchema: { key: z.string(), body: z.string().min(1) },
  }, safe(async (a) => {
    const t = await client.post<TaskDetail>(`/tasks/${encodeURIComponent(a.key)}/notes`, { body: a.body });
    return `Added a note to ${t.key} (${t.notes.length} note${t.notes.length === 1 ? "" : "s"} now).`;
  }));

  server.registerTool("add_subtasks", {
    title: "Add subtasks",
    description: "Append one or more checklist items to a task.",
    inputSchema: { key: z.string(), titles: z.array(z.string().min(1).max(300)).min(1) },
  }, safe(async (a) => {
    let t: TaskDetail | undefined;
    for (const title of a.titles) t = await client.post<TaskDetail>(`/tasks/${encodeURIComponent(a.key)}/subtasks`, { title });
    return `${t!.key} now has ${t!.subtasks.length} subtasks (${t!.subtasks.filter((s) => s.done).length} done).`;
  }));

  server.registerTool("update_subtask", {
    title: "Update subtask",
    description: "Check off, uncheck or rename a subtask, identified by its id or by (part of) its title.",
    inputSchema: {
      key: z.string(),
      subtask: z.union([z.number(), z.string()]).describe("Subtask id, or text matching its title"),
      done: z.boolean().optional(),
      title: z.string().min(1).max(300).optional(),
    },
  }, safe(async (a) => {
    const t = await client.get<TaskDetail>(`/tasks/${encodeURIComponent(a.key)}`);
    const ref = a.subtask;
    const matches = typeof ref === "number" || /^\d+$/.test(ref)
      ? t.subtasks.filter((s) => s.id === Number(ref))
      : t.subtasks.filter((s) => s.title.toLowerCase().includes(ref.toLowerCase()));
    if (matches.length !== 1) {
      return `${matches.length ? "Several" : "No"} subtasks match "${ref}". Subtasks: ${t.subtasks.map((s) => `${s.id}: ${s.title}`).join("; ") || "none"}`;
    }
    const next = await client.patch<TaskDetail>(`/subtasks/${matches[0].id}`, { done: a.done, title: a.title });
    return `Updated subtask on ${next.key}: ${next.subtasks.filter((s) => s.done).length}/${next.subtasks.length} done.`;
  }));

  server.registerTool("archive_task", {
    title: "Archive task",
    description: "Hide a task from the board (kept in the Archive view), or restore it with restore: true.",
    inputSchema: { key: z.string(), restore: z.boolean().optional() },
    annotations: { destructiveHint: false },
  }, safe(async (a) => {
    const t = await client.post<TaskDetail>(`/tasks/${encodeURIComponent(a.key)}/${a.restore ? "restore" : "archive"}`);
    return `${a.restore ? "Restored" : "Archived"} ${t.key}.`;
  }));

  server.registerTool("create_project", {
    title: "Create project",
    description: "Create a project, or a subproject by passing parent. Top-level projects get a task prefix (derived from the name unless given).",
    inputSchema: {
      name: z.string().min(1).max(80),
      parent: z.union([z.string(), z.number()]).optional(),
      key: z.string().min(2).max(6).optional().describe("Task prefix for top-level projects, e.g. WEB"),
      description: z.string().optional(),
    },
  }, safe(async (a) => {
    const b = await board();
    const parentId = a.parent !== undefined ? resolveProject(b, a.parent).id : null;
    const p = await client.post<Project>("/projects", { name: a.name, parentId, key: a.key, description: a.description });
    const after = await board();
    return `Created project ${projectPath(after.projects, p.id)} (id ${p.id}${p.key ? `, tasks numbered ${p.key}-1, ${p.key}-2…` : ""}).`;
  }));

  server.registerTool("recent_activity", {
    title: "Recent activity",
    description: "What changed recently: completions, moves, notes, edits (by the user or Claude). Useful for stand-ups and 'what did I do today'.",
    inputSchema: {
      since: z.string().optional().describe('YYYY-MM-DD or "today" / "yesterday" / a weekday; default: today'),
      limit: z.number().int().min(1).max(300).optional(),
    },
    annotations: { readOnlyHint: true },
  }, safe(async (a) => {
    const since = parseDue(a.since ?? "today") ?? today();
    const start = new Date(`${since}T00:00`).getTime();
    const rows: Activity[] = [];
    let before: number | undefined;
    // Page back through history until we pass the start date.
    for (let i = 0; i < 20; i++) {
      const page = await client.get<Activity[]>(`/activity?limit=200${before ? `&before=${before}` : ""}`);
      rows.push(...page.filter((r) => new Date(r.createdAt).getTime() >= start));
      if (page.length < 200 || new Date(page.at(-1)!.createdAt).getTime() < start) break;
      before = page.at(-1)!.id;
    }
    if (!rows.length) return `No activity since ${since}.`;
    const limited = rows.slice(0, a.limit ?? 100);
    const completed = rows.filter((r) => r.type === "completed");
    return [
      `${rows.length} change${rows.length === 1 ? "" : "s"} since ${since}; ${completed.length} task${completed.length === 1 ? "" : "s"} completed${completed.length ? `: ${completed.map((r) => `${r.taskKey} (${r.taskTitle})`).join(", ")}` : ""}.`,
      "",
      ...limited.map((r) => `${new Date(r.createdAt).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })} · ${r.actor} · ${r.taskKey ? `${r.taskKey} ${r.taskTitle} · ` : ""}${activityText(r)}`),
    ].join("\n");
  }));
}

