# Treadmill-Web Databasguide för Bengt 🤖

Hej Bengt! Här är en guide till databasen så du vet var allt sparas.

**Databas:** SQLite  
**Sökväg:** `~/treadmill-web/7min/server/data/app.db`

---

## 📊 Huvudtabeller för träningspass

### `workout_sessions` — Alla träningspass
Detta är **huvudtabellen** för alla loggade pass.

| Kolumn | Typ | Beskrivning |
|--------|-----|-------------|
| `id` | TEXT | Unikt ID (UUID) |
| `user_id` | INTEGER | Användar-ID |
| `session_type` | TEXT | Typ av pass: `hiit`, `strength`, `run`, `mobility`, `test`, `treadmill`, `progressive`, `circuit` |
| `started_at` | TEXT | Starttid (ISO 8601) |
| `ended_at` | TEXT | Sluttid (ISO 8601) |
| `duration_sec` | INTEGER | Total tid i sekunder |
| `notes` | TEXT | Anteckningar |
| `source` | TEXT | Källa: `manual`, `import`, `treadmill`, `ai` |
| `treadmill_state_json` | TEXT | JSON med löpbandsdata (speed, incline) |
| `hiit_program_title` | TEXT | Titel på HIIT-programmet (om tillämpligt) |
| `created_at` | TEXT | När raden skapades |

**Exempel-query för senaste pass:**
```sql
SELECT id, session_type, started_at, ended_at, duration_sec, notes
FROM workout_sessions
WHERE user_id = 1
ORDER BY started_at DESC
LIMIT 5;
```

---

### `circuit_sessions` — Circuit/HIIT-pass
Specifik tabell för circuit-träning med rundor.

| Kolumn | Typ | Beskrivning |
|--------|-----|-------------|
| `id` | INTEGER | Unikt ID |
| `user_id` | INTEGER | Användar-ID |
| `circuit_program_id` | INTEGER | Vilket program som kördes |
| `title` | TEXT | Titel på passet |
| `rounds_completed` | INTEGER | Antal rundor genomförda |
| `total_seconds` | INTEGER | Total tid i sekunder |
| `exercise_times` | TEXT | JSON-array med tider per övning |
| `completed_at` | TEXT | När passet avslutades |

**Exempel-query:**
```sql
SELECT title, rounds_completed, total_seconds, completed_at
FROM circuit_sessions
WHERE user_id = 1
ORDER BY completed_at DESC
LIMIT 1;
```

---

### `progressive_program_days` — Progressiva program (dagliga pass)
För progressiva träningsprogram (t.ex. burpees, armhävningar).

| Kolumn | Typ | Beskrivning |
|--------|-----|-------------|
| `id` | TEXT | Unikt ID |
| `program_id` | TEXT | Koppling till `progressive_programs` |
| `date` | TEXT | Datum (YYYY-MM-DD) |
| `day_type` | TEXT | `workout`, `rest`, eller `test` |
| `status` | TEXT | `planned`, `done`, eller `skipped` |
| `plan_json` | TEXT | Planerade sets/reps |
| `result_json` | TEXT | Faktiskt resultat |

**Exempel-query för dagens träning:**
```sql
SELECT ppd.date, ppd.day_type, ppd.status, pp.exercise_key, ppd.result_json
FROM progressive_program_days ppd
JOIN progressive_programs pp ON pp.id = ppd.program_id
WHERE pp.user_id = 1 AND ppd.date = date('now')
ORDER BY ppd.date DESC;
```

---

## 🏃 Bra queries för Bengt

### Senaste passet (oavsett typ)
```sql
SELECT 
  session_type,
  started_at,
  duration_sec,
  notes
FROM workout_sessions
WHERE user_id = 1
ORDER BY COALESCE(started_at, created_at) DESC
LIMIT 1;
```

### Antal pass senaste 7 dagarna
```sql
SELECT COUNT(*) as antal_pass
FROM workout_sessions
WHERE user_id = 1
  AND date(started_at) >= date('now', '-7 days');
```

### Total träningstid denna vecka (minuter)
```sql
SELECT ROUND(SUM(duration_sec) / 60.0, 1) as minuter
FROM workout_sessions
WHERE user_id = 1
  AND date(started_at) >= date('now', 'weekday 0', '-7 days');
```

### Senaste progressiva träningen
```sql
SELECT 
  pp.exercise_key,
  ppd.date,
  ppd.status,
  ppd.result_json
FROM progressive_program_days ppd
JOIN progressive_programs pp ON pp.id = ppd.program_id
WHERE pp.user_id = 1 AND ppd.status = 'done'
ORDER BY ppd.date DESC
LIMIT 1;
```

---

## 📝 Session Types (passtyper)

| Typ | Beskrivning |
|-----|-------------|
| `hiit` | Intervallträning |
| `strength` | Styrketräning |
| `run` | Löpning |
| `mobility` | Rörlighet/stretching |
| `test` | Max-test |
| `treadmill` | Löpbandspass |
| `progressive` | Progressivt program |
| `circuit` | Circuit-träning |

---

## 💡 Tips för Bengt

1. **User ID:** Just nu finns troligen bara `user_id = 1`
2. **Tider:** Alla tider är i ISO 8601-format (UTC)
3. **JSON-fält:** `result_json`, `plan_json` etc. innehåller strukturerad data
4. **Null-hantering:** Använd `COALESCE()` för att hantera NULL-värden

Lycka till! 🎉

