// Daily/weekly status reports: the shape the server builds, and formatters shared by the
// UI (copy for Teams/email), the API (?format=md) and the Claude Code tool.

export interface ReportNote {
  body: string;
  actor: "user" | "claude" | "system";
  createdAt: string;
}

export interface ReportTask {
  key: string;
  title: string;
  /** Project names from the top level down, e.g. ["Infra", "Terraform"]. */
  projectPath: string[];
  projectColor: string;
  column: string;
  priority: string;
  dueDate: string | null;
  completedAt: string | null;
  blockedReason: string | null;
  blockedAt: string | null;
  subtasksDone: number;
  subtasksTotal: number;
  subtasks: { title: string; done: boolean }[];
  /** Most recent note (within the period for completed tasks). */
  note: ReportNote | null;
}

export interface Report {
  from: string; // YYYY-MM-DD, inclusive
  to: string; // YYYY-MM-DD, inclusive
  generatedAt: string;
  project: string | null; // path of the project filter, if any
  completed: ReportTask[];
  inProgress: ReportTask[];
  blocked: ReportTask[];
  createdCount: number;
  /** Completions per day in the period, split by top-level project. */
  perDay: { date: string; byProject: { name: string; color: string; count: number }[] }[];
}

/** "status": the plain status-update format (project → bullets); "detailed": IDs, notes, meta. */
export type ReportStyle = "status" | "detailed";
export const REPORT_STYLES: ReportStyle[] = ["status", "detailed"];

export interface ReportOptions {
  notes?: boolean;
  title?: string;
  style?: ReportStyle;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const d = (s: string) => {
  const [y, m, day] = s.split("-").map(Number);
  return new Date(y, m - 1, day);
};
const short = (s: string) => `${DAYS[d(s).getDay()]} ${d(s).getDate()} ${MONTHS[d(s).getMonth()]}`;

export function reportTitle(r: Report): string {
  const scope = r.project ? `${r.project} · ` : "";
  if (r.from === r.to) return `${scope}Daily update · ${short(r.from)} ${d(r.from).getFullYear()}`;
  const a = d(r.from);
  const b = d(r.to);
  const span = Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;
  const range = a.getMonth() === b.getMonth()
    ? `${a.getDate()}–${b.getDate()} ${MONTHS[b.getMonth()]} ${b.getFullYear()}`
    : `${a.getDate()} ${MONTHS[a.getMonth()]} – ${b.getDate()} ${MONTHS[b.getMonth()]} ${b.getFullYear()}`;
  return `${scope}${span === 7 ? "Weekly update" : "Update"} · ${range}`;
}

export function reportSummary(r: Report): string {
  const n = (x: number, one: string, many = `${one}s`) => `${x} ${x === 1 ? one : many}`;
  return `${n(r.completed.length, "task")} completed · ${r.inProgress.length} in progress · ${n(r.blocked.length, "blocker")}`;
}

function sinceLabel(iso: string, now: Date): string {
  const days = Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000);
  return days <= 0 ? "since today" : days === 1 ? "since yesterday" : `for ${days} days`;
}

function excerpt(body: string, max = 180): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Groups tasks by top-level project, keeping first-seen order. */
function byRoot(tasks: ReportTask[]): [string, ReportTask[]][] {
  const out = new Map<string, ReportTask[]>();
  for (const t of tasks) {
    const root = t.projectPath[0] ?? "No project";
    if (!out.has(root)) out.set(root, []);
    out.get(root)!.push(t);
  }
  return [...out.entries()];
}

const sub = (t: ReportTask) => (t.projectPath.length > 1 ? t.projectPath.slice(1).join(" › ") : null);

function progressMeta(t: ReportTask): string {
  return [
    t.column,
    t.dueDate ? `due ${short(t.dueDate)}` : null,
    t.subtasksTotal ? `${t.subtasksDone}/${t.subtasksTotal} subtasks` : null,
    t.priority === "urgent" || t.priority === "high" ? t.priority : null,
  ].filter(Boolean).join(" · ");
}

// ---------- status-update style ----------
//
//   Weekly Status Update (24 Sep – 30 Sep 2026)
//
//   **Northwind**
//   Completed Work:
//   * Investigated two alerts in the Northwind staging environment:
//      * Disk space warning        ← the task's completed subtasks
//   In Progress:
//   * …
//   Blockers:
//   * … — waiting on …

export interface StatusItem {
  text: string;
  children: string[];
}

export interface StatusProject {
  name: string;
  completed: StatusItem[];
  inProgress: StatusItem[];
  blocked: StatusItem[];
}

export function statusTitle(r: Report): string {
  const a = d(r.from);
  const b = d(r.to);
  const span = Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;
  const kind = span === 1 ? "Daily " : span === 7 ? "Weekly " : "";
  const range = span === 1
    ? `${short(r.from)} ${a.getFullYear()}`
    : `${a.getDate()} ${MONTHS[a.getMonth()]}${a.getFullYear() !== b.getFullYear() ? ` ${a.getFullYear()}` : ""} – ${b.getDate()} ${MONTHS[b.getMonth()]} ${b.getFullYear()}`;
  return `${kind}Status Update (${range})`;
}

/** Groups the report by top-level project, in the order projects first appear. */
export function statusProjects(r: Report): StatusProject[] {
  const out = new Map<string, StatusProject>();
  const get = (t: ReportTask) => {
    const name = t.projectPath[0] ?? "Other";
    if (!out.has(name)) out.set(name, { name, completed: [], inProgress: [], blocked: [] });
    return out.get(name)!;
  };
  for (const t of r.completed) get(t).completed.push({ text: t.title, children: t.subtasks.filter((s) => s.done).map((s) => s.title) });
  for (const t of r.inProgress) get(t).inProgress.push({ text: t.title, children: [] });
  for (const t of r.blocked) get(t).blocked.push({ text: `${t.title} — ${t.blockedReason ?? "blocked"}`, children: [] });
  return [...out.values()];
}

const STATUS_SECTIONS = [["completed", "Completed Work"], ["inProgress", "In Progress"], ["blocked", "Blockers"]] as const;

function statusMarkdown(r: Report, title?: string): string {
  const lines = [`**${title ?? statusTitle(r)}**`];
  const projects = statusProjects(r);
  if (!projects.length) lines.push("", "_No updates for this period._");
  for (const p of projects) {
    lines.push("", `**${p.name}**`);
    for (const [key, label] of STATUS_SECTIONS) {
      if (!p[key].length) continue;
      lines.push(`${label}:`, "");
      for (const item of p[key]) {
        lines.push(`* ${item.text}`);
        for (const c of item.children) lines.push(`   * ${c}`);
      }
      lines.push("");
    }
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

function statusHtml(r: Report, title?: string): string {
  const projects = statusProjects(r);
  const body = projects.length
    ? projects.map((p) => [
      `<p style="margin:14px 0 4px"><b>${esc(p.name)}</b></p>`,
      ...STATUS_SECTIONS.filter(([key]) => p[key].length).map(([key, label]) =>
        `<p style="margin:6px 0 2px">${label}:</p><ul style="margin:0 0 6px;padding-left:22px">${p[key].map((item) =>
          `<li>${esc(item.text)}${item.children.length ? `<ul style="margin:2px 0;padding-left:20px">${item.children.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}</li>`).join("")}</ul>`),
    ].join("")).join("")
    : `<p><i>No updates for this period.</i></p>`;
  return `<div style="font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.45"><p style="margin:0 0 4px"><b>${esc(title ?? statusTitle(r))}</b></p>${body}</div>`;
}

export function reportToMarkdown(r: Report, opts: ReportOptions = {}): string {
  if ((opts.style ?? "status") === "status") return statusMarkdown(r, opts.title);
  const notes = opts.notes ?? true;
  const now = new Date(r.generatedAt);
  const lines = [`## ${opts.title ?? reportTitle(r)}`, "", `**${reportSummary(r)}**`, ""];

  lines.push(`### Completed (${r.completed.length})`);
  if (!r.completed.length) lines.push("_Nothing completed in this period._");
  for (const [root, tasks] of byRoot(r.completed)) {
    lines.push(`**${root}**`);
    for (const t of tasks) {
      lines.push(`- ${t.key} ${t.title}${sub(t) ? ` _(${sub(t)})_` : ""}`);
      if (notes && t.note) lines.push(`  - ${excerpt(t.note.body)}`);
    }
  }
  lines.push("");

  lines.push(`### In progress (${r.inProgress.length})`);
  if (!r.inProgress.length) lines.push("_Nothing in progress._");
  for (const [root, tasks] of byRoot(r.inProgress)) {
    lines.push(`**${root}**`);
    for (const t of tasks) {
      lines.push(`- ${t.key} ${t.title}${sub(t) ? ` _(${sub(t)})_` : ""} — ${progressMeta(t)}`);
      if (notes && t.note) lines.push(`  - Latest: ${excerpt(t.note.body)}`);
    }
  }
  lines.push("");

  lines.push(`### Blockers (${r.blocked.length})`);
  if (!r.blocked.length) lines.push("_No blockers._");
  for (const t of r.blocked) {
    lines.push(`- ${t.key} ${t.title} _(${t.projectPath.join(" › ")})_ — **${t.blockedReason}**${t.blockedAt ? ` (${sinceLabel(t.blockedAt, now)})` : ""}`);
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Email/Teams-friendly HTML: plain structure with light inline styling, so it pastes cleanly
 * into Outlook, Gmail and Teams in both light and dark clients.
 */
export function reportToHtml(r: Report, opts: ReportOptions = {}): string {
  if ((opts.style ?? "status") === "status") return statusHtml(r, opts.title);
  const notes = opts.notes ?? true;
  const now = new Date(r.generatedAt);
  const muted = "color:#6b6889";
  const key = (t: ReportTask) => `<span style="font-family:Consolas,Menlo,monospace;font-size:12px;${muted}">${esc(t.key)}</span>`;
  const subLabel = (t: ReportTask) => (sub(t) ? ` <span style="${muted}">(${esc(sub(t)!)})</span>` : "");
  const group = (tasks: ReportTask[], render: (t: ReportTask) => string) =>
    byRoot(tasks).map(([root, list]) => `<p style="margin:8px 0 2px"><b>${esc(root)}</b></p><ul style="margin:0 0 6px;padding-left:20px">${list.map(render).join("")}</ul>`).join("");
  const note = (t: ReportTask, prefix = "") =>
    notes && t.note ? `<br><span style="${muted};font-size:13px">${prefix}${esc(excerpt(t.note.body))}</span>` : "";

  return [
    `<div style="font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.45">`,
    `<h2 style="margin:0 0 4px;font-size:18px">${esc(opts.title ?? reportTitle(r))}</h2>`,
    `<p style="margin:0 0 12px"><b>${esc(reportSummary(r))}</b></p>`,
    `<h3 style="margin:14px 0 4px;font-size:15px">Completed (${r.completed.length})</h3>`,
    r.completed.length ? group(r.completed, (t) => `<li>${key(t)} ${esc(t.title)}${subLabel(t)}${note(t)}</li>`) : `<p style="${muted}"><i>Nothing completed in this period.</i></p>`,
    `<h3 style="margin:14px 0 4px;font-size:15px">In progress (${r.inProgress.length})</h3>`,
    r.inProgress.length ? group(r.inProgress, (t) => `<li>${key(t)} ${esc(t.title)}${subLabel(t)} <span style="${muted}">— ${esc(progressMeta(t))}</span>${note(t, "Latest: ")}</li>`) : `<p style="${muted}"><i>Nothing in progress.</i></p>`,
    `<h3 style="margin:14px 0 4px;font-size:15px">Blockers (${r.blocked.length})</h3>`,
    r.blocked.length
      ? `<ul style="margin:0;padding-left:20px">${r.blocked.map((t) => `<li>${key(t)} ${esc(t.title)} <span style="${muted}">(${esc(t.projectPath.join(" › "))})</span> — <b style="color:#c6304a">${esc(t.blockedReason ?? "")}</b>${t.blockedAt ? ` <span style="${muted}">(${sinceLabel(t.blockedAt, now)})</span>` : ""}</li>`).join("")}</ul>`
      : `<p style="${muted}"><i>No blockers.</i></p>`,
    "</div>",
  ].join("\n");
}
