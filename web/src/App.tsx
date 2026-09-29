import { useEffect } from "react";
import { motion } from "motion/react";
import type { ChangeEvent } from "@shared/types";
import { clientId } from "./api";
import { remember, useStore } from "./store";
import { cycleTheme, useSystemTheme } from "./theme";
import { isTyping } from "./util";
import { Board } from "./components/Board";
import { BoardHeader, Toolbar } from "./components/BoardHeader";
import { CommandPalette } from "./components/CommandPalette";
import { NewTaskDialog, ProjectDialog } from "./components/Dialogs";
import { Sidebar } from "./components/Sidebar";
import { Sky } from "./components/Sky";
import { TaskPanel } from "./components/TaskPanel";
import { ActivityView, ArchiveView, Toasts } from "./components/Views";
import { ReportsView } from "./components/ReportsView";
import { SettingsView } from "./components/SettingsView";
import { Icon } from "./components/Icon";

/** Keeps the board in sync with changes made elsewhere (other tabs, Claude Code). */
function useLiveUpdates() {
  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      es = new EventSource("/api/events");
      es.addEventListener("change", (m) => {
        const ev = JSON.parse((m as MessageEvent).data) as ChangeEvent;
        if (ev.clientId === clientId) return;
        const s = useStore.getState();
        void s.load();
        if (ev.actor === "claude") s.toast(`Claude: ${ev.summary}`, "claude");
      });
      // Reconnect after the server restarts, then catch up on anything missed.
      es.onerror = () => {
        es?.close();
        retry = setTimeout(() => { connect(); void useStore.getState().load(); }, 2000);
      };
    };
    connect();
    return () => { es?.close(); clearTimeout(retry); };
  }, []);
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        s.set({ paletteOpen: !s.paletteOpen });
        return;
      }
      const busy = s.paletteOpen || s.newTask || s.projectDialog || s.openTask;
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || busy) return;
      const go = (view: "board" | "activity" | "reports") => { s.set({ view }); remember("orbit.view", view); };
      switch (e.key) {
        case "n": if (s.board?.projects.some((p) => !p.archivedAt)) { e.preventDefault(); s.set({ newTask: {} }); } break;
        case "p": e.preventDefault(); s.set({ projectDialog: { mode: "create" } }); break;
        case "/": e.preventDefault(); go("board"); setTimeout(() => window.dispatchEvent(new Event("orbit:focus-search"))); break;
        case "t": cycleTheme(); break;
        case "b": go("board"); break;
        case "a": go("activity"); break;
        case "r": go("reports"); break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

function EmptySky() {
  const set = useStore((s) => s.set);
  return (
    <motion.div className="empty-sky" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.3, 0.7, 0.2, 1] }}>
      <div className="empty-orb" />
      <h2>Your sky is empty</h2>
      <p>Start with a project, like a client, a product or a part of your life. You can nest subprojects inside it and track every task on one board.</p>
      <button className="new" onClick={() => set({ projectDialog: { mode: "create" } })}><Icon name="plus" size={15} />Create your first project</button>
    </motion.div>
  );
}

export function App() {
  const { board, view, load } = useStore();
  useSystemTheme();
  useLiveUpdates();
  useShortcuts();

  // Links from Teams cards: /?task=INF-3 opens that task, /?view=reports opens a view.
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const task = q.get("task");
    const v = q.get("view");
    if (v && ["board", "reports", "activity", "archive", "settings"].includes(v)) useStore.getState().set({ view: v as never });
    if (task) useStore.getState().set({ openTask: task.toUpperCase() });
    if (task || v) history.replaceState(null, "", "/");
  }, []);

  useEffect(() => {
    void load();
    // Refresh date-dependent bits (overdue, stats) when the window regains focus.
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  return (
    <div className="app">
      <Sky />
      <Sidebar />
      <main className="main">
        {!board ? (
          <div className="booting"><div className="empty-orb small" /></div>
        ) : (
          // Entry-only animation: switching views never waits on an exit animation.
          <motion.div key={view} className="view" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}>
              {view === "board" && (board.projects.length === 0 ? <EmptySky /> : <><BoardHeader /><Toolbar /><Board /></>)}
              {view === "activity" && <ActivityView />}
              {view === "archive" && <ArchiveView />}
              {view === "reports" && <ReportsView />}
              {view === "settings" && <SettingsView />}
          </motion.div>
        )}
      </main>
      <TaskPanel />
      <NewTaskDialog />
      <ProjectDialog />
      <CommandPalette />
      <Toasts />
    </div>
  );
}
