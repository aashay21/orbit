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

/**
 * A project's colour for chart marks: same hue (and chroma, capped) at a fixed OKLCH lightness,
 * so bars sit in the validated band for each theme (L 0.64 on Night, 0.62 on Dawn) while still
 * reading as "that project".
 */
export function chartColor(hex: string, lightness: number): string {
  const s2l = (c: number) => (c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  const l2s = (c: number) => {
    const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.max(0, c) ** (1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, v)) * 255);
  };
  const [r, g, b] = [1, 3, 5].map((i) => s2l(parseInt(hex.slice(i, i + 2), 16)));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.min(Math.hypot(A, B), 0.16);
  const H = Math.atan2(B, A);
  const a2 = C * Math.cos(H), b2 = C * Math.sin(H), L = lightness;
  const l3 = (L + 0.3963377774 * a2 + 0.2158037573 * b2) ** 3;
  const m3 = (L - 0.1055613458 * a2 - 0.0638541728 * b2) ** 3;
  const s3 = (L - 0.0894841775 * a2 - 1.291485548 * b2) ** 3;
  const out = [
    4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  ];
  return `#${out.map((c) => l2s(c).toString(16).padStart(2, "0")).join("")}`;
}
