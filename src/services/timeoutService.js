/**
 * Timeout service for managing rotation pick timeouts.
 * 
 * This module handles the automatic expiration of rotation picks
 * when users don't respond within the configured timeout period.
 */

const NestedStore = require('../stores/NestedStore');

/**
 * Service for managing rotation pick timeouts.
 */
class TimeoutService {
  /**
   * Creates a new TimeoutService instance.
   * 
   * @param {object} stateStore - The state storage instance
   * @param {Function} onTimeoutCallback - Function to call when a pick times out
   */
  constructor(stateStore, onTimeoutCallback, createBackupCallback = null) {
    this.stateStore = stateStore;
    this.onTimeoutCallback = onTimeoutCallback;
    this.createBackup = createBackupCallback;
    this.timeoutInterval = null;
  }

  /**
   * Starts the timeout reaper that checks for expired picks.
   * Runs every 30 seconds to check for timed-out picks.
   */
  startTimeoutReaper() {
    if (this.timeoutInterval) {
      console.warn('[WARN] Timeout reaper is already running');
      return;
    }

    this.timeoutInterval = setInterval(async () => {
      await this.checkForExpiredPicks();
    }, 30 * 1000); // Check every 30 seconds

    console.log('⏰ Timeout reaper is active.');
  }

  /**
   * Stops the timeout reaper.
   */
  stopTimeoutReaper() {
    if (this.timeoutInterval) {
      clearInterval(this.timeoutInterval);
      this.timeoutInterval = null;
      console.log('[INFO] Timeout reaper stopped');
    }
  }

  /**
   * Checks for expired picks and handles them.
   * This method is called periodically by the timeout reaper.
   */
  async checkForExpiredPicks() {
    const now = Date.now();
    let changed = false;

    // Iterate through all channels and their pick states
    for (const channelId in this.stateStore.data) {
      for (const messageTs in this.stateStore.data[channelId]) {
        try {
          const pick = this.stateStore.getItem(channelId, messageTs);
          
          // Check if this pick has expired
          if (pick.expiresAt && pick.expiresAt < now) {
            changed = true;
            console.log(`[INFO] Pick ${messageTs} expired in ${channelId}: starting next pick`);

            // Call the timeout callback to handle the expired pick
            await this.onTimeoutCallback(channelId, messageTs, pick);
            
            // Remove the expired pick from state
            this.stateStore.deleteItem(channelId, messageTs);
          }
        } catch (err) {
          console.error(`[ERROR] Timeout reaper failure for ${channelId}@${messageTs}:`, err);
        }
      }
    }

    // Save state if any changes were made
    if (changed) {
      this.stateStore.save();
      if (this.createBackup) this.createBackup();
    }
  }

  /**
   * Sets a timeout for a rotation pick.
   * 
   * @param {string} channelId - The Slack channel ID
   * @param {string} messageTs - The message timestamp
   * @param {object} pickData - The pick data to store
   * @param {number} timeoutMinutes - Timeout in minutes (optional)
   */
  setTimeoutForPick(channelId, messageTs, pickData, timeoutMinutes = null) {
    const pickState = { ...pickData };
    
    // Add expiration time if timeout is configured
    if (timeoutMinutes) {
      pickState.expiresAt = new Date().getTime() + (timeoutMinutes * 60 * 1000);
    }
    
    this.stateStore.setItem(channelId, messageTs, pickState);
    this.stateStore.save();
    if (this.createBackup) this.createBackup();
  }

  /**
   * Removes a pick from the timeout tracking.
   * 
   * @param {string} channelId - The Slack channel ID
   * @param {string} messageTs - The message timestamp
   */
  removePickTimeout(channelId, messageTs) {
    this.stateStore.deleteItem(channelId, messageTs);
    this.stateStore.save();
    if (this.createBackup) this.createBackup();
  }

  /**
   * Gets the number of active picks being tracked.
   * 
   * @returns {number} Number of active picks
   */
  getActivePickCount() {
    let count = 0;
    for (const channelId in this.stateStore.data) {
      count += Object.keys(this.stateStore.data[channelId] || {}).length;
    }
    return count;
  }

  /**
   * Gets information about all active picks.
   * 
   * @returns {Array} Array of pick information objects
   */
  getActivePicks() {
    const picks = [];
    for (const channelId in this.stateStore.data) {
      for (const messageTs in this.stateStore.data[channelId]) {
        const pick = this.stateStore.getItem(channelId, messageTs);
        picks.push({
          channelId,
          messageTs,
          ...pick,
          expiresIn: pick.expiresAt ? Math.max(0, pick.expiresAt - Date.now()) : null
        });
      }
    }
    return picks;
  }

  /**
   * Checks if a specific pick is being tracked.
   * 
   * @param {string} channelId - The Slack channel ID
   * @param {string} messageTs - The message timestamp
   * @returns {boolean} True if pick is being tracked
   */
  isPickTracked(channelId, messageTs) {
    return this.stateStore.getItem(channelId, messageTs) !== undefined;
  }

  /**
   * Gets the pick data for a specific message.
   * 
   * @param {string} channelId - The Slack channel ID
   * @param {string} messageTs - The message timestamp
   * @returns {object | null} The pick data or null if not found
   */
  getPickData(channelId, messageTs) {
    return this.stateStore.getItem(channelId, messageTs) || null;
  }
}

module.exports = TimeoutService; 