import { useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { Column, Project, Tag, Task } from "@shared/types";
import { api } from "../api";
import { useStore } from "../store";
import { cx, SWATCHES } from "../util";
import { Icon } from "./Icon";
import { SortableCard } from "./TaskCard";
import { MenuItem, Popover } from "./ui";

interface Props {
  column: Column;
  columns: Column[];
  droppableId: string;
  keys: string[];
  taskByKey: Map<string, Task>;
  projectById: Map<number, Project>;
  projects: Project[];
  tags: Tag[];
  highlighted: boolean;
  first: boolean;
  last: boolean;
}

export function ColumnView({ column, columns, droppableId, keys, taskByKey, projectById, projects, tags, highlighted, first, last }: Props) {
  const { setNodeRef } = useDroppable({ id: droppableId, data: { type: "column" } });
  const { set, run, board } = useStore();
  const menuRef = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<null | "main" | "color" | "delete">(null);
  const [renaming, setRenaming] = useState(false);
  const [wipEdit, setWipEdit] = useState(false);

  const total = board?.tasks.filter((t) => t.columnId === column.id).length ?? 0;
  const overWip = column.wipLimit != null && total > column.wipLimit;
  const update = (patch: Parameters<typeof api.updateColumn>[1]) => run(() => api.updateColumn(column.id, patch));
  const close = () => setMenu(null);

  return (
    <section className={cx("col", highlighted && "over", overWip && "over-wip")} style={{ ["--c" as string]: column.color }}>
      <header className="col-h">
        <span className="orb" />
        {renaming ? (
          <input className="col-rename" autoFocus defaultValue={column.name} maxLength={40}
            onBlur={(e) => { setRenaming(false); const v = e.target.value.trim(); if (v && v !== column.name) void update({ name: v }); }}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setRenaming(false); }} />
        ) : (
          <span className="col-name" onDoubleClick={() => setRenaming(true)}>{column.name}</span>
        )}
        <span className="cnt">{keys.length !== total ? `${keys.length}/${total}` : total}</span>
        {column.isDone && <span className="done-badge" title="Tasks here count as completed"><Icon name="check" size={10} /></span>}
        <span className="col-actions">
          <button title="Add task here" onClick={() => set({ newTask: { columnId: column.id } })}><Icon name="plus" size={15} /></button>
          <button ref={menuRef} title="Column options" onClick={() => setMenu(menu ? null : "main")}><Icon name="more" size={16} /></button>
        </span>
      </header>

      {column.wipLimit != null && (
        <div className={cx("wip", overWip && "over")}>
          <span className="track"><i style={{ width: `${Math.min(100, (total / column.wipLimit) * 100)}%` }} /></span>
          WIP {total} / {column.wipLimit}
        </div>
      )}
      {wipEdit && (
        <form className="wip-edit" onSubmit={(e) => {
          e.preventDefault();
          const v = Number(new FormData(e.currentTarget).get("wip"));
          setWipEdit(false);
          void update({ wipLimit: v > 0 ? Math.floor(v) : null });
        }}>
          <input name="wip" type="number" min={0} autoFocus defaultValue={column.wipLimit ?? ""} placeholder="Limit (empty = none)"
            onBlur={(e) => e.currentTarget.form?.requestSubmit()} onKeyDown={(e) => e.key === "Escape" && setWipEdit(false)} />
        </form>
      )}

      <Popover anchor={menuRef} open={menu === "main"} onClose={close} align="end" width={230}>
        <MenuItem icon="edit" onClick={() => { close(); setRenaming(true); }}>Rename</MenuItem>
        <MenuItem icon="eye" onClick={() => setMenu("color")}>Color</MenuItem>
        <MenuItem icon="filter" onClick={() => { close(); setWipEdit(true); }}>{column.wipLimit ? "Change WIP limit" : "Set WIP limit"}</MenuItem>
        <MenuItem icon="check" active={column.isDone} onClick={() => { close(); void update({ isDone: !column.isDone }); }}>Counts as done</MenuItem>
        <div className="menu-sep" />
        {!first && <MenuItem icon="left" onClick={() => { close(); void update({ shift: -1 }); }}>Move left</MenuItem>}
        {!last && <MenuItem icon="right" onClick={() => { close(); void update({ shift: 1 }); }}>Move right</MenuItem>}
        {total > 0 && (
          <MenuItem icon="archive" onClick={() => { close(); void run(() => api.archiveColumn(column.id), `Archived ${total} task${total === 1 ? "" : "s"}`); }}>
            Archive all tasks
          </MenuItem>
        )}
        {columns.length > 1 && <MenuItem icon="trash" danger onClick={() => setMenu("delete")}>Delete column…</MenuItem>}
      </Popover>

      <Popover anchor={menuRef} open={menu === "color"} onClose={close} align="end" width={196}>
        <div className="swatches">
          {SWATCHES.map((c) => (
            <button key={c} className={cx("swatch", c === column.color && "on")} style={{ background: c }}
              onClick={() => { close(); void update({ color: c }); }} aria-label={c} />
          ))}
        </div>
      </Popover>

      <Popover anchor={menuRef} open={menu === "delete"} onClose={close} align="end" width={250}>
        <div className="menu-title">Delete “{column.name}”?</div>
        {total === 0 ? (
          <MenuItem icon="trash" danger onClick={() => { close(); void run(() => api.deleteColumn(column.id), `Deleted ${column.name}`); }}>Delete column</MenuItem>
        ) : (
          <>
            <div className="menu-note">Move its {total} task{total === 1 ? "" : "s"} to:</div>
            {columns.filter((c) => c.id !== column.id).map((c) => (
              <MenuItem key={c.id} onClick={() => { close(); void run(() => api.deleteColumn(column.id, c.id), `Deleted ${column.name}`); }}>
                <span className="menu-tag"><i style={{ background: c.color }} />{c.name}</span>
              </MenuItem>
            ))}
          </>
        )}
      </Popover>

      <SortableContext id={droppableId} items={keys} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className="col-body">
          {keys.map((k) => {
            const t = taskByKey.get(k);
            if (!t) return null;
            return <SortableCard key={k} task={t} project={projectById.get(t.projectId)} projects={projects} tags={tags} done={column.isDone} />;
          })}
          {keys.length === 0 && (
            <button className="col-empty" onClick={() => set({ newTask: { columnId: column.id } })}>
              {total > 0 ? "No tasks match the filters" : <><Icon name="plus" size={14} />Add a task</>}
            </button>
          )}
        </div>
      </SortableContext>
    </section>
  );
}
