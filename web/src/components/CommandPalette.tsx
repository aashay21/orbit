import { Command } from "cmdk";
import { AnimatePresence, motion } from "motion/react";
import { createPortal } from "react-dom";
import { remember, useStore } from "../store";
import { setTheme } from "../theme";
import { flattenTree, projectTree } from "../util";
import { Icon } from "./Icon";

export function CommandPalette() {
  const { paletteOpen, board, set } = useStore();
  const close = () => set({ paletteOpen: false });
  const act = (fn: () => void) => () => { close(); fn(); };

  return createPortal(
    <AnimatePresence>
      {paletteOpen && board && (
        <motion.div className="modal-scrim palette-scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
          <motion.div initial={{ opacity: 0, y: -12, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 520, damping: 34 }}>
            <Command className="palette" label="Command palette" loop
              onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); close(); } }}>
              <div className="palette-input"><Icon name="search" size={16} /><Command.Input autoFocus placeholder="Type a command, task ID or title…" /></div>
              <Command.List>
                <Command.Empty>Nothing found.</Command.Empty>
                <Command.Group heading="Actions">
                  {board.projects.length > 0 && <Command.Item onSelect={act(() => set({ newTask: {} }))}><Icon name="plus" />New task<kbd>N</kbd></Command.Item>}
                  <Command.Item onSelect={act(() => set({ projectDialog: { mode: "create" } }))}><Icon name="folder" />New project</Command.Item>
                  <Command.Item onSelect={act(() => { set({ view: "board" }); remember("orbit.view", "board"); })}><Icon name="board" />Go to board<kbd>B</kbd></Command.Item>
                  <Command.Item onSelect={act(() => { set({ view: "reports" }); remember("orbit.view", "reports"); })}><Icon name="report" />Go to reports<kbd>R</kbd></Command.Item>
                  <Command.Item onSelect={act(() => { set({ view: "activity" }); remember("orbit.view", "activity"); })}><Icon name="activity" />Go to activity<kbd>A</kbd></Command.Item>
                  <Command.Item onSelect={act(() => { set({ view: "archive" }); remember("orbit.view", "archive"); })}><Icon name="archive" />Go to archive</Command.Item>
                  <Command.Item onSelect={act(() => { set({ view: "settings" }); remember("orbit.view", "settings"); })}><Icon name="gear" />Settings: notifications</Command.Item>
                  <Command.Item onSelect={act(() => setTheme("night"))}><Icon name="moon" />Theme: Night</Command.Item>
                  <Command.Item onSelect={act(() => setTheme("dawn"))}><Icon name="sun" />Theme: Dawn</Command.Item>
                  <Command.Item onSelect={act(() => setTheme("auto"))}><Icon name="auto" />Theme: Match system</Command.Item>
                  <Command.Item onSelect={act(() => { window.location.href = "/api/export"; })}><Icon name="download" />Export all data (JSON)</Command.Item>
                </Command.Group>
                {board.projects.length > 0 && (
                  <Command.Group heading="Show project">
                    <Command.Item value="show all projects" onSelect={act(() => { set({ projectFilter: null, view: "board" }); remember("orbit.projectFilter", null); })}>
                      <Icon name="board" />All projects
                    </Command.Item>
                    {flattenTree(projectTree(board.projects)).map((p) => (
                      <Command.Item key={p.id} value={`project ${p.name} ${p.id}`} onSelect={act(() => { set({ projectFilter: p.id, view: "board" }); remember("orbit.projectFilter", p.id); })}>
                        <span className={p.depth ? "ring-dot" : "dot"} style={{ ["--acc" as string]: p.color, marginLeft: p.depth * 14 }} />{p.name}
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}
                {board.tasks.length > 0 && (
                  <Command.Group heading="Tasks">
                    {board.tasks.map((t) => (
                      <Command.Item key={t.key} value={`${t.key} ${t.title}`} onSelect={act(() => set({ openTask: t.key }))}>
                        <span className="tid" style={{ ["--acc" as string]: board.projects.find((p) => p.id === t.projectId)?.color }}>{t.key}</span>
                        <span className="palette-task">{t.title}</span>
                        <span className="palette-col">{board.columns.find((c) => c.id === t.columnId)?.name}</span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}
              </Command.List>
            </Command>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
