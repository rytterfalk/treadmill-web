#!/usr/bin/env python3
"""
Genererar weekly-summary.json för Lena att läsa.
Körs automatiskt efter träning eller via cron.
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


def get_week_dates():
    """Get Monday-Sunday dates for current week."""
    today = datetime.now().date()
    monday = today - timedelta(days=today.weekday())
    return [(monday + timedelta(days=i)).isoformat() for i in range(7)]


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


def generate_summary():
    """Generate weekly training summary."""
    if not DB_PATH.exists():
        print(f"Database not found: {DB_PATH}")
        return

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    
    week_dates = get_week_dates()
    from_date = week_dates[0]
    to_date = week_dates[-1]
    today = datetime.now().date().isoformat()
    
    summary = {
        "generated_at": datetime.now().isoformat(),
        "week": {"from": from_date, "to": to_date},
        "today": today,
        "days": [],
        "totals": {
            "workouts": 0,
            "minutes": 0,
            "pushups": 0,
            "runs": 0,
            "run_km": 0.0,
            "challenges": 0,
            "challenge_reps": 0,
        }
    }
    
    for date in week_dates:
        day_data = {
            "date": date,
            "weekday": datetime.fromisoformat(date).strftime("%A"),
            "is_today": date == today,
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
        """, (date,)).fetchall()
        
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
                    workout["run_type"] = run_data.get("run_type", "outdoor")  # outdoor, treadmill, track
                    workout["workout_type"] = run_data.get("workout_type", "easy")  # easy, zone2, intervals, tempo, long, race

                    # Build descriptive title
                    run_labels = {"outdoor": "ute", "treadmill": "löpband", "track": "bana"}
                    workout_labels = {
                        "easy": "Lugnt",
                        "zone2": "Zone 2",
                        "intervals": "Intervaller",
                        "tempo": "Tempo",
                        "long": "Långpass",
                        "race": "Tävling",
                    }
                    run_label = run_labels.get(workout["run_type"], "")
                    workout_label = workout_labels.get(workout["workout_type"], "")
                    if workout_label:
                        workout["title"] = f"{workout_label} {workout['distance_km']}km ({run_label})"
                    else:
                        workout["title"] = f"Löpning {workout['distance_km']}km ({run_label})"

                    summary["totals"]["runs"] += 1
                    summary["totals"]["run_km"] += workout["distance_km"]
                except:
                    pass
            
            day_data["workouts"].append(workout)
            summary["totals"]["workouts"] += 1
            summary["totals"]["minutes"] += workout["minutes"]
        
        # Get progressive program (pushups etc)
        pushups = conn.execute("""
            SELECT ppd.result_json, pp.exercise_key
            FROM progressive_program_days ppd
            JOIN progressive_programs pp ON pp.id = ppd.program_id
            WHERE ppd.date = ? AND ppd.result_json IS NOT NULL
        """, (date,)).fetchall()
        
        for p in pushups:
            reps = parse_pushups(p["result_json"])
            day_data["pushups"] += reps
            summary["totals"]["pushups"] += reps
        
        # Get daily challenges
        challenges = conn.execute("""
            SELECT dc.exercise, dc.target_reps, dc.is_timed,
                   (SELECT COALESCE(SUM(reps), 0) FROM daily_challenge_sets WHERE challenge_id = dc.id) as total_reps,
                   (SELECT COALESCE(SUM(seconds), 0) FROM daily_challenge_sets WHERE challenge_id = dc.id) as total_seconds,
                   (SELECT COUNT(*) FROM daily_challenge_sets WHERE challenge_id = dc.id) as sets_count
            FROM daily_challenges dc
            WHERE dc.date = ?
        """, (date,)).fetchall()
        
        for c in challenges:
            challenge = {
                "exercise": c["exercise"],
                "sets": c["sets_count"],
                "reps": c["total_reps"],
                "seconds": c["total_seconds"] if c["is_timed"] else None,
            }
            day_data["challenges"].append(challenge)
            summary["totals"]["challenges"] += 1
            summary["totals"]["challenge_reps"] += c["total_reps"]
        
        summary["days"].append(day_data)
    
    conn.close()
    
    # Write output
    with open(OUTPUT_PATH, "w") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)
    
    print(f"✅ Summary written to {OUTPUT_PATH}")
    print(f"   Workouts: {summary['totals']['workouts']}, Minutes: {summary['totals']['minutes']}")
    print(f"   Pushups: {summary['totals']['pushups']}, Runs: {summary['totals']['runs']} ({summary['totals']['run_km']:.1f}km)")


if __name__ == "__main__":
    generate_summary()

