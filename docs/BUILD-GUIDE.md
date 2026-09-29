# Orbit: build guide for a local Kanban planner

Orbit is a personal, **local-only** task planner. It has one Kanban board across many projects, a
distinctive night-sky UI, a Claude Code integration, daily and weekly status reports, and Microsoft Teams
notifications. This document describes every feature and how it's implemented, so you can build something
similar with Claude.

> **How to use this guide with Claude:** give Claude this file and ask it to build the app phase by phase
> (see [Suggested build order](#17-suggested-build-order-and-prompts)). Ask for a mockup before any UI
> work, and have it test each phase before moving on. The sections below are the specification.

---

## Contents

1. [Goals and principles](#1-goals-and-principles)
2. [Tech stack](#2-tech-stack)
3. [Project layout](#3-project-layout)
4. [Data model](#4-data-model)
5. [Core board logic](#5-core-board-logic)
6. [HTTP API](#6-http-api)
7. [Live updates](#7-live-updates)
8. [UI and design system](#8-ui-and-design-system)
9. [Recurring tasks](#9-recurring-tasks)
10. [Blockers and "in progress" columns](#10-blockers-and-in-progress-columns)
11. [Reports](#11-reports)
12. [Claude Code integration (MCP)](#12-claude-code-integration-mcp)
13. [Teams notifications](#13-teams-notifications)
14. [Per-task reminders](#14-per-task-reminders)
15. [Running it: service, desktop app, backups](#15-running-it-service-desktop-app-backups)
16. [Security, privacy and testing](#16-security-privacy-and-testing)
17. [Suggested build order and prompts](#17-suggested-build-order-and-prompts)
18. [Pitfalls we hit (and fixes)](#18-pitfalls-we-hit-and-fixes)
19. [Ideas not built yet](#19-ideas-not-built-yet)

---

## 1. Goals and principles

| Requirement | How Orbit meets it |
| --- | --- |
| Local only, you own the data | Server binds to `127.0.0.1` only; data in one SQLite file; no accounts, no cloud |
| Persistent, no babysitting | Runs as a systemd **user** service (auto-start at login, auto-restart on crash); SQLite is embedded, so there's no separate DB service |
| One board, many projects | A single board; every task belongs to a project or subproject; a sidebar filter shows one project and its subprojects |
| Unique task IDs | Per-project prefix plus a counter (`INF-42`); **never changes**, even if the task moves to another project |
| Customisable columns | Five defaults, all editable: rename, recolour, reorder, add, delete, WIP limits, "counts as done", "counts as in progress" |
| Amazing, unique UI | Custom design system (no stock component library), glow effects, spring animations, smooth drag-and-drop, two themes |
| Claude can manage tasks | MCP server exposing tools; Claude's changes show live and are attributed to Claude |
| Status updates | Daily, weekly (week can end on any weekday) or custom-range reports, copyable for Teams or email |
| Notifications | Teams via a Workflows webhook: digest, reminders, blockers, Claude's completions, scheduled reports |
| Version control | Everything in git; commit after each feature |

**Guiding rules:**
- Keep all data logic in one module (`repo.ts`); the API routes only validate input and call it.
- Log every change as an activity row with its actor (`user`, `claude` or `system`). History, reports and
  attribution all come from this.
- Permanent IDs, and no hard delete from automation. Claude can archive tasks, but only the user deletes them.

---

## 2. Tech stack

Everything is TypeScript on Node 22.

| Layer | Choice | Why |
| --- | --- | --- |
| Server | **Hono** + `@hono/node-server` | Tiny, fast, typed routes; also serves the built UI |
| Database | **SQLite** via **better-sqlite3** (WAL mode) | A single file, synchronous and fast, with safe online backups via `db.backup()` |
| Validation | **zod** | Request validation and readable error messages |
| Migrations | Hand-written SQL strings in `server/db/migrations.ts`, tracked with `PRAGMA user_version` | Nothing to locate at runtime once bundled; no ORM needed |
| UI | **React 19** + **Vite** | Fast dev loop |
| Drag-and-drop | **@dnd-kit/core** + **@dnd-kit/sortable** | Smooth, accessible multi-container sorting, keyboard support and a drag overlay |
| Animation | **Motion** (`motion/react`, formerly Framer Motion) | Springy panels, dialogs, toasts and tree expand/collapse |
| State | **zustand** | A small global store |
| Command palette | **cmdk** | ⌘K / Ctrl-K palette |
| Markdown | **react-markdown** (raw HTML stays off) | Task descriptions and notes |
| Dates | **date-fns** | Formatting and relative dates |
| Fonts | `@fontsource-variable/geist`, `geist-mono`, `@fontsource/instrument-serif` | Bundled locally, so no internet is needed |
| Claude integration | **@modelcontextprotocol/sdk** (stdio server) | Claude Code starts it on demand |
| Build | `vite build` for the UI; **esbuild** bundles the server and the MCP server (`--packages=external`) | Two small JS files plus static assets |
| Tests | **vitest** | Server, recurrence, reports, notifications and MCP tests (43 in total) |

Scripts in `package.json`:

```jsonc
"dev": "concurrently \"npm:dev:server\" \"npm:dev:web\"",   // API :4700 + Vite :4701 (proxy /api)
"build": "npm run build:web && npm run build:server && npm run build:mcp",
"start": "node dist/server/index.js",
"test": "vitest run", "typecheck": "tsc --noEmit",
"service:install" / "service:update" / "service:uninstall",  // systemd helpers
"mcp:install", "autostart:install" / "autostart:remove", "backup"
```

---

## 3. Project layout

```
orbit/
├─ server/
│  ├─ db/migrations.ts     schema, append-only migrations
│  ├─ db/index.ts          open DB (WAL, foreign keys), migrate, seed columns, daily backups
│  ├─ repo.ts              ALL data logic (projects, columns, tasks, activity, stats, reports, notifications)
│  ├─ app.ts               Hono routes + zod schemas + SSE stream + origin check
│  ├─ notify/cards.ts      Teams Adaptive Cards
│  ├─ notify/notifier.ts   scheduler, catch-up, dedupe, retries, instant events
│  └─ index.ts             entry: serve API + static UI on 127.0.0.1, start backups and notifier
├─ shared/
│  ├─ types.ts             Task, Project, Column, Board, Stats, Activity…
│  ├─ recurrence.ts        repeat rules: next date, description
│  ├─ report.ts            Report type + Markdown/HTML formatters
│  └─ notifications.ts     settings type + defaults
├─ mcp/
│  ├─ index.ts             stdio MCP server entry
│  ├─ client.ts            HTTP client to Orbit (tags requests as Claude)
│  ├─ resolve.ts           "Infra/Terraform" → project, "friday" → date, "every weekday" → rule
│  └─ tools.ts             tool definitions and output formatting
├─ web/
│  ├─ index.html, public/  PWA manifest, icons (SVG + 192/512 PNG)
│  └─ src/                 App, store, api client, theme, styles.css, components/
├─ scripts/                install-service, update, snapshot, install-mcp, install-autostart, open-app
├─ tests/                  repo, recurrence, report, notify, mcp tests
├─ docs/                   mockups.html, this guide
├─ CLAUDE.md               conventions for future Claude sessions
└─ data/                   (git-ignored) orbit.db + backups/
```

---

## 4. Data model

SQLite, one file. Timestamps are ISO-8601 UTC strings; dates are `YYYY-MM-DD` in local time.

```sql
projects (id, parent_id → projects ON DELETE CASCADE, name,
          key UNIQUE,            -- task prefix, top-level projects only ("INF")
          next_seq,              -- next task number for this prefix
          color, description, position REAL, archived_at, created_at, updated_at)

columns  (id, name, color, position REAL,
          is_done,               -- tasks here count as completed
          is_active,             -- tasks here count as "in progress" in reports
          wip_limit, created_at)

tasks    (id, key UNIQUE,        -- "INF-42", permanent
          project_id, column_id, title, description (Markdown),
          priority,              -- none | low | medium | high | urgent
          due_date,              -- YYYY-MM-DD or NULL
          position REAL,         -- order within its column
          last_actor,            -- user | claude | system
          recurrence,            -- JSON rule or NULL
          next_key,              -- occurrence spawned on completion (created once)
          blocked_reason, blocked_at,
          remind_at,             -- ISO timestamp for a Teams reminder
          created_at, updated_at, completed_at, archived_at)

tags (id, name UNIQUE COLLATE NOCASE, color);   task_tags (task_id, tag_id)
subtasks (id, task_id, title, done, position)
notes    (id, task_id, body, actor, created_at)
activity (id, task_id → tasks ON DELETE SET NULL, task_key, task_title, project_id,
          actor, type, data JSON, created_at)   -- survives task deletion
settings (key, value JSON)                      -- e.g. 'notifications'
notify_log (id, kind, dedupe_key UNIQUE, title, status, detail, attempts, created_at, updated_at)
```

**Migrations** are an array of SQL strings. On start, apply `migrations[user_version…]`, each in a
transaction, then set `user_version`. **Never edit a shipped migration; always append.** Seed the five
default columns after migrations if the table is empty: Backlog, To Do, In Progress (active), Review
(active), and Done (done).

---

## 5. Core board logic

All of this lives in `repo.ts`. Every mutation runs in a transaction, writes an activity row, and emits a
change event.

### Task keys
- A top-level project gets a **prefix** derived from its name ("Acme Client" → `ACM`, adding `ACM2` if
  that's taken), or one the user chooses (2–6 letters or digits, starting with a letter). Subprojects have
  no prefix; they use their root project's.
- New task: take the root's `next_seq`, skip any number already used (in case a prefix was renamed and
  reused), then increment it.
- **A key never changes.** Moving a task to another project only changes `project_id`.

### Ordering (fractional positions)
- Each task has a `position REAL`. A move sends the target `columnId` plus optionally `afterKey` (the card
  above) and/or `beforeKey` (the card below).
- Rule: **the card above wins.** If `afterKey` is given, place the task directly below it (find the next
  card after it, ignoring `beforeKey`). This keeps the order correct even when a filter hides cards between
  the two neighbours. Only `beforeKey` means "directly above that card"; neither means top or bottom.
- New position = the midpoint of the neighbours (±1024 at the ends). If the midpoint can't be represented
  (the neighbours are too close), **rebalance** the column to 1024, 2048, … and recompute.

### Completion
- Moving into a column with `is_done` sets `completed_at = now` (if it came from a non-done column);
  moving out clears it. Activity types are `completed`, `reopened` or `moved`.
- Completion also clears any blocker and spawns the next occurrence of a repeating task (see §9).

### Projects
- Nesting to any depth (via `parent_id`); moving a project inside its own subtree is rejected.
- **Archive** hides a project, its subprojects and their tasks from the board (reversible).
- **Delete** is only allowed when neither the project nor its subprojects have any tasks.

### Columns
- Create, rename, recolour, set a WIP limit, toggle "counts as done" or "counts as in progress", and move
  left or right (swapping positions).
- Delete: if the column has tasks, the caller must choose a column to move them to. The board always keeps
  at least one column.

### Other task features
- Tags (created on the fly by name, case-insensitive), subtasks (a checklist), notes (Markdown, with the
  actor), a Markdown description, priority and due date.
- **Archive** a single task, or "archive all" in a column (e.g. to tidy Done). Restore puts the task at the
  bottom of its column.
- **Stats:** done today, done this week (counted per day, Monday to Sunday), overdue, blocked, whether
  notifications are ready, and when Claude was last seen.

---

## 6. HTTP API

Everything is under `/api`, as JSON. An optional `x-orbit-actor: claude` header attributes a change to
Claude, and `x-orbit-client: <uuid>` identifies the browser tab so it can ignore echoes of its own changes.
Errors return `{error}` with status 400 (validation), 404 (not found) or 409 (conflict).

```
GET    /board                      columns, projects, tags, open (non-archived) tasks
GET    /stats                      done today/week, per-day week, overdue, blocked, claudeLastSeen
GET    /activity?limit=&before=    newest first, pageable
GET    /export                     full JSON dump (download)
GET    /report?from=&to=&projectId=&format=json|md|html&notes=0
POST   /projects                   {name, parentId?, key?, color?, description?}
PATCH  /projects/:id               {…, archived?}           DELETE /projects/:id
POST   /columns                    {name, color?, isDone?, isActive?, wipLimit?}
PATCH  /columns/:id                {…, shift?: -1|1}        DELETE /columns/:id?moveTo=
POST   /columns/:id/archive        archive every task in it
GET    /tasks?archived=1&q=&projectId=&columnId=
POST   /tasks                      {title, projectId, columnId?, priority?, dueDate?, tags?, subtasks?,
                                    recurrence?, remindAt?, placement?}
GET    /tasks/:key                 task + subtasks + notes + history
PATCH  /tasks/:key                 {title?, description?, priority?, dueDate?, projectId?, tags?, tagIds?,
                                    recurrence?, blocked?: string|null, remindAt?: string|null}
POST   /tasks/:key/move            {columnId, afterKey?, beforeKey?}
POST   /tasks/:key/archive | /restore          DELETE /tasks/:key
POST   /tasks/:key/subtasks {title}  PATCH /subtasks/:id {title?, done?}  DELETE /subtasks/:id
POST   /tasks/:key/notes {body}      DELETE /notes/:id
GET|POST /tags   PATCH|DELETE /tags/:id
GET    /notifications              settings (webhook masked) + recent delivery log
PUT    /notifications              partial settings update
POST   /notifications/test         send a test card
POST   /notifications/report       {from, to, projectId?, notes?} → post to Teams now
GET    /events                     Server-Sent Events stream
```

**Origin check middleware:** reject any request whose `Origin` header isn't `http://127.0.0.1:*` or
`http://localhost:*`. This stops a website you visit from driving your local server through your browser.

---

## 7. Live updates

- The repo emits `change` events of the form `{actor, clientId, kind, summary, taskKey}`.
- `GET /api/events` streams them with Hono's `streamSSE`, plus a keep-alive ping every 25 seconds.
- The UI opens an `EventSource`. On each event it ignores its own `clientId`, reloads the board (bursts are
  merged into at most one extra fetch), and shows a toast when the actor is Claude. It reconnects after 2
  seconds on error and reloads to catch up.
- The UI also reloads when the window regains focus, so date-dependent labels ("overdue") stay fresh.

---

## 8. UI and design system

### Design direction: "Night Observatory" and "Dawn Observatory"
Two themes built from the same idea: a deep-space board with **soft glowing project colours**, and a
light "sunrise" version. Get the look agreed with a mockup first. We built one HTML file showing both
variants side by side before writing any app code.

- **Tokens** are CSS variables under `:root[data-theme="night"|"dawn"]`: `--bg`, `--panel`, `--card`,
  `--text`, `--muted`, `--faint`, `--hover`, `--glow`, `--tint`, `--shadow`, and so on. Components never
  hard-code colours that differ between the themes.
- **Night:** `#05060d` background, violet and teal radial "nebula" gradients, 150 twinkling stars (CSS
  opacity animation), frosted panels (`backdrop-filter: blur`).
- **Dawn:** `#f5f2ed` background, pastel aurora gradients (lavender, mint, peach) and drifting light
  specks; glows become soft coloured shadows.
- **Type:** Instrument Serif for display titles, Geist for UI text, Geist Mono for IDs and labels.
- **Glow:** each card gets `--acc` (its project colour), a faint radial tint in the top-left corner and a
  `box-shadow` halo using `color-mix(in oklab, var(--acc) 42%, transparent)`. Hovering lifts the card and
  strengthens the glow.
- **Priority** is shown as 4 small signal bars (urgent pulses); **due** dates as relative labels (Today,
  Tomorrow, 2d overdue in rose, Thu 1 Oct); **subtasks** as a progress ring; the **Claude** badge is an
  orange four-point spark.
- **Theme switch:** Night, Dawn or Auto (follows the OS). The choice is saved in `localStorage` and applied
  by an inline script **before first paint** to avoid a flash. Switching uses the **View Transitions API**:
  the new theme spreads out in a circle from where you clicked (`clip-path` animation on
  `::view-transition-new(root)`).

### Layout
- **Sidebar:** logo, navigation (Board, Reports, Activity, Archive, Settings), the **project tree** (click
  to filter, expand and collapse with animation, hover buttons for "add subproject" and "edit", open-task
  counts), archived projects, a **Claude Code status** indicator (pulses green when active in the last 15
  minutes), the theme switch, and a hint for the command palette.
- **Board header:** date eyebrow, title (the project name or "All projects", with an open-task count),
  stat tiles (done today, this week, overdue, blocked) and a 7-day completion bar chart.
- **Toolbar:** search (`/`), and filter chips for priority (multi-select), due (overdue, today, this week,
  no date), tags and blocked, plus "Clear" and a gradient **New task** button (`N`).
- **Columns:** a glowing orb in the column colour, the name (double-click to rename), a count (e.g. `3/5`
  when filtered), a done badge, "+" and a ⋯ menu, and a WIP meter. The last column is followed by
  "Add column" (inline input).

### Drag-and-drop (dnd-kit, multi-container)
- `DndContext` with a `PointerSensor` (6px activation distance, so clicks still open cards) and a
  `KeyboardSensor`.
- Each column is a `SortableContext` over the visible task keys, plus a `useDroppable` for empty columns
  (droppable ids `col-<id>`).
- **Collision detection:** use `pointerWithin` first and fall back to `rectIntersection`. If the pointer is
  over a column, snap to the nearest card in it (`closestCenter`); remember the last target to avoid
  flicker.
- `onDragStart`: copy the visible items per column. `onDragOver`: move the key between columns in the copy,
  so cards shift out of the way. `onDragEnd`: apply `arrayMove` within the column, read the neighbours, and
  call `moveTask(key, columnId, afterKey, beforeKey)`.
- **Optimistic update:** place the card locally at once, then call the API, then reload.
- `DragOverlay` renders a "lifted" card (tilted 2.4°, scale 1.035, strong glow) with a custom spring-like
  drop animation. The original spot shows as a faded, dashed placeholder, and the target column glows.

### Task panel (right-hand drawer)
It slides in with a spring and shows:
- The key, with a copy button.
- An editable serif title.
- A blocker banner, or a "Mark as blocked" button.
- Status pills (one per column; click to move).
- Fields: project picker (tree), priority selector, due date (date input plus Today, Tomorrow and "In a
  week" shortcuts), **Remind me**, **Repeat**, and tags (find or create).
- A Markdown description (click to edit; Ctrl+Enter saves).
- Subtasks (check off, rename inline, remove, add), notes (newest first, Claude's tinted orange), and a
  **history timeline** in plain English ("Claude moved it from To Do to In Progress").
- A footer with Archive or Restore, and Delete (confirmed with a second click).

### Other UI
- **New task dialog:** big serif title input, details, project, column, priority, due, remind, repeat,
  tags, and a "create another" toggle.
- **Project dialog:** name, parent, prefix (with a live example "INF-1"), colour swatches, description,
  archive and delete.
- **Command palette (Ctrl-K):** actions, jump to a project, and jump to any task by ID or title.
- **Activity view** (grouped by day), **Archive view** (search, restore, delete), **Reports**, and
  **Settings**.
- **Keyboard shortcuts:** `N` new task, `P` new project, `/` search, `B`/`R`/`A` switch view, `T` cycle
  theme, `Esc` close. Shortcuts are ignored while you're typing in a field.
- **Empty state:** "Your sky is empty", with a floating orb and a "Create your first project" button.
- **Deep links:** `/?task=INF-3` opens a task and `/?view=reports` opens a view (used by the Teams cards).

---

## 9. Recurring tasks

**Rule** (stored as JSON in `tasks.recurrence`):

```ts
{ freq: "daily" | "weekly" | "monthly" | "yearly",
  interval: number,          // every N units
  weekdays?: number[],       // weekly only, 0 = Sunday
  monthDay?: number,         // monthly only (clamped to short months without drifting)
  until?: "YYYY-MM-DD",      // end date
  columnId?: number }        // column new copies start in (default: first non-done column)
```

- **The next date** (`shared/recurrence.ts`) is one step after the base date. The base is the due date if
  there is one, otherwise today. Missed slots are **skipped** so a late completion never creates an
  already-overdue copy. The result is null once past `until`.
  - Weekly with specific days: weeks run Monday to Sunday. Try later days in the same week first, then jump
    N weeks to the first chosen day.
  - Monthly: keep the anchor day (e.g. the 31st), clamping to the month's length (31 Jan → 28 Feb → 31 Mar).
- **On completion:** if the task has a rule and no `next_key` yet, create a **new task** (new key) in the
  same project, copying the title, description, priority and tags, with its subtasks **unchecked**, the new
  due date, and the reminder shifted by the same number of days. Then set `next_key` so completing,
  reopening and completing again never creates a duplicate. The finished task stays in Done, so reports
  still count it.
- **UI:** presets (every day, every weekday, weekly, every 2 weeks, monthly, yearly) plus a custom editor
  (every N days/weeks/months/years, weekday pills, month day, end date, target column), with a live summary
  and a preview of the next due date. Cards show a ↻ icon.

---

## 10. Blockers and "in progress" columns

- **Blocker:** `PATCH /tasks/:key {blocked: "Waiting on client"}` sets `blocked_reason` and `blocked_at`
  (the timestamp is kept when only the wording changes); `{blocked: null}` clears it. Completing a task
  clears its blocker automatically. Activity types: `blocked` and `unblocked`.
- **UI:** a red banner in the panel (with Edit and Unblock), a red glow and reason line on the card, a
  "Blocked" filter chip with a count, and a stat tile.
- **"Counts as in progress"** is a column flag (`is_active`), on by default for In Progress and Review. It
  defines the report's "In progress" section. A done column can't also be active.

---

## 11. Reports

**Content** (`repo.getReport(from, to, projectId?)`):
- **Completed:** tasks with `completed_at` in the period (including ones archived since), each with its
  latest note from within the period.
- **In progress:** tasks currently in active columns, with column, due date, subtask progress and latest
  note.
- **Blockers:** tasks currently blocked, with the reason and how long they've been blocked.
- The number of tasks created in the period, and completions **per day split by top-level project** (for
  the chart).
- Optional project filter (includes subprojects). Periods are capped at 366 days.

**Periods in the UI:**
- **Day**, with ← and → arrows.
- **Week**, with a **"Week ends on"** setting (e.g. Wednesday gives Thursday to Wednesday). The week is
  anchored on its end day because that's usually when the update is sent.
- **Custom** from and to dates, both included.

**Formats** (`shared/report.ts`, shared by the UI, API and MCP):
- **Markdown:** a heading, a summary line, and sections grouped by top-level project.
- **HTML** for email and Teams: simple structure, inline styles, neutral font, HTML-escaped text.
- **Copy for Teams / email** writes both `text/html` and `text/plain` to the clipboard with `ClipboardItem`,
  so pasting gives formatted text. There's also Copy Markdown, Download `.md`, and **Send to Teams** (posts
  a report card).

**Chart:** completions per day, stacked by project, with a 2px gap between segments, rounded tops, a total
above each bar, a hover tooltip per day, and a legend when there's more than one project. The project
colours are too light to be read as chart bars, so they're **relit**: keep each project's OKLCH hue (with
chroma capped at 0.16) and set the lightness to **0.64 on Night and 0.62 on Dawn**, values checked with a
palette validator for contrast and colour-blind separation. The report list below the chart doubles as
its table view.

---

## 12. Claude Code integration (MCP)

A **stdio MCP server** (`mcp/index.ts`) that Claude Code starts on demand. It **goes through the HTTP
API** (never the database directly) and sends `x-orbit-actor: claude` with every request. That's why
Claude's changes appear live, get the spark badge and show up in history as Claude's.

Registered once for all projects:

```bash
claude mcp add --scope user orbit -- /absolute/path/to/node /path/to/orbit/dist/mcp/index.js
```

(Use absolute paths. With nvm, the node path includes the version, so re-register after switching Node.)

**Server instructions** (sent to Claude): tasks have permanent IDs, so always mention them; columns are
the user's own, so read them first; keep the task you're working on current (move it to in progress when
you start, add notes on decisions and blockers, move it on when finished) and say what you changed; don't
change tasks the user didn't ask about; there's no delete tool.

**Tools**

| Tool | Purpose |
| --- | --- |
| `board_overview` | Today's date, columns and counts, project tree, in-progress, blocked, overdue, due in the next 7 days, completions (start here) |
| `list_projects` | Tree with prefixes, ids and open counts |
| `list_tasks` | Filters: project (includes subprojects), column, priority, due (overdue, today, this_week, none), tag, blocked, search, include_done, archived, limit |
| `get_task` | Full details, subtasks with ids, notes, recent history |
| `create_task` | title, project, column, priority, due_date, description, tags, subtasks, repeat, remind_at |
| `update_task` | Any field; `append_description`, `add_tags`/`remove_tags`, `repeat`, `blocked`, `remind_at` |
| `move_task` | By column name, top or bottom; reports the next occurrence for repeating tasks |
| `complete_task` | Move to the done column, with an optional closing note |
| `add_note`, `add_subtasks`, `update_subtask` | Subtask by id or by part of its title |
| `archive_task` | Archive or restore (no delete) |
| `create_project` | Optional parent and prefix |
| `recent_activity` | Changes since a date: "what did I do today" |
| `get_report` | today, yesterday, day, this_week, last_week (with `week_ends_on`), or a range; optional project; `send_to_teams` |

**Resolvers** (`mcp/resolve.ts`) make natural language work:
- **Project:** an id, a prefix (`INF`), an exact name, a path (`Acme Client/Landing Zone`), or a fuzzy name.
  If it's ambiguous, the tool returns an error listing the candidates' paths.
- **Column:** an id, a name, or "done" (the first done column).
- **Due date:** `YYYY-MM-DD`, today, tomorrow, yesterday, a weekday (the coming one, today included),
  "next friday", "next week", `+3d`, "in 2 weeks", or "none".
- **Reminder:** an ISO date-time, "in 2 hours", "tomorrow 9am", "friday at 14:30", or a bare time (today,
  or tomorrow if that time has passed).
- **Repeat:** daily, every weekday, weekly, biweekly, every 2 weeks, "every monday and thursday", "every 2
  weeks on fri", monthly, yearly, optionally ", until DATE", or a structured object.
- Every tool wraps errors so Claude sees a readable message ("No column "Nowhere". Columns: …") instead of
  a failure.

**Output format:** compact lines, e.g.
`INF-2 · Migrate state backend · In Progress · urgent · due 2026-09-28 (1d overdue) · Infra / Terraform · #terraform · 4/5 subtasks · BLOCKED: …`

**UI side:** the server records the time of the last Claude request and exposes it in stats, which drives
the sidebar's "Claude Code · active 2m ago" indicator.

---

## 13. Teams notifications

### Transport: Teams Workflows webhook
- Old Office 365 "Incoming Webhook" connectors are being retired, so use **Workflows** (Power Automate
  inside Teams): template **"Send webhook alerts to a chat"** or **"Post to a channel when a webhook
  request is received"**.
- Orbit `POST`s this envelope to the URL:
  `{ type: "message", attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", contentUrl: null, content: <AdaptiveCard 1.4> }] }`
- **Workflows returns 202 once it has accepted the request, even if the run fails later.** Tell users to
  check the flow's **run history** if nothing arrives.

### Setup gotcha (important)
**A workflow can't post into your own self-chat (the Teams "Notes" chat).** It fails with Graph error
`Call made for a thread which is not a ChatThread`. Fix: in **every** "Post card in a chat or channel" step
(the template has **both an If yes and an If no branch**), set **Post as: Flow bot**, **Post in: Chat with
Flow bot**, and **Recipient: your email**. Messages then arrive in the "Workflows" chat. A channel in a
private team also works.

### Events
| Notification | When | Default |
| --- | --- | --- |
| Morning digest: due today, overdue, blocked (or "clear skies") | At a time on chosen days | 09:00, Monday to Friday |
| Due-today reminder per open task (6 or more become one list) | At a time on the due day | 12:00 |
| Task reminder (§14) | At the task's `remind_at` | On |
| New blocker (not re-wordings of an existing one) | Immediately | On |
| Claude completed a task (with its closing note and next occurrence) | Immediately | On |
| Scheduled report | Daily (chosen days) or weekly (weekday; covers the 7 days ending then), at a time, optionally one project | Friday 17:00, weekly |

Cards use headings, subtle sub-lines, bullet lists, coloured section titles, and **Open in Orbit** buttons
that link to `127.0.0.1` deep links (these only work on the same machine). User text is sanitised for the
card's Markdown subset: break link syntax (`](` → `] (`) and replace `*` with the look-alike `∗`. Don't
use backslash escapes; some clients show them as literal backslashes.

### Scheduler (`notify/notifier.ts`)
- `tick()` runs every 30 seconds (plus once 5 seconds after start). Immediate events come from repo
  "domain" events (`blocked`, `completed`), separate from the UI change events.
- **Dedupe:** every scheduled message has a key (`digest:2026-09-29`, `due:INF-3:2026-09-29`,
  `remind:INF-3:<iso>`, `report:weekly:2026-10-02`) stored in `notify_log` with a UNIQUE constraint.
- **Catch-up:** if Orbit wasn't running at the scheduled time, send when it next runs. That's the same day
  for the digest and due reminders, within 3 days for reports, and within 7 days for task reminders.
- **No burst on save:** settings store `savedAt`, and a slot only fires if it's at or after `savedAt`.
  Enabling notifications at 15:00 won't immediately send the morning digest or last Friday's report.
- **Retries:** a failed send is logged with its error; retry after 10 minutes, at most 3 attempts. Log
  entries are stamped with the notifier's clock, which matters for tests with a fake clock.
- **Settings** are JSON in the `settings` table, deep-merged with defaults, with a master on/off switch.
  **The webhook URL is secret:** the API never returns it (only a hint like `host · …a1b2c3`), it's not in
  exports, and the UI input is a password field.
- The **Settings page** has connection status, paste or replace URL, **Send test message**, a toggle and
  controls per event, and a **Recently sent** log with errors.

---

## 14. Per-task reminders

- `tasks.remind_at` (ISO). The UI's **Remind me** control offers quick picks (in 1 hour, this evening
  18:00, tomorrow 09:00, the day before due at 09:00, the due day at 09:00, next Monday 09:00), an exact
  `datetime-local`, and Remove.
- If Teams isn't set up yet, the control shows "Set up Teams to get it", which links to Settings.
- The notifier sends a 🔔 card at that time if the task isn't done or archived (catch-up up to 7 days).
  Changing the time re-arms it, because the dedupe key includes the time.
- Repeating tasks carry the reminder to the next occurrence at the same offset from the due date.
- Cards with a pending reminder show a small amber 🔔.

---

## 15. Running it: service, desktop app, backups

**systemd user service** (`scripts/install-service.sh`, safe to re-run):

```ini
[Service]
WorkingDirectory=/path/to/orbit
ExecStart=/absolute/path/to/node /path/to/orbit/dist/server/index.js
Environment=PORT=4700
Restart=on-failure
RestartSec=2
[Install]
WantedBy=default.target
```

`systemctl --user enable --now orbit` starts it at login and restarts it within seconds after a crash.
Optionally, `loginctl enable-linger $USER` starts it at boot instead of login. Logs:
`journalctl --user -u orbit`.

**Updates:** `npm run service:update` takes a DB snapshot, installs dependencies, runs the tests, builds,
and restarts. Nothing restarts if the tests fail.

**Desktop app (PWA):** a web manifest (`display: standalone`) plus SVG and 192/512 PNG icons. Chrome's
"Install" gives Orbit its own window and launcher entry. **Open at login:** an XDG autostart entry
(`~/.config/autostart/orbit.desktop`) runs a script that **waits for `/api/health`** and then runs
`google-chrome --app-id=<id>`. The app id is read from Chrome's generated `.desktop` file, and waiting for
the server avoids a "can't connect" page during boot.

**Backups:** `db.backup()` writes `data/backups/orbit-YYYY-MM-DD.db` on start and every 6 hours, keeping
14. Every update also takes a `pre-update` snapshot (10 kept), and `npm run backup` takes one on demand.
The JSON export is in the command palette. To restore: stop the service, copy a backup over `orbit.db`,
then start it.

---

## 16. Security, privacy and testing

**Security and privacy**
- The server listens on `127.0.0.1` only. The origin check blocks cross-site requests from web pages.
- All user text is rendered safely: React escapes it, react-markdown doesn't render raw HTML, report HTML is
  escaped, and card text is sanitised.
- Only outbound HTTPS to Microsoft for notifications; nothing can reach Orbit from outside. Card contents
  (task titles and so on) become visible in Teams, so mention that for confidential projects.
- The webhook URL is treated like a password: the user pastes it into Settings, never into chat or code.

**Testing** (vitest, in-memory SQLite `openDatabase(":memory:")`):
- **Repo:** keys and prefixes, keys kept when a task changes project, cycle rejection, delete rules,
  ordering with 60 inserts between the same pair, completion and reopen, actor attribution, column delete
  with moves, tags and archive, and API validation (400/404/403).
- **Recurrence:** date math (weekday sets, every 2 weeks on Monday and Thursday, month-end clamping, leap
  years), skipping missed slots, `until`, and spawning once with copied details.
- **Reports:** section contents, project scope, Markdown/HTML output, HTML escaping, titles, API formats,
  and the chart colour values.
- **Notifications:** a fake clock and fake sender covering digest timing and days, catch-up vs `savedAt`,
  reminders with batching, weekly report plus retry spacing, report slot calculation, instant events, pause
  and toggles, and the settings API never leaking the URL.
- **MCP:** a real MCP `Client` connected over `InMemoryTransport` to the tools, with the tools' HTTP calls
  routed into the in-memory Hono app. Covers a full session, resolvers and errors.
- **Manual:** run a second instance (`PORT=4799 ORBIT_DATA=/tmp/x`) seeded through the API, click through
  it in a browser, and point notifications at a local stand-in HTTP server that records the cards.

---

## 17. Suggested build order and prompts

Build in phases, committing after each one. Example prompts for Claude:

1. **Design first.** "Make two HTML mockups of a Kanban board: a dark 'night observatory' theme with soft
   glowing project colours, and the same idea on a light background. Cards need IDs, project › subproject,
   priority, due date, subtasks and tags. Show a card mid-drag."
2. **Phase 1: board.** "Build a local-only Kanban app from docs/BUILD-GUIDE.md, sections 2–8 and 15: Hono,
   SQLite, React, dnd-kit and Motion. Include projects and subprojects, permanent task IDs, customisable
   columns, the task panel, filters, command palette, both themes with a toggle, a systemd user service,
   the PWA and backups. Write tests, check it in a browser, and use git."
3. **Recurring tasks** (§9).
4. **Phase 2: MCP** (§12). "Add an MCP server that goes through the HTTP API as Claude, with these tools
   and resolvers, and register it with Claude Code at user scope."
5. **Phase 3: reports and blockers** (§10–11), including week-ends-on and custom ranges.
6. **Phase 4: Teams** (§13–14). "Add Teams notifications via a Workflows webhook, with a Settings page, a
   scheduler with catch-up, dedupe and retries, and per-task reminders."
7. **Autostart** of the app window at login (§15).

Tips: have Claude run a throwaway second instance for testing, never your real `data/`. Ask for a
`CLAUDE.md` with the conventions so later sessions follow them.

---

## 18. Pitfalls we hit (and fixes)

| Problem | Fix |
| --- | --- |
| Dropping between two non-adjacent cards (filters on) gave every new card the same midpoint, so they tied | "The card above wins": place directly below `afterKey`, looking up the actual next card |
| The panel title was squashed when the panel content grew | Flex children shrank; add `.panel-inner > * { flex-shrink: 0 }` |
| Switching views sometimes got stuck mid-animation | Don't make view switches wait for an exit animation (entry animation only). Background tabs pause animation frames |
| A theme flash on load | Apply the saved theme in an inline `<script>` in `index.html` before React loads |
| Retry spacing broke under a fake clock | Stamp log rows with the notifier's clock, not `new Date()` |
| Enabling notifications sent a burst of old messages | `savedAt`: only fire slots after the last settings save |
| Teams cards never arrived although Orbit showed "ok" | Workflows returns 202 then fails later; check run history. Self-chat isn't postable: use "Chat with Flow bot" in **both** branches |
| Backslash escapes might show literally in Teams | Neutralise links and `*` instead of escaping |
| Project colours were too light for chart bars | Relight to a fixed OKLCH lightness per theme, keeping the hue |
| `pkill -f <pattern>` killed the shell running it | The pattern matched its own command line; find processes by PID, environment or port instead |
| Clipboard blocked in some embedded browsers | Catch the error, show a toast, and offer Download instead |

---

## 19. Ideas not built yet

- **Email** as a second notification channel (SMTP via nodemailer, same events and settings).
- Dragging columns to reorder them (currently via the column menu).
- Task dependencies ("blocked by INF-3"), time tracking and estimates.
- File attachments and links to PRs or repos with status.
- Import from Trello, Jira or CSV; JSON import to go with the export.
- Multi-device sync (e.g. via a self-hosted relay). Today it's strictly one machine.
