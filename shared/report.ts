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

export interface ReportOptions {
  notes?: boolean;
  title?: string;
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

export function reportToMarkdown(r: Report, opts: ReportOptions = {}): string {
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
