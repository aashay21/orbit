# Orbit

**A personal Kanban board that runs entirely on your own computer.** One board for all your projects,
with a night-sky (or dawn) look, status reports for your daily and weekly updates, reminders in
Microsoft Teams, and an assistant that can manage your tasks for you through Claude Code.

Your tasks are stored in a single file on your machine. Nothing is sent to the internet unless you
turn on Teams notifications.

---

## Contents

- [What you get](#what-you-get)
- [Supported systems](#supported-systems)
- [Set it up](#set-it-up)
  - [Linux (Ubuntu, Debian, Fedora…)](#linux)
  - [macOS](#macos)
  - [Windows](#windows)
- [Open it like a normal app](#open-it-like-a-normal-app)
- [Optional: let Claude Code manage your tasks](#optional-let-claude-code-manage-your-tasks)
- [Optional: Microsoft Teams notifications](#optional-microsoft-teams-notifications)
- [Using Orbit](#using-orbit)
- [Updating Orbit](#updating-orbit)
- [Your data and backups](#your-data-and-backups)
- [Troubleshooting](#troubleshooting)
- [For developers](#for-developers)

---

## What you get

- **One board for every project.** Projects can have subprojects. Click a project in the sidebar to see only its tasks.
- **Smooth drag-and-drop** between columns (Backlog, To Do, In Progress, Review and Done to start with; rename, add or remove them as you like).
- **Task IDs that never change**, like `WEB-12`.
- **Everything a task needs:** priority, due date, tags, notes, a checklist, a "blocked" flag with the reason, and full history.
- **Repeating tasks:** daily, weekdays, weekly on chosen days, monthly, yearly. Finishing one creates the next.
- **Reminders** at any date and time you choose.
- **Status reports** for a day, a week (ending on any weekday you like) or any date range, in a clean "Status Update" format you can copy into Teams or email.
- **Teams notifications** (optional): morning summary, due-today reminders, task reminders, new blockers, and your weekly report on a schedule.
- **Claude Code integration** (optional): ask Claude to create, update or complete tasks, or to write your weekly update.
- **Night, Dawn and Auto themes**, a command palette (`Ctrl K`) and keyboard shortcuts.

## Supported systems

| System | Runs Orbit | Starts automatically at login | Notes |
| --- | --- | --- | --- |
| **Linux** (Ubuntu 22.04+, Debian, Fedora, any distro with systemd) | ✅ | ✅ one command | Developed and tested here. |
| **macOS** 12+ (Intel or Apple Silicon) | ✅ | ✅ a few commands (launchd) | Not tested by the author yet. Please open an issue if a step doesn't work. |
| **Windows** 10 / 11 | ✅ | ✅ a few commands (Task Scheduler) | Not tested by the author yet. Please open an issue if a step doesn't work. |

On every system you need:

- **Node.js 22 or newer**
- **Git**
- **Google Chrome or Microsoft Edge**, to install Orbit as a desktop app (any modern browser works for using it)

---

## Set it up

Choose your system. Each guide takes about 5–10 minutes. When you're done, Orbit is running at
**http://127.0.0.1:4700** and starts by itself whenever you log in.

<a id="linux"></a>
### 🐧 Linux

**1. Install Git and Node.js 22.** These commands use [nvm](https://github.com/nvm-sh/nvm), which works on every distro:

```bash
sudo apt install -y git curl          # Fedora: sudo dnf install -y git curl
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.bashrc
nvm install 22
```

Check it worked: `node --version` should print `v22` or newer.

**2. Download Orbit and set it up to run in the background:**

```bash
git clone https://github.com/aashay21/orbit.git ~/orbit
cd ~/orbit
npm run service:install
```

This installs everything, builds the app, and registers Orbit as a background service that starts
at login and restarts itself if it ever stops. When it prints `✓ Orbit is running at http://127.0.0.1:4700`,
you're done.

**3. Open http://127.0.0.1:4700** in your browser.

<details>
<summary>Optional: start Orbit when the computer boots (before anyone logs in)</summary>

```bash
loginctl enable-linger "$USER"
```
</details>

<a id="macos"></a>
### 🍎 macOS

**1. Install the Xcode command-line tools** (they include Git). Open **Terminal** and run:

```bash
xcode-select --install
```

**2. Install Node.js 22** with [Homebrew](https://brew.sh) (install Homebrew first if you don't have it):

```bash
brew install node@22
brew link --overwrite node@22
```

Check it worked: `node --version` should print `v22` or newer.

**3. Download and build Orbit:**

```bash
git clone https://github.com/aashay21/orbit.git ~/orbit
cd ~/orbit
npm install
npm run build
```

**4. Make it start at login.** Copy and paste this whole block into Terminal:

```bash
cd ~/orbit && mkdir -p data ~/Library/LaunchAgents
cat > ~/Library/LaunchAgents/com.orbit.server.plist <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.orbit.server</string>
  <key>ProgramArguments</key>
  <array><string>$(command -v node)</string><string>$HOME/orbit/dist/server/index.js</string></array>
  <key>WorkingDirectory</key><string>$HOME/orbit</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/orbit/data/orbit.log</string>
  <key>StandardErrorPath</key><string>$HOME/orbit/data/orbit.log</string>
</dict>
</plist>
EOF
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.orbit.server.plist
```

**5. Open http://127.0.0.1:4700** in your browser.

To stop it starting at login, run `launchctl bootout gui/$(id -u)/com.orbit.server`.

<a id="windows"></a>
### 🪟 Windows

**1. Install Git and Node.js 22.** Open **PowerShell** (Start menu → type "PowerShell") and run:

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
```

Close and reopen PowerShell, then check: `node --version` should print `v22` or newer.

**2. Download and build Orbit:**

```powershell
git clone https://github.com/aashay21/orbit.git $HOME\orbit
cd $HOME\orbit
npm install
npm run build
```

**3. Make it start at login, hidden in the background.** Paste this whole block into PowerShell:

```powershell
cd $HOME\orbit
$node = (Get-Command node).Source
$cmd = "Set-Location '$HOME\orbit'; & '$node' dist\server\index.js"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-WindowStyle Hidden -NoProfile -Command `"$cmd`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName "Orbit" -Action $action -Trigger $trigger -Settings $settings
Start-ScheduledTask -TaskName "Orbit"
```

**4. Open http://127.0.0.1:4700** in your browser.

To stop it starting at login, run `Unregister-ScheduledTask -TaskName "Orbit"`.

> If `npm install` fails with an error about **better-sqlite3** or **node-gyp**, install the
> "Desktop development with C++" workload from
> [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) and run `npm install` again.

### Just want to try it first?

On any system, you can run Orbit without setting up auto-start:

```bash
git clone https://github.com/aashay21/orbit.git
cd orbit
npm install
npm run build
npm start
```

Then open http://127.0.0.1:4700. Press `Ctrl C` in the terminal to stop it.

---

## Open it like a normal app

Orbit can live in its own window with its own icon, just like an installed app:

1. Open **http://127.0.0.1:4700** in **Chrome** or **Edge**.
2. Click the **install** icon at the right end of the address bar (or **⋮ → Cast, save and share → Install page as app**).
3. Orbit now appears in your app launcher, Start menu or Launchpad.

**To open the Orbit window automatically at login:**

- **Linux:** run `cd ~/orbit && npm run autostart:install`.
- **macOS and Windows:** open `chrome://apps` (or `edge://apps`), right-click Orbit and turn on **Start app when you sign in**, if your browser version offers it.

---

## Optional: let Claude Code manage your tasks

If you use [Claude Code](https://claude.com/claude-code), you can connect it to Orbit. Claude can then
read your board and create, update, block, remind or complete tasks, and write your status update.
Its changes appear on your board instantly and are marked with a ✦.

**Linux and macOS:**

```bash
cd ~/orbit && npm run mcp:install
```

**Windows (PowerShell):**

```powershell
cd $HOME\orbit
claude mcp add --scope user orbit -- (Get-Command node).Source "$HOME\orbit\dist\mcp\index.js"
```

Then start a new Claude Code session and try:

- "What's on my board?" · "What's overdue?"
- "Create a task under Website/Backend to fix the login bug, high priority, due Friday"
- "I'm starting WEB-12" · "WEB-12 is blocked waiting on the design" · "WEB-12 is done"
- "Remind me about WEB-12 tomorrow at 3pm"
- "Give me my weekly update" · "…from last Wednesday to today" · "Send it to Teams"

Claude can archive tasks but never delete them. Only you can delete tasks.

---

## Optional: Microsoft Teams notifications

Orbit can post messages to you in Teams using a Teams **Workflow**. You need a Microsoft 365
account where Workflows (Power Automate) is allowed.

1. In Teams, open **Apps → Workflows → Create**, and pick the template **"Send webhook alerts to a chat"**
   (or **"Post to a channel when a webhook request is received"** for a channel).
2. Finish the template and **copy the URL** it gives you.
3. **Important if you want messages sent to yourself:** Teams can't post into your own "chat with
   yourself". Edit the workflow, and in **every** "Post card in a chat or channel" step (including both the
   **If yes** and **If no** branches), set **Post as: Flow bot**, **Post in: Chat with Flow bot**, and
   **Recipient:** your email address. Save. Messages will then arrive in the **Workflows** chat.
4. In Orbit, go to **Settings**, paste the URL, click **Save**, then **Send test message**.
5. Choose what you'd like to receive and when:

| Notification | Default |
| --- | --- |
| ☀️ Morning summary: due today, overdue, blocked | 09:00, Monday–Friday |
| ⏰ Due today reminder for each open task | 12:00 on the due day |
| 🔔 Task reminder | When you set it on the task |
| ⛔ New blocker | Straight away |
| ✅ Claude completed a task | Straight away |
| 📋 Status report | Fridays at 17:00, covering the past 7 days |

If your computer was off at a scheduled time, Orbit sends what you missed when you're back.

**Didn't get the test message?** Orbit only knows that Teams *accepted* it. Open the workflow's
**run history** in Teams or at [make.powerautomate.com](https://make.powerautomate.com) to see the real error.

The webhook URL works like a password, so keep it private. Orbit stores it only on your computer and never shows it in full.

---

## Using Orbit

1. **Create a project** with the **+** next to *Projects* (or press `P`). Give it a short prefix like `WEB`.
2. **Add tasks** with **New task** (or press `N`).
3. **Drag cards** between columns as work moves along. Click a card to see and edit everything about it.
4. Use **Reports** for your daily or weekly update. Pick the period, check the preview, then **Copy for Teams / email** or **Send to Teams**.

**How tasks become your status update:** each completed task's **title** becomes a bullet under its
project, and its completed **checklist items** become sub-bullets:

```
Weekly Status Update (24 Sep – 30 Sep 2026)

Website
Completed Work:
* Fixed the login timeout on mobile.
* Investigated two production alerts:
   * Disk space warning
   * Slow API response alert
```

So write task titles the way you'd like them to read in your update.

| Shortcut | Does |
| --- | --- |
| `Ctrl K` | Command palette: jump to any task, project or action |
| `N` / `P` | New task / new project |
| `/` | Search |
| `B` / `R` / `A` | Board / Reports / Activity |
| `T` | Switch theme (Night → Dawn → Auto) |
| `Esc` | Close a panel or dialog |

---

## Updating Orbit

Your data is never touched by updates.

**Linux:**

```bash
cd ~/orbit && git pull && npm run service:update
```

**macOS:**

```bash
cd ~/orbit && git pull && npm install && npm run build
launchctl kickstart -k gui/$(id -u)/com.orbit.server
```

**Windows (PowerShell):**

```powershell
cd $HOME\orbit; git pull; npm install; npm run build
Stop-ScheduledTask -TaskName "Orbit"; Start-ScheduledTask -TaskName "Orbit"
```

If you connected Claude Code, start a new Claude session to pick up changes.

---

## Your data and backups

| What | Where |
| --- | --- |
| All your tasks and settings | `orbit/data/orbit.db` (one file) |
| Automatic daily backups (last 14 kept) | `orbit/data/backups/` |
| Make a backup now | `npm run backup` |
| Export everything as JSON | Command palette (`Ctrl K`) → **Export all data** |

To **move Orbit to a new computer**, set it up there, stop it, and copy your `data` folder across.

To **restore a backup**, stop Orbit, copy a file from `data/backups/` over `data/orbit.db`, and start it again.

---

## Troubleshooting

**The page won't load.** Check that Orbit is running:
- Linux: `systemctl --user status orbit` (logs: `journalctl --user -u orbit -n 50`)
- macOS: `launchctl print gui/$(id -u)/com.orbit.server` (logs: `~/orbit/data/orbit.log`)
- Windows: `Get-ScheduledTask -TaskName Orbit` (or run `npm start` in PowerShell to see errors)

**Port 4700 is already used by something else.** Start Orbit on another port with the `PORT` setting,
for example `PORT=4800 npm start` (Windows: `$env:PORT=4800; npm start`), and add the same setting to your auto-start entry.

**`npm install` fails on better-sqlite3.** Make sure you're on Node.js 22+ (`node --version`). On Windows,
install the Visual Studio C++ build tools (see the Windows section); on Linux, `sudo apt install build-essential python3`.

**Claude doesn't see Orbit.** Run `claude mcp get orbit`, and make sure Orbit is running. If you
changed Node versions, run the Claude Code step again.

---

## For developers

```bash
npm install
npm run dev        # API on :4700 (data in ./data-dev) + live-reloading UI on http://127.0.0.1:4701
npm test           # tests (vitest)
npm run typecheck
```

Stop the background Orbit first if it's using port 4700.

**Built with** TypeScript, React, Vite, dnd-kit and Motion for the UI; Hono and SQLite (better-sqlite3)
on the server; and the MCP SDK for Claude Code. [`docs/BUILD-GUIDE.md`](docs/BUILD-GUIDE.md) explains
every feature and how it's built.

```
server/          API and database (repo.ts holds all the logic)
  notify/        Teams cards and the notification scheduler
mcp/             Claude Code (MCP) server
shared/          types, report formats and repeat rules used everywhere
web/             the user interface
scripts/         Linux service, autostart and backup helpers
tests/           automated tests
```

Orbit listens only on `127.0.0.1`, so other devices on your network can't reach it. The API
rejects requests from other websites.

## License

[MIT](LICENSE) © aashay21
