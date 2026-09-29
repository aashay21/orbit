# Orbit

A local-only Kanban board for every project you're working on, with a night-sky (and dawn) look.
Everything runs on your machine at `http://127.0.0.1:4700`, and data lives in one SQLite file.

## Features (phase 1)

- **One board, all projects.** Filter by a project (including its subprojects) from the sidebar.
- **Projects and nested subprojects.** Each has its own colour. Top-level projects set a task prefix.
- **Permanent task IDs**, like `INF-42`. They never change, even if a task moves to another project.
- **Customisable columns.** The defaults are Backlog, To Do, In Progress, Review and Done. You can rename, recolour, reorder, add and delete columns, set WIP limits, and choose which columns count as done.
- **Smooth drag-and-drop** between and within columns. Keyboard dragging also works.
- **Per-task fields:** priority, optional due date, tags, Markdown description, subtasks, notes and full history.
- **Search and filters** by text, priority, due date and tags.
- **Archive** for finished work. Restore anything later.
- **Activity feed** of every change, including who made it (you or Claude).
- **Live updates:** changes from other tabs or Claude Code appear instantly.
- **Themes:** Night, Dawn or Auto (follows your system).
- **Command palette** (`Ctrl K`) and keyboard shortcuts.

Coming next: Claude Code integration via MCP (phase 2), daily and weekly reports (phase 3), and email and Teams notifications (phase 4).

## Running it

Orbit runs as a **systemd user service**. It starts when you log in and restarts itself if it crashes:

```bash
npm run service:install     # build, install and start (safe to re-run)
npm run service:update      # after code changes: snapshot DB, test, build, restart
npm run service:uninstall   # stop and remove the service (keeps your data)
```

```bash
systemctl --user status orbit
journalctl --user -u orbit -f
```

**Use it like a desktop app:** open `http://127.0.0.1:4700` in Chrome or Edge, then choose
"Install Orbit" (the install icon in the address bar, or ⋮ → *Cast, save and share* → *Install page as app*).
Orbit then gets its own window and an entry in the app launcher.

To start Orbit at boot instead of at login, run this once:

```bash
loginctl enable-linger "$USER"
```

## Your data

| What | Where |
| --- | --- |
| Database | `data/orbit.db` (SQLite, one file) |
| Daily backups | `data/backups/orbit-YYYY-MM-DD.db` (made on start and every 6 hours; the last 14 are kept) |
| Update snapshots | `data/backups/orbit-pre-update-*.db` (taken before every `service:update`) |
| Manual snapshot | `npm run backup` |
| Full JSON export | Command palette → *Export all data*, or `GET /api/export` |

`data/` is ignored by git. To restore a backup, stop the service, copy the backup over `data/orbit.db`, then start the service again.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Ctrl K` | Command palette (jump to any task, project or action) |
| `N` | New task |
| `P` | New project |
| `/` | Search |
| `B` / `A` | Board / Activity |
| `T` | Cycle theme (Night → Dawn → Auto) |
| `Esc` | Close panel or dialog |
| `Enter` on a focused card | Open it |
| `Space` on a focused card | Pick up and move it with the arrow keys |

## Development

```bash
npm install
npm run dev        # API on :4700 (data in ./data-dev) + Vite UI on http://127.0.0.1:4701
npm test           # server tests (vitest)
npm run typecheck
```

Stop the service first (`systemctl --user stop orbit`) if you want to run the dev server on port 4700.

## Structure

```
server/          Hono API + SQLite (better-sqlite3)
  db/            schema migrations, connection, backups
  repo.ts        all data logic: projects, columns, tasks, activity, stats
  app.ts         REST routes, validation (zod), live-update stream (SSE)
  index.ts       entry point: static files, backups, listen on 127.0.0.1
shared/types.ts  types shared by server and UI
web/             React + Vite UI (dnd-kit for dragging, Motion for animation)
scripts/         service install/update, snapshots
tests/           server tests
```

### API (quick reference)

Every mutation takes an optional `x-orbit-actor: claude` header, so history shows who made each change.

```
GET    /api/board                  columns, projects, tags, open tasks
GET    /api/stats                  done today / this week / overdue
GET    /api/activity?limit=&before=
POST   /api/projects               {name, parentId?, key?, color?}
PATCH  /api/projects/:id           {..., archived?}
POST   /api/tasks                  {title, projectId, columnId?, priority?, dueDate?, tags?, subtasks?}
GET    /api/tasks/:key             task + subtasks, notes, history
PATCH  /api/tasks/:key             {title?, description?, priority?, dueDate?, projectId?, tags?}
POST   /api/tasks/:key/move        {columnId, afterKey?, beforeKey?}
POST   /api/tasks/:key/notes       {body}
POST   /api/tasks/:key/archive | /restore
GET    /api/tasks?archived=1&q=&projectId=
GET    /api/events                 server-sent events for live updates
```
