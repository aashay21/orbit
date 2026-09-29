import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import Markdown from "react-markdown";
import { format, parseISO } from "date-fns";
import { PRIORITIES, type Activity, type Priority, type TaskDetail } from "@shared/types";
import { api } from "../api";
import { useStore } from "../store";
import { cx, dueInfo, inDays, PRIORITY_META, relativeTime, today } from "../util";
import { Icon, Spark } from "./Icon";
import { ConfirmButton, Popover, PriorityBars, ProjectPicker } from "./ui";

export function TaskPanel() {
  const openKey = useStore((s) => s.openTask);
  const set = useStore((s) => s.set);
  const close = () => set({ openTask: null });

  useEffect(() => {
    if (!openKey) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented && !document.querySelector(".popover")) close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  return createPortal(
    <AnimatePresence>
      {openKey && (
        <>
          <motion.div key="scrim" className="panel-scrim" onClick={close}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} />
          <motion.aside key="panel" className="panel" role="dialog" aria-label={`Task ${openKey}`}
            initial={{ x: 60, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 60, opacity: 0, transition: { duration: 0.16 } }}
            transition={{ type: "spring", stiffness: 420, damping: 38 }}>
            <PanelContent taskKey={openKey} onClose={close} />
          </motion.aside>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function PanelContent({ taskKey, onClose }: { taskKey: string; onClose(): void }) {
  const { board, version, run, toast } = useStore();
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let alive = true;
    api.task(taskKey).then((t) => alive && (setTask(t), setMissing(false))).catch(() => alive && setMissing(true));
    return () => { alive = false; };
  }, [taskKey, version]);

  if (missing) return <div className="panel-missing">This task no longer exists. <button className="btn" onClick={onClose}>Close</button></div>;
  if (!task || !board) return <div className="panel-loading" />;

  const project = board.projects.find((p) => p.id === task.projectId);
  const column = board.columns.find((c) => c.id === task.columnId);
  const acc = project?.color ?? "#94a3b8";

  /** Saves a change and shows the server's version of the task. */
  const save = async (fn: () => Promise<TaskDetail>) => {
    const next = await run(fn);
    if (next) setTask(next);
  };
  const patch = (p: Parameters<typeof api.updateTask>[1]) => save(() => api.updateTask(task.key, p));

  return (
    <div className="panel-inner" style={{ ["--acc" as string]: acc }}>
      <div className="panel-glow" />
      <header className="panel-top">
        <span className="tid big">{task.key}</span>
        {task.archivedAt && <span className="pill">Archived</span>}
        {task.lastActor === "claude" && <span className="pill claude"><Spark /> Claude</span>}
        <span className="grow" />
        <button className="icon-btn" title="Copy task ID" onClick={() => { void navigator.clipboard?.writeText(task.key); toast(`Copied ${task.key}`); }}>
          <Icon name="list" size={15} />
        </button>
        <button className="icon-btn" title="Close (Esc)" onClick={onClose}><Icon name="close" size={16} /></button>
      </header>

      <TitleEditor value={task.title} onSave={(title) => patch({ title })} />

      <div className="status-row">
        {board.columns.map((c) => (
          <button key={c.id} className={cx("status", c.id === task.columnId && "on")} style={{ ["--c" as string]: c.color }}
            onClick={() => c.id !== task.columnId && save(() => api.moveTask(task.key, { columnId: c.id }))}>
            <i />{c.name}
          </button>
        ))}
      </div>

      <div className="props">
        <label>Project</label>
        <ProjectPicker projects={board.projects} value={task.projectId} onChange={(projectId) => patch({ projectId })} />

        <label>Priority</label>
        <PrioritySelect value={task.priority} onChange={(priority) => patch({ priority })} />

        <label>Due</label>
        <DueEditor value={task.dueDate} done={!!column?.isDone} onChange={(dueDate) => patch({ dueDate })} />

        <label>Tags</label>
        <TagEditor tagIds={task.tagIds} onChange={(p) => patch(p)} />
      </div>

      <Section title="Description">
        <DescriptionEditor value={task.description} onSave={(description) => patch({ description })} />
      </Section>

      <Section title="Subtasks" aside={task.subtasks.length ? `${task.subtasks.filter((s) => s.done).length}/${task.subtasks.length}` : undefined}>
        <div className="subtasks">
          {task.subtasks.map((s) => (
            <div key={s.id} className={cx("subtask", s.done && "done")}>
              <button className="checkbox" aria-label={s.done ? "Mark not done" : "Mark done"} onClick={() => save(() => api.updateSubtask(s.id, { done: !s.done }))}>
                {s.done && <Icon name="check" size={11} />}
              </button>
              <InlineText value={s.title} onSave={(title) => save(() => api.updateSubtask(s.id, { title }))} />
              <button className="icon-btn subtle" title="Remove" onClick={() => save(() => api.deleteSubtask(s.id))}><Icon name="close" size={13} /></button>
            </div>
          ))}
          <AddLine placeholder="Add a subtask…" onAdd={(title) => save(() => api.addSubtask(task.key, title))} />
        </div>
      </Section>

      <Section title="Notes" aside={task.notes.length ? String(task.notes.length) : undefined}>
        <NoteComposer onAdd={(body) => save(() => api.addNote(task.key, body))} />
        <div className="notes">
          {task.notes.map((n) => (
            <div key={n.id} className={cx("note", n.actor === "claude" && "claude")}>
              <div className="note-h">
                {n.actor === "claude" ? <span className="who claude"><Spark /> Claude</span> : <span className="who">You</span>}
                <span className="when" title={format(new Date(n.createdAt), "d MMM yyyy, HH:mm")}>{relativeTime(n.createdAt)}</span>
                <button className="icon-btn subtle" title="Delete note" onClick={() => save(() => api.deleteNote(n.id))}><Icon name="trash" size={13} /></button>
              </div>
              <div className="md"><Markdown>{n.body}</Markdown></div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="History">
        <ol className="timeline">
          {task.activity.map((a) => <li key={a.id} className={a.actor}><span className="t-dot" /><span>{describe(a)}</span><time>{relativeTime(a.createdAt)}</time></li>)}
        </ol>
      </Section>

      <footer className="panel-foot">
        <span className="muted small">Created {format(new Date(task.createdAt), "d MMM yyyy")} · updated {relativeTime(task.updatedAt)}</span>
        <span className="grow" />
        {task.archivedAt ? (
          <button className="btn ghost" onClick={() => save(() => api.restoreTask(task.key))}><Icon name="restore" size={15} />Restore</button>
        ) : (
          <button className="btn ghost" onClick={() => save(() => api.archiveTask(task.key))}><Icon name="archive" size={15} />Archive</button>
        )}
        <ConfirmButton icon="trash" confirmLabel="Delete forever?" onConfirm={async () => {
          await run(() => api.deleteTask(task.key), `Deleted ${task.key}`);
          onClose();
        }}>Delete</ConfirmButton>
      </footer>
    </div>
  );
}

export function describe(a: Activity): string {
  const who = a.actor === "claude" ? "Claude" : a.actor === "system" ? "Orbit" : "You";
  const d = a.data as Record<string, any>;
  switch (a.type) {
    case "created": return `${who} created this in ${d.column}`;
    case "moved": return `${who} moved it from ${d.from} to ${d.to}`;
    case "completed": return `${who} completed it (${d.from} → ${d.to})`;
    case "reopened": return `${who} reopened it (${d.from} → ${d.to})`;
    case "archived": return `${who} archived it`;
    case "restored": return `${who} restored it`;
    case "deleted": return `${who} deleted it`;
    case "note": return `${who} added a note`;
    case "subtask_added": return `${who} added subtask “${d.title}”`;
    case "subtask_done": return `${who} checked off “${d.title}”`;
    case "subtask_reopened": return `${who} unchecked “${d.title}”`;
    case "updated": {
      const parts: string[] = [];
      if (d.title) parts.push("renamed it");
      if (d.priority) parts.push(`set priority to ${PRIORITY_META[d.priority[1] as Priority]?.label ?? d.priority[1]}`);
      if (d.dueDate) parts.push(d.dueDate[1] ? `set due date to ${format(parseISO(d.dueDate[1]), "d MMM")}` : "cleared the due date");
      if (d.project) parts.push(`moved it to ${d.project[1]}`);
      if (d.tags) parts.push("changed tags");
      if (d.description) parts.push("edited the description");
      return `${who} ${parts.join(", ") || "updated it"}`;
    }
    default: return `${who} ${a.type.replace(/_/g, " ")}`;
  }
}

function Section({ title, aside, children }: { title: string; aside?: string; children: ReactNode }) {
  return (
    <section className="panel-sec">
      <h3>{title}{aside && <span>{aside}</span>}</h3>
      {children}
    </section>
  );
}

function TitleEditor({ value, onSave }: { value: string; onSave(v: string): void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    const el = ref.current;
    if (el) { el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; }
  }, [draft]);
  return (
    <textarea ref={ref} className="title-edit" value={draft} rows={1} maxLength={300}
      onChange={(e) => setDraft(e.target.value.replace(/\n/g, ""))}
      onBlur={() => { const v = draft.trim(); if (v && v !== value) onSave(v); else setDraft(value); }}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } if (e.key === "Escape") { setDraft(value); e.currentTarget.blur(); e.preventDefault(); } }} />
  );
}

function InlineText({ value, onSave }: { value: string; onSave(v: string): void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input className="inline-text" value={draft} onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { const v = draft.trim(); if (v && v !== value) onSave(v); else setDraft(value); }}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setDraft(value); e.preventDefault(); } }} />
  );
}

function AddLine({ placeholder, onAdd }: { placeholder: string; onAdd(v: string): void }) {
  const [v, setV] = useState("");
  return (
    <form className="add-line" onSubmit={(e) => { e.preventDefault(); if (v.trim()) { onAdd(v.trim()); setV(""); } }}>
      <Icon name="plus" size={14} />
      <input value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} maxLength={300} />
    </form>
  );
}

function PrioritySelect({ value, onChange }: { value: Priority; onChange(p: Priority): void }) {
  return (
    <div className="prio-select" role="radiogroup">
      {PRIORITIES.map((p) => {
        const m = PRIORITY_META[p];
        return (
          <button key={p} role="radio" aria-checked={p === value} className={cx(p === value && "on")} style={{ ["--p" as string]: m.color }}
            onClick={() => p !== value && onChange(p)} title={m.label}>
            {m.level > 0 ? <PriorityBars level={m.level} color={m.color} /> : <span className="none-dash">—</span>}
            <span>{m.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function DueEditor({ value, done, onChange }: { value: string | null; done?: boolean; onChange(v: string | null): void }) {
  const info = value ? dueInfo(value, done) : null;
  const quick: [string, string][] = [["Today", today()], ["Tomorrow", inDays(1)], ["In a week", inDays(7)]];
  return (
    <div className="due-edit">
      <label className={cx("date-field", info?.state)}>
        <Icon name="calendar" size={14} />
        <span>{info ? info.label : "No due date"}</span>
        <input type="date" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} />
      </label>
      {quick.map(([label, d]) => d !== value && <button key={label} className="mini-btn" onClick={() => onChange(d)}>{label}</button>)}
      {value && <button className="mini-btn" onClick={() => onChange(null)}>Clear</button>}
    </div>
  );
}

export function TagEditor({ tagIds, onChange }: { tagIds: number[]; onChange(p: { tagIds?: number[]; tags?: string[] }): void }) {
  const tags = useStore((s) => s.board?.tags ?? []);
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const selected = tags.filter((t) => tagIds.includes(t.id));
  const matches = tags.filter((t) => t.name.toLowerCase().includes(q.trim().toLowerCase()));
  const exact = tags.some((t) => t.name.toLowerCase() === q.trim().toLowerCase());
  const toggle = (id: number) => onChange({ tagIds: tagIds.includes(id) ? tagIds.filter((x) => x !== id) : [...tagIds, id] });
  return (
    <div className="tag-edit">
      {selected.map((t) => (
        <span key={t.id} className="tag big" style={{ ["--t" as string]: t.color }}>
          {t.name}<button aria-label={`Remove ${t.name}`} onClick={() => toggle(t.id)}><Icon name="close" size={11} /></button>
        </span>
      ))}
      <button ref={ref} className="mini-btn" onClick={() => setOpen((o) => !o)}><Icon name="plus" size={12} />Tag</button>
      <Popover anchor={ref} open={open} onClose={() => { setOpen(false); setQ(""); }} width={230}>
        <form onSubmit={(e) => {
          e.preventDefault();
          const name = q.trim();
          if (!name) return;
          const hit = tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
          if (hit) toggle(hit.id); else onChange({ tagIds, tags: [name] });
          setQ("");
        }}>
          <input className="menu-input" autoFocus value={q} placeholder="Find or create a tag…" onChange={(e) => setQ(e.target.value)} maxLength={40} />
        </form>
        <div className="menu-scroll">
          {matches.map((t) => (
            <button key={t.id} className={cx("menu-item", tagIds.includes(t.id) && "active")} onClick={() => toggle(t.id)}>
              <span className="menu-tag"><i style={{ background: t.color }} />{t.name}</span>
              {tagIds.includes(t.id) && <Icon name="check" size={14} className="menu-check" />}
            </button>
          ))}
          {q.trim() && !exact && <div className="menu-empty">Press Enter to create “{q.trim()}”</div>}
          {!q && tags.length === 0 && <div className="menu-empty">Type to create your first tag</div>}
        </div>
      </Popover>
    </div>
  );
}

function DescriptionEditor({ value, onSave }: { value: string; onSave(v: string): void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);
  if (!editing) {
    return (
      <div className={cx("desc", !value && "empty")} onClick={(e) => (e.target as HTMLElement).tagName !== "A" && setEditing(true)} role="button" tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && setEditing(true)}>
        {value ? <div className="md"><Markdown>{value}</Markdown></div> : "Add details, links, acceptance criteria… (Markdown supported)"}
      </div>
    );
  }
  const finish = () => { setEditing(false); if (draft !== value) onSave(draft); };
  return (
    <div className="desc-edit">
      <textarea autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} rows={Math.min(18, Math.max(5, draft.split("\n").length + 1))}
        onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); setDraft(value); setEditing(false); } if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) finish(); }} />
      <div className="desc-actions">
        <span className="muted small">Markdown · Ctrl+Enter to save · Esc to cancel</span>
        <button className="btn ghost" onClick={() => { setDraft(value); setEditing(false); }}>Cancel</button>
        <button className="btn primary" onClick={finish}>Save</button>
      </div>
    </div>
  );
}

function NoteComposer({ onAdd }: { onAdd(body: string): void }) {
  const [v, setV] = useState("");
  const submit = () => { if (v.trim()) { onAdd(v.trim()); setV(""); } };
  return (
    <div className="note-compose">
      <textarea value={v} placeholder="Write a note… (Ctrl+Enter to add)" rows={v ? 3 : 1} onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && (e.ctrlKey || e.metaKey) && (e.preventDefault(), submit())} />
      {v.trim() && <button className="btn primary" onClick={submit}>Add note</button>}
    </div>
  );
}
