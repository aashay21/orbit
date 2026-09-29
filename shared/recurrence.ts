// Recurrence rules, shared by the server (to schedule the next occurrence) and the UI (to preview it).

export type Freq = "daily" | "weekly" | "monthly" | "yearly";

export interface Recurrence {
  freq: Freq;
  /** Every N days/weeks/months/years. */
  interval: number;
  /** Weekly only: days of the week, 0 = Sunday … 6 = Saturday. Empty/absent = same weekday as the base date. */
  weekdays?: number[];
  /** Monthly only: day of the month to land on (clamped to short months). Absent = the base date's day. */
  monthDay?: number;
  /** Last date (YYYY-MM-DD) an occurrence may fall on. */
  until?: string | null;
  /** Column that new occurrences start in. Absent = the board's first column. */
  columnId?: number | null;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const pad = (n: number) => String(n).padStart(2, "0");
export const fmtDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseDate = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const daysIn = (y: number, m: number) => new Date(y, m + 1, 0).getDate();

/** The occurrence right after `base` (YYYY-MM-DD), ignoring `until`. */
export function stepAfter(rule: Recurrence, base: string): string {
  const b = parseDate(base);
  const n = Math.max(1, Math.floor(rule.interval || 1));
  switch (rule.freq) {
    case "daily":
      return fmtDate(addDays(b, n));
    case "weekly": {
      const days = [...new Set(rule.weekdays ?? [])].filter((d) => d >= 0 && d <= 6).sort();
      if (!days.length) return fmtDate(addDays(b, 7 * n));
      // Weeks run Monday..Sunday. Try later days in the same week, then jump N weeks.
      const mondayIdx = (d: number) => (d + 6) % 7;
      const baseIdx = mondayIdx(b.getDay());
      const order = days.map(mondayIdx).sort((x, y) => x - y);
      const later = order.find((i) => i > baseIdx);
      if (later !== undefined) return fmtDate(addDays(b, later - baseIdx));
      const weekStart = addDays(b, -baseIdx);
      return fmtDate(addDays(weekStart, 7 * n + order[0]));
    }
    case "monthly": {
      const day = rule.monthDay ?? b.getDate();
      const total = b.getMonth() + n;
      const y = b.getFullYear() + Math.floor(total / 12);
      const m = ((total % 12) + 12) % 12;
      return fmtDate(new Date(y, m, Math.min(day, daysIn(y, m))));
    }
    case "yearly": {
      const y = b.getFullYear() + n;
      return fmtDate(new Date(y, b.getMonth(), Math.min(b.getDate(), daysIn(y, b.getMonth()))));
    }
  }
}

/**
 * Due date for the next occurrence: one step after `base`, skipping any dates before `today`
 * so a late completion doesn't create an already-overdue copy. Null once past `until`.
 */
export function nextOccurrence(rule: Recurrence, base: string, today: string): string | null {
  let next = stepAfter(rule, base);
  for (let guard = 0; next < today && guard < 5000; guard++) next = stepAfter(rule, next);
  if (rule.until && next > rule.until) return null;
  return next;
}

export function describeRecurrence(rule: Recurrence | null | undefined): string {
  if (!rule) return "Does not repeat";
  const n = Math.max(1, rule.interval || 1);
  const unit = { daily: "day", weekly: "week", monthly: "month", yearly: "year" }[rule.freq];
  let s: string;
  const days = [...(rule.weekdays ?? [])].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  if (rule.freq === "weekly" && n === 1 && days.join() === "1,2,3,4,5") s = "Every weekday";
  else if (rule.freq === "daily" && n === 1) s = "Every day";
  else s = n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`;
  if (rule.freq === "weekly" && days.length && s !== "Every weekday") s += ` on ${days.map((d) => DAY_NAMES[d]).join(", ")}`;
  if (rule.freq === "monthly" && rule.monthDay) s += ` on day ${rule.monthDay}`;
  if (rule.until) s += `, until ${rule.until}`;
  return s;
}
