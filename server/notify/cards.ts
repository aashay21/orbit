// Adaptive Cards for Teams, in the envelope the Workflows "webhook alerts" templates expect.

import type { Project, Task } from "../../shared/types.ts";
import { reportSummary, reportTitle, statusProjects, statusTitle, type Report, type ReportStyle, type ReportTask } from "../../shared/report.ts";

export type Card = Record<string, unknown>;
type Block = Record<string, unknown>;

export const ORBIT_URL = process.env.ORBIT_PUBLIC_URL ?? `http://127.0.0.1:${process.env.PORT ?? 4700}`;
const link = (params = "") => `${ORBIT_URL}/${params}`;

/** Wraps card content in the message envelope Workflows posts to a chat or channel. */
export function envelope(body: Block[], actions: Block[] = []): Card {
  return {
    type: "message",
    attachments: [{
      contentType: "application/vnd.microsoft.card.adaptive",
      contentUrl: null,
      content: {
        $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
        type: "AdaptiveCard",
        version: "1.4",
        msteams: { width: "Full" },
        body,
        actions,
      },
    }],
  };
}

// Card text is a small Markdown subset and not every Teams client honours backslash escapes, so
// instead of escaping (which can show up as stray "\\"), neutralise what could change meaning:
// links, and asterisks (swapped for the look-alike "∗"). Underscores inside words are left alone.
const plain = (s: string) => s.replace(/\]\(/g, "] (").replace(/\*/g, "∗");

const heading = (text: string, color?: string): Block => ({ type: "TextBlock", text, weight: "Bolder", size: "Medium", wrap: true, ...(color ? { color } : {}) });
const sub = (text: string): Block => ({ type: "TextBlock", text, isSubtle: true, spacing: "None", wrap: true, size: "Small" });
const section = (text: string, color?: string): Block => ({ type: "TextBlock", text, weight: "Bolder", spacing: "Medium", wrap: true, ...(color ? { color } : {}) });
const bullets = (lines: string[]): Block => ({ type: "TextBlock", text: lines.map((l) => `- ${l}`).join("\n"), wrap: true, spacing: "Small" });
const open = (title: string, params = ""): Block => ({ type: "Action.OpenUrl", title, url: link(params) });

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const nice = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return `${DAYS[dt.getDay()]} ${d} ${MONTHS[m - 1]}`;
};

export function projectPath(projects: Project[], id: number): string {
  const names: string[] = [];
  for (let p = projects.find((x) => x.id === id); p; p = projects.find((x) => x.id === p!.parentId)) names.unshift(p.name);
  return names.join(" › ");
}

const taskLine = (t: Task, projects: Project[], extra?: string) =>
  `**${t.key}** ${plain(t.title)} · _${plain(projectPath(projects, t.projectId))}_${extra ? ` · ${extra}` : ""}`;

export function testCard(): Card {
  return envelope([
    heading("🪐 Orbit is connected"),
    sub("If you can read this in Teams, notifications are working. You can change what gets sent in Orbit → Settings."),
  ], [open("Open Orbit")]);
}

export function digestCard(date: string, due: Task[], overdue: Task[], blocked: Task[], projects: Project[]): Card {
  const body: Block[] = [heading(`☀️ Your day · ${nice(date)}`)];
  if (!due.length && !overdue.length && !blocked.length) {
    body.push(sub("Nothing due, nothing overdue, nothing blocked. Clear skies."));
    return envelope(body, [open("Open Orbit")]);
  }
  body.push(sub([`${due.length} due today`, overdue.length ? `${overdue.length} overdue` : null, blocked.length ? `${blocked.length} blocked` : null].filter(Boolean).join(" · ")));
  if (overdue.length) body.push(section(`Overdue (${overdue.length})`, "Attention"), bullets(overdue.map((t) => taskLine(t, projects, `was due ${nice(t.dueDate!)}`))));
  if (due.length) body.push(section(`Due today (${due.length})`), bullets(due.map((t) => taskLine(t, projects, t.priority === "urgent" || t.priority === "high" ? t.priority : undefined))));
  if (blocked.length) body.push(section(`Blocked (${blocked.length})`, "Warning"), bullets(blocked.map((t) => taskLine(t, projects, `waiting on: ${plain(t.blockedReason ?? "")}`))));
  return envelope(body, [open("Open Orbit")]);
}

export function dueReminderCard(tasks: Task[], projects: Project[], columnName: (t: Task) => string): Card {
  if (tasks.length === 1) {
    const t = tasks[0];
    return envelope([
      heading(`⏰ Due today · ${t.key}`),
      { type: "TextBlock", text: plain(t.title), wrap: true, size: "Medium", spacing: "Small" },
      sub([projectPath(projects, t.projectId), columnName(t), t.priority !== "none" ? `${t.priority} priority` : null, t.blockedReason ? `blocked: ${t.blockedReason}` : null].filter(Boolean).join(" · ")),
    ], [open(`Open ${t.key}`, `?task=${encodeURIComponent(t.key)}`)]);
  }
  return envelope([
    heading(`⏰ ${tasks.length} tasks are due today`),
    bullets(tasks.map((t) => taskLine(t, projects, columnName(t)))),
  ], [open("Open Orbit")]);
}

export function taskReminderCard(t: Task, projects: Project[], column: string): Card {
  return envelope([
    heading(`🔔 Reminder · ${t.key}`, "Accent"),
    { type: "TextBlock", text: plain(t.title), wrap: true, size: "Medium", spacing: "Small" },
    sub([projectPath(projects, t.projectId), column, t.dueDate ? `due ${nice(t.dueDate)}` : null, t.priority !== "none" ? `${t.priority} priority` : null,
      t.blockedReason ? `blocked: ${t.blockedReason}` : null].filter(Boolean).join(" · ")),
  ], [open(`Open ${t.key}`, `?task=${encodeURIComponent(t.key)}`)]);
}

export function blockedCard(t: Task, projects: Project[], actor: string): Card {
  return envelope([
    heading(`⛔ Blocked · ${t.key}`, "Attention"),
    { type: "TextBlock", text: plain(t.title), wrap: true, spacing: "Small" },
    { type: "TextBlock", text: `**Waiting on:** ${plain(t.blockedReason ?? "")}`, wrap: true },
    sub(`${projectPath(projects, t.projectId)} · marked by ${actor === "claude" ? "Claude" : "you"}`),
  ], [open(`Open ${t.key}`, `?task=${encodeURIComponent(t.key)}`)]);
}

export function claudeCompletedCard(t: Task, projects: Project[], note: string | null, next: Task | null): Card {
  const body: Block[] = [
    heading(`✅ Claude completed ${t.key}`, "Good"),
    { type: "TextBlock", text: plain(t.title), wrap: true, spacing: "Small" },
    sub(projectPath(projects, t.projectId)),
  ];
  if (note) body.push({ type: "TextBlock", text: plain(note.length > 400 ? `${note.slice(0, 399)}…` : note), wrap: true, spacing: "Medium" });
  if (next) body.push(sub(`Repeats: next is ${next.key}${next.dueDate ? `, due ${nice(next.dueDate)}` : ""}`));
  return envelope(body, [open(`Open ${t.key}`, `?task=${encodeURIComponent(t.key)}`)]);
}

/** One bullet line, indented by level. Built from columns rather than Markdown lists, because
 *  nested Markdown lists don't render consistently across Teams clients. */
function bulletRow(text: string, level: 0 | 1): Block {
  return {
    type: "ColumnSet",
    spacing: level ? "None" : "Small",
    columns: [
      { type: "Column", width: level ? "28px" : "12px", items: [{ type: "TextBlock", text: level ? "◦" : "•", horizontalAlignment: "Right", wrap: false }] },
      { type: "Column", width: "stretch", items: [{ type: "TextBlock", text: plain(text), wrap: true }] },
    ],
  };
}

/** The status-update format: title, then each project in bold with its sections as bullets. */
export function statusReportCard(r: Report): Card {
  const body: Block[] = [{ type: "TextBlock", text: statusTitle(r), weight: "Bolder", size: "Large", wrap: true }];
  const projects = statusProjects(r);
  if (!projects.length) body.push(sub("No updates for this period."));
  const sections = [["completed", "Completed Work:"], ["inProgress", "In Progress:"], ["blocked", "Blockers:"]] as const;
  for (const p of projects) {
    body.push({ type: "TextBlock", text: `**${plain(p.name)}**`, wrap: true, spacing: "Large", size: "Medium" });
    for (const [key, label] of sections) {
      if (!p[key].length) continue;
      body.push({ type: "TextBlock", text: label, wrap: true, spacing: "Small" });
      for (const item of p[key]) {
        body.push(bulletRow(item.text, 0));
        for (const c of item.children) body.push(bulletRow(c, 1));
      }
    }
  }
  return envelope(body, [open("Open report in Orbit", "?view=reports")]);
}

export function reportCard(r: Report, notes: boolean, style: ReportStyle = "status"): Card {
  if (style === "status") return statusReportCard(r);
  const line = (t: ReportTask, extra?: string) =>
    `**${t.key}** ${plain(t.title)}${t.projectPath.length > 1 ? ` _(${plain(t.projectPath.slice(1).join(" › "))})_` : ""}${extra ? ` · ${extra}` : ""}`;
  const grouped = (tasks: ReportTask[], render: (t: ReportTask) => string): Block[] => {
    const groups = new Map<string, ReportTask[]>();
    for (const t of tasks) groups.set(t.projectPath[0] ?? "No project", [...(groups.get(t.projectPath[0] ?? "No project") ?? []), t]);
    return [...groups].flatMap(([root, list]) => [
      { type: "TextBlock", text: `**${plain(root)}**`, wrap: true, spacing: "Small" },
      bullets(list.map(render)),
    ]);
  };
  const noteOf = (t: ReportTask, prefix = "") => (notes && t.note ? `\n  ${prefix}_${plain(t.note.body.replace(/\s+/g, " ").slice(0, 160))}_` : "");
  const body: Block[] = [heading(`📋 ${reportTitle(r)}`), sub(reportSummary(r))];

  body.push(section(`Completed (${r.completed.length})`, "Good"));
  body.push(...(r.completed.length ? grouped(r.completed, (t) => line(t) + noteOf(t)) : [sub("Nothing completed in this period.")]));
  body.push(section(`In progress (${r.inProgress.length})`, "Accent"));
  body.push(...(r.inProgress.length
    ? grouped(r.inProgress, (t) => line(t, [t.column, t.dueDate ? `due ${nice(t.dueDate)}` : null].filter(Boolean).join(" · ")) + noteOf(t, "Latest: "))
    : [sub("Nothing in progress.")]));
  body.push(section(`Blockers (${r.blocked.length})`, "Attention"));
  body.push(r.blocked.length ? bullets(r.blocked.map((t) => `${line(t)} · **${plain(t.blockedReason ?? "")}**`)) : sub("No blockers."));
  return envelope(body, [open("Open report in Orbit", "?view=reports")]);
}
