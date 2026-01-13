#!/usr/bin/env node
/**
 * One-time script to fix daily_challenge_sets that were incorrectly migrated
 * to new challenges. This moves sets back to the challenge matching their
 * logged_at date.
 * 
 * Run with: node fix-challenge-dates.js
 */

const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'database.sqlite');
const db = new Database(dbPath);

console.log('Analyzing sets with mismatched dates...\n');

// Find all sets where the logged_at date doesn't match the challenge date
const mismatchedSets = db.prepare(`
  SELECT 
    dcs.id as set_id,
    dcs.challenge_id as current_challenge_id,
    dcs.reps,
    dcs.logged_at,
    date(dcs.logged_at) as set_date,
    dc.date as challenge_date,
    dc.user_id,
    dc.exercise
  FROM daily_challenge_sets dcs
  JOIN daily_challenges dc ON dcs.challenge_id = dc.id
  WHERE date(dcs.logged_at) != dc.date
`).all();

console.log(`Found ${mismatchedSets.length} sets with mismatched dates.\n`);

if (mismatchedSets.length === 0) {
  console.log('Nothing to fix!');
  process.exit(0);
}

// Group by what needs to happen
const fixes = [];

for (const set of mismatchedSets) {
  // Find the correct challenge for this set's date
  const correctChallenge = db.prepare(`
    SELECT id, date FROM daily_challenges
    WHERE user_id = ? AND exercise = ? AND date = ?
  `).get(set.user_id, set.exercise, set.set_date);

  if (correctChallenge) {
    fixes.push({
      setId: set.set_id,
      reps: set.reps,
      loggedAt: set.logged_at,
      fromChallengeId: set.current_challenge_id,
      fromDate: set.challenge_date,
      toChallengeId: correctChallenge.id,
      toDate: correctChallenge.date
    });
  } else {
    console.log(`⚠️  No challenge found for set ${set.set_id} (logged ${set.logged_at}, needs challenge for ${set.set_date})`);
  }
}

console.log(`\nWill move ${fixes.length} sets to their correct challenges:\n`);

for (const fix of fixes) {
  console.log(`  Set ${fix.setId}: ${fix.reps} reps @ ${fix.loggedAt}`);
  console.log(`    From challenge ${fix.fromChallengeId} (${fix.fromDate}) → ${fix.toChallengeId} (${fix.toDate})`);
}

// Apply the fixes
console.log('\nApplying fixes...');

const updateStmt = db.prepare(`
  UPDATE daily_challenge_sets SET challenge_id = ? WHERE id = ?
`);

const applyFixes = db.transaction(() => {
  for (const fix of fixes) {
    updateStmt.run(fix.toChallengeId, fix.setId);
  }
});

applyFixes();

console.log(`\n✅ Fixed ${fixes.length} sets!`);

// Verify
const remaining = db.prepare(`
  SELECT COUNT(*) as count
  FROM daily_challenge_sets dcs
  JOIN daily_challenges dc ON dcs.challenge_id = dc.id
  WHERE date(dcs.logged_at) != dc.date
`).get();

if (remaining.count === 0) {
  console.log('✅ All sets now have correct challenge assignments.');
} else {
  console.log(`⚠️  ${remaining.count} sets still have mismatched dates (may need manual review).`);
}

db.close();

