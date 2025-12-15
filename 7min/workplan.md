WORKPLAN.md 

A. Repo-konventioner (en gång)
	•	server/ (Node/Express)
	•	db/ (schema.sql, migrations/, migrate.js)
	•	routes/ (auth, library, sessions, calendar, import, treadmill, ai)
	•	services/ (points, routines, programs, importers, treadmillBridge, aiCoach)
	•	middleware/ (auth, error, rateLimit)
	•	client/ (React/Vite)
	•	src/pages/ (Overview, Calendar, Library, Builder, Session, Tests, Import, Treadmill, Coach, Settings)
	•	src/components/ (TopBar, WeekBars, CalendarGrid, SessionList, TemplateCard, RoutineBadge, TestCard, ImportWizard)
	•	src/api/ (fetch-wrappers)
	•	src/styles/ (ren CSS, modulärt per vy)

DoD: bygg/serve funkar lokalt, migrations körs via node server/db/migrate.js.

⸻

B. Milestone 1 — Datamodell v1 (klarar allt)

B1.1 Skapa migrations-system
	•	Tabell migrations(id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)
	•	server/db/migrate.js kör alla .sql i ordning.

B1.2 DB-tabeller (minsta nödvändiga)
	1.	workout_templates

	•	id, owner_user_id, title, description, visibility (private|shared|public), type (hiit|strength|run|mobility|test|other), estimated_minutes, created_at, updated_at

	2.	template_blocks (flexibel blockmodell)

	•	id, template_id, sort_index, block_type (interval|exercise|rest|note), payload_json (t.ex. {exerciseId, reps, sets, weight, seconds, distance})

	3.	workout_sessions

	•	id, user_id, template_id NULL, session_type, started_at, ended_at, duration_sec, notes, source (manual|import|treadmill|ai)

	4.	session_entries

	•	id, session_id, sort_index, entry_type, payload_json

	5.	routines (för grön bock som släcks)

	•	id, user_id, template_id, title, due_rule_json (t.ex. {type:"every_n_days", n:2}), next_due_at, active

	6.	routine_completions

	•	id, routine_id, session_id, completed_at

	7.	fitness_tests + test_results

	•	fitness_tests(id, name, unit, description, category, scoring_json)
	•	test_results(id, user_id, test_id, value_num, value_text NULL, performed_at, notes)

	8.	imports

	•	imports(id, user_id, kind, filename, status, created_at, meta_json, error_text NULL)

DoD: du kan skapa ett template, starta en session, spara entries, lista sessions per datumintervall.

⸻

C. Milestone 2 — Kalender + Strava-lik överblick

C2.1 Backend-endpoints
	•	GET /api/calendar/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
	•	returnera per dag: {date, icons:[...], minutes, points, sessionIds}
	•	GET /api/sessions?date=YYYY-MM-DD
	•	GET /api/sessions/:id

Ikonlogik (v1):
	•	run|treadmill → shoe
	•	strength → dumbbell
	•	hiit → bolt
	•	test → beaker

C2.2 “Staplar i toppen” (WeekBars)
	•	GET /api/calendar/weekbars?weeks=8
	•	returnera dagliga points + cap (takvärde)

Points-regler (v1, enkel och justerbar i config):
	•	points = round(duration_min * multiplier)
	•	run=1.0, strength=1.1, hiit=1.4, mobility=0.6, test=0.3
	•	cap t.ex. 60 points/dag → när points>=cap markera “hit cap” (UI byter state)

DoD: kalender visar historik + ikoner, top-bar visar 8 veckor med staplar.

⸻

D. Milestone 3 — Bibliotek: Egna + Delade + “grön bock”

D3.1 Backend
	•	GET /api/templates?scope=mine|shared|public
	•	POST /api/templates
	•	POST /api/templates/:id/clone (spara kopia)
	•	GET /api/routines
	•	POST /api/routines
	•	POST /api/routines/:id/complete (kopplas till en session och flyttar next_due_at)

D3.2 Frontend
	•	Bibliotek med två flikar: Egna och Delade
	•	Varje kort visar:
	•	startknapp
	•	“✅” om rutin finns och now < next_due_at
	•	“⏳” om due

DoD: delade pass syns, egna pass syns, rutiner tänds/släcks korrekt från DB.

⸻

E. Milestone 4 — Progressiva program (pullups/pushups osv)

E4.1 DB
	•	programs(id, user_id, kind, target_value, state_json, created_at, active)
	•	program_events(id, program_id, type, created_at, payload_json) (logg)

E4.2 Program-motor (service)
	•	services/programs/pullups.js
	•	input: senaste max-test + senaste genomförda pass
	•	output: nästa schema (set/reps) + när “max-test” ska triggas igen
	•	Generera ett template “on the fly” eller en session-plan (v1: generera template + auto-skapa routine)

DoD: du kan starta ett pullups-program och få “nästa pass” automatiskt.

⸻

F. Milestone 5 — Tester (“Don’t die”-känsla)
	•	UI: Testbibliotek + “logga nytt resultat”
	•	Backend: GET /api/tests, POST /api/tests/results, GET /api/tests/results?testId=...
	•	“Kroppsålder” (valfritt, v2): bara som score/level, inte medicinska påståenden.

DoD: trend per test syns och test-dagar markeras i kalendern.

⸻

G. Milestone 6 — Import (HealthFit CSV + GPX)

G6.1 Import-wizard (frontend)
Steg:
	1.	Välj fil (CSV/GPX)
	2.	Preview (20 rader / 200 punkter)
	3.	Importera (skapar sessions)
	4.	Resultat: “X pass skapade” + felradlista

G6.2 Backend
	•	POST /api/imports (multipart upload)
	•	GET /api/imports/:id (status/progress)
	•	Parser-services:
	•	services/importers/healthfitCsv.js
	•	services/importers/gpx.js (XML → trackpoints → distance, duration, elevation gain, pace)

DoD: historiken fyller kalendern bakåt.

⸻

H. Milestone 7 — Löpband (Pi3 bridge) + Apple Watch-data

H7.1 Bridge-kontrakt (mellan 7min-server och Pi3)
[Unverified] Jag vet inte hur din Pi3-app exponerar kontroll idag, så gör detta som adapter:
	•	server/services/treadmillBridge.js pratar med Pi via HTTP (eller WS)
	•	GET /api/treadmill/status
	•	POST /api/treadmill/start {mode, speed, incline}
	•	POST /api/treadmill/stop
	•	POST /api/treadmill/route {routeId} (för “återspela GPX”)

Spara treadmill-pass som workout_sessions med source="treadmill".

H7.2 Apple Watch (hjärtfrekvens)
[Unverified] Jag kan inte verifiera bästa vägen i din setup, men två realistiska spår att planera för:
	1.	Via HealthFit-import (HR hamnar i CSV-exporten om den finns där) → enklast, inga live-krav.
	2.	Live HR via BLE om du har en Watch-app/lösning som exponerar HR som standard BLE Heart Rate (många appar kan göra detta) → Pi3 kan läsa via BLE och skicka till din server som “live metrics”.

DoD: treadmill-pass kan startas från portalen, och HR kan antingen importeras eller tas live (om du väljer spår 2).

⸻

I. Milestone 8 — AI Coach (OpenAI API)

I8.1 “Context endpoint”
	•	GET /api/ai/context?days=28
	•	summering: minuter/typ, senaste 10 pass, due-routines, programstatus, senaste testresultat, ev. constraints (utrustning hemma)

I8.2 Coach-endpoints
	•	POST /api/ai/suggest {minutesAvailable, equipment[], intensity, goalFocus}
	•	POST /api/ai/review/weekly
	•	Alla AI-svar loggas i ai_logs(id, user_id, created_at, prompt_meta_json, response_json).

I8.3 UI
	•	Coach-sida med snabbknappar: 15/30/60/120
	•	“Skapa pass av förslag” → skapar template + startar session

DoD: du kan be om ett 30-min pass och starta det direkt som timerpass.

⸻

Codex-instruktion (lägg överst i WORKPLAN.md)
	•	Implementera milestones i ordning.
	•	Varje milestone = 1 PR:
	•	migration + backend + minimal UI
	•	manuellt testflöde dokumenterat i docs/testing.md



“Milestone Treadmill Integration”

1) Backend: Treadmill-adapter i Node (Socket.IO client)

Mål: Express-servern ska vara “proxy/controller” mot Pi:n.

Install
	•	Lägg till dependency i server/: socket.io-client

Ny fil
	•	server/services/treadmill/piSocketClient.js

Konfig
	•	ENV:
	•	TREADMILL_PI_URL=http://<pi-ip>:5000
	•	(valfritt) TREADMILL_ENABLED=true

Event-kontrakt (från Pi)
	•	subscribe:
	•	status → { connected: true|false }
	•	data → { raw: "<string>" }

Command-kontrakt (till Pi)
	•	emit:
	•	event: command
	•	payload:
	•	{ cmd: "start" }
	•	{ cmd: "stop" }
	•	{ cmd: "speed", value: number }
	•	{ cmd: "incline", value: number }

Krav
	•	Håll en singleton-connection (en per Node-process).
	•	Auto-reconnect.
	•	Spara senaste:
	•	connected status
	•	senaste 50 raw rader (ring buffer) för debug
	•	Rate-limit kommandon (ex: max 5/sek) för att inte spamma serial.

DoD: Node kan ansluta till Pi, lyssna på status/data, och skicka command.

⸻

2) Backend: API-endpoints i 7min för UI

Ny route
	•	server/routes/treadmill.js

Endpoints
	•	GET /api/treadmill/status
	•	{ enabled, connected, lastRawLines: [...] }
	•	POST /api/treadmill/command
	•	body: { cmd: "start"|"stop"|"speed"|"incline", value?: number }
	•	return: { ok: true }

Validering
	•	speed: number (0–22?) och en decimal (om du vill)
	•	incline: integer/float (0–??)
	•	stop/start: inget value

DoD: Frontend kan styra löpbandet via Express utan att prata direkt med Pi:n.

⸻

3) DB: logga treadmill-sessioner (v1)

Mål: när du trycker start/stop i portalen → skapa pass i kalendern.

Regel (v1 enkel)
	•	När start skickas:
	•	skapa workout_sessions med session_type="treadmill" + source="treadmill" + started_at=now
	•	spara treadmill_state_json (valfritt) med initial speed/incline
	•	När stop skickas:
	•	uppdatera aktuell “öppen” treadmill-session: ended_at=now, duration_sec=...

Ny tabell (valfri men bra)
	•	treadmill_events(id, session_id, ts, kind, payload_json)
	•	logga varje skickat kommando + utvalda raw lines (om du vill)

DoD: varje treadmill-pass hamnar i kalendern med ikon 👟 eller 🏃‍♂️ (din choice).

⸻

4) Frontend: “Treadmill”-sida + knapp i top-nav

Ny sida
	•	client/src/pages/Treadmill.jsx

UI-komponenter
	•	Statusruta: Connected/Disconnected
	•	Knappar: Start / Stop
	•	Sliders/inputs:
	•	Speed (t.ex. 0.5 steg eller fri input)
	•	Incline
	•	Debug-panel (collapsible): senaste raw lines

Polling
	•	Poll GET /api/treadmill/status var 1–2 sekund (v1).
	•	(v2) byt till WebSocket direkt till Express och “push:a” status.

DoD: du kan styra löpbandet från portalen, och ser feedback.

⸻

5) Route playback (senare milestone, men planera nu)

Mål: spela upp GPX som “lutningsprofil” och ev. fartprofil.

Plan
	•	Import GPX → spara polyline + elevation
	•	Beräkna lutning per segment
	•	Skapa “playback scheduler” i Node:
	•	var X sekund: skicka incline (och ev speed)
	•	UI: “Återspela rutt” på treadmill-sidan

DoD (v2): starta route → incline uppdateras automatiskt över tid.

⸻

Codex: konkret testplan (lägg i docs/testing.md)
	1.	Sätt TREADMILL_PI_URL=http://pi:5000
	2.	Starta Node-server
	3.	Öppna /treadmill
	4.	Bekräfta connected:true när USB finns
	5.	Tryck Start → se att Pi får START\n
	6.	Sätt speed 9.5 → Pi får SPEED 9.5\n
	7.	Stop → STOP\n + session stängs i DB

⸻

Om du vill kan jag också skriva en färdig kodskiss (Node-service + route + minimal React-sida) som du kan klistra in, men då behöver jag bara veta:
	•	Vilken port kör din Node/Express på (internt)?
	•	Har du redan en central apiFetch() wrapper i frontend, eller kör du fetch() direkt?

