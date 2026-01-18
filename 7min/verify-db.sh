#!/bin/bash

# Verify database schema for circuit audio features
DB_PATH="server/db/app.db"

echo "🔍 Verifying database schema for circuit audio features..."
echo ""

# Check if database exists
if [ ! -f "$DB_PATH" ]; then
  echo "❌ Database not found at $DB_PATH"
  exit 1
fi

echo "✅ Database found at $DB_PATH"
echo ""

# Check media_assets table
echo "📋 Checking media_assets table..."
sqlite3 "$DB_PATH" "SELECT sql FROM sqlite_master WHERE type='table' AND name='media_assets';" | head -20
echo ""

# Check circuit_programs table structure
echo "📋 Checking circuit_programs table..."
sqlite3 "$DB_PATH" "PRAGMA table_info(circuit_programs);" | while IFS='|' read -r cid name type notnull dflt_value pk; do
  echo "  - $name ($type)"
done
echo ""

# Check circuit_exercises table structure
echo "📋 Checking circuit_exercises table..."
sqlite3 "$DB_PATH" "PRAGMA table_info(circuit_exercises);" | while IFS='|' read -r cid name type notnull dflt_value pk; do
  echo "  - $name ($type)"
done
echo ""

# Check if intro_audio_asset_id column exists
echo "🔍 Checking for intro_audio_asset_id column..."
if sqlite3 "$DB_PATH" "PRAGMA table_info(circuit_programs);" | grep -q "intro_audio_asset_id"; then
  echo "✅ intro_audio_asset_id column EXISTS"
else
  echo "❌ intro_audio_asset_id column MISSING"
  echo ""
  echo "💡 Run migration to add it:"
  echo "   cd server && node db/migrate.js"
fi
echo ""

# Check if audio columns exist in circuit_exercises
echo "🔍 Checking circuit_exercises audio columns..."
AUDIO_COL=$(sqlite3 "$DB_PATH" "PRAGMA table_info(circuit_exercises);" | grep "audio_asset_id" | wc -l)
REST_AUDIO_COL=$(sqlite3 "$DB_PATH" "PRAGMA table_info(circuit_exercises);" | grep "rest_audio_asset_id" | wc -l)

if [ "$AUDIO_COL" -gt 0 ]; then
  echo "✅ audio_asset_id column EXISTS"
else
  echo "❌ audio_asset_id column MISSING"
fi

if [ "$REST_AUDIO_COL" -gt 0 ]; then
  echo "✅ rest_audio_asset_id column EXISTS"
else
  echo "❌ rest_audio_asset_id column MISSING"
fi
echo ""

# Check for any existing circuit programs with audio
echo "📊 Checking existing circuit programs..."
TOTAL_CIRCUITS=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM circuit_programs;")
echo "  Total circuit programs: $TOTAL_CIRCUITS"

if [ "$TOTAL_CIRCUITS" -gt 0 ]; then
  echo ""
  echo "  Sample circuit program:"
  sqlite3 "$DB_PATH" "SELECT id, title, intro_audio_asset_id FROM circuit_programs LIMIT 1;" | while IFS='|' read -r id title intro; do
    echo "    ID: $id"
    echo "    Title: $title"
    echo "    Intro Audio ID: ${intro:-NULL}"
  done
fi
echo ""

# Check for any media assets
echo "📊 Checking media assets..."
TOTAL_ASSETS=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM media_assets WHERE type='audio';")
echo "  Total audio assets: $TOTAL_ASSETS"

if [ "$TOTAL_ASSETS" -gt 0 ]; then
  echo ""
  echo "  Recent audio assets:"
  sqlite3 "$DB_PATH" "SELECT id, filename, created_at FROM media_assets WHERE type='audio' ORDER BY created_at DESC LIMIT 3;" | while IFS='|' read -r id filename created; do
    echo "    - ID: $id, File: $filename, Created: $created"
  done
fi
echo ""

echo "✅ Database verification complete!"
echo ""
echo "💡 Next steps if columns are missing:"
echo "   cd 7min/server && node db/migrate.js"

