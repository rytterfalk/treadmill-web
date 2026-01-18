#!/usr/bin/env node
/**
 * Script to convert all existing audio files to MP3 format
 * This ensures Safari/iOS compatibility
 * 
 * Usage: node scripts/convert-audio-to-mp3.js
 */

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const UPLOAD_DIR = path.join(__dirname, '../uploads');
const DB_PATH = path.join(__dirname, '../data/app.db');

// Check if ffmpeg is available
function checkFfmpeg() {
  return new Promise((resolve) => {
    execFile('ffmpeg', ['-version'], (error) => {
      resolve(!error);
    });
  });
}

// Convert audio file to MP3
function convertToMp3(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', [
      '-i', inputPath,
      '-y',                    // Overwrite output
      '-vn',                   // No video
      '-ar', '44100',          // Sample rate
      '-ac', '1',              // Mono (smaller file)
      '-b:a', '128k',          // Bitrate
      '-f', 'mp3',             // Output format
      outputPath
    ], (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
      } else {
        resolve(outputPath);
      }
    });
  });
}

async function main() {
  console.log('🔊 Audio to MP3 Converter');
  console.log('='.repeat(50));

  // Check ffmpeg
  if (!await checkFfmpeg()) {
    console.error('❌ ffmpeg not found! Please install it first.');
    process.exit(1);
  }
  console.log('✅ ffmpeg found');

  // Check database
  if (!fs.existsSync(DB_PATH)) {
    console.error(`❌ Database not found at ${DB_PATH}`);
    process.exit(1);
  }
  const db = new Database(DB_PATH);
  console.log('✅ Database connected');

  // Find all audio assets that are not MP3
  const audioAssets = db.prepare(`
    SELECT id, filename, mime 
    FROM media_assets 
    WHERE type = 'audio' 
      AND mime != 'audio/mpeg'
      AND filename NOT LIKE '%.mp3'
  `).all();

  console.log(`\n📁 Found ${audioAssets.length} audio files to convert\n`);

  if (audioAssets.length === 0) {
    console.log('✨ Nothing to convert!');
    process.exit(0);
  }

  let converted = 0;
  let failed = 0;

  for (const asset of audioAssets) {
    const inputPath = path.join(UPLOAD_DIR, asset.filename);
    const mp3Filename = asset.filename.replace(/\.[^.]+$/, '.mp3');
    const outputPath = path.join(UPLOAD_DIR, mp3Filename);

    // Check if input file exists
    if (!fs.existsSync(inputPath)) {
      console.log(`⚠️  Skip: ${asset.filename} (file not found)`);
      failed++;
      continue;
    }

    try {
      process.stdout.write(`🔄 Converting: ${asset.filename} ... `);
      
      await convertToMp3(inputPath, outputPath);
      
      // Get new file size
      const newSize = fs.statSync(outputPath).size;
      
      // Update database
      db.prepare(`
        UPDATE media_assets 
        SET filename = ?, mime = 'audio/mpeg', size = ?
        WHERE id = ?
      `).run(mp3Filename, newSize, asset.id);
      
      // Delete original file
      fs.unlinkSync(inputPath);
      
      console.log(`✅ -> ${mp3Filename}`);
      converted++;
    } catch (err) {
      console.log(`❌ Failed: ${err.message}`);
      failed++;
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log(`✅ Converted: ${converted}`);
  console.log(`❌ Failed: ${failed}`);
  console.log('='.repeat(50));

  db.close();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

