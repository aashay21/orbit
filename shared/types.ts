// Types shared by the server and the web UI.

import type { Recurrence } from "./recurrence.ts";
export type { Recurrence } from "./recurrence.ts";

export const PRIORITIES = ["none", "low", "medium", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

export type Actor = "user" | "claude" | "system";

export interface Project {
  id: number;
  parentId: number | null;
  name: string;
  /** Task-ID prefix. Only top-level projects have one; subprojects inherit their root's. */
  key: string | null;
  color: string;
  description: string;
  position: number;
  archivedAt: string | null;
  createdAt: string;
}

export interface Column {
  id: number;
  name: string;
  color: string;
  position: number;
  /** Tasks in a "done" column count as completed for reports and stats. */
  isDone: boolean;
  /** Tasks here count as "in progress" in reports. */
  isActive: boolean;
  wipLimit: number | null;
}

export interface Tag {
  id: number;
  name: string;
  color: string;
}

export interface Task {
  id: number;
  /** Human-facing identifier, e.g. "INF-42". Never changes once assigned. */
  key: string;
  projectId: number;
  columnId: number;
  title: string;
  description: string;
  priority: Priority;
  dueDate: string | null; // YYYY-MM-DD
  position: number;
  tagIds: number[];
  recurrence: Recurrence | null;
  /** For a completed recurring task: the key of the occurrence it spawned. */
  nextKey: string | null;
  /** Set while the task is blocked: what it's waiting on. */
  blockedReason: string | null;
  blockedAt: string | null;
  /** When to send a reminder for this task (ISO timestamp), if any. */
  remindAt: string | null;
  subtasksDone: number;
  subtasksTotal: number;
  notesCount: number;
  lastActor: Actor;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  archivedAt: string | null;
}

export interface Subtask {
  id: number;
  taskId: number;
  title: string;
  done: boolean;
  position: number;
}

export interface Note {
  id: number;
  taskId: number;
  body: string;
  actor: Actor;
  createdAt: string;
}

export interface Activity {
  id: number;
  taskId: number | null;
  taskKey: string | null;
  taskTitle: string | null;
  projectId: number | null;
  actor: Actor;
  type: string;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface TaskDetail extends Task {
  subtasks: Subtask[];
  notes: Note[];
  activity: Activity[];
}

export interface Board {
  columns: Column[];
  projects: Project[];
  tags: Tag[];
  tasks: Task[];
}

export interface Stats {
  doneToday: number;
  doneThisWeek: number;
  /** Completed counts Monday..Sunday of the current week. */
  week: number[];
  overdue: number;
  blocked: number;
  /** A Teams webhook is configured and notifications are on, so reminders will arrive. */
  notificationsReady: boolean;
  /** Last time Claude Code talked to Orbit (since the server started). */
  claudeLastSeen: string | null;
}

export interface ChangeEvent {
  actor: Actor;
  clientId: string | null;
  kind: string;
  summary: string;
  taskKey?: string;
}
