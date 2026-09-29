import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { format, isToday, isYesterday } from "date-fns";
import type { Activity, Task } from "@shared/types";
import { api } from "../api";
import { useStore } from "../store";
import { cx, projectPath, relativeTime } from "../util";
import { Icon, Spark } from "./Icon";
import { describe } from "./TaskPanel";
import { ConfirmButton } from "./ui";

export function Toasts() {
  const { toasts, dismissToast } = useStore();
  return (
    <div className="toasts" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div key={t.id} layout className={cx("toast", t.tone)} onClick={() => dismissToast(t.id)}
            initial={{ opacity: 0, y: 16, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, x: 30, transition: { duration: 0.18 } }}
            transition={{ type: "spring", stiffness: 480, damping: 34 }}>
            {t.tone === "claude" ? <span className="spark big"><Spark size={15} /></span> : t.tone === "error" ? <span className="toast-ic err">!</span> : <span className="toast-ic"><Icon name="check" size={13} /></span>}
            <div>
              <div className="t1">{t.text}</div>
              {t.detail && <div className="t2">{t.detail}</div>}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

const dayLabel = (iso: string) => {
  const d = new Date(iso);
  return isToday(d) ? "Today" : isYesterday(d) ? "Yesterday" : format(d, "EEEE, d MMMM");
};

export function ActivityView() {
  const { version, set } = useStore();
  const [items, setItems] = useState<Activity[]>([]);
  const [more, setMore] = useState(true);

  useEffect(() => {
    api.activity().then((a) => { setItems(a); setMore(a.length >= 80); }).catch(() => {});
  }, [version]);

  const groups = useMemo(() => {
    const out: [string, Activity[]][] = [];
    for (const a of items) {
      const label = dayLabel(a.createdAt);
      if (out.at(-1)?.[0] !== label) out.push([label, []]);
      out.at(-1)![1].push(a);
    }
    return out;
  }, [items]);

  return (
    <div className="page">
      <div className="head"><div><div className="eyebrow">EVERYTHING THAT HAPPENED</div><h1 className="title">Activity</h1></div></div>
      <div className="page-body">
        {items.length === 0 && <div className="empty-note">Nothing yet. Changes to tasks show up here, including Claude's.</div>}
        {groups.map(([label, list]) => (
          <section key={label} className="day">
            <h3>{label}</h3>
            <ol className="timeline wide">
              {list.map((a) => (
                <li key={a.id} className={a.actor}>
                  <span className="t-dot" />
                  {a.actor === "claude" && <span className="spark"><Spark /></span>}
                  {a.taskKey ? (
                    <button className="tid link" onClick={() => a.taskId && set({ openTask: a.taskKey })} disabled={!a.taskId}>{a.taskKey}</button>
                  ) : <span className="tid">·</span>}
                  <span className="act-text">
                    {a.taskTitle && <b>{a.taskTitle}</b>}
                    <span>{a.taskTitle ? " · " : ""}{a.type.startsWith("project_") ? `${a.actor === "claude" ? "Claude" : "You"} ${a.type.replace("project_", "")} project ${(a.data as { name?: string }).name ?? ""}` : describe(a)}</span>
                  </span>
                  <time title={format(new Date(a.createdAt), "d MMM yyyy, HH:mm")}>{format(new Date(a.createdAt), "HH:mm")}</time>
                </li>
              ))}
            </ol>
          </section>
        ))}
        {more && items.length > 0 && (
          <button className="btn ghost load-more" onClick={() => api.activity(items.at(-1)!.id).then((a) => { setItems((x) => [...x, ...a]); setMore(a.length >= 80); })}>
            Load older
          </button>
        )}
      </div>
    </div>
  );
}

export function ArchiveView() {
  const { version, board, run, set } = useStore();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => { api.archivedTasks().then(setTasks).catch(() => {}); }, [version]);

  const shown = tasks.filter((t) => !q.trim() || `${t.key} ${t.title}`.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="page">
      <div className="head">
        <div><div className="eyebrow">OUT OF SIGHT, NOT FORGOTTEN</div><h1 className="title">Archive<em>· {tasks.length}</em></h1></div>
      </div>
      <div className="toolbar">
        <label className="search"><Icon name="search" size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search archived tasks…" /></label>
      </div>
      <div className="page-body">
        {shown.length === 0 && <div className="empty-note">{tasks.length ? "No matches." : "Archived tasks land here. Use “Archive all tasks” on the Done column to tidy up."}</div>}
        <div className="archive-list">
          {shown.map((t) => {
            const project = board?.projects.find((p) => p.id === t.projectId);
            return (
              <div key={t.key} className="archive-row" style={{ ["--acc" as string]: project?.color ?? "#94a3b8" }}>
                <button className="tid link" onClick={() => set({ openTask: t.key })}>{t.key}</button>
                <span className="archive-title" onClick={() => set({ openTask: t.key })}>{t.title}</span>
                <span className="path"><i />{board ? projectPath(board.projects, t.projectId).join(" › ") : ""}</span>
                <span className="muted small">{t.completedAt ? `done ${relativeTime(t.completedAt)}` : `archived ${relativeTime(t.archivedAt!)}`}</span>
                <button className="btn ghost" onClick={() => run(() => api.restoreTask(t.key), `Restored ${t.key}`)}><Icon name="restore" size={14} />Restore</button>
                <ConfirmButton icon="trash" confirmLabel="Sure?" onConfirm={() => run(() => api.deleteTask(t.key), `Deleted ${t.key}`)}>Delete</ConfirmButton>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
