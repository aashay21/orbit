import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../server/db/index.ts";
import { Repo, type Ctx } from "../server/repo.ts";
import { createApp } from "../server/app.ts";
import { lastReportSlot, Notifier } from "../server/notify/notifier.ts";
import type { Card } from "../server/notify/cards.ts";
import { DEFAULT_NOTIFICATIONS } from "../shared/notifications.ts";
import { fmtDate } from "../shared/recurrence.ts";

const me: Ctx = { actor: "user", clientId: null };
const claude: Ctx = { actor: "claude", clientId: null };
const URL_ = "https://example.logic.azure.com/workflows/abc/triggers/manual/paths/invoke?sig=secret123";

let repo: Repo;
let sent: Card[];
let fail: boolean;
let clock: Date;
let notifier: Notifier;

/** Text of every TextBlock in a card, joined, for easy assertions. */
const text = (c: Card) => JSON.stringify(c).match(/"text":"(.*?)(?<!\\)"/g)?.map((m) => m.slice(8, -1)).join(" | ") ?? "";
const col = (name: string) => repo.getBoard().columns.find((c) => c.name === name)!.id;
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  repo = new Repo(openDatabase(":memory:"));
  sent = [];
  fail = false;
  // Tuesday 29 Sep 2026, 08:00 local.
  clock = new Date(2026, 8, 29, 8, 0);
  notifier = new Notifier(repo, async (_url, card) => {
    if (fail) throw new Error("Teams returned 500");
    sent.push(card);
  }, () => clock);
  repo.saveNotificationSettings({ ...DEFAULT_NOTIFICATIONS, teamsWebhook: URL_ });
  // Pretend settings were saved long ago so today's slots are eligible.
  repo.db.prepare("UPDATE settings SET value = json_set(value, '$.savedAt', '2026-01-01T00:00:00.000Z') WHERE key = 'notifications'").run();
});

describe("scheduled notifications", () => {
  it("sends the morning digest once, from its time onwards, on enabled days only", async () => {
    const p = repo.createProject(me, { name: "Infra" });
    repo.createTask(me, { title: "Due today", projectId: p.id, dueDate: fmtDate(clock) });
    repo.createTask(me, { title: "Late one", projectId: p.id, dueDate: "2026-09-25" });
    await notifier.tick();
    expect(sent).toHaveLength(0); // before 09:00

    clock = new Date(2026, 8, 29, 9, 0);
    await notifier.tick();
    await notifier.tick();
    expect(sent).toHaveLength(1);
    expect(text(sent[0])).toContain("Your day · Tue 29 Sep");
    expect(text(sent[0])).toContain("Overdue (1)");
    expect(text(sent[0])).toContain("**INF-1** Due today");

    // Saturday isn't a digest day by default.
    clock = new Date(2026, 9, 3, 10, 0);
    sent = [];
    await notifier.tick();
    expect(sent.filter((c) => text(c).includes("Your day"))).toHaveLength(0);
  });

  it("catches up after the laptop was off, but not for slots before settings were saved", async () => {
    clock = new Date(2026, 8, 29, 11, 30); // woke up late
    await notifier.tick();
    expect(text(sent[0])).toContain("Clear skies");

    // Saving settings at 11:40 means today's 09:00 digest is considered past, not pending.
    const fresh = new Repo(openDatabase(":memory:"));
    const s: Card[] = [];
    const n = new Notifier(fresh, async (_u, c) => void s.push(c), () => new Date(2026, 8, 29, 11, 45));
    fresh.saveNotificationSettings({ ...DEFAULT_NOTIFICATIONS, teamsWebhook: URL_ });
    await n.tick();
    expect(s).toHaveLength(0);
  });

  it("reminds about each open task on its due day, skipping done ones, and batches big days", async () => {
    const p = repo.createProject(me, { name: "Home" });
    const today = fmtDate(clock);
    repo.createTask(me, { title: "Pay rent", projectId: p.id, dueDate: today, priority: "high" });
    const done = repo.createTask(me, { title: "Already done", projectId: p.id, dueDate: today });
    repo.moveTask(me, done.key, { columnId: col("Done") });
    repo.createTask(me, { title: "Tomorrow", projectId: p.id, dueDate: "2026-09-30" });

    clock = new Date(2026, 8, 29, 12, 0);
    await notifier.tick();
    const reminders = sent.filter((c) => text(c).includes("Due today ·"));
    expect(reminders).toHaveLength(1);
    expect(text(reminders[0])).toContain("Due today · HOM-1");
    expect(text(reminders[0])).toContain("high priority");

    // A task added later that day still gets its reminder, once.
    repo.createTask(me, { title: "Late addition", projectId: p.id, dueDate: today });
    clock = new Date(2026, 8, 29, 15, 0);
    sent = [];
    await notifier.tick();
    await notifier.tick();
    expect(sent.map(text).filter((t) => t.includes("Due today ·"))).toEqual([expect.stringContaining("HOM-4")]);

    // Six at once become a single list.
    for (let i = 0; i < 6; i++) repo.createTask(me, { title: `Chore ${i}`, projectId: p.id, dueDate: today });
    sent = [];
    await notifier.tick();
    expect(sent).toHaveLength(1);
    expect(text(sent[0])).toContain("6 tasks are due today");
  });

  it("sends the weekly report on its day for the 7 days ending then, and retries failures", async () => {
    const s = repo.getNotificationSettings();
    repo.saveNotificationSettings({ ...s, report: { ...s.report, weekday: 3, time: "17:00" } }); // Wednesday
    repo.db.prepare("UPDATE settings SET value = json_set(value, '$.savedAt', '2026-01-01T00:00:00.000Z') WHERE key = 'notifications'").run();

    clock = new Date(2026, 8, 30, 17, 5); // Wed 30 Sep
    fail = true;
    await notifier.tick();
    expect(sent).toHaveLength(0);
    expect(repo.notifyLogRecent().find((l) => l.kind === "report")).toMatchObject({ status: "error", attempts: 1 });

    fail = false;
    clock = new Date(2026, 8, 30, 17, 10); // too soon to retry
    await notifier.tick();
    expect(sent.filter((c) => text(c).includes("Weekly update"))).toHaveLength(0);
    clock = new Date(2026, 8, 30, 17, 20);
    await notifier.tick();
    const reports = sent.filter((c) => text(c).includes("Weekly update"));
    expect(reports).toHaveLength(1);
    expect(text(reports[0])).toContain("Weekly update · 24–30 Sep 2026");
    expect(repo.notifyLogRecent().find((l) => l.kind === "report")).toMatchObject({ status: "ok", attempts: 2 });
  });

  it("finds the last report slot for weekly and daily schedules", () => {
    const weekly = { ...DEFAULT_NOTIFICATIONS.report, frequency: "weekly" as const, weekday: 5, time: "17:00" };
    expect(lastReportSlot(weekly, new Date(2026, 8, 29, 12, 0))).toEqual(new Date(2026, 8, 25, 17, 0));
    expect(lastReportSlot(weekly, new Date(2026, 9, 2, 17, 0))).toEqual(new Date(2026, 9, 2, 17, 0));
    const daily = { ...weekly, frequency: "daily" as const, days: [1, 2, 3, 4, 5] };
    expect(lastReportSlot(daily, new Date(2026, 9, 4, 10, 0))).toEqual(new Date(2026, 9, 2, 17, 0)); // Sunday → Friday
  });
});

describe("task reminders", () => {
  it("fires at the task's reminder time once, skips done tasks, and catches up within a week", async () => {
    const p = repo.createProject(me, { name: "Home" });
    const t = repo.createTask(me, { title: "Call the bank", projectId: p.id, remindAt: new Date(2026, 8, 29, 14, 30).toISOString() });
    expect(t.remindAt).toBe(new Date(2026, 8, 29, 14, 30).toISOString());
    const done = repo.createTask(me, { title: "Done already", projectId: p.id, remindAt: new Date(2026, 8, 29, 14, 0).toISOString() });
    repo.moveTask(me, done.key, { columnId: col("Done") });

    clock = new Date(2026, 8, 29, 14, 29);
    await notifier.tick();
    expect(sent.filter((c) => text(c).includes("Reminder"))).toHaveLength(0);
    clock = new Date(2026, 8, 30, 8, 0); // laptop was off at 14:30; back the next morning
    await notifier.tick();
    await notifier.tick();
    const reminders = sent.filter((c) => text(c).includes("Reminder"));
    expect(reminders).toHaveLength(1);
    expect(text(reminders[0])).toContain("Reminder · HOM-1");

    // Moving the reminder later arms it again.
    repo.updateTask(me, t.key, { remindAt: new Date(2026, 8, 30, 9, 0).toISOString() });
    clock = new Date(2026, 8, 30, 9, 1);
    sent = [];
    await notifier.tick();
    expect(sent.filter((c) => text(c).includes("Reminder · HOM-1"))).toHaveLength(1);
    expect(repo.updateTask(me, t.key, { remindAt: null }).remindAt).toBeNull();
    expect(() => repo.updateTask(me, t.key, { remindAt: "sometime" })).toThrow(/date and time/);
  });

  it("keeps the same offset from the due date on repeating tasks", () => {
    const p = repo.createProject(me, { name: "Home" });
    const today = fmtDate(new Date());
    const [y, m, d] = today.split("-").map(Number);
    const t = repo.createTask(me, {
      title: "Weekly review", projectId: p.id, dueDate: today, recurrence: { freq: "weekly", interval: 1 },
      remindAt: new Date(y, m - 1, d - 1, 9, 0).toISOString(), // the day before at 09:00
    });
    const next = repo.getTask(repo.moveTask(me, t.key, { columnId: col("Done") }).nextKey!);
    expect(next.remindAt).toBe(new Date(y, m - 1, d + 6, 9, 0).toISOString());
  });
});

describe("instant notifications", () => {
  it("announces new blockers (not re-wordings) and Claude's completions, not yours", async () => {
    const p = repo.createProject(me, { name: "Acme" });
    const t = repo.createTask(me, { title: "SOW questions", projectId: p.id });
    repo.updateTask(me, t.key, { blocked: "Waiting on client" });
    repo.updateTask(me, t.key, { blocked: "Waiting on client (DR)" });
    await flush();
    expect(sent.map(text)).toEqual([expect.stringContaining("Blocked · ACM-1")]);
    expect(text(sent[0])).toContain("Waiting on:** Waiting on client");

    const a = repo.createTask(me, { title: "Mine", projectId: p.id });
    repo.moveTask(me, a.key, { columnId: col("Done") });
    const b = repo.createTask(me, { title: "Kickoff deck", projectId: p.id });
    repo.addNote(claude, b.key, "Deck shared with the client.");
    repo.moveTask(claude, b.key, { columnId: col("Done") });
    await flush();
    expect(sent).toHaveLength(2);
    expect(text(sent[1])).toContain("Claude completed ACM-3");
    expect(text(sent[1])).toContain("Deck shared with the client.");
  });

  it("stays quiet when paused or when the event type is off", async () => {
    const s = repo.getNotificationSettings();
    repo.saveNotificationSettings({ ...s, blockers: { enabled: false } });
    const p = repo.createProject(me, { name: "Acme" });
    const t = repo.createTask(me, { title: "x", projectId: p.id });
    repo.updateTask(me, t.key, { blocked: "Waiting" });
    repo.saveNotificationSettings({ ...repo.getNotificationSettings(), enabled: false });
    clock = new Date(2026, 8, 29, 23, 0);
    await notifier.tick();
    await flush();
    expect(sent).toHaveLength(0);
  });
});

describe("settings API", () => {
  it("never returns the webhook, validates input, and sends test messages", async () => {
    const app = createApp(repo, notifier);
    const res = await app.request("/api/notifications");
    const view = await res.json();
    expect(JSON.stringify(view)).not.toContain("secret123");
    expect(view.settings.webhook).toEqual({ set: true, hint: "example.logic.azure.com · …ret123" });

    const put = (b: unknown) => app.request("/api/notifications", { method: "PUT", body: JSON.stringify(b), headers: { "content-type": "application/json" } });
    expect((await put({ teamsWebhook: "http://insecure.example.com/x" })).status).toBe(400);
    expect((await put({ digest: { time: "25:00" } })).status).toBe(400);
    const ok = await (await put({ digest: { time: "08:30" }, report: { frequency: "daily" } })).json();
    expect(ok.settings.digest).toEqual({ enabled: true, time: "08:30", days: [1, 2, 3, 4, 5] });
    expect(ok.settings.report.frequency).toBe("daily");
    expect(repo.getNotificationSettings().teamsWebhook).toBe(URL_); // untouched when not sent

    const test = await (await app.request("/api/notifications/test", { method: "POST" })).json();
    expect(test.ok).toBe(true);
    expect(text(sent[0])).toContain("Orbit is connected");
    fail = true;
    const bad = await (await app.request("/api/notifications/test", { method: "POST" })).json();
    expect(bad).toMatchObject({ ok: false, error: "Teams returned 500" });
  });
});
