# State — 7min (Progressiva pass)

Detta dokument beskriver status på arbetet enligt `7min/workplan progress workout.md`.

## Klar

### M2 — DB: progressiva tabeller
- Migration: `7min/server/db/migrations/0002_progressive_programs.sql`
  - `progressive_programs`
  - `progressive_program_days`
  - `workout_sessions.program_day_id` (koppling mellan planerad dag och loggad session)

### M3 — Backend: program + today endpoint
- Routes: `7min/server/routes/progressive.js`
  - `POST /api/progressive-programs`
  - `GET /api/progressive-programs`
  - `GET /api/progressive-programs/:id`
  - `POST /api/progressive-programs/:id/deactivate`
  - `GET /api/today`

### M4 — Wizard UI + “Dagens grej”
- Wizard: `7min/client/src/components/ProgressiveProgramWizard.jsx`
- START-kort: `7min/client/src/App.jsx` (anropar `GET /api/today`)

### M5 — Program-day träningsvy + result + progression v1
- Träningsvy: `7min/client/src/components/ProgramDayScreen.jsx` (`/workout/program-day/:id`)
- Backend:
  - `POST /api/program-days/:id/complete` (sparar resultat + uppdaterar state + uppdaterar nästa workout plan)
  - `POST /api/program-days/:id/skip` (markerar skipped, uppdaterar inte progression)

### M6 — Test day var 4:e vecka
- Backend: `POST /api/program-days/:id/test` (sparar nytt max, re-basar state, skapar nästa 4 veckor vid behov)
- UI: `7min/client/src/components/ProgramDayScreen.jsx` (test-input när `day_type === "test"`)

## Näst
- M7 — Progress-sida: plan vs done + test-info
