# Orbit: notes for Claude

Personal, local-only Kanban app. See README.md for features and layout.

- Runs as the systemd user service `orbit` on 127.0.0.1:4700 using `data/orbit.db`. Never point tests or experiments at `data/`; use `ORBIT_DATA=<scratch dir>` and another `PORT`.
- After changing code, run `npm test && npm run typecheck`, then deploy with `npm run service:update`.
- Schema changes: append a new entry to `server/db/migrations.ts`; never edit a shipped migration.
- All data logic lives in `server/repo.ts`. Routes in `server/app.ts` only validate input and call it. Every mutation logs an activity row with its actor and emits a change event.
- Task keys (`INF-42`) are permanent. Don't renumber them or derive them from the current project.
- UI styling uses the theme tokens in `web/src/styles.css` (`[data-theme="night"|"dawn"]`). Don't hard-code colours that differ between themes.
- Commit messages end with a `Co-Authored-By` trailer for Claude.
