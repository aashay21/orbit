import { useEffect, useState, type ReactNode } from "react";
import { format } from "date-fns";
import type { NotificationsView, PublicNotificationSettings } from "@shared/notifications";
import { api, type NotificationsPatch } from "../api";
import { useStore } from "../store";
import { cx, relativeTime } from "../util";
import { Icon } from "./Icon";
import { ProjectPicker } from "./ui";

const WEEK = [1, 2, 3, 4, 5, 6, 0];
const LETTER = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const KIND_LABEL: Record<string, string> = {
  test: "Test", digest: "Digest", due_reminder: "Due today", task_reminder: "Reminder", blocked: "Blocker",
  claude_completed: "Claude", report: "Report",
};

export function SettingsView() {
  const { board, toast, load } = useStore();
  const [view, setView] = useState<NotificationsView | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { api.notifications().then(setView).catch((e) => toast(e.message, "error")); }, [toast]);

  const save = async (patch: NotificationsPatch, done?: string) => {
    try {
      setView(await api.saveNotifications(patch));
      void load(); // refresh "notifications ready" for reminder hints
      if (done) toast(done);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't save", "error");
    }
  };

  const test = async () => {
    setBusy("test");
    try {
      const r = await api.testNotification();
      setView(r.view);
      if (r.ok) toast("Test sent. Check Teams: it can take a few seconds to appear");
      else toast(`Teams didn't accept it: ${r.error}`, "error");
    } finally {
      setBusy(null);
    }
  };

  if (!view) return <div className="page"><div className="head"><div><div className="eyebrow">SETTINGS</div><h1 className="title">Notifications</h1></div></div></div>;
  const s = view.settings;
  const connected = s.webhook.set;

  return (
    <div className="page settings">
      <div className="head">
        <div>
          <div className="eyebrow">SETTINGS</div>
          <h1 className="title">Notifications<em>· Microsoft Teams</em></h1>
        </div>
        <label className="toggle big">
          <input type="checkbox" checked={s.enabled} onChange={(e) => save({ enabled: e.target.checked }, e.target.checked ? "Notifications on" : "Notifications paused")} />
          <span className="toggle-ui" />{s.enabled ? "On" : "Paused"}
        </label>
      </div>

      <div className="page-body">
        <div className="settings-grid">
          <section className="set-card">
            <h3><Icon name="send" size={14} />Teams connection
              <span className={cx("pill", connected ? "ok" : "warn")}>{connected ? "Connected" : "Not set up"}</span>
            </h3>
            {connected ? (
              <div className="webhook-set">
                <span className="muted small">Webhook</span><code>{s.webhook.hint}</code>
                <button className="btn" onClick={test} disabled={busy === "test"}>{busy === "test" ? "Sending…" : "Send test message"}</button>
                <button className="btn ghost danger" onClick={() => save({ teamsWebhook: null }, "Webhook removed")}>Remove</button>
              </div>
            ) : (
              <p className="muted small set-help">
                In Teams, open <b>Workflows</b> and pick <b>“Send webhook alerts to a chat”</b> (or “…to a channel”), choose where messages go,
                and copy the URL it gives you. Paste it here; it stays in Orbit's local database.
              </p>
            )}
            <form className="webhook-form" onSubmit={(e) => { e.preventDefault(); if (url.trim()) void save({ teamsWebhook: url.trim() }, "Webhook saved").then(() => setUrl("")); }}>
              <input type="password" autoComplete="off" spellCheck={false} value={url} onChange={(e) => setUrl(e.target.value)}
                placeholder={connected ? "Paste a new URL to replace it" : "https://…logic.azure.com/workflows/… or …powerplatform.com/…"} />
              <button className="btn primary" disabled={!url.trim()}>{connected ? "Replace" : "Save"}</button>
            </form>
          </section>

          <section className="set-card">
            <h3><Icon name="bell" size={14} />What to send</h3>
            <Rule title="Morning digest" desc="Due today, overdue and blocked, in one card." on={s.digest.enabled} onToggle={(v) => save({ digest: { enabled: v } })}>
              <TimeInput value={s.digest.time} onChange={(time) => save({ digest: { time } })} />
              <DayPills days={s.digest.days} onChange={(days) => save({ digest: { days } })} />
            </Rule>
            <Rule title="Due today reminders" desc="One reminder per open task on the day it's due." on={s.dueReminders.enabled} onToggle={(v) => save({ dueReminders: { enabled: v } })}>
              <TimeInput value={s.dueReminders.time} onChange={(time) => save({ dueReminders: { time } })} />
            </Rule>
            <Rule title="Task reminders" desc="At the date and time you set on a task (“Remind me”)." on={s.taskReminders.enabled} onToggle={(v) => save({ taskReminders: { enabled: v } })} />
            <Rule title="New blockers" desc="As soon as a task is marked blocked." on={s.blockers.enabled} onToggle={(v) => save({ blockers: { enabled: v } })} />
            <Rule title="Claude completes a task" desc="With Claude's closing note, when there is one." on={s.claudeCompleted.enabled} onToggle={(v) => save({ claudeCompleted: { enabled: v } })} />
            <ReportRule s={s} save={save} projects={board?.projects ?? []} />
            <p className="muted small set-help">
              Times use this laptop's clock. If Orbit wasn't running at a scheduled time, it catches up when you're back
              (same day for digests, up to 3 days for reports, a week for task reminders). Changes apply from now on.
            </p>
          </section>

          <section className="set-card log-card">
            <h3><Icon name="list" size={14} />Recently sent</h3>
            {view.log.length === 0 && <div className="report-empty">Nothing sent yet.</div>}
            <div className="notify-log">
              {view.log.map((l) => (
                <div key={l.id} className={cx("log-row", l.status)} title={l.detail ?? ""}>
                  <span className={cx("log-dot", l.status)} />
                  <span className="log-kind">{KIND_LABEL[l.kind] ?? l.kind}</span>
                  <span className="log-title">{l.title}{l.status === "error" && l.detail ? <em> · {l.detail}</em> : null}</span>
                  <time title={format(new Date(l.updatedAt), "d MMM yyyy, HH:mm")}>{relativeTime(l.updatedAt)}</time>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function Rule({ title, desc, on, onToggle, children }: { title: string; desc: string; on: boolean; onToggle(v: boolean): void; children?: ReactNode }) {
  return (
    <div className={cx("rule", !on && "off")}>
      <label className="toggle">
        <input type="checkbox" checked={on} onChange={(e) => onToggle(e.target.checked)} />
        <span className="toggle-ui" />
      </label>
      <div className="rule-text"><b>{title}</b><span>{desc}</span></div>
      {children && <div className="rule-controls">{children}</div>}
    </div>
  );
}

function TimeInput({ value, onChange }: { value: string; onChange(v: string): void }) {
  return <input type="time" className="time-input" defaultValue={value} key={value} onBlur={(e) => e.target.value && e.target.value !== value && onChange(e.target.value)}
    onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />;
}

function DayPills({ days, onChange }: { days: number[]; onChange(d: number[]): void }) {
  const toggle = (d: number) => onChange(days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort());
  return (
    <div className="recur-days compact">
      {WEEK.map((d) => <button key={d} type="button" className={cx("day-pill", days.includes(d) && "on")} onClick={() => toggle(d)} title={DAY_NAMES[d]}>{LETTER[d]}</button>)}
    </div>
  );
}

function ReportRule({ s, save, projects }: { s: PublicNotificationSettings; save(p: NotificationsPatch): void; projects: Parameters<typeof ProjectPicker>[0]["projects"] }) {
  const r = s.report;
  return (
    <Rule title="Scheduled report" desc={r.frequency === "weekly" ? `Every ${DAY_NAMES[r.weekday]}, covering the 7 days ending that day.` : "At the end of each chosen day."}
      on={r.enabled} onToggle={(v) => save({ report: { enabled: v } })}>
      <div className="seg small">
        {(["daily", "weekly"] as const).map((f) => (
          <button key={f} type="button" className={cx(r.frequency === f && "on")} onClick={() => save({ report: { frequency: f } })}>{f === "daily" ? "Daily" : "Weekly"}</button>
        ))}
      </div>
      {r.frequency === "weekly" ? (
        <select className="time-input" value={r.weekday} onChange={(e) => save({ report: { weekday: Number(e.target.value) } })}>
          {DAY_NAMES.map((d, i) => <option key={d} value={i}>{d}</option>)}
        </select>
      ) : (
        <DayPills days={r.days} onChange={(days) => save({ report: { days } })} />
      )}
      <TimeInput value={r.time} onChange={(time) => save({ report: { time } })} />
      <ProjectPicker projects={projects} value={r.projectId} placeholder="All projects" onChange={(projectId) => save({ report: { projectId } })} />
      {r.projectId != null && <button type="button" className="mini-btn" onClick={() => save({ report: { projectId: null } })}>All projects</button>}
      <label className="toggle">
        <input type="checkbox" checked={r.notes} onChange={(e) => save({ report: { notes: e.target.checked } })} />
        <span className="toggle-ui" />Notes
      </label>
    </Rule>
  );
}
