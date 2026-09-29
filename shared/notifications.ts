// Notification settings (stored in the local database) and their defaults.

export interface NotificationSettings {
  /** Master switch: pause everything without losing the configuration. */
  enabled: boolean;
  /** Teams Workflows webhook URL. Never sent back to the UI in full. */
  teamsWebhook: string | null;
  /** Morning summary: due today, overdue and blocked. */
  digest: { enabled: boolean; time: string; days: number[] };
  /** One reminder per open task on the day it's due. */
  dueReminders: { enabled: boolean; time: string };
  /** At the date and time set on an individual task. */
  taskReminders: { enabled: boolean };
  /** As soon as a task is marked blocked. */
  blockers: { enabled: boolean };
  /** As soon as Claude completes a task. */
  claudeCompleted: { enabled: boolean };
  /** Scheduled status report. Weekly reports cover the 7 days ending on the send day. */
  report: {
    enabled: boolean;
    frequency: "daily" | "weekly";
    weekday: number; // weekly: 0 = Sunday … 6 = Saturday
    days: number[]; // daily: which days to send
    time: string;
    projectId: number | null;
    notes: boolean;
  };
  /** When settings were last saved. Schedules only fire for slots after this, so saving never
   *  triggers a burst of already-passed messages. */
  savedAt: string | null;
}

export const DEFAULT_NOTIFICATIONS: NotificationSettings = {
  enabled: true,
  teamsWebhook: null,
  digest: { enabled: true, time: "09:00", days: [1, 2, 3, 4, 5] },
  dueReminders: { enabled: true, time: "12:00" },
  taskReminders: { enabled: true },
  blockers: { enabled: true },
  claudeCompleted: { enabled: true },
  report: { enabled: true, frequency: "weekly", weekday: 5, days: [1, 2, 3, 4, 5], time: "17:00", projectId: null, notes: true },
  savedAt: null,
};

/** What the UI sees: the webhook replaced by a hint. */
export type PublicNotificationSettings = Omit<NotificationSettings, "teamsWebhook"> & {
  webhook: { set: boolean; hint: string | null };
};

export interface NotificationLogEntry {
  id: number;
  kind: string;
  title: string;
  status: "ok" | "error";
  detail: string | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationsView {
  settings: PublicNotificationSettings;
  log: NotificationLogEntry[];
}
