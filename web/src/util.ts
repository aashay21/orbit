import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import type { Priority, Project } from "@shared/types";

export const PRIORITY_META: Record<Priority, { label: string; level: number; color: string }> = {
  none: { label: "None", level: 0, color: "#64748b" },
  low: { label: "Low", level: 1, color: "#94a3b8" },
  medium: { label: "Medium", level: 2, color: "#60a5fa" },
  high: { label: "High", level: 3, color: "#f59e0b" },
  urgent: { label: "Urgent", level: 4, color: "#fb7185" },
};

export const SWATCHES = ["#2dd4bf", "#a78bfa", "#fb7185", "#fbbf24", "#38bdf8", "#f472b6", "#a3e635", "#fb923c", "#8b8fd6", "#34d399", "#e879f9", "#94a3b8"];

export const toISODate = (d: Date) => format(d, "yyyy-MM-dd");
export const today = () => toISODate(new Date());
export const inDays = (n: number) => toISODate(addDays(new Date(), n));

export type DueState = "overdue" | "today" | "soon" | "later";

/** Short, human label for a due date plus how urgent it is. */
export function dueInfo(date: string, done = false): { label: string; state: DueState } {
  const diff = differenceInCalendarDays(parseISO(date), new Date());
  if (done) return { label: format(parseISO(date), "d MMM"), state: "later" };
  if (diff < 0) return { label: diff === -1 ? "1d overdue" : `${-diff}d overdue`, state: "overdue" };
  if (diff === 0) return { label: "Today", state: "today" };
  if (diff === 1) return { label: "Tomorrow", state: "soon" };
  if (diff < 7) return { label: format(parseISO(date), "EEE d MMM"), state: "soon" };
  return { label: format(parseISO(date), "d MMM"), state: "later" };
}

export function relativeTime(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  if (s < 7 * 86_400) return `${Math.round(s / 86_400)}d ago`;
  return format(new Date(iso), "d MMM yyyy");
}

export interface ProjectNode extends Project {
  children: ProjectNode[];
  depth: number;
}

/** Builds the nested project tree (optionally including archived ones), ordered by position. */
export function projectTree(projects: Project[], includeArchived = false): ProjectNode[] {
  const visible = projects.filter((p) => includeArchived || !p.archivedAt);
  const byParent = new Map<number | null, Project[]>();
  for (const p of visible) {
    const key = p.parentId != null && visible.some((q) => q.id === p.parentId) ? p.parentId : null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(p);
  }
  const build = (parent: number | null, depth: number): ProjectNode[] =>
    (byParent.get(parent) ?? []).map((p) => ({ ...p, depth, children: build(p.id, depth + 1) }));
  return build(null, 0);
}

export function flattenTree(nodes: ProjectNode[]): ProjectNode[] {
  return nodes.flatMap((n) => [n, ...flattenTree(n.children)]);
}

/** A project plus every project nested under it. */
export function descendantIds(projects: Project[], id: number): Set<number> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of projects) {
      if (p.parentId != null && out.has(p.parentId) && !out.has(p.id)) {
        out.add(p.id);
        grew = true;
      }
    }
  }
  return out;
}

/** "Infra › Terraform" style path for a project. */
export function projectPath(projects: Project[], id: number): string[] {
  const names: string[] = [];
  let p = projects.find((x) => x.id === id);
  while (p) {
    names.unshift(p.name);
    const parentId: number | null = p.parentId;
    p = parentId != null ? projects.find((x) => x.id === parentId) : undefined;
  }
  return names;
}

export const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
