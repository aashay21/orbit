// Turns the loose references Claude (or you) naturally use — "Infra/Terraform", "done",
// "next friday", "every weekday" — into the exact ids, dates and rules the API expects.

import type { Board, Column, Project, Recurrence } from "../shared/types.ts";
import { fmtDate } from "../shared/recurrence.ts";

export class ResolveError extends Error {}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export function projectPath(projects: Project[], id: number): string {
  const names: string[] = [];
  for (let p = projects.find((x) => x.id === id); p; p = projects.find((x) => x.id === p!.parentId)) names.unshift(p.name);
  return names.join(" / ");
}

/** Accepts an id, a top-level prefix ("INF"), a name, or a path ("Acme Client/Landing Zone"). */
export function resolveProject(board: Board, ref: string | number): Project {
  const live = board.projects.filter((p) => !p.archivedAt);
  const describe = (list: Project[]) => list.map((p) => `"${projectPath(board.projects, p.id)}" (id ${p.id})`).join(", ");
  if (typeof ref === "number" || /^\d+$/.test(String(ref).trim())) {
    const p = board.projects.find((x) => x.id === Number(ref));
    if (!p) throw new ResolveError(`No project with id ${ref}`);
    if (p.archivedAt) throw new ResolveError(`Project "${p.name}" is archived`);
    return p;
  }
  const raw = String(ref).trim();
  const byKey = live.find((p) => p.key && p.key.toLowerCase() === raw.toLowerCase());
  if (byKey) return byKey;

  const parts = raw.split(/\s*(?:\/|›|>)\s*/).map(norm).filter(Boolean);
  if (parts.length > 1) {
    const hits = live.filter((p) => norm(projectPath(board.projects, p.id)).split(" / ").slice(-parts.length).join("/") === parts.join("/"));
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) throw new ResolveError(`"${raw}" matches several projects: ${describe(hits)}`);
    throw new ResolveError(`No project at path "${raw}". Projects: ${describe(live)}`);
  }
  const exact = live.filter((p) => norm(p.name) === parts[0]);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) throw new ResolveError(`"${raw}" matches several projects: ${describe(exact)}. Use a path like "Parent/Child".`);
  const fuzzy = live.filter((p) => norm(p.name).includes(parts[0]));
  if (fuzzy.length === 1) return fuzzy[0];
  if (fuzzy.length > 1) throw new ResolveError(`"${raw}" is ambiguous: ${describe(fuzzy)}`);
  throw new ResolveError(`No project named "${raw}". Projects: ${describe(live) || "(none yet; create one with create_project)"}`);
}

/** Accepts an id, a column name, or "done" for the first column that counts as completed. */
export function resolveColumn(board: Board, ref: string | number): Column {
  const cols = board.columns;
  if (typeof ref === "number" || /^\d+$/.test(String(ref).trim())) {
    const c = cols.find((x) => x.id === Number(ref));
    if (!c) throw new ResolveError(`No column with id ${ref}`);
    return c;
  }
  const q = norm(String(ref)).replace(/[-_]/g, " ");
  const exact = cols.find((c) => norm(c.name) === q) ?? cols.find((c) => norm(c.name).replace(/\s/g, "") === q.replace(/\s/g, ""));
  if (exact) return exact;
  if (["done", "complete", "completed", "finished"].includes(q)) {
    const d = cols.find((c) => c.isDone);
    if (d) return d;
  }
  const fuzzy = cols.filter((c) => norm(c.name).includes(q));
  if (fuzzy.length === 1) return fuzzy[0];
  throw new ResolveError(`No column "${ref}". Columns: ${cols.map((c) => c.name).join(", ")}`);
}

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const dayIndex = (s: string) => DAYS.findIndex((d) => d === s || d.slice(0, 3) === s);

/**
 * Parses a due date: YYYY-MM-DD, today, tomorrow, yesterday, a weekday ("friday" = the coming one,
 * today included; "next friday" = the coming one after today), "next week", "+3d", "in 2 weeks".
 * Returns null for "none"/"clear".
 */
export function parseDue(input: string | null, now = new Date()): string | null {
  if (input == null) return null;
  const s = norm(input);
  if (["", "none", "clear", "no date", "null"].includes(s)) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const plus = (n: number) => fmtDate(new Date(base.getFullYear(), base.getMonth(), base.getDate() + n));
  if (s === "today") return plus(0);
  if (s === "tomorrow") return plus(1);
  if (s === "yesterday") return plus(-1);
  if (s === "next week") return plus(7);
  const rel = s.match(/^(?:in\s+|\+)?(\d+)\s*(d|day|days|w|wk|week|weeks)$/);
  if (rel) return plus(Number(rel[1]) * (rel[2].startsWith("w") ? 7 : 1));
  const wd = s.match(/^(next\s+|this\s+)?([a-z]+)$/);
  if (wd && dayIndex(wd[2]) >= 0) {
    let diff = (dayIndex(wd[2]) - base.getDay() + 7) % 7;
    if (wd[1]?.startsWith("next") && diff === 0) diff = 7;
    return plus(diff);
  }
  throw new ResolveError(`Couldn't read the date "${input}". Use YYYY-MM-DD, today, tomorrow, a weekday, or +3d.`);
}

export type RecurrenceInput =
  | string
  | { freq: Recurrence["freq"]; interval?: number; weekdays?: (number | string)[]; month_day?: number; until?: string | null; column?: string | number | null };

/**
 * Parses a repeat rule from plain words ("daily", "every weekday", "every 2 weeks",
 * "every monday and thursday", "monthly", "yearly", "none") or a structured object.
 */
export function parseRecurrence(input: RecurrenceInput | null, board: Board): Recurrence | null {
  if (input == null) return null;
  if (typeof input === "object") {
    const rule: Recurrence = { freq: input.freq, interval: Math.max(1, input.interval ?? 1) };
    if (input.weekdays?.length) {
      rule.weekdays = input.weekdays.map((d) => {
        const i = typeof d === "number" ? d : dayIndex(norm(d));
        if (i < 0 || i > 6) throw new ResolveError(`Unknown weekday "${d}"`);
        return i;
      });
    }
    if (input.month_day) rule.monthDay = input.month_day;
    if (input.until) rule.until = parseDue(input.until);
    if (input.column != null) rule.columnId = resolveColumn(board, input.column).id;
    return rule;
  }
  let s = norm(input).replace(/^repeat(s)?\s+/, "");
  if (["none", "never", "no", "off", "stop", "does not repeat"].includes(s)) return null;
  let until: string | undefined;
  const u = s.match(/^(.*?)(?:,?\s+until\s+(.+))$/);
  if (u) { s = u[1]; until = parseDue(u[2]) ?? undefined; }
  const withUntil = (r: Recurrence) => (until ? { ...r, until } : r);

  const simple: Record<string, Recurrence> = {
    daily: { freq: "daily", interval: 1 }, "every day": { freq: "daily", interval: 1 },
    weekdays: { freq: "weekly", interval: 1, weekdays: [1, 2, 3, 4, 5] }, "every weekday": { freq: "weekly", interval: 1, weekdays: [1, 2, 3, 4, 5] },
    weekly: { freq: "weekly", interval: 1 }, "every week": { freq: "weekly", interval: 1 },
    biweekly: { freq: "weekly", interval: 2 }, fortnightly: { freq: "weekly", interval: 2 },
    monthly: { freq: "monthly", interval: 1 }, "every month": { freq: "monthly", interval: 1 },
    yearly: { freq: "yearly", interval: 1 }, annually: { freq: "yearly", interval: 1 }, "every year": { freq: "yearly", interval: 1 },
  };
  if (simple[s]) return withUntil(simple[s]);
  const every = s.match(/^every\s+(\d+)\s+(day|week|month|year)s?$/);
  if (every) {
    const unit = { day: "daily", week: "weekly", month: "monthly", year: "yearly" } as const;
    return withUntil({ freq: unit[every[2] as keyof typeof unit], interval: Number(every[1]) });
  }
  const on = s.match(/^(?:every\s+(?:(\d+)\s+weeks?\s+on\s+)?|weekly\s+on\s+|on\s+)(.+)$/);
  if (on) {
    const days = on[2].split(/\s*(?:,|and|&)\s*/).filter(Boolean).map((d) => dayIndex(d.replace(/s$/, "")));
    if (days.length && days.every((d) => d >= 0)) return withUntil({ freq: "weekly", interval: Number(on[1] ?? 1), weekdays: days });
  }
  throw new ResolveError(`Couldn't read the repeat rule "${input}". Try: daily, every weekday, weekly, every 2 weeks, every monday and thursday, monthly, yearly, or none.`);
}

/**
 * Parses a reminder time: an ISO date-time, "in 2 hours" / "in 30 minutes" / "in 3 days",
 * or a date phrase plus a time ("tomorrow 9am", "friday at 14:30", "2026-10-01 15:00").
 * A bare time means today, or tomorrow if that time has passed. Returns an ISO timestamp,
 * or null for "none"/"clear".
 */
export function parseRemind(input: string | null, now = new Date()): string | null {
  if (input == null) return null;
  const s = norm(input);
  if (["", "none", "clear", "off", "null"].includes(s)) return null;
  const rel = s.match(/^in\s+(\d+)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)$/);
  if (rel) {
    const n = Number(rel[1]);
    const ms = rel[2].startsWith("m") ? 60_000 : rel[2].startsWith("h") ? 3_600_000 : 86_400_000;
    return new Date(now.getTime() + n * ms).toISOString();
  }
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})[t ](\d{1,2}):(\d{2})$/);
  if (iso) {
    const [y, m, d] = iso[1].split("-").map(Number);
    return new Date(y, m - 1, d, Number(iso[2]), Number(iso[3])).toISOString();
  }
  const withTime = s.match(/^(?:(.*?)\s+(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (withTime && (withTime[3] || withTime[4] || withTime[1])) {
    let h = Number(withTime[2]);
    const min = Number(withTime[3] ?? 0);
    if (withTime[4] === "pm" && h < 12) h += 12;
    if (withTime[4] === "am" && h === 12) h = 0;
    if (h > 23 || min > 59) throw new ResolveError(`"${input}" isn't a valid time`);
    let day: string;
    if (withTime[1]) day = parseDue(withTime[1], now) ?? fmtDate(now);
    else {
      const todayAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, min);
      day = fmtDate(todayAt > now ? now : new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
    }
    const [y, m, d] = day.split("-").map(Number);
    return new Date(y, m - 1, d, h, min).toISOString();
  }
  throw new ResolveError(`Couldn't read the reminder time "${input}". Try "tomorrow 9am", "friday 14:30", "in 2 hours" or "2026-10-01 15:00".`);
}
