import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { PRIORITIES } from "@shared/types";
import { filtersActive, useStore, useVisibleTasks, type DueFilter } from "../store";
import { cx, PRIORITY_META, projectPath } from "../util";
import { Icon } from "./Icon";
import { MenuItem, Popover, PriorityBars } from "./ui";

const DUE_LABEL: Record<DueFilter, string> = { any: "Any time", overdue: "Overdue", today: "Due today", week: "Due this week", none: "No due date" };

export function BoardHeader() {
  const { board, stats, projectFilter } = useStore();
  const visible = useVisibleTasks();
  if (!board) return null;
  const doneCols = new Set(board.columns.filter((c) => c.isDone).map((c) => c.id));
  const open = visible.filter((t) => !doneCols.has(t.columnId)).length;
  const path = projectFilter != null ? projectPath(board.projects, projectFilter) : null;
  const todayIdx = (new Date().getDay() + 6) % 7;
  const max = Math.max(1, ...(stats?.week ?? [0]));

  return (
    <div className="head">
      <div>
        <div className="eyebrow">{format(new Date(), "EEEE · d MMMM").toUpperCase()}</div>
        <h1 className="title">
          {path ? path[path.length - 1] : "All projects"}
          <em>· {open} open</em>
        </h1>
        {path && path.length > 1 && <div className="crumbs">{path.slice(0, -1).join(" › ")}</div>}
      </div>
      {stats && (
        <div className="stats">
          <div className="stat"><div className="v">{stats.doneToday}</div><div className="l">done today</div></div>
          <div className="stat"><div className="v">{stats.doneThisWeek}</div><div className="l">this week</div></div>
          {stats.overdue > 0 && <div className="stat overdue"><div className="v">{stats.overdue}</div><div className="l">overdue</div></div>}
          <div className="week" title="Tasks completed each day this week">
            <div className="bars">
              {stats.week.map((v, i) => (
                <div key={i} className={cx(i > todayIdx && "future", i === todayIdx && "today")}
                  style={{ height: i > todayIdx ? 5 : 6 + (v / max) * 34 }} title={`${v} done`} />
              ))}
            </div>
            <div className="bars-l">{"MTWTFSS".split("").map((d, i) => <span key={i} className={cx(i === todayIdx && "today")}>{d}</span>)}</div>
          </div>
        </div>
      )}
    </div>
  );
}

export function Toolbar() {
  const s = useStore();
  const searchRef = useRef<HTMLInputElement>(null);
  const prioRef = useRef<HTMLButtonElement>(null);
  const dueRef = useRef<HTMLButtonElement>(null);
  const tagRef = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<"prio" | "due" | "tag" | null>(null);
  const close = () => setMenu(null);

  useEffect(() => {
    const focus = () => searchRef.current?.focus();
    window.addEventListener("orbit:focus-search", focus);
    return () => window.removeEventListener("orbit:focus-search", focus);
  }, []);

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const tags = s.board?.tags ?? [];

  return (
    <div className="toolbar">
      <label className="search">
        <Icon name="search" size={15} />
        <input ref={searchRef} value={s.search} placeholder="Search tasks…" onChange={(e) => s.set({ search: e.target.value })}
          onKeyDown={(e) => e.key === "Escape" && (s.set({ search: "" }), e.currentTarget.blur())} />
        {s.search ? <button className="clear" onClick={() => s.set({ search: "" })}><Icon name="close" size={13} /></button> : <kbd>/</kbd>}
      </label>

      <button ref={prioRef} className={cx("chip", s.priorities.length > 0 && "on")} onClick={() => setMenu(menu === "prio" ? null : "prio")}>
        <Icon name="flag" size={14} />
        {s.priorities.length ? s.priorities.map((p) => PRIORITY_META[p].label).join(", ") : "Priority"}
      </button>
      <Popover anchor={prioRef} open={menu === "prio"} onClose={close}>
        {[...PRIORITIES].reverse().map((p) => (
          <MenuItem key={p} active={s.priorities.includes(p)} onClick={() => s.set({ priorities: toggle(s.priorities, p) })}>
            <span className="menu-prio"><PriorityBars level={PRIORITY_META[p].level} color={PRIORITY_META[p].color} />{PRIORITY_META[p].label}</span>
          </MenuItem>
        ))}
      </Popover>

      <button ref={dueRef} className={cx("chip", s.due !== "any" && "on")} onClick={() => setMenu(menu === "due" ? null : "due")}>
        <Icon name="calendar" size={14} />{s.due === "any" ? "Due" : DUE_LABEL[s.due]}
      </button>
      <Popover anchor={dueRef} open={menu === "due"} onClose={close}>
        {(Object.keys(DUE_LABEL) as DueFilter[]).map((d) => (
          <MenuItem key={d} active={s.due === d} onClick={() => { s.set({ due: d }); close(); }}>{DUE_LABEL[d]}</MenuItem>
        ))}
      </Popover>

      <button ref={tagRef} className={cx("chip", s.tagFilter.length > 0 && "on")} onClick={() => setMenu(menu === "tag" ? null : "tag")}>
        <Icon name="tag" size={14} />
        {s.tagFilter.length ? tags.filter((t) => s.tagFilter.includes(t.id)).map((t) => t.name).join(", ") : "Tags"}
      </button>
      <Popover anchor={tagRef} open={menu === "tag"} onClose={close}>
        <div className="menu-scroll">
          {tags.length === 0 && <div className="menu-empty">No tags yet. Add them on a task.</div>}
          {tags.map((t) => (
            <MenuItem key={t.id} active={s.tagFilter.includes(t.id)} onClick={() => s.set({ tagFilter: toggle(s.tagFilter, t.id) })}>
              <span className="menu-tag"><i style={{ background: t.color }} />{t.name}</span>
            </MenuItem>
          ))}
        </div>
      </Popover>

      {filtersActive(s) && <button className="chip clear-all" onClick={s.clearFilters}><Icon name="close" size={13} />Clear</button>}

      <button className="new" onClick={() => s.set({ newTask: {} })} disabled={!s.board?.projects.some((p) => !p.archivedAt)}
        title={s.board?.projects.length ? "New task" : "Create a project first"}>
        <Icon name="plus" size={15} />New task<kbd>N</kbd>
      </button>
    </div>
  );
}
