import { useEffect, useMemo, useState } from "react";
import { PRIORITIES, type Priority, type Recurrence } from "@shared/types";
import { RecurrenceEditor } from "./RecurrenceEditor";
import { RemindEditor } from "./RemindEditor";
import { api } from "../api";
import { remember, useStore } from "../store";
import { cx, descendantIds, PRIORITY_META, SWATCHES } from "../util";
import { Icon } from "./Icon";
import { DueEditor, TagEditor } from "./TaskPanel";
import { ConfirmButton, Modal, PriorityBars, ProjectPicker } from "./ui";

export function NewTaskDialog() {
  const { newTask, board, projectFilter, set, run } = useStore();
  const open = newTask != null;
  const close = () => set({ newTask: null });

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState<number | null>(null);
  const [columnId, setColumnId] = useState<number | null>(null);
  const [priority, setPriority] = useState<Priority>("none");
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [tagIds, setTagIds] = useState<number[]>([]);
  const [newTags, setNewTags] = useState<string[]>([]);
  const [recurrence, setRecurrence] = useState<Recurrence | null>(null);
  const [remindAt, setRemindAt] = useState<string | null>(null);
  const [another, setAnother] = useState(false);

  // Reset the form each time it opens, defaulting to the filtered or last-used project.
  useEffect(() => {
    if (!open || !board) return;
    const live = board.projects.filter((p) => !p.archivedAt);
    let last: number | null = null;
    try { last = JSON.parse(localStorage.getItem("orbit.lastProject") ?? "null"); } catch { /* ignore */ }
    const pick = [projectFilter, last].find((id) => id != null && live.some((p) => p.id === id)) ?? live[0]?.id ?? null;
    setTitle(""); setDescription(""); setPriority("none"); setDueDate(null); setTagIds([]); setNewTags([]); setRecurrence(null); setRemindAt(null);
    setProjectId(pick);
    setColumnId(newTask?.columnId ?? board.columns[0]?.id ?? null);
  }, [open]);

  const submit = async (keepOpen: boolean) => {
    if (!title.trim() || projectId == null) return;
    remember("orbit.lastProject", projectId);
    const t = await run(() => api.createTask({
      title: title.trim(), description, projectId, columnId: columnId ?? undefined, priority, dueDate, tagIds, tags: newTags, recurrence, remindAt,
    }));
    if (!t) return;
    useStore.getState().toast(`Created ${t.key}`, "info", t.title);
    if (keepOpen) { setTitle(""); setDescription(""); }
    else close();
  };

  if (!board) return null;
  const allTags = [...tagIds];
  return (
    <Modal open={open} onClose={close} label="New task" className="new-task">
      <div className="modal-h">
        <span className="eyebrow">NEW TASK</span>
        <button className="icon-btn" onClick={close} aria-label="Close"><Icon name="close" size={16} /></button>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); void submit(another); }}>
        <input className="big-input" autoFocus value={title} placeholder="What needs doing?" maxLength={300}
          onChange={(e) => setTitle(e.target.value)} />
        <textarea className="soft-input" value={description} placeholder="Details (optional, Markdown)" rows={3}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.ctrlKey || e.metaKey) && (e.preventDefault(), void submit(another))} />

        <div className="props">
          <label>Project</label>
          <ProjectPicker projects={board.projects} value={projectId} onChange={setProjectId} />
          <label>Column</label>
          <div className="status-row compact">
            {board.columns.map((c) => (
              <button type="button" key={c.id} className={cx("status", c.id === columnId && "on")} style={{ ["--c" as string]: c.color }} onClick={() => setColumnId(c.id)}>
                <i />{c.name}
              </button>
            ))}
          </div>
          <label>Priority</label>
          <div className="prio-select">
            {PRIORITIES.map((p) => (
              <button type="button" key={p} className={cx(p === priority && "on")} style={{ ["--p" as string]: PRIORITY_META[p].color }} onClick={() => setPriority(p)}>
                {PRIORITY_META[p].level > 0 ? <PriorityBars level={PRIORITY_META[p].level} color={PRIORITY_META[p].color} /> : <span className="none-dash">—</span>}
                <span>{PRIORITY_META[p].label}</span>
              </button>
            ))}
          </div>
          <label>Due</label>
          <DueEditor value={dueDate} onChange={setDueDate} />
          <label>Remind me</label>
          <RemindEditor value={remindAt} dueDate={dueDate} onChange={setRemindAt} />
          <label>Repeat</label>
          <RecurrenceEditor value={recurrence} dueDate={dueDate} onChange={setRecurrence} />
          <label>Tags</label>
          <div className="tag-edit-wrap">
            <TagEditor tagIds={allTags} onChange={(p) => { if (p.tagIds) setTagIds(p.tagIds); if (p.tags) setNewTags((n) => [...new Set([...n, ...p.tags!])]); }} />
            {newTags.map((n) => (
              <span key={n} className="tag big new">{n}<button type="button" onClick={() => setNewTags((x) => x.filter((y) => y !== n))}><Icon name="close" size={11} /></button></span>
            ))}
          </div>
        </div>

        <div className="modal-foot">
          <label className="toggle">
            <input type="checkbox" checked={another} onChange={(e) => setAnother(e.target.checked)} />
            <span className="toggle-ui" />Create another
          </label>
          <span className="grow" />
          <button type="button" className="btn ghost" onClick={close}>Cancel</button>
          <button type="submit" className="btn primary" disabled={!title.trim() || projectId == null}>Create task <kbd>Enter</kbd></button>
        </div>
      </form>
    </Modal>
  );
}

export function ProjectDialog() {
  const { projectDialog, board, set, run } = useStore();
  const open = projectDialog != null;
  const close = () => set({ projectDialog: null });
  const editing = projectDialog?.mode === "edit" ? board?.projects.find((p) => p.id === projectDialog.id) : undefined;

  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [color, setColor] = useState(SWATCHES[0]);
  const [parentId, setParentId] = useState<number | null>(null);
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!open || !board) return;
    if (editing) {
      setName(editing.name); setKey(editing.key ?? ""); setColor(editing.color); setParentId(editing.parentId); setDescription(editing.description);
    } else {
      const parent = projectDialog?.mode === "create" ? projectDialog.parentId ?? null : null;
      const pc = board.projects.find((p) => p.id === parent)?.color;
      const roots = board.projects.filter((p) => p.parentId == null).length;
      setName(""); setKey(""); setParentId(parent); setDescription("");
      setColor(pc ?? SWATCHES[roots % 8]);
    }
  }, [open, editing?.id]);

  // Parent candidates: anything except this project and its descendants.
  const parentOptions = useMemo(() => {
    if (!board) return [];
    const banned = editing ? descendantIds(board.projects, editing.id) : new Set<number>();
    return board.projects.filter((p) => !banned.has(p.id) && !p.archivedAt);
  }, [board, editing]);

  if (!board) return null;
  const isRoot = parentId == null;
  const suggested = name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3);
  const taskCount = editing ? board.tasks.filter((t) => descendantIds(board.projects, editing.id).has(t.projectId)).length : 0;

  const submit = async () => {
    if (!name.trim()) return;
    const payload = { name: name.trim(), color, description, parentId, key: isRoot && key.trim() ? key.trim() : undefined };
    const ok = await run(() => (editing ? api.updateProject(editing.id, payload) : api.createProject(payload)), editing ? `Saved ${name.trim()}` : `Created ${name.trim()}`);
    if (ok) close();
  };

  return (
    <Modal open={open} onClose={close} label={editing ? "Edit project" : "New project"} className="project-dialog">
      <div className="modal-h">
        <span className="eyebrow">{editing ? "EDIT PROJECT" : parentId ? "NEW SUBPROJECT" : "NEW PROJECT"}</span>
        <button className="icon-btn" onClick={close} aria-label="Close"><Icon name="close" size={16} /></button>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} style={{ ["--acc" as string]: color }}>
        <div className="proj-name-row">
          <span className="dot big" />
          <input className="big-input" autoFocus value={name} placeholder="Project name" maxLength={80} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="props">
          <label>Parent</label>
          <div className="parent-row">
            <ProjectPicker projects={parentOptions} value={parentId} onChange={setParentId} placeholder="None (top level)" />
            {parentId != null && <button type="button" className="mini-btn" onClick={() => setParentId(null)}>Make top level</button>}
          </div>
          {isRoot && (
            <>
              <label>Task prefix</label>
              <div className="key-row">
                <input className="key-input" value={key} placeholder={editing?.key ?? (suggested.length >= 2 ? suggested : "ABC")} maxLength={6}
                  onChange={(e) => setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} />
                <span className="muted small">Tasks will be numbered like <b className="tid">{(key || editing?.key || (suggested.length >= 2 ? suggested : "ABC"))}-1</b>{editing ? " (existing IDs never change)" : ""}</span>
              </div>
            </>
          )}
          <label>Color</label>
          <div className="swatches inline">
            {SWATCHES.map((c) => (
              <button type="button" key={c} className={cx("swatch", c === color && "on")} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />
            ))}
          </div>
          <label>About</label>
          <textarea className="soft-input" value={description} rows={2} placeholder="What is this project for? (optional)" onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="modal-foot">
          {editing && (
            <>
              <button type="button" className="btn ghost" onClick={async () => {
                const ok = await run(() => api.updateProject(editing.id, { archived: !editing.archivedAt }), editing.archivedAt ? `Restored ${editing.name}` : `Archived ${editing.name}`);
                if (ok) close();
              }}>
                <Icon name={editing.archivedAt ? "restore" : "archive"} size={15} />{editing.archivedAt ? "Restore" : "Archive"}
              </button>
              {taskCount === 0 && (
                <ConfirmButton icon="trash" confirmLabel="Delete project?" onConfirm={async () => {
                  await run(() => api.deleteProject(editing.id), `Deleted ${editing.name}`);
                  close();
                }}>Delete</ConfirmButton>
              )}
            </>
          )}
          <span className="grow" />
          <button type="button" className="btn ghost" onClick={close}>Cancel</button>
          <button type="submit" className="btn primary" disabled={!name.trim()}>{editing ? "Save" : "Create project"}</button>
        </div>
      </form>
    </Modal>
  );
}
