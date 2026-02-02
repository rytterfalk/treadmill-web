#!/usr/bin/env python3
"""
Genererar training-summary.json för Lena att läsa.
Körs automatiskt efter varje träningspass.
Innehåller 8 veckors historik för trendanalys.
"""
import os
import json
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

# Paths
SCRIPT_DIR = Path(__file__).parent.parent
DB_PATH = SCRIPT_DIR / "7min/server/data/app.db"
OUTPUT_PATH = SCRIPT_DIR / "weekly-summary.json"

# How many weeks of history to include
WEEKS_OF_HISTORY = 8


def get_week_info(date):
    """Get week number and Monday date for a given date."""
    monday = date - timedelta(days=date.weekday())
    week_num = date.isocalendar()[1]
    return week_num, monday


def parse_pushups(result_json):
    """Extract total reps from progressive_program_days result_json."""
    if not result_json:
        return 0
    try:
        data = json.loads(result_json)
        if "sets" in data:
            return sum(s.get("actual_reps", 0) for s in data["sets"])
        if "steps" in data:
            return len(data["steps"])  # Trappor
    except:
        pass
    return 0


def get_day_data(conn, date_str, today_str):
    """Get all training data for a specific date."""
    day_data = {
        "date": date_str,
        "weekday": datetime.fromisoformat(date_str).strftime("%A"),
        "is_today": date_str == today_str,
        "workouts": [],
        "pushups": 0,
        "challenges": [],
    }

    # Get workout sessions
    workouts = conn.execute("""
        SELECT ws.session_type, ws.duration_sec, ws.notes, ws.treadmill_state_json,
               ws.hiit_program_title, wt.title as template_title
        FROM workout_sessions ws
        LEFT JOIN workout_templates wt ON wt.id = ws.template_id
        WHERE date(COALESCE(ws.started_at, ws.ended_at, ws.created_at), 'localtime') = ?
        ORDER BY ws.started_at
    """, (date_str,)).fetchall()

    for w in workouts:
        workout = {
            "type": w["session_type"],
            "minutes": (w["duration_sec"] or 0) // 60,
            "title": w["hiit_program_title"] or w["template_title"] or w["session_type"],
        }

        # Parse run data
        if w["session_type"] == "run" and w["treadmill_state_json"]:
            try:
                run_data = json.loads(w["treadmill_state_json"])
                workout["distance_km"] = run_data.get("distance_km", 0)
                workout["pace"] = run_data.get("pace_min_per_km", "")
                workout["run_type"] = run_data.get("run_type", "outdoor")
                workout["workout_type"] = run_data.get("workout_type", "easy")

                run_labels = {"outdoor": "ute", "treadmill": "löpband", "track": "bana"}
                workout_labels = {
                    "easy": "Lugnt", "zone2": "Zone 2", "intervals": "Intervaller",
                    "tempo": "Tempo", "long": "Långpass", "race": "Tävling",
                }
                run_label = run_labels.get(workout["run_type"], "")
                workout_label = workout_labels.get(workout["workout_type"], "")
                if workout_label:
                    workout["title"] = f"{workout_label} {workout['distance_km']}km ({run_label})"
                else:
                    workout["title"] = f"Löpning {workout['distance_km']}km ({run_label})"
            except:
                pass

        day_data["workouts"].append(workout)

    # Get progressive program (pushups etc)
    pushups = conn.execute("""
        SELECT ppd.result_json, pp.exercise_key
        FROM progressive_program_days ppd
        JOIN progressive_programs pp ON pp.id = ppd.program_id
        WHERE ppd.date = ? AND ppd.result_json IS NOT NULL
    """, (date_str,)).fetchall()

    for p in pushups:
        day_data["pushups"] += parse_pushups(p["result_json"])

    # Get daily challenges
    challenges = conn.execute("""
        SELECT dc.exercise, dc.target_reps, dc.is_timed,
               (SELECT COALESCE(SUM(reps), 0) FROM daily_challenge_sets WHERE challenge_id = dc.id) as total_reps,
               (SELECT COALESCE(SUM(seconds), 0) FROM daily_challenge_sets WHERE challenge_id = dc.id) as total_seconds,
               (SELECT COUNT(*) FROM daily_challenge_sets WHERE challenge_id = dc.id) as sets_count
        FROM daily_challenges dc
        WHERE dc.date = ?
    """, (date_str,)).fetchall()

    for c in challenges:
        day_data["challenges"].append({
            "exercise": c["exercise"],
            "sets": c["sets_count"],
            "reps": c["total_reps"],
            "seconds": c["total_seconds"] if c["is_timed"] else None,
        })

    return day_data


def calculate_week_totals(days):
    """Calculate totals for a week from day data."""
    totals = {"workouts": 0, "minutes": 0, "pushups": 0, "runs": 0, "run_km": 0.0, "challenges": 0, "challenge_reps": 0}
    for day in days:
        totals["pushups"] += day["pushups"]
        for w in day["workouts"]:
            totals["workouts"] += 1
            totals["minutes"] += w.get("minutes", 0)
            if w.get("type") == "run" and w.get("distance_km"):
                totals["runs"] += 1
                totals["run_km"] += w["distance_km"]
        for c in day["challenges"]:
            totals["challenges"] += 1
            totals["challenge_reps"] += c.get("reps", 0)
    return totals


def generate_summary():
    """Generate training summary with 8 weeks of history."""
    if not DB_PATH.exists():
        print(f"Database not found: {DB_PATH}")
        return

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    today = datetime.now().date()
    today_str = today.isoformat()

    # Calculate date range: 8 weeks back from current week's Monday
    current_monday = today - timedelta(days=today.weekday())
    start_date = current_monday - timedelta(weeks=WEEKS_OF_HISTORY - 1)

    # Build weeks structure
    weeks = []
    for week_offset in range(WEEKS_OF_HISTORY):
        week_monday = start_date + timedelta(weeks=week_offset)
        week_sunday = week_monday + timedelta(days=6)
        week_num = week_monday.isocalendar()[1]

        is_current_week = week_monday == current_monday

        # Get all days in this week
        days = []
        for day_offset in range(7):
            day_date = week_monday + timedelta(days=day_offset)
            if day_date <= today:  # Don't include future dates
                days.append(get_day_data(conn, day_date.isoformat(), today_str))

        weeks.append({
            "week_number": week_num,
            "from": week_monday.isoformat(),
            "to": week_sunday.isoformat(),
            "is_current_week": is_current_week,
            "days": days,
            "totals": calculate_week_totals(days),
        })

    # Calculate today's totals (for milestone tracking)
    today_data = get_day_data(conn, today_str, today_str)
    today_pushups = today_data["pushups"] + sum(c["reps"] for c in today_data["challenges"] if "armhäv" in c.get("exercise", "").lower())

    conn.close()

    # Build final summary
    summary = {
        "generated_at": datetime.now().isoformat(),
        "today": today_str,
        "today_totals": {
            "workouts": len(today_data["workouts"]),
            "minutes": sum(w.get("minutes", 0) for w in today_data["workouts"]),
            "pushups": today_data["pushups"],
            "challenge_reps": sum(c.get("reps", 0) for c in today_data["challenges"]),
        },
        "current_week": weeks[-1] if weeks else None,  # Most recent week
        "weeks": weeks,
        "totals_all_time": {
            "weeks_tracked": len(weeks),
            "workouts": sum(w["totals"]["workouts"] for w in weeks),
            "minutes": sum(w["totals"]["minutes"] for w in weeks),
            "pushups": sum(w["totals"]["pushups"] for w in weeks),
            "runs": sum(w["totals"]["runs"] for w in weeks),
            "run_km": sum(w["totals"]["run_km"] for w in weeks),
            "challenge_reps": sum(w["totals"]["challenge_reps"] for w in weeks),
        },
    }

    # Write output
    with open(OUTPUT_PATH, "w") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)

    current = weeks[-1]["totals"] if weeks else {}
    print(f"✅ Summary written to {OUTPUT_PATH}")
    print(f"   Denna vecka: {current.get('workouts', 0)} pass, {current.get('minutes', 0)} min, {current.get('pushups', 0)} armhävningar")
    print(f"   Idag: {today_pushups} armhävningar/reps")
    print(f"   Totalt ({WEEKS_OF_HISTORY} veckor): {summary['totals_all_time']['workouts']} pass")


if __name__ == "__main__":
    generate_summary()

