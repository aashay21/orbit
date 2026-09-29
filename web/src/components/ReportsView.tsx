import { useEffect, useMemo, useState, type ReactNode } from "react";
import { addDays, differenceInCalendarDays, format, isSameDay, parseISO } from "date-fns";
import { reportSummary, reportTitle, reportToHtml, reportToMarkdown, type Report, type ReportTask } from "@shared/report";
import { api } from "../api";
import { remember, useStore } from "../store";
import { chartColor, cx, relativeTime, toISODate } from "../util";
import { Icon, Spark } from "./Icon";
import { ProjectPicker } from "./ui";

type Mode = "day" | "week" | "custom";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Last day of the 7-day report window containing `d`, for weeks ending on `endDay`. */
const weekEnd = (d: Date, endDay: number) => addDays(d, (endDay - d.getDay() + 7) % 7);

const load = <T,>(k: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v == null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
};

async function copyRich(html: string, text: string) {
  try {
    await navigator.clipboard.write([
      new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([text], { type: "text/plain" }) }),
    ]);
  } catch {
    await navigator.clipboard.writeText(text);
  }
}

export function ReportsView() {
  const { board, version, toast, set } = useStore();
  const [mode, setMode] = useState<Mode>(() => load("orbit.report.mode", "week"));
  const [anchor, setAnchor] = useState(() => new Date());
  const [endDay, setEndDay] = useState<number>(() => load("orbit.report.weekEnd", 0));
  const [range, setRange] = useState<{ from: string; to: string }>(() => ({ from: toISODate(addDays(new Date(), -7)), to: toISODate(new Date()) }));
  const [projectId, setProjectId] = useState<number | null>(() => load("orbit.report.project", null));
  const [notes, setNotes] = useState<boolean>(() => load("orbit.report.notes", true));
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  const to = mode === "day" ? anchor : mode === "week" ? weekEnd(anchor, endDay) : parseISO(range.to);
  const from = mode === "day" ? anchor : mode === "week" ? addDays(to, -6) : parseISO(range.from);
  const fromS = toISODate(from);
  const toS = toISODate(to);
  const validProject = projectId != null && board?.projects.some((p) => p.id === projectId && !p.archivedAt) ? projectId : null;

  useEffect(() => {
    let alive = true;
    api.report(fromS, toS, validProject)
      .then((r) => { if (alive) { setReport(r); setError(null); } })
      .catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [fromS, toS, validProject, version]);

  const isCurrent = mode === "day" ? isSameDay(anchor, new Date()) : isSameDay(to, weekEnd(new Date(), endDay));
  const step = (n: number) => setAnchor((a) => addDays(mode === "day" ? a : to, mode === "day" ? n : 7 * n));
  const days = differenceInCalendarDays(to, from) + 1;
  const choose = (m: Mode) => { setMode(m); remember("orbit.report.mode", m); };

  const md = report ? reportToMarkdown(report, { notes }) : "";
  const copy = async (rich: boolean) => {
    if (!report) return;
    try {
      if (rich) await copyRich(reportToHtml(report, { notes }), md);
      else await navigator.clipboard.writeText(md);
      toast(rich ? "Copied: paste into Teams, Outlook or Gmail" : "Copied Markdown");
    } catch {
      toast("Couldn't reach the clipboard. Click into the window and try again, or use Download.", "error");
    }
  };
  const download = () => {
    if (!report) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
    a.download = `orbit-${mode === "day" ? "daily" : mode === "week" ? "weekly" : "update"}-${fromS}${fromS !== toS ? `-to-${toS}` : ""}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="page reports">
      <div className="head">
        <div>
          <div className="eyebrow">STATUS REPORT</div>
          <h1 className="title">{report ? reportTitle(report).replace(/^(.* · )?((Daily|Weekly) update|Update) · /, "") : "…"}<em>· {mode === "day" ? "daily" : mode === "week" ? "weekly" : `${days} days`}</em></h1>
          {report && <div className="crumbs">{reportSummary(report)}{report.project ? ` · ${report.project}` : ""}</div>}
        </div>
        <div className="report-actions">
          <button className="new" onClick={() => copy(true)} disabled={!report}><Icon name="copy" size={15} />Copy for Teams / email</button>
          <button className="btn" onClick={() => copy(false)} disabled={!report}>Copy Markdown</button>
          <button className="btn ghost" onClick={download} disabled={!report} title="Download .md"><Icon name="download" size={15} /></button>
        </div>
      </div>

      <div className="toolbar">
        <div className="seg" role="radiogroup" aria-label="Period">
          {(["day", "week", "custom"] as Mode[]).map((m) => (
            <button key={m} role="radio" aria-checked={mode === m} className={cx(mode === m && "on")} onClick={() => choose(m)}>{m === "day" ? "Day" : m === "week" ? "Week" : "Custom"}</button>
          ))}
        </div>
        {mode === "custom" ? (
          <div className="range">
            <input type="date" value={range.from} max={range.to} onChange={(e) => e.target.value && setRange((r) => ({ ...r, from: e.target.value }))} />
            <span className="muted">to</span>
            <input type="date" value={range.to} min={range.from} onChange={(e) => e.target.value && setRange((r) => ({ ...r, to: e.target.value }))} />
            <span className="muted small">{days} days, both ends included</span>
          </div>
        ) : (
          <>
            <div className="period">
              <button className="icon-btn" onClick={() => step(-1)} aria-label="Previous"><Icon name="left" size={16} /></button>
              <span>{mode === "day" ? format(from, "EEE d MMM yyyy") : `${format(from, "EEE d MMM")} – ${format(to, "EEE d MMM yyyy")}`}</span>
              <button className="icon-btn" onClick={() => step(1)} aria-label="Next"><Icon name="right" size={16} /></button>
            </div>
            {mode === "week" && (
              <label className="week-end">
                <span className="muted small">Week ends</span>
                <select value={endDay} onChange={(e) => { const v = Number(e.target.value); setEndDay(v); remember("orbit.report.weekEnd", v); setAnchor(new Date()); }}>
                  {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                </select>
              </label>
            )}
            {!isCurrent && <button className="chip" onClick={() => setAnchor(new Date())}>{mode === "day" ? "Today" : "This week"}</button>}
          </>
        )}
        <div className="report-project">
          <ProjectPicker projects={board?.projects ?? []} value={validProject} placeholder="All projects"
            onChange={(id) => { setProjectId(id); remember("orbit.report.project", id); }} />
          {validProject != null && <button className="mini-btn" onClick={() => { setProjectId(null); remember("orbit.report.project", null); }}>All projects</button>}
        </div>
        <label className="toggle">
          <input type="checkbox" checked={notes} onChange={(e) => { setNotes(e.target.checked); remember("orbit.report.notes", e.target.checked); }} />
          <span className="toggle-ui" />Include notes
        </label>
      </div>

      <div className="page-body">
        {error && <div className="empty-note">{error}</div>}
        {report && (
          <div className="report">
            <div className="tiles">
              <Tile label="Completed" value={report.completed.length} tone="done" />
              <Tile label="In progress" value={report.inProgress.length} tone="active" hint="right now" />
              <Tile label="Blockers" value={report.blocked.length} tone={report.blocked.length ? "blocked" : "quiet"} hint="right now" />
              <Tile label="Created" value={report.createdCount} tone="quiet" />
            </div>

            {days > 1 && days <= 31 && <WeekChart report={report} />}

            <ReportSection title="Completed" count={report.completed.length} empty="Nothing completed in this period yet.">
              {report.completed.map((t) => <Row key={t.key} t={t} notes={notes} meta={t.completedAt ? format(new Date(t.completedAt), days === 1 ? "HH:mm" : days <= 7 ? "EEE HH:mm" : "d MMM HH:mm") : ""} onOpen={() => set({ openTask: t.key })} />)}
            </ReportSection>
            <ReportSection title="In progress" count={report.inProgress.length} empty="Nothing in progress. Columns marked “Counts as in progress” show up here.">
              {report.inProgress.map((t) => (
                <Row key={t.key} t={t} notes={notes} notePrefix="Latest: " onOpen={() => set({ openTask: t.key })}
                  meta={[t.column, t.dueDate ? `due ${format(parseISO(t.dueDate), "EEE d MMM")}` : null, t.subtasksTotal ? `${t.subtasksDone}/${t.subtasksTotal}` : null].filter(Boolean).join(" · ")} />
              ))}
            </ReportSection>
            <ReportSection title="Blockers" count={report.blocked.length} empty="No blockers. Nice." tone="blocked">
              {report.blocked.map((t) => (
                <Row key={t.key} t={t} notes={false} blocked onOpen={() => set({ openTask: t.key })} meta={t.blockedAt ? `blocked ${relativeTime(t.blockedAt)}` : ""} />
              ))}
            </ReportSection>
          </div>
        )}
      </div>
    </div>
  );
}

function Tile({ label, value, tone, hint }: { label: string; value: number; tone: string; hint?: string }) {
  return (
    <div className={cx("tile", tone)}>
      <div className="tile-v">{value}</div>
      <div className="tile-l">{label}{hint && <span> · {hint}</span>}</div>
    </div>
  );
}

function ReportSection({ title, count, empty, tone, children }: { title: string; count: number; empty: string; tone?: string; children: ReactNode }) {
  return (
    <section className={cx("report-sec", tone)}>
      <h3>{title}<span>{count}</span></h3>
      {count === 0 ? <div className="report-empty">{empty}</div> : <div className="report-rows">{children}</div>}
    </section>
  );
}

function Row({ t, meta, notes, notePrefix = "", blocked, onOpen }: { t: ReportTask; meta: string; notes: boolean; notePrefix?: string; blocked?: boolean; onOpen(): void }) {
  return (
    <div className={cx("report-row", blocked && "blocked")} style={{ ["--acc" as string]: t.projectColor }} onClick={onOpen} role="button" tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}>
      <span className="tid">{t.key}</span>
      <div className="report-main">
        <div className="report-title">{t.title}</div>
        {blocked && <div className="report-reason"><Icon name="block" size={12} />{t.blockedReason}</div>}
        {notes && t.note && (
          <div className="report-note">
            {t.note.actor === "claude" && <span className="spark"><Spark size={9} /></span>}
            {notePrefix}{t.note.body.replace(/\s+/g, " ").slice(0, 220)}
          </div>
        )}
      </div>
      <span className="path"><i />{t.projectPath.join(" › ")}</span>
      <span className="report-meta">{meta}</span>
    </div>
  );
}

/** Tasks completed per day, stacked by top-level project. */
function WeekChart({ report }: { report: Report }) {
  const [hover, setHover] = useState<number | null>(null);
  const projects = useMemo(() => {
    const seen = new Map<string, string>();
    for (const d of report.perDay) for (const p of d.byProject) seen.set(p.name, p.color);
    return [...seen].map(([name, color]) => ({ name, color, night: chartColor(color, 0.64), dawn: chartColor(color, 0.62) }));
  }, [report]);
  const totals = report.perDay.map((d) => d.byProject.reduce((a, p) => a + p.count, 0));
  const max = Math.max(1, ...totals);
  const todayS = toISODate(new Date());

  return (
    <section className="report-sec chart-card">
      <h3>Completed each day<span>{totals.reduce((a, b) => a + b, 0)}</span></h3>
      <div className="week-chart" style={{ gridTemplateColumns: `repeat(${report.perDay.length}, 1fr)`, gap: report.perDay.length > 10 ? 4 : 10 }} onMouseLeave={() => setHover(null)}>
        {report.perDay.map((d, i) => (
          <div key={d.date} className={cx("wc-day", d.date === todayS && "today", d.date > todayS && "future")} onMouseEnter={() => setHover(i)}>
            <div className="wc-plot">
              {totals[i] > 0 && <span className="wc-total">{totals[i]}</span>}
              <div className="wc-stack" style={{ height: `${(totals[i] / max) * 100}%` }}>
                {projects.map((p) => {
                  const n = d.byProject.find((x) => x.name === p.name)?.count ?? 0;
                  return n ? <i key={p.name} style={{ flexGrow: n, ["--cn" as string]: p.night, ["--cd" as string]: p.dawn }} /> : null;
                })}
              </div>
            </div>
            <span className="wc-label">{format(parseISO(d.date), report.perDay.length <= 7 ? "EEE" : report.perDay.length <= 14 ? "EEEEE d" : "d")}</span>
            {hover === i && (
              <div className={cx("wc-tip", i > report.perDay.length * 0.6 && "left")}>
                <b>{format(parseISO(d.date), "EEEE d MMM")}</b>
                {totals[i] === 0 ? <span className="muted">Nothing completed</span> : projects.map((p) => {
                  const n = d.byProject.find((x) => x.name === p.name)?.count ?? 0;
                  return n ? <span key={p.name} className="wc-tip-row"><i style={{ ["--cn" as string]: p.night, ["--cd" as string]: p.dawn }} />{p.name}<b>{n}</b></span> : null;
                })}
              </div>
            )}
          </div>
        ))}
      </div>
      {projects.length > 1 && (
        <div className="wc-legend">
          {projects.map((p) => <span key={p.name}><i style={{ ["--cn" as string]: p.night, ["--cd" as string]: p.dawn }} />{p.name}</span>)}
        </div>
      )}
    </section>
  );
}
