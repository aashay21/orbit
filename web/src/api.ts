import type { Activity, Board, Column, Priority, Project, Recurrence, Stats, Tag, Task, TaskDetail } from "@shared/types";
import type { Report } from "@shared/report";
import type { NotificationSettings, NotificationsView } from "@shared/notifications";

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K] };
export type NotificationsPatch = DeepPartial<Omit<NotificationSettings, "savedAt">>;

/** Identifies this tab so it can ignore live-update echoes of its own changes. */
export const clientId = crypto.randomUUID();

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { "content-type": "application/json", "x-orbit-client": clientId },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

export interface ProjectInput {
  name?: string;
  parentId?: number | null;
  key?: string | null;
  color?: string;
  description?: string;
  archived?: boolean;
}

export interface TaskInput {
  title: string;
  projectId: number;
  columnId?: number;
  description?: string;
  priority?: Priority;
  dueDate?: string | null;
  tagIds?: number[];
  tags?: string[];
  recurrence?: Recurrence | null;
  remindAt?: string | null;
  placement?: "top" | "bottom";
}

export type TaskPatch = Partial<Omit<TaskInput, "columnId" | "placement">> & { blocked?: string | null };

export const api = {
  board: () => request<Board>("GET", "/board"),
  stats: () => request<Stats>("GET", "/stats"),
  activity: (before?: number) => request<Activity[]>("GET", `/activity?limit=80${before ? `&before=${before}` : ""}`),

  createProject: (p: ProjectInput & { name: string }) => request<Project>("POST", "/projects", p),
  updateProject: (id: number, p: ProjectInput) => request<Project>("PATCH", `/projects/${id}`, p),
  deleteProject: (id: number) => request<void>("DELETE", `/projects/${id}`),

  createColumn: (c: { name: string; color?: string }) => request<Column>("POST", "/columns", c),
  updateColumn: (id: number, c: Partial<Pick<Column, "name" | "color" | "isDone" | "isActive" | "wipLimit">> & { shift?: -1 | 1 }) =>
    request<Column>("PATCH", `/columns/${id}`, c),
  deleteColumn: (id: number, moveTo?: number) => request<void>("DELETE", `/columns/${id}${moveTo ? `?moveTo=${moveTo}` : ""}`),
  archiveColumn: (id: number) => request<{ archived: number }>("POST", `/columns/${id}/archive`),

  report: (from: string, to: string, projectId: number | null) =>
    request<Report>("GET", `/report?from=${from}&to=${to}${projectId != null ? `&projectId=${projectId}` : ""}`),
  notifications: () => request<NotificationsView>("GET", "/notifications"),
  saveNotifications: (p: NotificationsPatch) => request<NotificationsView>("PUT", "/notifications", p),
  testNotification: () => request<{ ok: boolean; error: string | null; view: NotificationsView }>("POST", "/notifications/test"),
  sendReport: (b: { from: string; to: string; projectId: number | null; notes: boolean; style?: "status" | "detailed" }) => request<{ ok: true }>("POST", "/notifications/report", b),
  archivedTasks: () => request<Task[]>("GET", "/tasks?archived=1"),
  task: (key: string) => request<TaskDetail>("GET", `/tasks/${encodeURIComponent(key)}`),
  createTask: (t: TaskInput) => request<TaskDetail>("POST", "/tasks", t),
  updateTask: (key: string, t: TaskPatch) => request<TaskDetail>("PATCH", `/tasks/${encodeURIComponent(key)}`, t),
  moveTask: (key: string, m: { columnId: number; afterKey?: string | null; beforeKey?: string | null }) =>
    request<TaskDetail>("POST", `/tasks/${encodeURIComponent(key)}/move`, m),
  archiveTask: (key: string) => request<TaskDetail>("POST", `/tasks/${encodeURIComponent(key)}/archive`),
  restoreTask: (key: string) => request<TaskDetail>("POST", `/tasks/${encodeURIComponent(key)}/restore`),
  deleteTask: (key: string) => request<void>("DELETE", `/tasks/${encodeURIComponent(key)}`),

  addSubtask: (key: string, title: string) => request<TaskDetail>("POST", `/tasks/${encodeURIComponent(key)}/subtasks`, { title }),
  updateSubtask: (id: number, s: { title?: string; done?: boolean }) => request<TaskDetail>("PATCH", `/subtasks/${id}`, s),
  deleteSubtask: (id: number) => request<TaskDetail>("DELETE", `/subtasks/${id}`),
  addNote: (key: string, body: string) => request<TaskDetail>("POST", `/tasks/${encodeURIComponent(key)}/notes`, { body }),
  deleteNote: (id: number) => request<TaskDetail>("DELETE", `/notes/${id}`),

  createTag: (t: { name: string; color?: string }) => request<Tag>("POST", "/tags", t),
  updateTag: (id: number, t: { name?: string; color?: string }) => request<Tag>("PATCH", `/tags/${id}`, t),
  deleteTag: (id: number) => request<void>("DELETE", `/tags/${id}`),
};
