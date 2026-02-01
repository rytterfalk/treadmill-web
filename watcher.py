#!/usr/bin/env python3
import os
import asyncio
import aiosqlite
import json
import logging
import re
from datetime import datetime, date, timedelta
from dotenv import load_dotenv
from telegram import Bot

# Load env
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
TOKEN = os.getenv("TELEGRAM_TOKEN")
CHAT = os.getenv("TARGET_CHAT_ID")
DBPATH = os.path.expanduser(os.getenv("TREADMILL_DB", "/treadmill-web/7min/server/data/app.db"))
DAYS_NO_TRAINING = int(os.getenv("DAYS_NO_TRAINING", "3"))
PUSH_THRESHOLD = int(os.getenv("PUSH_THRESHOLD", "500"))  # total reps/day
PER_PASS_THRESHOLD = int(os.getenv("PER_PASS_THRESHOLD", "50"))  # reps in single pass
INTERVAL = int(os.getenv("WATCH_INTERVAL", "60"))

# State / history files
STATE_FILE = os.path.expanduser("~/.treadmill-bot-watcher.state")
HISTORY_FILE = os.path.expanduser("~/.treadmill-bot-history.json")
GOALS_FILE = os.path.expanduser("~/.treadmill-bot-goals.json")

# Setup
bot = Bot(token=TOKEN)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("treadmill-watcher")


# Helpers for persistent state

def load_state():
    try:
        with open(STATE_FILE, "r") as f:
            return json.load(f)
    except Exception:
        return {"last_seen_sessions": [], "last_checked": None}


def save_state(s):
    with open(STATE_FILE, "w") as f:
        json.dump(s, f)


def load_history():
    try:
        with open(HISTORY_FILE, "r") as f:
            return json.load(f)
    except Exception:
        return {}  # keyed by date -> {"reps":N, "minutes":M, "best": bool}


def save_history(h):
    with open(HISTORY_FILE, "w") as f:
        json.dump(h, f, indent=2)


def load_goals():
    try:
        with open(GOALS_FILE, "r") as f:
            return json.load(f)
    except Exception:
        return {}  # keyed by date or goal id


def save_goals(g):
    with open(GOALS_FILE, "w") as f:
        json.dump(g, f, indent=2)


# Parsing helpers

def parse_reps_from_jsonfield(jsontext):
    """Try to pull numeric reps from common JSON structures (simple heuristics)"""
    if not jsontext:
        return 0
    try:
        j = json.loads(jsontext)
    except Exception:
        return 0
    total = 0
    # common keys: reps, sets, exercises -> list of {reps, sets}
    if isinstance(j, dict):
        if "reps" in j and isinstance(j["reps"], int):
            total += j["reps"]
        # plan/result structures may contain arrays
        for k in ("result", "result_json", "plan", "exercises", "items", "sets"):
            v = j.get(k)
            if isinstance(v, list):
                for it in v:
                    if isinstance(it, dict):
                        r = it.get("reps") or it.get("count") or it.get("repetition") or 0
                        s = it.get("sets") or it.get("sets_count") or 1
                        try:
                            total += int(r) * int(s)
                        except Exception:
                            pass
    # alternative: entries with 'reps' nested
    def walk(o):
        nonlocal total
        if isinstance(o, dict):
            for key, val in o.items():
                if key in ("reps", "count", "repetition") and isinstance(val, int):
                    total += val
                else:
                    walk(val)
        elif isinstance(o, list):
            for x in o:
                walk(x)
    walk(j)
    return total


async def sum_progressive_for_date(db, userid=1, target_date=None):
    """Sum reps from progressive_program_days.result_json for given date"""
    if target_date is None:
        target_date = date.today().isoformat()
    total = 0
    async with db.execute(
        "SELECT result_json FROM progressive_program_days ppd "
        "JOIN progressive_programs pp ON pp.id = ppd.program_id "
        "WHERE pp.user_id = ? AND ppd.date = ?",
        (userid, target_date)
    ) as cur:
        rows = await cur.fetchall()
        for (rjson,) in rows:
            total += parse_reps_from_jsonfield(rjson)
    return total


async def sum_workout_sessions_for_date(db, userid=1, target_date=None):
    if target_date is None:
        target_date = date.today().isoformat()
    total_reps = 0
    total_minutes = 0
    # workout_sessions may have treadmill_state_json or notes with reps
    async with db.execute(
        "SELECT id, session_type, started_at, duration_sec, treadmill_state_json, notes "
        "FROM workout_sessions WHERE user_id = ? AND date(started_at) = date(?) "
        "ORDER BY started_at ASC",
        (userid, target_date)
    ) as cur:
        rows = await cur.fetchall()
        for row in rows:
            sid, stype, started_at, duration_sec, tjson, notes = row
            total_minutes += (int(duration_sec) // 60) if duration_sec else 0
            # parse treadmill_state_json
            total_reps += parse_reps_from_jsonfield(tjson or "")
            # try parse ints from notes: e.g. "34 reps"
            if notes:
                m = re.findall(r"(\d+)\sreps|\b(\d+)\srep\b", notes)
                for grp in m:
                    for g in grp:
                        if g:
                            total_reps += int(g)
    return total_reps, total_minutes


async def sum_circuit_for_date(db, userid=1, target_date=None):
    if target_date is None:
        target_date = date.today().isoformat()
    total_reps = 0
    async with db.execute(
        "SELECT exercise_times FROM circuit_sessions "
        "WHERE user_id = ? AND date(completed_at) = date(?)",
        (userid, target_date)
    ) as cur:
        rows = await cur.fetchall()
        for (etxt,) in rows:
            total_reps += parse_reps_from_jsonfield(etxt or "")
    return total_reps


async def get_latest_workout_rows(db, last_seen_ids):
    rows = []
    async with db.execute(
        "SELECT id, user_id, session_type, started_at, duration_sec, treadmill_state_json, notes "
        "FROM workout_sessions WHERE COALESCE(started_at, created_at) >= datetime('now','-7 days') "
        "ORDER BY COALESCE(started_at, created_at) ASC"
    ) as cur:
        allrows = await cur.fetchall()
        for r in allrows:
            rid = r[0]
            if rid not in last_seen_ids:
                rows.append(r)
    return rows


# Goal parsing from free text (simple)

def parse_goal_from_text(text):
    """Example triggers: 'mål 1000 armhävningar', 'mål: 1000 pushups', 'goal 500'"""
    m = re.search(r"mål[:\s]([0-9]{2,6})", text, re.IGNORECASE)
    if not m:
        m = re.search(r"goal[:\s]([0-9]{2,6})", text, re.IGNORECASE)
    if m:
        try:
            return int(m.group(1))
        except:
            return None
    # also catch phrases like "idag är målet 1000"
    m2 = re.search(r"([0-9]{2,6})\s*(armh|armhäv|pushup|pushups|reps)", text, re.IGNORECASE)
    if m2:
        return int(m2.group(1))
    return None


async def main_loop():
    state = load_state()
    history = load_history()
    goals = load_goals()
    last_seen = set(state.get("last_seen_sessions", []))
    userid = 1
    logger.info("Watcher started. DB=%s", DBPATH)

    while True:
        try:
            if not os.path.exists(DBPATH):
                logger.warning("DB missing: %s", DBPATH)
                await asyncio.sleep(INTERVAL)
                continue

            async with aiosqlite.connect(DBPATH) as db:
                # 1) detect new workout_sessions
                new_rows = await get_latest_workout_rows(db, last_seen)
                for r in new_rows:
                    rid, uid, stype, started_at, duration_sec, tjson, notes = r
                    # record seen
                    last_seen.add(rid)
                    # estimate reps in this row
                    repcount = parse_reps_from_jsonfield(tjson or "")
                    # try parse from notes too
                    if notes:
                        m = re.findall(r"(\d+)\s*reps|\b(\d+)\s*rep\b", notes)
                        for grp in m:
                            for g in grp:
                                if g:
                                    repcount += int(g)
                    # per-pass reaction
                    if repcount >= PER_PASS_THRESHOLD:
                        await bot.send_message(chat_id=CHAT, text=f"Grymt! Ett pass med {repcount} reps registrerat — bra tryck! 💪")
                    elif duration_sec and int(duration_sec) >= 900:
                        await bot.send_message(chat_id=CHAT, text=f"Långt pass (~{int(int(duration_sec) / 60)} min) registrerat — stabilt jobbat!")
                    # check if notes contain a goal
                    if notes:
                        g = parse_goal_from_text(notes)
                        if g:
                            gid = f"{rid}"
                            goals[gid] = {"goal": g, "source": "notes", "session_id": rid, "created": datetime.utcnow().isoformat()}
                            save_goals(goals)
                            await bot.send_message(chat_id=CHAT, text=f"Mål sparat: {g} reps. Jag följer upp! 🎯")

                # 2) compute daily totals across sources
                today = date.today().isoformat()
                prog = await sum_progressive_for_date(db, userid, today)
                ws_reps, ws_minutes = await sum_workout_sessions_for_date(db, userid, today)
                circuit_reps = await sum_circuit_for_date(db, userid, today)
                total_reps_today = prog + ws_reps + circuit_reps
                total_minutes_today = ws_minutes

                # update history and check thresholds/records
                prev_best = max((v.get("reps", 0) for k, v in history.items()), default=0)
                today_hist = history.get(today, {"reps": 0, "minutes": 0})
                # if increased since last check
                if total_reps_today != today_hist.get("reps") or total_minutes_today != today_hist.get("minutes"):
                    history[today] = {"reps": total_reps_today, "minutes": total_minutes_today}
                    save_history(history)
                    # celebrate if crossing PUSH_THRESHOLD
                    if total_reps_today >= PUSH_THRESHOLD and (today_hist.get("reps", 0) < PUSH_THRESHOLD):
                        await bot.send_message(chat_id=CHAT, text=f"Wow — du har nått {total_reps_today} reps idag! Sjukt bra jobbat! 🎉")
                    # check for new record
                    if total_reps_today > prev_best and prev_best > 0:
                        await bot.send_message(chat_id=CHAT, text=f"Ny daglig rekord! {total_reps_today} reps (tidigare bäst {prev_best}). Heja! 🏆")
                    else:
                        # if close to record (>= 90%)
                        if prev_best > 0 and total_reps_today >= int(prev_best * 0.9) and total_reps_today < prev_best:
                            await bot.send_message(chat_id=CHAT, text=f"Snart rekord! Du är uppe i {total_reps_today} reps — bara {prev_best - total_reps_today} kvar till din bästa dag ({prev_best}). 🚀")

                # 3) days since last session (check ALL sources: workout_sessions, progressive_program_days, circuit_sessions)
                days = 999

                # Check workout_sessions
                async with db.execute(
                    "SELECT COALESCE(started_at, created_at) FROM workout_sessions "
                    "WHERE user_id = ? ORDER BY COALESCE(started_at, created_at) DESC LIMIT 1",
                    (userid,)
                ) as cur:
                    row = await cur.fetchone()
                    if row and row[0]:
                        try:
                            last_dt = datetime.fromisoformat(row[0])
                            days = min(days, (date.today() - last_dt.date()).days)
                        except:
                            pass

                # Check progressive_program_days (where you actually train!)
                async with db.execute(
                    "SELECT date FROM progressive_program_days ppd "
                    "JOIN progressive_programs pp ON pp.id = ppd.program_id "
                    "WHERE pp.user_id = ? AND ppd.status = 'done' "
                    "ORDER BY ppd.date DESC LIMIT 1",
                    (userid,)
                ) as cur:
                    row = await cur.fetchone()
                    if row and row[0]:
                        try:
                            last_date = date.fromisoformat(row[0])
                            days = min(days, (date.today() - last_date).days)
                        except:
                            pass

                # Check circuit_sessions
                async with db.execute(
                    "SELECT completed_at FROM circuit_sessions "
                    "WHERE user_id = ? ORDER BY completed_at DESC LIMIT 1",
                    (userid,)
                ) as cur:
                    row = await cur.fetchone()
                    if row and row[0]:
                        try:
                            last_dt = datetime.fromisoformat(row[0])
                            days = min(days, (date.today() - last_dt.date()).days)
                        except:
                            pass

                if days >= DAYS_NO_TRAINING:
                        # send gentle nudge (but only once per threshold; check state timestamp)
                        last_warn = state.get("last_no_training_warn")
                        if not last_warn or (datetime.fromisoformat(last_warn) < datetime.utcnow() - timedelta(days=DAYS_NO_TRAINING)):
                            await bot.send_message(chat_id=CHAT, text=f"Det har gått {days} dagar utan registrerat pass. Hej kompis — dags att röra på sig? Behöver du en liten utmaning? 😏")
                            state["last_no_training_warn"] = datetime.utcnow().isoformat()

                # 4) parse goals from memory files (simple approach)
                memdir = os.path.expanduser("~/treadmill-bot/memory")
                if os.path.exists(memdir):
                    for fname in sorted(os.listdir(memdir))[-7:]:  # check last week files
                        p = os.path.join(memdir, fname)
                        try:
                            with open(p, "r", encoding="utf-8") as f:
                                for line in f:
                                    if "mål" in line.lower() or "goal" in line.lower():
                                        g = parse_goal_from_text(line)
                                        if g:
                                            gid = f"mem-{fname}-{line.strip()[:30]}"
                                            if gid not in goals:
                                                goals[gid] = {"goal": g, "source": "memory", "line": line.strip(), "created": datetime.utcnow().isoformat()}
                                                save_goals(goals)
                                                await bot.send_message(chat_id=CHAT, text=f"Noterat mål från chatten: {g} reps — jag följer upp! 🎯")
                        except Exception:
                            pass

                # persist last_seen & state
                state["last_seen_sessions"] = list(last_seen)
                state["last_checked"] = datetime.utcnow().isoformat()
                save_state(state)

            await asyncio.sleep(INTERVAL)
        except Exception as e:
            logger.exception("Watcher error, retrying")
            await asyncio.sleep(30)


if __name__ == "__main__":
    asyncio.run(main_loop())