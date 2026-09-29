import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { remember, useStore, type View } from "../store";
import { setTheme } from "../theme";
import { cx, descendantIds, projectTree, type ProjectNode } from "../util";
import { Icon } from "./Icon";

const NAV: { view: View; icon: string; label: string; key: string }[] = [
  { view: "board", icon: "board", label: "Board", key: "B" },
  { view: "activity", icon: "activity", label: "Activity", key: "A" },
  { view: "archive", icon: "archive", label: "Archive", key: "" },
];

export function Sidebar() {
  const { board, view, projectFilter, themePref, set } = useStore();
  const [showArchived, setShowArchived] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set());

  const tree = useMemo(() => (board ? projectTree(board.projects) : []), [board]);
  const archived = useMemo(() => board?.projects.filter((p) => p.archivedAt && (p.parentId == null || !board.projects.find((q) => q.id === p.parentId)?.archivedAt)) ?? [], [board]);

  // Open (not-done) task counts per project, including nested projects.
  const counts = useMemo(() => {
    const out = new Map<number, number>();
    if (!board) return out;
    const doneCols = new Set(board.columns.filter((c) => c.isDone).map((c) => c.id));
    for (const p of board.projects) {
      const ids = descendantIds(board.projects, p.id);
      out.set(p.id, board.tasks.filter((t) => ids.has(t.projectId) && !doneCols.has(t.columnId)).length);
    }
    return out;
  }, [board]);

  const go = (v: View) => {
    set({ view: v });
    remember("orbit.view", v);
  };
  const filter = (id: number | null) => {
    set({ projectFilter: id, view: view === "board" ? view : "board" });
    remember("orbit.projectFilter", id);
    remember("orbit.view", "board");
  };

  const renderNode = (n: ProjectNode) => {
    const isOpen = !collapsed.has(n.id);
    return (
      <div key={n.id} className="tree-node">
        <div className={cx(n.depth === 0 ? "proj" : "sub", projectFilter === n.id && "selected")} style={{ ["--acc" as string]: n.color }}
          onClick={() => filter(projectFilter === n.id ? null : n.id)} role="button" tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && filter(n.id)}>
          {n.children.length > 0 ? (
            <button className={cx("twisty", isOpen && "open")} aria-label={isOpen ? "Collapse" : "Expand"}
              onClick={(e) => { e.stopPropagation(); setCollapsed((s) => { const c = new Set(s); if (c.has(n.id)) c.delete(n.id); else c.add(n.id); return c; }); }}>
              <Icon name="chevron" size={11} />
            </button>
          ) : <span className="twisty-space" />}
          <span className={n.depth === 0 ? "dot" : "ring-dot"} />
          <span className="name">{n.name}</span>
          <span className="row-actions">
            <button title="Add subproject" onClick={(e) => { e.stopPropagation(); set({ projectDialog: { mode: "create", parentId: n.id } }); }}><Icon name="plus" size={13} /></button>
            <button title="Edit project" onClick={(e) => { e.stopPropagation(); set({ projectDialog: { mode: "edit", id: n.id } }); }}><Icon name="edit" size={13} /></button>
          </span>
          <span className="n">{counts.get(n.id) || ""}</span>
        </div>
        <AnimatePresence initial={false}>
          {n.children.length > 0 && isOpen && (
            <motion.div className="subs" style={{ ["--acc" as string]: n.color }}
              initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.3, 0.7, 0.2, 1] }}>
              {n.children.map(renderNode)}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  return (
    <aside className="side">
      <div className="logo"><span className="logo-orb" /><span>Orbit</span></div>

      <nav className="nav">
        {NAV.map((n) => (
          <button key={n.view} className={cx(view === n.view && "active")} onClick={() => go(n.view)}>
            <Icon name={n.icon} />{n.label}{n.key && <span className="k">{n.key}</span>}
          </button>
        ))}
        <button disabled title="Coming in phase 3"><Icon name="report" />Reports<span className="k soon">soon</span></button>
      </nav>

      <div className="side-projects">
        <div className="sec">
          <span>PROJECTS</span>
          <button title="New project" onClick={() => set({ projectDialog: { mode: "create" } })}><Icon name="plus" size={14} /></button>
        </div>
        <div className="tree">
          <div className={cx("proj all", projectFilter == null && "selected")} onClick={() => filter(null)} role="button" tabIndex={0}>
            <span className="twisty-space" />
            <span className="all-dots">{tree.slice(0, 4).map((p) => <i key={p.id} style={{ background: p.color }} />)}</span>
            <span className="name">All projects</span>
          </div>
          {tree.map(renderNode)}
          {tree.length === 0 && (
            <button className="side-empty" onClick={() => set({ projectDialog: { mode: "create" } })}>
              <Icon name="plus" size={14} /> Create your first project
            </button>
          )}
        </div>
        {archived.length > 0 && (
          <div className="archived-projects">
            <button className="sec-toggle" onClick={() => setShowArchived((s) => !s)}>
              <Icon name="chevron" size={11} className={cx("twisty-ic", showArchived && "open")} /> Archived ({archived.length})
            </button>
            {showArchived && archived.map((p) => (
              <div key={p.id} className="proj archived" style={{ ["--acc" as string]: p.color }}
                onClick={() => set({ projectDialog: { mode: "edit", id: p.id } })} role="button" tabIndex={0}>
                <span className="twisty-space" /><span className="dot" /><span className="name">{p.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="side-foot">
        <div className="theme-switch" role="radiogroup" aria-label="Theme">
          {(["night", "dawn", "auto"] as const).map((t) => (
            <button key={t} role="radio" aria-checked={themePref === t} className={cx(themePref === t && "on")}
              title={t === "night" ? "Night" : t === "dawn" ? "Dawn" : "Match system"}
              onClick={(e) => setTheme(t, { x: e.clientX, y: e.clientY })}>
              <Icon name={t === "night" ? "moon" : t === "dawn" ? "sun" : "auto"} size={15} />
              <span>{t === "night" ? "Night" : t === "dawn" ? "Dawn" : "Auto"}</span>
            </button>
          ))}
        </div>
        <button className="palette-hint" onClick={() => set({ paletteOpen: true })}>
          <Icon name="command" size={14} /> Command palette <kbd>Ctrl K</kbd>
        </button>
      </div>
    </aside>
  );
}
