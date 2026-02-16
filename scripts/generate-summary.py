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


def get_day_data(conn, date_str, today_str, user_id=1):
    """Get all training data for a specific date for a specific user."""
    day_data = {
        "date": date_str,
        "weekday": datetime.fromisoformat(date_str).strftime("%A"),
        "is_today": date_str == today_str,
        "workouts": [],
        "pushups": 0,
        "challenges": [],
    }

    # Get workout sessions (filtered by user_id)
    workouts = conn.execute("""
        SELECT ws.session_type, ws.duration_sec, ws.notes, ws.treadmill_state_json,
               ws.hiit_program_title, wt.title as template_title
        FROM workout_sessions ws
        LEFT JOIN workout_templates wt ON wt.id = ws.template_id
        WHERE date(COALESCE(ws.started_at, ws.ended_at, ws.created_at), 'localtime') = ?
          AND ws.user_id = ?
        ORDER BY ws.started_at
    """, (date_str, user_id)).fetchall()

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

    # Get progressive program (pushups etc) - filtered by user_id
    pushups = conn.execute("""
        SELECT ppd.result_json, pp.exercise_key
        FROM progressive_program_days ppd
        JOIN progressive_programs pp ON pp.id = ppd.program_id
        WHERE ppd.date = ? AND ppd.result_json IS NOT NULL AND pp.user_id = ?
    """, (date_str, user_id)).fetchall()

    for p in pushups:
        day_data["pushups"] += parse_pushups(p["result_json"])

    # Get daily challenges - filtered by user_id
    challenges = conn.execute("""
        SELECT dc.exercise, dc.target_reps, dc.is_timed,
               (SELECT COALESCE(SUM(reps), 0) FROM daily_challenge_sets WHERE challenge_id = dc.id) as total_reps,
               (SELECT COALESCE(SUM(seconds), 0) FROM daily_challenge_sets WHERE challenge_id = dc.id) as total_seconds,
               (SELECT COUNT(*) FROM daily_challenge_sets WHERE challenge_id = dc.id) as sets_count
        FROM daily_challenges dc
        WHERE dc.date = ? AND dc.user_id = ?
    """, (date_str, user_id)).fetchall()

    for c in challenges:
        day_data["challenges"].append({
            "exercise": c["exercise"],
            "sets": c["sets_count"],
            "reps": c["total_reps"],
            "seconds": c["total_seconds"] if c["is_timed"] else None,
        })

    return day_data


def is_pushup_exercise(name):
    """Check if exercise name is a pushup variant."""
    if not name:
        return False
    name_lower = name.lower()
    # Match: armhävningar, pushups, diamant, ryska, trippel, etc
    pushup_keywords = ["armhäv", "pushup", "push-up", "push up", "diamant", "rysk", "trippel", "triple", "wide", "close", "decline", "incline"]
    return any(kw in name_lower for kw in pushup_keywords)


def calculate_week_totals(days):
    """Calculate totals for a week from day data."""
    totals = {"workouts": 0, "minutes": 0, "pushups": 0, "runs": 0, "run_km": 0.0, "challenges": 0, "challenge_reps": 0, "all_pushups": 0}
    for day in days:
        totals["pushups"] += day["pushups"]
        totals["all_pushups"] += day["pushups"]  # From progressive programs
        for w in day["workouts"]:
            totals["workouts"] += 1
            totals["minutes"] += w.get("minutes", 0)
            if w.get("type") == "run" and w.get("distance_km"):
                totals["runs"] += 1
                totals["run_km"] += w["distance_km"]
        for c in day["challenges"]:
            totals["challenges"] += 1
            totals["challenge_reps"] += c.get("reps", 0)
            # Count pushup-type challenges
            if is_pushup_exercise(c.get("exercise", "")):
                totals["all_pushups"] += c.get("reps", 0)
    return totals


def generate_user_summary(conn, user_id, user_name, today, today_str, current_monday, start_date):
    """Generate summary for a single user."""
    weeks = []
    for week_offset in range(WEEKS_OF_HISTORY):
        week_monday = start_date + timedelta(weeks=week_offset)
        week_sunday = week_monday + timedelta(days=6)
        week_num = week_monday.isocalendar()[1]
        is_current_week = week_monday == current_monday

        days = []
        for day_offset in range(7):
            day_date = week_monday + timedelta(days=day_offset)
            if day_date <= today:
                days.append(get_day_data(conn, day_date.isoformat(), today_str, user_id))

        weeks.append({
            "week_number": week_num,
            "from": week_monday.isoformat(),
            "to": week_sunday.isoformat(),
            "is_current_week": is_current_week,
            "days": days,
            "totals": calculate_week_totals(days),
        })

    today_data = get_day_data(conn, today_str, today_str, user_id)
    today_all_pushups = today_data["pushups"] + sum(
        c["reps"] for c in today_data["challenges"] if is_pushup_exercise(c.get("exercise", ""))
    )

    return {
        "name": user_name,
        "today_totals": {
            "workouts": len(today_data["workouts"]),
            "minutes": sum(w.get("minutes", 0) for w in today_data["workouts"]),
            "pushups": today_data["pushups"],
            "challenge_reps": sum(c.get("reps", 0) for c in today_data["challenges"]),
            "all_pushups": today_all_pushups,
        },
        "current_week": weeks[-1] if weeks else None,
        "weeks": weeks,
        "totals_all_time": {
            "weeks_tracked": len(weeks),
            "workouts": sum(w["totals"]["workouts"] for w in weeks),
            "minutes": sum(w["totals"]["minutes"] for w in weeks),
            "pushups": sum(w["totals"]["pushups"] for w in weeks),
            "all_pushups": sum(w["totals"]["all_pushups"] for w in weeks),
            "runs": sum(w["totals"]["runs"] for w in weeks),
            "run_km": sum(w["totals"]["run_km"] for w in weeks),
            "challenge_reps": sum(w["totals"]["challenge_reps"] for w in weeks),
        },
    }


def generate_summary():
    """Generate training summary with 8 weeks of history for all users."""
    if not DB_PATH.exists():
        print(f"Database not found: {DB_PATH}")
        return

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    today = datetime.now().date()
    today_str = today.isoformat()
    current_monday = today - timedelta(days=today.weekday())
    start_date = current_monday - timedelta(weeks=WEEKS_OF_HISTORY - 1)

    # Get all users
    users = conn.execute("SELECT id, name FROM users").fetchall()
    if not users:
        users = [(1, "Användare")]  # Fallback if no users table

    # Generate summary for each user
    users_data = {}
    for user in users:
        user_id = user["id"] if isinstance(user, sqlite3.Row) else user[0]
        user_name = user["name"] if isinstance(user, sqlite3.Row) else user[1]
        # Use lowercase name as key for easy lookup
        key = user_name.lower()
        users_data[key] = generate_user_summary(conn, user_id, user_name, today, today_str, current_monday, start_date)

    conn.close()

    # Build final summary with all users
    summary = {
        "generated_at": datetime.now().isoformat(),
        "today": today_str,
        "users": users_data,
    }

    # Write output
    with open(OUTPUT_PATH, "w") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)

    print(f"✅ Summary written to {OUTPUT_PATH}")
    print(f"   Användare: {', '.join(users_data.keys())}")
    for name, data in users_data.items():
        totals = data.get("totals_all_time", {})
        print(f"   {name}: {totals.get('all_pushups', 0)} armhävningar, {totals.get('workouts', 0)} pass")


if __name__ == "__main__":
    generate_summary()

