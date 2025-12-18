# WORKPLAN — 7min Studio (Progressiva pass + Dagens grej)

## Syfte
Bygga stöd för flera typer av träningspass:
1) HIIT (befintligt)
2) Styrka (ny typ, enkel v1)
3) Progressiva program (ny typ) som skapar en plan över tid, kopplad till kalendern, med adaptiv progression och periodiska tester.

Denna fil är specifikationen. Codex ska följa den exakt och uppdatera `docs/STATE.md` när milestones blir klara.

---

## Designmål (produkt)
- Mobil först: träningsvy under pass ska vara fullscreen (se separat UI-fix-workplan).
- “Dagens grej” syns på START! baserat på kalenderplanen (workout/rest/test).
- Progressiva pass anpassar sig när användaren inte klarar planerade reps.
- Tester sker sällan (default: var 4:e vecka) och uppdaterar programmets nivå.

---

## Ordlista
- **Pass/Template**: en återanvändbar definition av träningspass (t.ex. HIIT-rutin).
- **Session**: ett faktiskt genomfört pass (logg).
- **Program**: en progressiv plan kopplad till en övning och en metod (submax, ladder).
- **Program Day**: en planerad dag i kalendern för ett program (workout/rest/test).
- **Plan**: vad som ska göras idag (t.ex. sets/reps).
- **Result**: vad som faktiskt genomfördes.

---

## Rekommenderade progressiva metoder (v1)
Starta med dessa två (90% nytta, enkel UI):
1) **SUBMAX**: flera set på ~60–80% av max (submaximal volym).
2) **LADDER**: trappa upp 1–2–3–…–top (1–N) med vila.

Senare (v2/v3):
- DENSITY / EMOM
- GTG (Grease the Groove)

AI ska inte styra progression i v1. AI kan komma senare som coach-lager.

---

# Datamodell (SQLite)

## Befintliga tabeller
Projektet har redan auth + programs/exercises i någon form. Codex ska INTE gissa.
Om tabeller redan finns: återanvänd namn och lägg till fält via migration.
Om tabeller saknas: skapa nedan.

### Viktigt: namn-krock med befintliga `programs`
Projektet har redan `programs` + `program_exercises` som används för HIIT/7-minuters-pass (och `WorkoutScreen.jsx` laddar via `/api/programs/:id`).
För att undvika att bryta befintlig funktionalitet använder vi **separata tabeller** för progressiva program:
- `progressive_programs`
- `progressive_program_days`

## Nya tabeller (v1)

### progressive_programs
Progressivt program för en user + övning + metod.
- id TEXT PRIMARY KEY
- user_id INTEGER NOT NULL
- exercise_key TEXT NOT NULL           -- ex: "burpees" | "pushups" | "pullups"
- method TEXT NOT NULL                 -- "submax" | "ladder"
- target_value INTEGER NULL            -- valfritt framtida mål, ex 50
- test_max INTEGER NOT NULL            -- senaste max-test
- schedule_json TEXT NOT NULL          -- schema: dagar/vecka, preferenser
- state_json TEXT NOT NULL             -- aktuell nivå + historik, adaptiv status
- active INTEGER NOT NULL DEFAULT 1
- created_at TEXT NOT NULL

Index:
- INDEX progressive_programs_user_active ON progressive_programs(user_id, active)

### progressive_program_days
Planerad kalenderdag för ett program.
- id TEXT PRIMARY KEY
- program_id TEXT NOT NULL             -- FK -> progressive_programs.id
- date TEXT NOT NULL                   -- YYYY-MM-DD
- day_type TEXT NOT NULL               -- "workout" | "rest" | "test"
- plan_json TEXT NULL                  -- dagens plan (sets/reps etc)
- status TEXT NOT NULL DEFAULT "planned"   -- planned|done|skipped
- result_json TEXT NULL                -- faktisk prestation per set
- created_at TEXT NOT NULL

Constraints:
- UNIQUE(program_id, date)

Index:
- INDEX progressive_program_days_program_date ON progressive_program_days(program_id, date)
- INDEX progressive_program_days_date ON progressive_program_days(date)

### (valfritt men rekommenderat) workout_sessions.program_day_id
Om ni redan har `workout_sessions`, lägg till:
- program_day_id TEXT NULL

Syfte: koppla dagens program-workout till sessionlogg.

---

# JSON-kontrakt

## plan_json (Progressivt)
All plan ska kunna renderas i träningsvyn utan specialfall.

### plan_json: SUBMAX
Exempel:
{
  "method": "submax",
  "exercise_key": "burpees",
  "sets": [
    { "target_reps": 8, "rest_sec": 90 },
    { "target_reps": 8, "rest_sec": 90 },
    { "target_reps": 8, "rest_sec": 90 },
    { "target_reps": 8, "rest_sec": 90 },
    { "target_reps": 8, "rest_sec": 120 }
  ],
  "notes": "Submax volym. Stoppa 1–2 reps innan failure."
}

### plan_json: LADDER
Exempel:
{
  "method": "ladder",
  "exercise_key": "pullups",
  "ladders": [
    { "steps": [1,2,3,4,5], "rest_between_steps_sec": 60, "rest_between_ladders_sec": 120 }
  ],
  "notes": "Ladder. Ingen failure. Bra form."
}

## result_json (Per set / per step)
När användaren inte klarar target:
- vi sparar actual reps.

SUBMAX result:
{
  "sets": [
    { "target_reps": 8, "actual_reps": 8 },
    { "target_reps": 8, "actual_reps": 7 },
    { "target_reps": 8, "actual_reps": 6 },
    { "target_reps": 8, "actual_reps": 8 },
    { "target_reps": 8, "actual_reps": 7 }
  ],
  "completed_at": "2025-12-18T19:40:00Z"
}

LADDER result:
{
  "steps": [1,2,3,4,3],  -- sista steget missades (klarade 3 istället för 5)
  "completed_at": "2025-12-18T19:40:00Z"
}

---

# Regler: Generering, progression, test

## Grundregler
- Programmet ska skapa `progressive_program_days` för 4 veckor framåt vid skapande.
- Programmet ska alltid ha exakt EN “dagens grej” per datum per aktivt program.
- Test ska planeras var 4:e vecka (default). Kan vara konfig senare.

## Scheduling (v1)
Wizard låter user välja 3 eller 4 dagar/vecka.
- 3 dagar/vecka: t.ex. mån/ons/fre (rest övriga)
- 4 dagar/vecka: t.ex. mån/tis/tor/lör

`program.schedule_json` ska spara:
{
  "days_per_week": 3,
  "preferred_days": ["Mon","Wed","Fri"],
  "test_every_weeks": 4
}

## SUBMAX: plan från test_max
- work_reps = round(test_max * 0.70)
- sets = 5
- rest = 90–120 sek (v1: 90 för set 1–4, 120 för sista)
- plan: 5 set med samma target reps

SUBMAX progression efter workout:
- total_target = sum(target_reps)
- total_actual = sum(actual_reps)
- ratio = total_actual / total_target
- Om ratio >= 0.90 → öka work_reps +1 nästa workout
- Om 0.70 <= ratio < 0.90 → behåll
- Om ratio < 0.70 → sänk work_reps -1 nästa workout
- Clamp work_reps: min 1, max test_max (v1)

## LADDER: plan från test_max
- top = clamp(round(test_max * 0.60), min=3, max=12)
- ladder steps = [1..top]
- (v1) ladders = 1
- rests: 60s mellan steps, 120s mellan ladders (om fler senare)

LADDER progression:
- Om användaren klarar hela stegen till top → top + 1
- Om missar på steg k (dvs klarar < target på sista) → behåll top (v1) eller sätt top = k nästa gång (v2)
- Clamp top: min 3, max 20 (v1)

## Test-dag (var 4:e vecka)
- Skapa en `progressive_program_day` med day_type="test"
- Test-dagen kräver input: actual max reps (heltal)
- När testresultat sparas:
  - progressive_programs.test_max = ny max
  - Re-baseline state_json (work_reps/top räknas om)
  - Skapa kommande 4 veckors dagar om de saknas

---

# API (Node/Express)

## Auth
Alla endpoints kräver inloggning (JWT/cookie som ni redan har).

## Program
### POST /api/progressive-programs
Skapa program + generera 4 veckor progressive_program_days.
Body:
{
  "exercise_key": "burpees",
  "method": "submax",
  "test_max": 12,
  "days_per_week": 3,
  "preferred_days": ["Mon","Wed","Fri"]
}

Return:
{ "program": {...}, "days_created": 28 }

### GET /api/progressive-programs
Lista användarens program (active först).

### GET /api/progressive-programs/:id
Returnera program + kommande progressive_program_days.

### POST /api/progressive-programs/:id/deactivate
Sätt active=0 (stoppa planering).

## Program day
### GET /api/today
Returnera “dagens grej”:
- Om aktivt program har progressive_program_day för dagens datum → returnera den
- Annars returnera { kind:"none" }

Return-exempel:
{
  "kind": "program_day",
  "program_day": { ... },
  "program": { ... }
}

### POST /api/program-days/:id/complete
Spara result_json och markera done.
Body:
{ "result_json": { ... } }

Servern ska:
- spara result_json
- status="done"
- uppdatera programs.state_json (progression)
- uppdatera kommande workout-day plan_json (nästa pass) baserat på nya state

### POST /api/program-days/:id/test
Spara nytt max-test och markera test-dagen som done.
Body:
{ "test_max": 14 }

Servern ska:
- status="done" + spara result_json (inkl completed_at)
- uppdatera program.test_max
- re-baseline state_json (work_reps/top räknas om)
- skapa kommande 4 veckors dagar om de saknas

### POST /api/program-days/:id/skip
status="skipped" (valfritt v1)

UPPDATERA INTE progression.

---

# UI (React)

## Passen: Nytt pass (Pass-typ)
När user klickar “+ Skapa nytt pass”:
- visa val av typ:
  - HIIT
  - Styrka
  - Progressivt

### HIIT
Gå till befintlig editor.

### Styrka (v1)
Skapa pass med typ="strength" (kan vara enkel lista av övningar + set/reps).
Ingen avancerad progression i v1.

### Progressivt
Starta “Program Wizard”.

## Program Wizard (Progressivt)
Steg:
1) Välj övning (burpees/pushups/pullups)
2) Input max (test_max)
3) Välj metod: submax / ladder (kort text)
4) Välj dagar/vecka (3 eller 4)
5) Skapa → POST /api/progressive-programs

## START! “Dagens grej”-kort
- anropa GET /api/today
- Om rest: visa “Vilodag”
- Om workout/test: visa knapp “Starta”
- Starta ska navigera till träningsvyn för program_day:
  - `/workout/program-day/:id` eller motsvarande

## Träningsvy för program_day
- Rendera plan_json
- För varje set/step: visa target + input för actual
- Efter sista set: “Spara & Klar”
  - POST /api/program-days/:id/complete

VIKTIGT:
- Om user under passet inte klarar target → user väljer actual (heltal)
- Default actual = target (snabbt)

## Progress-sidan
Visa:
- Aktivt program
- Senaste test_max
- Nästa test-datum (baserat på kommande progressive_program_days)
- Veckovy: planned/done/skipped

---

# Implementation rules för Codex
- Små PR: en milestone åt gången.
- Migrations först.
- Backend endpoints med tydliga request/response.
- UI: minimal men komplett, mobil-first.
- Gissa inte befintliga tabeller: kontrollera vad som redan finns.
- Uppdatera `docs/STATE.md` efter varje milestone.

---

# Milestones (ordning)

## M1 — Pass-typ i “Skapa nytt pass”
- UI: val av HIIT / Styrka / Progressivt
- Styrka kan vara stub v1 (skapar placeholder)

## M2 — DB: progressive_programs + progressive_program_days + (ev) program_day_id i sessions
- migrations
- minimal seed/README
OBS: För att undvika namn-krock med befintliga HIIT-tabeller använder vi `progressive_programs` + `progressive_program_days` istället för `programs` + `program_days`.

## M3 — Backend: create/list program + today endpoint
- POST /api/progressive-programs
- GET /api/progressive-programs
- GET /api/today

## M4 — Wizard UI + “Dagens grej”
- Wizard i Passen
- Start! visar dagens program_day

## M5 — Program-day träningsvy + result + progression v1
- POST /api/program-days/:id/complete
- Adaptiv progression
- Ny plan genereras för nästa workout

## M6 — Test day var 4:e vecka
- UI för test input
- Re-baseline av program

## M7 — Progress-sida: plan vs done + test-info
- visuellt och tydligt

## M8 — (Senare) AI coach-lager
- ej del av v1-motorn

---

# QA / Testfall
- Skapa program (submax, burpees, max=12, 3 dagar/vecka)
- Verify: 4 veckor progressive_program_days skapade, inkl 1 testdag i vecka 4
- Idag (om matchar plan): START visar “Dagens grej”
- Genomför workout: mata in actual reps lägre än target
- Verify: nästa workout plan_json justeras enligt progression
- Genomför test: uppdatera test_max → verify plan rebasas
