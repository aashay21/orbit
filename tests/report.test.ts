import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../server/db/index.ts";
import { Repo, type Ctx } from "../server/repo.ts";
import { createApp } from "../server/app.ts";
import { fmtDate } from "../shared/recurrence.ts";
import { reportTitle, reportToHtml, reportToMarkdown } from "../shared/report.ts";
import { chartColor } from "../web/src/util.ts";

const me: Ctx = { actor: "user", clientId: null };
let repo: Repo;
const col = (name: string) => repo.getBoard().columns.find((c) => c.name === name)!.id;
const today = fmtDate(new Date());

beforeEach(() => {
  repo = new Repo(openDatabase(":memory:"));
});

describe("blockers", () => {
  it("marks, keeps the original time on re-wording, clears, and logs each step", () => {
    const p = repo.createProject(me, { name: "Acme" });
    const t = repo.createTask(me, { title: "SOW questions", projectId: p.id });
    const blocked = repo.updateTask(me, t.key, { blocked: "Waiting on client" });
    expect(blocked.blockedReason).toBe("Waiting on client");
    const since = blocked.blockedAt;
    expect(repo.updateTask(me, t.key, { blocked: "Waiting on client (DR section)" }).blockedAt).toBe(since);
    expect(repo.getStats().blocked).toBe(1);
    const cleared = repo.updateTask(me, t.key, { blocked: null });
    expect(cleared.blockedReason).toBeNull();
    expect(cleared.activity.map((a) => a.type).slice(0, 3)).toEqual(["unblocked", "blocked", "blocked"]);
  });

  it("clears automatically when the task is completed", () => {
    const p = repo.createProject(me, { name: "Acme" });
    const t = repo.createTask(me, { title: "x", projectId: p.id });
    repo.updateTask(me, t.key, { blocked: "Waiting" });
    expect(repo.moveTask(me, t.key, { columnId: col("Done") }).blockedReason).toBeNull();
  });
});

describe("reports", () => {
  it("defaults In Progress and Review to count as in progress", () => {
    const active = repo.getBoard().columns.filter((c) => c.isActive).map((c) => c.name);
    expect(active).toEqual(["In Progress", "Review"]);
  });

  it("collects completed, in-progress and blocked work, scoped by project", () => {
    const infra = repo.createProject(me, { name: "Infra" });
    const tf = repo.createProject(me, { name: "Terraform", parentId: infra.id });
    const acme = repo.createProject(me, { name: "Acme" });
    const a = repo.createTask(me, { title: "Rotate secrets", projectId: tf.id });
    repo.addNote(me, a.key, "Rotated all prod secrets.");
    repo.moveTask(me, a.key, { columnId: col("Done") });
    repo.createTask(me, { title: "State backend", projectId: infra.id, columnId: col("In Progress"), dueDate: today, subtasks: ["a", "b"] });
    const c = repo.createTask(me, { title: "SOW questions", projectId: acme.id, columnId: col("To Do") });
    repo.updateTask(me, c.key, { blocked: "Waiting on client" });
    repo.createTask(me, { title: "Backlog idea", projectId: acme.id });

    const r = repo.getReport(today, today);
    expect(r.completed.map((t) => [t.key, t.projectPath, t.note?.body])).toEqual([["INF-1", ["Infra", "Terraform"], "Rotated all prod secrets."]]);
    expect(r.inProgress.map((t) => t.key)).toEqual(["INF-2"]);
    expect(r.blocked.map((t) => [t.key, t.blockedReason])).toEqual([["ACM-1", "Waiting on client"]]);
    expect(r.createdCount).toBe(4);
    expect(r.perDay).toEqual([{ date: today, byProject: [{ name: "Infra", color: infra.color, count: 1 }] }]);

    const scoped = repo.getReport(today, today, acme.id);
    expect(scoped.project).toBe("Acme");
    expect([scoped.completed.length, scoped.inProgress.length, scoped.blocked.length]).toEqual([0, 0, 1]);

    const md = reportToMarkdown(r);
    expect(md).toContain("**1 task completed · 1 in progress · 1 blocker**");
    expect(md).toContain("**Infra**\n- INF-1 Rotate secrets _(Terraform)_\n  - Rotated all prod secrets.");
    expect(md).toMatch(/- INF-2 State backend — In Progress · due .* · 0\/2 subtasks/);
    expect(md).toContain("- ACM-1 SOW questions _(Acme)_ — **Waiting on client** (since today)");
    expect(reportToMarkdown(r, { notes: false })).not.toContain("Rotated all prod");

    const html = reportToHtml({ ...r, blocked: [{ ...r.blocked[0], blockedReason: "<script>" }] });
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("titles days and weeks", () => {
    const base = { generatedAt: "", project: null, completed: [], inProgress: [], blocked: [], createdCount: 0, perDay: [] };
    expect(reportTitle({ ...base, from: "2026-09-29", to: "2026-09-29" })).toBe("Daily update · Tue 29 Sep 2026");
    expect(reportTitle({ ...base, from: "2026-09-28", to: "2026-10-04" })).toBe("Weekly update · 28 Sep – 4 Oct 2026");
    expect(reportTitle({ ...base, from: "2026-10-05", to: "2026-10-11", project: "Acme" })).toBe("Acme · Weekly update · 5–11 Oct 2026");
  });

  it("serves JSON, Markdown and HTML over the API and validates dates", async () => {
    const app = createApp(repo);
    expect((await app.request(`/api/report?from=${today}`)).status).toBe(200);
    const md = await app.request(`/api/report?from=${today}&to=${today}&format=md`);
    expect(md.headers.get("content-type")).toContain("text/markdown");
    expect(await md.text()).toContain("Daily update");
    expect((await app.request("/api/report?from=2026-10-05&to=2026-10-01")).status).toBe(400);
    expect((await app.request("/api/report?from=last-week")).status).toBe(400);
  });
});

describe("chart colours", () => {
  it("match the validated palette (same hue, lightness in the band per theme)", () => {
    expect(["#2dd4bf", "#a78bfa", "#fb7185", "#fbbf24", "#38bdf8", "#f472b6"].map((c) => chartColor(c, 0.64)))
      .toEqual(["#00a592", "#9276e2", "#db5c6f", "#b98100", "#0099d2", "#d15d9a"]);
    expect(chartColor("#2dd4bf", 0.62)).toBe("#009f8c");
  });
});
