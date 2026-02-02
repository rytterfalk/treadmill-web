/**
 * Helper to regenerate training summary for Lena.
 * Called after workouts, challenges, and progressive programs are saved.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const SUMMARY_SCRIPT = path.join(__dirname, '../../../scripts/generate-summary.py');

function regenerateSummary() {
  if (!fs.existsSync(SUMMARY_SCRIPT)) {
    console.log('Summary script not found:', SUMMARY_SCRIPT);
    return;
  }
  // Run async without waiting
  const proc = spawn('python3', [SUMMARY_SCRIPT], { 
    detached: true, 
    stdio: 'ignore' 
  });
  proc.unref();
}

module.exports = { regenerateSummary };

