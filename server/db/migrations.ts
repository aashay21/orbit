// Schema migrations, applied in order. Never edit a shipped migration; add a new one.
// Kept inline (not .sql files) so the bundled server has no files to locate at runtime.

export const migrations: string[] = [
  /* 001 — initial schema */ `
  CREATE TABLE projects (
    id          INTEGER PRIMARY KEY,
    parent_id   INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    key         TEXT UNIQUE,
    next_seq    INTEGER NOT NULL DEFAULT 1,
    color       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    position    REAL NOT NULL,
    archived_at TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );

  CREATE TABLE columns (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    color      TEXT NOT NULL,
    position   REAL NOT NULL,
    is_done    INTEGER NOT NULL DEFAULT 0,
    wip_limit  INTEGER,
    created_at TEXT NOT NULL
  );

  CREATE TABLE tasks (
    id           INTEGER PRIMARY KEY,
    key          TEXT NOT NULL UNIQUE,
    project_id   INTEGER NOT NULL REFERENCES projects(id),
    column_id    INTEGER NOT NULL REFERENCES columns(id),
    title        TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    priority     TEXT NOT NULL DEFAULT 'none',
    due_date     TEXT,
    position     REAL NOT NULL,
    last_actor   TEXT NOT NULL DEFAULT 'user',
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    completed_at TEXT,
    archived_at  TEXT
  );
  CREATE INDEX tasks_column ON tasks(column_id, position);
  CREATE INDEX tasks_completed ON tasks(completed_at);

  CREATE TABLE tags (
    id    INTEGER PRIMARY KEY,
    name  TEXT NOT NULL UNIQUE COLLATE NOCASE,
    color TEXT NOT NULL
  );

  CREATE TABLE task_tags (
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    tag_id  INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, tag_id)
  );

  CREATE TABLE subtasks (
    id       INTEGER PRIMARY KEY,
    task_id  INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    title    TEXT NOT NULL,
    done     INTEGER NOT NULL DEFAULT 0,
    position REAL NOT NULL
  );

  CREATE TABLE notes (
    id         INTEGER PRIMARY KEY,
    task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    body       TEXT NOT NULL,
    actor      TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  -- Activity rows outlive deleted tasks (task_id is nulled), so history and reports stay intact.
  CREATE TABLE activity (
    id         INTEGER PRIMARY KEY,
    task_id    INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
    task_key   TEXT,
    task_title TEXT,
    project_id INTEGER,
    actor      TEXT NOT NULL,
    type       TEXT NOT NULL,
    data       TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );
  CREATE INDEX activity_task ON activity(task_id, created_at);
  CREATE INDEX activity_time ON activity(created_at);

  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
];
