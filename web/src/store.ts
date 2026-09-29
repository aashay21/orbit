import { create } from "zustand";
import type { Board, Priority, Stats, Task } from "@shared/types";
import { api, ApiError } from "./api";
import { descendantIds, inDays, today } from "./util";

export type View = "board" | "archive" | "activity" | "reports" | "settings";
export type ThemePref = "night" | "dawn" | "auto";
export type DueFilter = "any" | "overdue" | "today" | "week" | "none";

export interface Toast {
  id: number;
  text: string;
  tone: "info" | "error" | "claude";
  detail?: string;
}

type ProjectDialog = { mode: "create"; parentId?: number | null } | { mode: "edit"; id: number } | null;

interface State {
  board: Board | null;
  stats: Stats | null;
  /** Bumped after every board load; detail views watch it to refetch. */
  version: number;
  view: View;
  projectFilter: number | null;
  search: string;
  priorities: Priority[];
  due: DueFilter;
  tagFilter: number[];
  blockedOnly: boolean;
  openTask: string | null;
  newTask: { columnId?: number } | null;
  projectDialog: ProjectDialog;
  paletteOpen: boolean;
  themePref: ThemePref;
  toasts: Toast[];

  load(): Promise<void>;
  set(p: Partial<State>): void;
  toast(text: string, tone?: Toast["tone"], detail?: string): void;
  dismissToast(id: number): void;
  /** Runs a mutation, reloads the board and reports failures as a toast. */
  run<T>(fn: () => Promise<T>, success?: string): Promise<T | undefined>;
  /** Optimistically places a task, then persists the move. */
  moveTask(key: string, columnId: number, afterKey: string | null, beforeKey: string | null): Promise<void>;
  clearFilters(): void;
}

const saved = <T,>(k: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v == null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
};
export const remember = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* storage unavailable: preference just won't persist */
  }
};

let toastSeq = 0;
let loading: Promise<void> | null = null;
let reloadQueued = false;

export const useStore = create<State>((set, get) => ({
  board: null,
  stats: null,
  version: 0,
  view: saved<View>("orbit.view", "board"),
  projectFilter: saved<number | null>("orbit.projectFilter", null),
  search: "",
  priorities: [],
  due: "any",
  tagFilter: [],
  blockedOnly: false,
  openTask: null,
  newTask: null,
  projectDialog: null,
  paletteOpen: false,
  themePref: (() => {
    try {
      return (localStorage.getItem("orbit.theme") as ThemePref) || "auto";
    } catch {
      return "auto";
    }
  })(),
  toasts: [],

  async load() {
    // Coalesce bursts of reloads (e.g. several live events) into at most one extra fetch.
    if (loading) {
      reloadQueued = true;
      return loading;
    }
    loading = (async () => {
      try {
        const [board, stats] = await Promise.all([api.board(), api.stats()]);
        const pf = get().projectFilter;
        const stillExists = pf == null || board.projects.some((p) => p.id === pf && !p.archivedAt);
        set((s) => ({ board, stats, version: s.version + 1, projectFilter: stillExists ? pf : null }));
      } catch (e) {
        get().toast(e instanceof ApiError ? e.message : "Can't reach the Orbit server", "error");
      } finally {
        loading = null;
        if (reloadQueued) {
          reloadQueued = false;
          void get().load();
        }
      }
    })();
    return loading;
  },

  set: (p) => set(p),

  toast(text, tone = "info", detail) {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, tone, detail }] }));
    setTimeout(() => get().dismissToast(id), tone === "error" ? 6000 : 3800);
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  async run(fn, success) {
    try {
      const out = await fn();
      await get().load();
      if (success) get().toast(success);
      return out;
    } catch (e) {
      get().toast(e instanceof Error ? e.message : "Something went wrong", "error");
      await get().load();
      return undefined;
    }
  },

  async moveTask(key, columnId, afterKey, beforeKey) {
    const board = get().board;
    if (!board) return;
    const tasks = board.tasks;
    const pos = (k: string | null) => (k ? tasks.find((t) => t.key === k)?.position ?? null : null);
    const a = pos(afterKey);
    const b = pos(beforeKey);
    const position = a != null && b != null ? (a + b) / 2 : a != null ? a + 0.5 : b != null ? b - 0.5 : Number.MAX_SAFE_INTEGER;
    const updated: Task[] = tasks.map((t) => (t.key === key ? { ...t, columnId, position } : t));
    updated.sort((x, y) => x.columnId - y.columnId || x.position - y.position);
    set({ board: { ...board, tasks: updated } });
    await get().run(() => api.moveTask(key, { columnId, afterKey, beforeKey }));
  },

  clearFilters: () => set({ search: "", priorities: [], due: "any", tagFilter: [], blockedOnly: false }),
}));

/** Tasks visible under the current project, search, priority, due and tag filters. */
export function useVisibleTasks(): Task[] {
  const { board, projectFilter, search, priorities, due, tagFilter, blockedOnly } = useStore();
  if (!board) return [];
  const inProject = projectFilter != null ? descendantIds(board.projects, projectFilter) : null;
  const q = search.trim().toLowerCase();
  const t0 = today();
  const weekEnd = inDays(7);
  return board.tasks.filter((t) => {
    if (inProject && !inProject.has(t.projectId)) return false;
    if (q && !t.title.toLowerCase().includes(q) && !t.key.toLowerCase().includes(q) && !t.description.toLowerCase().includes(q)) return false;
    if (priorities.length && !priorities.includes(t.priority)) return false;
    if (blockedOnly && !t.blockedReason) return false;
    if (tagFilter.length && !tagFilter.some((id) => t.tagIds.includes(id))) return false;
    if (due === "none" && t.dueDate) return false;
    if (due !== "any" && due !== "none") {
      if (!t.dueDate) return false;
      if (due === "overdue" && !(t.dueDate < t0)) return false;
      if (due === "today" && t.dueDate !== t0) return false;
      if (due === "week" && !(t.dueDate <= weekEnd)) return false;
    }
    return true;
  });
}

export const filtersActive = (s: Pick<State, "search" | "priorities" | "due" | "tagFilter" | "blockedOnly">) =>
  !!s.search.trim() || s.priorities.length > 0 || s.due !== "any" || s.tagFilter.length > 0 || s.blockedOnly;
