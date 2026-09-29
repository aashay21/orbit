import { beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { openDatabase } from "../server/db/index.ts";
import { Repo } from "../server/repo.ts";
import { createApp } from "../server/app.ts";
import { OrbitClient } from "../mcp/client.ts";
import { registerTools } from "../mcp/tools.ts";
import { parseDue, parseRecurrence } from "../mcp/resolve.ts";
import type { Board } from "../shared/types.ts";

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
      "get_task", "list_projects", "list_tasks", "move_task", "recent_activity", "update_subtask", "update_task",
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
