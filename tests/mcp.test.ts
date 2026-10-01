import { beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { openDatabase } from "../server/db/index.ts";
import { Repo } from "../server/repo.ts";
import { createApp } from "../server/app.ts";
import { OrbitClient } from "../mcp/client.ts";
import { registerTools } from "../mcp/tools.ts";
import { parseDue, parseRecurrence, parseRemind } from "../mcp/resolve.ts";
import type { Board } from "../shared/types.ts";
import { fmtDate } from "../shared/recurrence.ts";
import { reportTitle } from "../shared/report.ts";

let repo: Repo;
let client: Client;

beforeEach(async () => {
  repo = new Repo(openDatabase(":memory:"));
  const app = createApp(repo);
  // The MCP tools talk HTTP; route their requests straight into the in-memory app.
  const orbit = new OrbitClient("http://orbit.test", (url, init) => Promise.resolve(app.request(url.replace("http://orbit.test", ""), init)));
  const server = new McpServer({ name: "orbit", version: "test" });
  registerTools(server, orbit);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  client = new Client({ name: "test", version: "1" });
  await client.connect(b);
});

async function call(name: string, args: Record<string, unknown> = {}) {
  const res = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  return { text: res.content.map((c) => c.text).join("\n"), isError: !!res.isError };
}

describe("MCP tools", () => {
  it("exposes the expected tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "add_note", "add_subtasks", "archive_task", "board_overview", "complete_task", "create_project", "create_task",
      "get_report", "get_task", "list_projects", "list_tasks", "move_task", "recent_activity", "update_subtask", "update_task",
    ]);
  });

  it("runs a realistic session: projects, tasks by path, moves, notes, completion", async () => {
    await call("create_project", { name: "Infra" });
    const sub = await call("create_project", { name: "Terraform", parent: "infra" });
    expect(sub.text).toContain("Infra / Terraform");

    const created = await call("create_task", {
      title: "Rotate secrets", project: "Infra/Terraform", priority: "high", due_date: "tomorrow",
      tags: ["security"], subtasks: ["Key Vault", "Pipelines"], column: "to do",
    });
    expect(created.isError).toBe(false);
    expect(created.text).toMatch(/Created INF-1 · Rotate secrets · To Do · high · due .* \(tomorrow\) · Infra \/ Terraform · #security · 0\/2 subtasks/);

    expect((await call("move_task", { key: "inf-1", column: "In Progress" })).text).toBe("Moved INF-1 to In Progress.");
    await call("update_subtask", { key: "INF-1", subtask: "vault", done: true });
    await call("add_note", { key: "INF-1", body: "Rotated Key Vault secrets." });
    await call("update_task", { key: "INF-1", add_tags: ["prod"], append_description: "Done via **pipeline**." });

    const detail = (await call("get_task", { key: "INF-1" })).text;
    expect(detail).toContain("Column: In Progress");
    expect(detail).toContain("Tags: prod, security");
    expect(detail).toContain("[x] Key Vault");
    expect(detail).toContain("Claude: Rotated Key Vault secrets.");

    const overview = (await call("board_overview")).text;
    expect(overview).toContain("In Progress:\n  INF-1 · Rotate secrets");

    expect((await call("complete_task", { key: "INF-1", note: "All rotated." })).text).toBe("Completed INF-1 (Done).");
    const activity = (await call("recent_activity")).text;
    expect(activity).toMatch(/1 task completed: INF-1 \(Rotate secrets\)/);

    // Changes are attributed to Claude.
    const task = repo.getTask("INF-1");
    expect(task.lastActor).toBe("claude");
    expect(task.activity.every((a) => a.actor === "claude")).toBe(true);
    expect(repo.claudeSeenAt).not.toBeNull();
  });

  it("creates the next occurrence when a repeating task is completed", async () => {
    await call("create_project", { name: "Home" });
    await call("create_task", { title: "Water plants", project: "Home", due_date: "today", repeat: "every 2 days" });
    const res = await call("complete_task", { key: "HOM-1" });
    expect(res.text).toMatch(/Completed HOM-1 \(Done\)\. Next occurrence: HOM-2 · Water plants · Backlog · due .* \(in 2d\)/);
  });

  it("tracks blockers and produces reports for weeks ending on any day or custom ranges", async () => {
    await call("create_project", { name: "Acme" });
    await call("create_task", { title: "SOW questions", project: "Acme", column: "In Progress" });
    await call("update_task", { key: "ACM-1", blocked: "Waiting on client" });
    expect((await call("list_tasks", { blocked: true })).text).toContain("BLOCKED: Waiting on client");
    expect((await call("board_overview")).text).toContain("Blocked:\n  ACM-1");
    await call("create_task", { title: "Kickoff deck", project: "Acme" });
    await call("complete_task", { key: "ACM-2" });

    const week = (await call("get_report", { style: "detailed" })).text;
    expect(week).toMatch(/^## Weekly update · /);
    expect(week).toContain("**1 task completed · 1 in progress · 1 blocker**");
    expect(week).toContain("- ACM-1 SOW questions _(Acme)_ — **Waiting on client** (since today)");

    // Week ending Wednesday: the Thu–Wed window containing today.
    const now = new Date();
    const at = (n: number) => fmtDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n));
    const endOffset = (3 - now.getDay() + 7) % 7;
    const empty = { generatedAt: "", project: null, completed: [], inProgress: [], blocked: [], createdCount: 0, perDay: [] };
    const wed = (await call("get_report", { week_ends_on: "wednesday", style: "detailed" })).text;
    expect(wed.split("\n")[0]).toBe(`## ${reportTitle({ ...empty, from: at(endOffset - 6), to: at(endOffset) })}`);
    const lastWed = (await call("get_report", { week_ends_on: "wed", period: "last_week", style: "detailed" })).text;
    expect(lastWed.split("\n")[0]).toBe(`## ${reportTitle({ ...empty, from: at(endOffset - 13), to: at(endOffset - 7) })}`);

    // "From last Wednesday to today", both ends included.
    const since = -(((now.getDay() - 3 + 7) % 7) || 7);
    const range = (await call("get_report", { period: "range", from: "wednesday", style: "detailed" })).text;
    expect(range.split("\n")[0]).toBe(`## ${reportTitle({ ...empty, from: at(since), to: at(0) })}`);
    expect((await call("get_report", { period: "today", project: "Acme", notes: false, style: "detailed" })).text).toMatch(/^## Acme · Daily update/);

    const status = (await call("get_report", {})).text;
    expect(status).toMatch(/^\*\*Weekly Status Update \(/);
    expect(status).toContain("**Acme**\nCompleted Work:\n\n* Kickoff deck");
    expect(status).toContain("Blockers:\n\n* SOW questions — Waiting on client");

    await call("update_task", { key: "ACM-1", blocked: null });
    expect((await call("list_tasks", { blocked: true })).text).toBe("No matching tasks.");
  });

  it("returns helpful errors instead of failing", async () => {
    await call("create_project", { name: "Acme Client" });
    await call("create_project", { name: "Landing Zone", parent: "Acme" });
    await call("create_project", { name: "Other" });
    await call("create_project", { name: "Landing Zone", parent: "Other" });

    const ambiguous = await call("create_task", { title: "x", project: "Landing Zone" });
    expect(ambiguous.isError).toBe(true);
    expect(ambiguous.text).toContain("matches several projects");
    expect((await call("create_task", { title: "x", project: "Acme Client/Landing Zone" })).isError).toBe(false);

    expect((await call("move_task", { key: "ACM-1", column: "Nowhere" })).text).toContain("Columns: Backlog, To Do");
    expect((await call("get_task", { key: "ZZZ-9" })).text).toBe("Task ZZZ-9 not found");
    expect((await call("create_task", { title: "x", project: "Other", due_date: "someday" })).text).toContain("Couldn't read the date");
  });
});

describe("resolvers", () => {
  const tue = new Date(2026, 8, 29); // Tuesday 29 Sep 2026
  it("parses loose dates", () => {
    expect(parseDue("friday", tue)).toBe("2026-10-02");
    expect(parseDue("tuesday", tue)).toBe("2026-09-29");
    expect(parseDue("next tuesday", tue)).toBe("2026-10-06");
    expect(parseDue("+3d", tue)).toBe("2026-10-02");
    expect(parseDue("in 2 weeks", tue)).toBe("2026-10-13");
    expect(parseDue("none", tue)).toBeNull();
  });

  it("parses reminder times", () => {
    const now = new Date(2026, 8, 29, 10, 0); // Tue 10:00
    const at = (m: number, d: number, h: number, min = 0) => new Date(2026, m, d, h, min).toISOString();
    expect(parseRemind("tomorrow 9am", now)).toBe(at(8, 30, 9));
    expect(parseRemind("friday at 14:30", now)).toBe(at(9, 2, 14, 30));
    expect(parseRemind("3pm", now)).toBe(at(8, 29, 15));
    expect(parseRemind("9:00", now)).toBe(at(8, 30, 9)); // already past today → tomorrow
    expect(parseRemind("2026-10-01 15:00", now)).toBe(at(9, 1, 15));
    expect(parseRemind("in 2 hours", now)).toBe(at(8, 29, 12));
    expect(parseRemind("none", now)).toBeNull();
    expect(() => parseRemind("soonish", now)).toThrow(/Couldn't read the reminder/);
  });

  it("parses repeat rules from words", () => {
    const board = { columns: [], projects: [], tags: [], tasks: [] } as Board;
    expect(parseRecurrence("every weekday", board)).toEqual({ freq: "weekly", interval: 1, weekdays: [1, 2, 3, 4, 5] });
    expect(parseRecurrence("every monday and thursday", board)).toEqual({ freq: "weekly", interval: 1, weekdays: [1, 4] });
    expect(parseRecurrence("every 2 weeks on fri", board)).toEqual({ freq: "weekly", interval: 2, weekdays: [5] });
    expect(parseRecurrence("monthly, until 2026-12-31", board)).toEqual({ freq: "monthly", interval: 1, until: "2026-12-31" });
    expect(parseRecurrence("none", board)).toBeNull();
    expect(() => parseRecurrence("whenever", board)).toThrow(/Couldn't read/);
  });
});
