import { beforeEach, describe, expect, it } from "vitest";
import { describeRecurrence, fmtDate, nextOccurrence, stepAfter } from "../shared/recurrence.ts";
import { openDatabase } from "../server/db/index.ts";
import { Repo, type Ctx } from "../server/repo.ts";

describe("stepAfter", () => {
  it("handles days, weeks and weekday sets", () => {
    expect(stepAfter({ freq: "daily", interval: 3 }, "2026-09-29")).toBe("2026-10-02");
    expect(stepAfter({ freq: "weekly", interval: 2 }, "2026-09-29")).toBe("2026-10-13");
    // 2026-10-02 is a Friday: weekdays skip the weekend.
    const weekdays = { freq: "weekly" as const, interval: 1, weekdays: [1, 2, 3, 4, 5] };
    expect(stepAfter(weekdays, "2026-10-02")).toBe("2026-10-05");
    expect(stepAfter(weekdays, "2026-09-29")).toBe("2026-09-30");
    // Every 2 weeks on Mon & Thu, from a Thursday: next is Monday two weeks later.
    expect(stepAfter({ freq: "weekly", interval: 2, weekdays: [1, 4] }, "2026-10-01")).toBe("2026-10-12");
    // Sunday counts as the end of the week.
    expect(stepAfter({ freq: "weekly", interval: 1, weekdays: [0] }, "2026-09-29")).toBe("2026-10-04");
  });

  it("clamps monthly and yearly dates to short months without drifting", () => {
    const monthly = { freq: "monthly" as const, interval: 1, monthDay: 31 };
    expect(stepAfter(monthly, "2026-01-31")).toBe("2026-02-28");
    expect(stepAfter(monthly, "2026-02-28")).toBe("2026-03-31");
    expect(stepAfter({ freq: "monthly", interval: 1 }, "2026-11-15")).toBe("2026-12-15");
    expect(stepAfter({ freq: "monthly", interval: 3 }, "2026-11-15")).toBe("2027-02-15");
    expect(stepAfter({ freq: "yearly", interval: 1 }, "2028-02-29")).toBe("2029-02-28");
  });
});

describe("nextOccurrence", () => {
  it("skips missed slots and respects until", () => {
    expect(nextOccurrence({ freq: "daily", interval: 1 }, "2026-09-20", "2026-09-29")).toBe("2026-09-29");
    expect(nextOccurrence({ freq: "weekly", interval: 1 }, "2026-10-06", "2026-09-29")).toBe("2026-10-13");
    expect(nextOccurrence({ freq: "daily", interval: 1, until: "2026-09-30" }, "2026-09-30", "2026-09-29")).toBeNull();
  });

  it("describes rules in plain words", () => {
    expect(describeRecurrence({ freq: "weekly", interval: 1, weekdays: [5, 1, 2, 3, 4] })).toBe("Every weekday");
    expect(describeRecurrence({ freq: "weekly", interval: 2, weekdays: [4, 1] })).toBe("Every 2 weeks on Mon, Thu");
    expect(describeRecurrence({ freq: "monthly", interval: 1, until: "2026-12-31" })).toBe("Every month, until 2026-12-31");
    expect(describeRecurrence(null)).toBe("Does not repeat");
  });
});

describe("recurring tasks in the board", () => {
  const me: Ctx = { actor: "user", clientId: null };
  let repo: Repo;
  const col = (name: string) => repo.getBoard().columns.find((c) => c.name === name)!.id;
  beforeEach(() => {
    repo = new Repo(openDatabase(":memory:"));
  });

  it("spawns the next occurrence once when completed, copying details", () => {
    const p = repo.createProject(me, { name: "Home" });
    const today = fmtDate(new Date());
    const t = repo.createTask(me, {
      title: "Water plants", projectId: p.id, priority: "medium", dueDate: today, tags: ["chores"],
      subtasks: ["Balcony", "Kitchen"], recurrence: { freq: "daily", interval: 2, columnId: col("To Do") },
    });
    repo.updateSubtask(me, t.subtasks[0].id, { done: true });

    const done = repo.moveTask(me, t.key, { columnId: col("Done") });
    expect(done.nextKey).toBe("HOM-2");
    const next = repo.getTask("HOM-2");
    expect(next).toMatchObject({ title: "Water plants", priority: "medium", columnId: col("To Do"), completedAt: null });
    expect(next.dueDate).toBe(nextOccurrence({ freq: "daily", interval: 2 }, today, today));
    expect(next.tagIds).toEqual(done.tagIds);
    expect(next.subtasks.map((s) => [s.title, s.done])).toEqual([["Balcony", false], ["Kitchen", false]]);
    expect(next.recurrence).toEqual({ freq: "daily", interval: 2, columnId: col("To Do") });
    expect(next.activity[0].data).toMatchObject({ recurredFrom: t.key });

    // Reopening and completing again must not create a second copy.
    repo.moveTask(me, t.key, { columnId: col("Review") });
    repo.moveTask(me, t.key, { columnId: col("Done") });
    expect(repo.getBoard().tasks.filter((x) => x.title === "Water plants")).toHaveLength(2);
  });

  it("stops at the end date and ignores non-recurring tasks", () => {
    const p = repo.createProject(me, { name: "Home" });
    const today = fmtDate(new Date());
    const last = repo.createTask(me, { title: "Last one", projectId: p.id, dueDate: today, recurrence: { freq: "daily", interval: 1, until: today } });
    expect(repo.moveTask(me, last.key, { columnId: col("Done") }).nextKey).toBeNull();
    const plain = repo.createTask(me, { title: "Once", projectId: p.id });
    expect(repo.moveTask(me, plain.key, { columnId: col("Done") }).nextKey).toBeNull();
    expect(repo.getBoard().tasks).toHaveLength(2);
  });

  it("can turn repetition on and off", () => {
    const p = repo.createProject(me, { name: "Home" });
    const t = repo.createTask(me, { title: "x", projectId: p.id });
    expect(repo.updateTask(me, t.key, { recurrence: { freq: "weekly", interval: 1, weekdays: [1] } }).recurrence).toEqual({ freq: "weekly", interval: 1, weekdays: [1] });
    expect(repo.updateTask(me, t.key, { recurrence: null }).recurrence).toBeNull();
  });
});
