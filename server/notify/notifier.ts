// Sends Teams notifications: immediately for blockers and Claude's completions, and on a
// schedule (checked every 30s) for the morning digest, due-date reminders and reports.
// Each scheduled message has a dedupe key, so it goes out once; if Orbit was off at the
// scheduled time it catches up when it next runs, and failed sends are retried a few times.

import type { Column, Task } from "../../shared/types.ts";
import { fmtDate } from "../../shared/recurrence.ts";
import type { NotificationSettings } from "../../shared/notifications.ts";
import type { DomainEvent, Repo } from "../repo.ts";
import { blockedCard, claudeCompletedCard, digestCard, dueReminderCard, reportCard, taskReminderCard, testCard, type Card } from "./cards.ts";

export type Sender = (url: string, card: Card) => Promise<void>;

/** Posts a card to a Teams Workflows webhook. Workflows answers 202 once it has accepted it. */
export const postToTeams: Sender = async (url, card) => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(card),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`Teams returned ${res.status}${text ? `: ${text}` : ""}`);
  }
};

const MAX_ATTEMPTS = 3;
const RETRY_AFTER_MS = 10 * 60_000;
/** More than this many reminders at once become a single list card. */
const BATCH_REMINDERS = 5;

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export class Notifier {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly repo: Repo,
    private readonly send: Sender = postToTeams,
    private readonly now: () => Date = () => new Date(),
  ) {
    repo.events.on("domain", (ev: DomainEvent) => void this.onEvent(ev).catch((e) => console.error("Notification failed:", e)));
  }

  start(intervalMs = 30_000) {
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref();
    // Give the machine a moment after boot/login before the first catch-up check.
    setTimeout(() => void this.tick(), 5_000).unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  private settings(): NotificationSettings | null {
    const s = this.repo.getNotificationSettings();
    return s.enabled && s.teamsWebhook ? s : null;
  }

  /** Sends one card now and records the outcome. Returns an error message on failure. */
  private async deliver(url: string, kind: string, title: string, card: Card, dedupeKey: string | null): Promise<string | null> {
    try {
      await this.send(url, card);
      this.repo.notifyLogWrite({ kind, dedupeKey, title, status: "ok", at: this.now() });
      return null;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.repo.notifyLogWrite({ kind, dedupeKey, title, status: "error", detail: msg, at: this.now() });
      return msg;
    }
  }

  /** Sends at most once per key, retrying failures up to MAX_ATTEMPTS, spaced RETRY_AFTER_MS apart. */
  private async once(url: string, key: string, kind: string, title: string, build: () => Card) {
    const prev = this.repo.notifyLogGet(key);
    if (prev?.status === "ok") return;
    if (prev && (prev.attempts >= MAX_ATTEMPTS || this.now().getTime() - new Date(prev.updatedAt).getTime() < RETRY_AFTER_MS)) return;
    await this.deliver(url, kind, title, build(), key);
  }

  async test(): Promise<string | null> {
    const s = this.repo.getNotificationSettings();
    if (!s.teamsWebhook) return "Add a Teams webhook URL first";
    return this.deliver(s.teamsWebhook, "test", "Test message", testCard(), null);
  }

  /** Sends a report on demand (from the Reports page or Claude). */
  async sendReport(from: string, to: string, projectId: number | null, notes: boolean, style: "status" | "detailed" = "status"): Promise<string | null> {
    const s = this.repo.getNotificationSettings();
    if (!s.teamsWebhook) return "Add a Teams webhook URL in Settings first";
    const r = this.repo.getReport(from, to, projectId);
    return this.deliver(s.teamsWebhook, "report", `Report ${from} → ${to}`, reportCard(r, notes, style), null);
  }

  private async onEvent(ev: DomainEvent) {
    const s = this.settings();
    if (!s) return;
    const board = this.repo.getBoard();
    const task = this.repo.getTask(ev.taskKey);
    if (ev.type === "blocked" && s.blockers.enabled && task.blockedReason) {
      await this.deliver(s.teamsWebhook!, "blocked", `${task.key} blocked`, blockedCard(task, board.projects, ev.actor), `blocked:${task.key}:${task.blockedAt}`);
    }
    if (ev.type === "completed" && ev.actor === "claude" && s.claudeCompleted.enabled) {
      const next = task.nextKey ? this.repo.getTask(task.nextKey) : null;
      await this.deliver(s.teamsWebhook!, "claude_completed", `Claude completed ${task.key}`,
        claudeCompletedCard(task, board.projects, task.notes[0]?.body ?? null, next), `completed:${task.key}:${task.completedAt}`);
    }
  }

  /** Checks every schedule against the clock. Safe to call as often as you like. */
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const s = this.settings();
      if (!s) return;
      const url = s.teamsWebhook!;
      const now = this.now();
      const today = fmtDate(now);
      const time = hhmm(now);
      const board = this.repo.getBoard();
      const since = s.savedAt ? new Date(s.savedAt) : new Date(0);
      const at = (hm: string, day = now) => { const [h, m] = hm.split(":").map(Number); return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m); };
      const colName = (t: Task) => board.columns.find((c: Column) => c.id === t.columnId)?.name ?? "";

      if (s.digest.enabled && s.digest.days.includes(now.getDay()) && time >= s.digest.time && at(s.digest.time) >= since) {
        await this.once(url, `digest:${today}`, "digest", `Morning digest ${today}`, () =>
          digestCard(today, this.repo.openTasksDue(today), this.repo.openTasksDue(today, true), this.repo.openBlockedTasks(), board.projects));
      }

      if (s.dueReminders.enabled && time >= s.dueReminders.time && at(s.dueReminders.time) >= since) {
        const pending = this.repo.openTasksDue(today).filter((t) => {
          const prev = this.repo.notifyLogGet(`due:${t.key}:${today}`);
          return !prev || (prev.status !== "ok" && prev.attempts < MAX_ATTEMPTS && now.getTime() - new Date(prev.updatedAt).getTime() >= RETRY_AFTER_MS);
        });
        if (pending.length > BATCH_REMINDERS) {
          const err = await this.deliver(url, "due_reminder", `${pending.length} tasks due today`, dueReminderCard(pending, board.projects, colName), null);
          for (const t of pending) this.repo.notifyLogWrite({ kind: "due_reminder", dedupeKey: `due:${t.key}:${today}`, title: `${t.key} due today`, status: err ? "error" : "ok", detail: err ?? "sent in a batch", at: now });
        } else {
          for (const t of pending) {
            await this.deliver(url, "due_reminder", `${t.key} due today`, dueReminderCard([t], board.projects, colName), `due:${t.key}:${today}`);
          }
        }
      }

      if (s.taskReminders.enabled) {
        // Reminders missed while the laptop was off still go out, up to a week late.
        for (const t of this.repo.dueTaskReminders(now, addDays(now, -7))) {
          await this.once(url, `remind:${t.key}:${t.remindAt}`, "task_reminder", `Reminder for ${t.key}`, () => taskReminderCard(t, board.projects, colName(t)));
        }
      }

      if (s.report.enabled) {
        const due = lastReportSlot(s.report, now);
        // Catch up on a missed report for up to 3 days, then let it go.
        if (due && due >= since && now.getTime() - due.getTime() < 3 * 86_400_000) {
          const to = fmtDate(due);
          const from = s.report.frequency === "weekly" ? fmtDate(addDays(due, -6)) : to;
          await this.once(url, `report:${s.report.frequency}:${to}`, "report", `${s.report.frequency === "weekly" ? "Weekly" : "Daily"} report ${from} → ${to}`, () => {
            const projectId = s.report.projectId != null && board.projects.some((p) => p.id === s.report.projectId && !p.archivedAt) ? s.report.projectId : null;
            return reportCard(this.repo.getReport(from, to, projectId), s.report.notes, s.report.style);
          });
        }
      }
    } catch (e) {
      console.error("Notification check failed:", e);
    } finally {
      this.running = false;
    }
  }
}

/** The most recent scheduled report time at or before `now` (within the last 8 days), or null. */
export function lastReportSlot(r: NotificationSettings["report"], now: Date): Date | null {
  const [h, m] = r.time.split(":").map(Number);
  for (let back = 0; back <= 8; back++) {
    const day = addDays(now, -back);
    const slot = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
    if (slot > now) continue;
    const match = r.frequency === "weekly" ? day.getDay() === r.weekday : r.days.includes(day.getDay());
    if (match) return slot;
  }
  return null;
}
