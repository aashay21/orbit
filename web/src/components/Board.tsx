import { useCallback, useMemo, useRef, useState } from "react";
import {
  closestCenter, DndContext, DragOverlay, getFirstCollision, KeyboardSensor, MeasuringStrategy, PointerSensor,
  pointerWithin, rectIntersection, useSensor, useSensors, type CollisionDetection, type DragEndEvent,
  type DragOverEvent, type DragStartEvent, type DropAnimation, type UniqueIdentifier,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { api } from "../api";
import { useStore, useVisibleTasks } from "../store";
import { CardBody } from "./TaskCard";
import { ColumnView } from "./ColumnView";
import { Icon } from "./Icon";

type Items = Record<string, string[]>; // column droppable id -> task keys

const colId = (id: number) => `col-${id}`;
const isCol = (id: UniqueIdentifier) => String(id).startsWith("col-");
const colNum = (id: string) => Number(id.slice(4));

const dropAnimation: DropAnimation = {
  duration: 260,
  easing: "cubic-bezier(.2,.9,.25,1.15)",
  sideEffects: ({ active }) => {
    active.node.style.opacity = "0";
    return () => { active.node.style.opacity = ""; };
  },
};

export function Board() {
  const { board, moveTask, run } = useStore();
  const [addingCol, setAddingCol] = useState(false);
  const visible = useVisibleTasks();
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [dragItems, setDragItems] = useState<Items | null>(null);
  const origin = useRef<{ col: string; index: number } | null>(null);
  const lastOver = useRef<UniqueIdentifier | null>(null);

  const items: Items = useMemo(() => {
    const out: Items = {};
    for (const c of board?.columns ?? []) out[colId(c.id)] = [];
    for (const t of visible) out[colId(t.columnId)]?.push(t.key);
    return out;
  }, [board, visible]);

  const current = dragItems ?? items;
  const taskByKey = useMemo(() => new Map(board?.tasks.map((t) => [t.key, t]) ?? []), [board]);
  const projectById = useMemo(() => new Map(board?.projects.map((p) => [p.id, p]) ?? []), [board]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const findCol = useCallback((id: UniqueIdentifier, from: Items) =>
    isCol(id) ? String(id) : Object.keys(from).find((c) => from[c].includes(String(id))), []);

  // Multi-column collision: prefer what's under the pointer; inside a column, snap to the nearest card.
  const collision: CollisionDetection = useCallback((args) => {
    const hits = pointerWithin(args);
    const pool = hits.length ? hits : rectIntersection(args);
    let overId = getFirstCollision(pool, "id");
    if (overId != null) {
      if (isCol(overId)) {
        const keys = current[String(overId)] ?? [];
        if (keys.length) {
          overId = closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((c) => keys.includes(String(c.id))) })[0]?.id ?? overId;
        }
      }
      lastOver.current = overId;
      return [{ id: overId }];
    }
    return lastOver.current ? [{ id: lastOver.current }] : [];
  }, [current]);

  const onDragStart = ({ active }: DragStartEvent) => {
    const key = String(active.id);
    const col = findCol(key, items)!;
    origin.current = { col, index: items[col].indexOf(key) };
    setActiveKey(key);
    setDragItems(structuredClone(items));
  };

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over || !dragItems) return;
    const from = findCol(active.id, dragItems);
    const to = findCol(over.id, dragItems);
    if (!from || !to || from === to) return;
    setDragItems((prev) => {
      if (!prev) return prev;
      const src = prev[from].filter((k) => k !== active.id);
      const dst = [...prev[to]];
      const overIndex = isCol(over.id) ? dst.length : dst.indexOf(String(over.id));
      const below = over.rect && active.rect.current.translated && active.rect.current.translated.top > over.rect.top + over.rect.height / 2;
      const at = overIndex < 0 ? dst.length : overIndex + (below ? 1 : 0);
      dst.splice(at, 0, String(active.id));
      return { ...prev, [from]: src, [to]: dst };
    });
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const key = String(active.id);
    const start = origin.current;
    let final = dragItems;
    setActiveKey(null);
    setDragItems(null);
    origin.current = null;
    lastOver.current = null;
    if (!over || !final || !start) return;
    const col = findCol(key, final);
    if (!col) return;
    const overIndex = isCol(over.id) ? -1 : final[col].indexOf(String(over.id));
    const curIndex = final[col].indexOf(key);
    if (overIndex >= 0 && overIndex !== curIndex) final = { ...final, [col]: arrayMove(final[col], curIndex, overIndex) };
    const list = final[col];
    const index = list.indexOf(key);
    if (col === start.col && index === start.index) return;
    void moveTask(key, colNum(col), list[index - 1] ?? null, list[index + 1] ?? null);
  };

  const onDragCancel = () => {
    setActiveKey(null);
    setDragItems(null);
    origin.current = null;
  };

  if (!board) return null;
  const active = activeKey ? taskByKey.get(activeKey) : null;
  const activeDone = active ? board.columns.find((c) => c.id === active.columnId)?.isDone ?? false : false;
  const overCol = activeKey && dragItems ? findCol(activeKey, dragItems) : null;

  return (
    <DndContext sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragOver={onDragOver}
      onDragEnd={onDragEnd} onDragCancel={onDragCancel} measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}>
      <div className="board">
        {board.columns.map((c, i) => (
          <ColumnView key={c.id} column={c} droppableId={colId(c.id)} keys={current[colId(c.id)] ?? []}
            taskByKey={taskByKey} projectById={projectById} projects={board.projects} tags={board.tags}
            highlighted={overCol === colId(c.id) && overCol !== origin.current?.col}
            first={i === 0} last={i === board.columns.length - 1} columns={board.columns} />
        ))}
        {addingCol ? (
          <form className="add-col editing" onSubmit={(e) => {
            e.preventDefault();
            const name = String(new FormData(e.currentTarget).get("name") ?? "").trim();
            setAddingCol(false);
            if (name) void run(() => api.createColumn({ name }), `Added column ${name}`);
          }}>
            <input name="name" autoFocus placeholder="Column name" maxLength={40}
              onBlur={(e) => !e.currentTarget.value.trim() && setAddingCol(false)}
              onKeyDown={(e) => e.key === "Escape" && setAddingCol(false)} />
            <span className="add-col-hint">Enter to add · Esc to cancel</span>
          </form>
        ) : (
          <button className="add-col" onClick={() => setAddingCol(true)}>
            <Icon name="plus" size={16} /><span>Add column</span>
          </button>
        )}
      </div>
      <DragOverlay dropAnimation={dropAnimation}>
        {active && (
          <CardBody task={active} project={projectById.get(active.projectId)} projects={board.projects} tags={board.tags} done={activeDone} lifted />
        )}
      </DragOverlay>
      {board.tasks.length === 0 && board.projects.length > 0 && (
        <div className="board-hint">Press <kbd>N</kbd> or click <b>New task</b> to add your first task.</div>
      )}
    </DndContext>
  );
}
