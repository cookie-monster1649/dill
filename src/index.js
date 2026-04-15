/**
 * Main entry point for Dill Bot.
 * 
 * This file initializes and starts the Dill Bot application.
 * It's designed to be simple and easy to understand.
 */

const DillBot = require('./app');
const fs = require('fs');
const path = require('path');

/**
 * Simple process lock to prevent multiple instances
 */
function createProcessLock() {
  const lockFile = path.join(__dirname, '..', '.dill-bot.lock');
  const pid = process.pid;
  
  try {
    // Check if lock file exists and if the process is still running
    if (fs.existsSync(lockFile)) {
      const existingPid = fs.readFileSync(lockFile, 'utf8').trim();
      try {
        // Check if the process is still running
        process.kill(parseInt(existingPid), 0);
        console.error(`[ERROR] Another instance of Dill Bot is already running (PID: ${existingPid})`);
        console.error('[ERROR] Please stop the other instance before starting a new one.');
        process.exit(1);
      } catch (e) {
        // Process is not running, remove stale lock file
        console.log('[INFO] Removing stale lock file from previous instance');
        fs.unlinkSync(lockFile);
      }
    }
    
    // Create lock file
    fs.writeFileSync(lockFile, pid.toString());
    console.log(`[INFO] Process lock created (PID: ${pid})`);
    
    // Clean up lock file on exit.
    // process.on('exit') fires for any exit path (normal, signal, or exception),
    // so we don't need separate SIGINT/SIGTERM handlers here – those are
    // owned by lifecycle.js which handles graceful shutdown.
    process.on('exit', () => {
      try {
        if (fs.existsSync(lockFile)) {
          fs.unlinkSync(lockFile);
          console.log('[INFO] Process lock removed');
        }
      } catch (e) {
        // Ignore errors during cleanup
      }
    });
    
  } catch (error) {
    console.error('[ERROR] Failed to create process lock:', error);
    process.exit(1);
  }
}

/**
 * Main function to start the bot.
 */
async function main() {
  try {
    // Create process lock to prevent multiple instances
    createProcessLock();
    
    // Create and start the bot
    const bot = new DillBot();
    await bot.start();
  } catch (error) {
    console.error('[ERROR] Failed to start Dill Bot:', error);
    process.exit(1);
  }
}

// Start the application
main();
